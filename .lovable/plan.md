# Wave 2 — Inteligência por Playlist + Recomendações Read-Only

Wave 1 entregou o raio-x **por faixa**. Wave 2 vira a câmera 90° e olha **por playlist**: como cada playlist está performando, quais faixas estão "puxando" ou "puxando pra baixo", e o que faz sentido adicionar/remover. Tudo **observação + sugestão**. Humano decide.

---

## 1. Tabela `playlist_ecosystem_score`

Uma linha por playlist (curator ou managed), recalculada periodicamente.

Campos principais:

- `playlist_id` (FK curator_playlists ou managed_playlists)
- `playlist_kind`: `curator` | `managed`
- `playlist_name`, `curator_name` (denormalizado)
- **Volume**:
  - `track_count` (faixas nossas ativas nela)
  - `total_streams` (soma dos cumulativos das nossas faixas nela)
  - `streams_7d`, `streams_28d` (soma dos plays_7d/28d das nossas faixas nela)
- **Saúde**:
  - `growth_28d_pct` (delta agregado da playlist nas últimas semanas)
  - `avg_track_momentum` (média ponderada dos momentum_class das faixas)
  - `pct_subindo`, `pct_caindo`, `pct_saturada` (composição)
- **Diagnóstico**:
  - `health_class`: `aquecida` | `estavel` | `esfriando` | `saturada` | `subutilizada` | `sem_dados`
  - `efficiency_score` (0–1: streams por faixa nossa vs benchmark)
  - `confidence` (0–1: baseado em snapshots disponíveis)
- `last_snapshot_at`, `calculated_at`

RLS: leitura autenticada, escrita só service_role.

## 2. Tabela `track_playlist_fit`

Sugestões **read-only** geradas pelo motor: "essa faixa faz sentido nessa playlist?".
Uma linha por par (track, playlist) com score relevante.

Campos:
- `spotify_track_id`, `playlist_id`, `playlist_kind`
- `fit_score` (0–100)
- `fit_reason`: array de tags (`genre_match`, `momentum_alinhado`, `curador_aceita_estilo`, `playlist_aquecida`, `gap_de_repertorio`)
- `recommendation_kind`: `adicionar` | `remover` | `reorganizar` | `manter`
- `evidence`: jsonb com os números crus que justificam (pra debug)
- `already_present` (boolean — está na playlist hoje?)
- `confidence` (0–1)
- `calculated_at`

**Importante:** essa tabela é cache de sugestão. Nada aqui executa nada. UI lê e mostra. Humano decide.

## 3. Edge function `calculate-playlist-ecosystem-score`

Modos: `full` | `single` (playlist_id).
Para cada playlist:
1. Lista as faixas nossas presentes (via `curator_playlists.song_id` ou `managed_playlists`).
2. Junta com `track_ecosystem_score` pra pegar momentum/streams já calculado.
3. Agrega: soma streams, calcula % por momentum_class, calcula growth da playlist via snapshots agregados.
4. Classifica `health_class` por regras determinísticas.
5. Upsert em `playlist_ecosystem_score`.

## 4. Edge function `calculate-track-playlist-fit`

Modos: `full` | `single` (track_id ou playlist_id).
Heurísticas determinísticas (sem ML):
- **Gap detection**: faixa `subindo` ou `forte` que NÃO está em playlist `aquecida` do mesmo gênero do curador → `adicionar` com fit alto.
- **Saturação**: faixa `saturada` presente em playlist `esfriando` há muito tempo → `remover`.
- **Reorganizar**: faixa `subindo` em playlist mas em posição ruim (se tivermos posição) → flag.
- **Manter**: faixa `estavel` + playlist `estavel` → confirma status quo.

Cada sugestão guarda `evidence` (jsonb) com os números brutos: "streams_7d=X, growth=Y%, playlist health=Z" pra você auditar.

## 5. Cron

`calculate-playlist-ecosystem-score`: 1x/dia, 04:30 BRT (depois do score de track).
`calculate-track-playlist-fit`: 1x/dia, 05:00 BRT.

## 6. UI: nova aba `/sistema?tab=playlist-score`

Mesma cara da tela de Wave 1 (tabela densa, filtros, expand pra raio-x). Mostra todas as playlists com health_class, top faixas, faixas problemáticas. Botão "Recalcular esta playlist".

## 7. UI: `/sistema?tab=recomendacoes`

A **tela de curadoria assistida** que você descreveu no prompt original. Read-only.

Layout:
- **Filtros no topo**: tipo (adicionar/remover/reorganizar), curador, gênero, fit mínimo, confidence mínima.
- **Lista de cards de recomendação**, cada um:
  - Faixa (nome + artista + momentum badge)
  - → Playlist alvo (nome + curador + health badge)
  - Fit score grande (ex: `87 / 100`)
  - Tags de motivo (`genre_match`, `momentum_alinhado`, etc)
  - Botão **"Ver evidência"** → drawer com os números crus (track_ecosystem_score + playlist_ecosystem_score lado a lado)
  - Botão **"Marcar como vista"** (registra que você revisou, sem executar nada)
  - Botão **"Descartar"** (registra que rejeitou a sugestão — feedback pra ajustar pesos depois)

Sem botão "Adicionar agora". Sem execução. O humano abre o Spotify e age — ou, em wave futura, dispara um deal manualmente.

Pra trackear visto/descartado: tabela leve `recommendation_feedback (user_id, fit_id, action, created_at)`.

---

## Critério de sucesso (pra liberar Wave 3)

Você abre a tela de recomendações, olha as primeiras 30 sugestões e fala:
- "Faz sentido, eu faria isso" → 70%+
- "Não faria, mas entendo o motivo" → 20%
- "Tá errado" → ajustamos thresholds/pesos

Quando bater 70%+, Wave 3 (execução assistida via deals + tracking de impacto) está liberada.

---

## Fora de escopo nessa Wave

- ❌ Executar adição/remoção
- ❌ Criar deals automaticamente
- ❌ ML / embeddings (continua tudo regra determinística)
- ❌ Alertas push/email
- ❌ Mudanças no bot

---

## Sequência sugerida de entrega

1. Migração: `playlist_ecosystem_score` + `track_playlist_fit` + `recommendation_feedback` + RLS + índices
2. Edge function `calculate-playlist-ecosystem-score` + tela debug `?tab=playlist-score`
3. **Pausa pra você validar** os números da playlist (mesmo critério da Wave 1)
4. Edge function `calculate-track-playlist-fit` + tela `?tab=recomendacoes`
5. Cron jobs
6. Iteração de thresholds com base no seu feedback

Posso começar pela migração + edge function de playlist score?
