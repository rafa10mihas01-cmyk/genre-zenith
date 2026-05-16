# Wave 1 — Track Ecosystem Score

Objetivo: criar a **camada base de inteligência** que vai alimentar tudo depois (análise de playlists, recomendações, execução). Sem essa camada confiável, as Waves 2 e 3 não fazem sentido.

Nada de UI de recomendação ainda. Nada de execução. Só **score + página de debug** pra você validar se os sinais batem com a realidade.

---

## O que será construído

### 1. Tabela `track_ecosystem_score`

Uma linha por `spotify_track_id`, recalculada periodicamente. Guarda o "raio-x" de cada faixa dentro do ecossistema NexEngine.

Campos principais (além de id/timestamps):

- `spotify_track_id` (unique)
- `track_name`, `artist_name` (denormalizado pra debug rápido)
- **Crescimento** (vindo dos snapshots de Spotify for Artists):
  - `streams_total`
  - `streams_7d`, `streams_28d`
  - `growth_7d_pct`, `growth_28d_pct`
  - `acceleration` (derivada — diferença entre growth 7d e 28d)
- **Presença no ecossistema**:
  - `managed_playlist_count` (em quantas playlists nossas está)
  - `curator_playlist_count` (em quantas playlists de curadores está)
  - `total_playlist_count`
  - `deal_active_count` (em quantos `curator_deals` ativos aparece)
- **Diagnóstico**:
  - `saturation_index` (0–1: muita presença + pouco crescimento = saturada)
  - `frequency_score` (0–1)
  - `momentum_class`: `subindo` | `forte` | `estavel` | `caindo` | `saturada` | `fraca` | `sem_dados`
  - `confidence` (0–1: baseado em quantidade de snapshots disponíveis)
- `last_snapshot_at`, `calculated_at`

RLS: leitura para usuários autenticados, escrita só via service_role (edge function).

Índices em `spotify_track_id`, `momentum_class`, `calculated_at`.

### 2. Edge function `calculate-track-ecosystem-score`

Roda em batch. Para cada faixa relevante:

1. Coleta últimos N snapshots (`spotify_artist_snapshots` ou equivalente que já existe).
2. Calcula streams 7d/28d e % de crescimento.
3. Conta presença em `managed_playlists` + `curator_playlists` (estado atual).
4. Conta `curator_deals` ativos.
5. Calcula `acceleration`, `saturation_index`, `frequency_score`.
6. Classifica `momentum_class` por regras claras (não ML — regras determinísticas, auditáveis).
7. Upsert em `track_ecosystem_score`.

Suporta dois modos:
- `mode: "full"` — recalcula tudo
- `mode: "single", track_id: "..."` — recalcula uma faixa (pra debug/teste)

### 3. Job agendado (pg_cron)

1x por dia, madrugada (ex: 04:00 BRT). Chama a edge function em modo `full`.

### 4. Página de debug `/sistema?tab=ecosystem-score`

Nova aba dentro de **Admin > Infra > Sistema** (já existe deep-link via `?tab=`). Mostra:

- Tabela com todas as faixas e seus scores
- Filtros por `momentum_class`, `confidence`, busca por nome/artista
- Coluna "raio-x" expansível mostrando os números crus (streams 7d/28d, presença, snapshots usados)
- Botão "Recalcular esta faixa" (chama edge function modo single)
- Botão "Recalcular tudo" (chama modo full, com confirmação)
- Última execução do job + status

Sem ações de recomendação. Só leitura + recálculo. O objetivo dessa página é **você bater o olho e dizer "esses números fazem sentido"**.

---

## Regras de classificação (`momentum_class`)

Determinísticas, ajustáveis depois:

```text
sem_dados   → confidence < 0.3 (poucos snapshots)
subindo     → growth_7d > 20% E acceleration > 0
forte       → growth_28d > 50% E presença alta E não saturada
estavel     → |growth_28d| <= 10%
caindo      → growth_28d < -15%
saturada    → presença alta (top 20%) E growth_28d < 5%
fraca       → presença baixa E growth_28d <= 0
```

Valores serão constantes nomeadas no topo da edge function pra você tunar fácil depois de ver os dados reais.

---

## Detalhes técnicos

- **Fonte de snapshots**: vou verificar exatamente qual tabela contém os snapshots S4A (`spotify_artist_snapshots`, `track_snapshots`, etc) antes de escrever a query.
- **Performance**: se a base de tracks for grande (>10k), o job processa em lotes de 500 com `Promise.all` controlado.
- **Idempotência**: upsert por `spotify_track_id`.
- **Sem dependência externa nova**: só Postgres + edge function + pg_cron (já habilitado).
- **Sem mudança no bot**: zero impacto na coleta atual.

---

## Entregáveis Wave 1

1. Migração: tabela `track_ecosystem_score` + RLS + índices
2. Edge function `calculate-track-ecosystem-score`
3. Cron job 1x/dia
4. Página de debug em `/sistema?tab=ecosystem-score`
5. Item "Ecosystem Score" no submenu de Sistema na sidebar

---

## Critério de sucesso (pra liberar Wave 2)

Você abre a página de debug, olha 20 faixas que conhece bem, e fala:
- "Essa tá subindo mesmo" ✅
- "Essa tá saturada, faz sentido" ✅
- "Essa tá classificada errada" → ajustamos os thresholds

Quando 80%+ das classificações baterem com seu julgamento manual, Wave 2 (análise de playlists + UI de recomendação read-only) está liberada.

---

## Fora de escopo nessa Wave

- ❌ Análise por playlist
- ❌ UI de recomendações (Add/Remove/Reorder)
- ❌ Tabela `playlist_recommendations`
- ❌ Execução automática
- ❌ Mudanças na coleta do bot

Posso começar pela migração + verificação das tabelas de snapshot existentes?
