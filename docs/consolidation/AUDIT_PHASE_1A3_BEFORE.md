# Auditor BEFORE — Fase 1.A.3
**Alvos:** `curator_deal_logs.is_baseline` · `curator_playlists.is_baseline`
**Gerado:** 2026-06-17

> Auditor bruto: `AUDIT_PHASE_1A3_BEFORE_RAW.md` (144 + 162 dependências).

---

## 🚨 Achado central

Nenhuma das duas colunas é redundante com `campaign_playlist_collections`. As três estruturas respondem perguntas de negócio diferentes:

| Estrutura | Pergunta de negócio | Grão |
|---|---|---|
| `campaign_playlist_collections` (Fase 1.A.1) | "Quais playlists faziam parte do plano da **campanha**?" | (campaign, playlist) |
| `curator_deal_snapshots.is_initial_capture` (Fase 1.A.2) | "Quantos plays tinha cada playlist no início da série de medição?" | (deal, song, playlist, captured_at) |
| `curator_deal_logs.is_baseline` (esta fase) | "Este log foi o registro da **primeira captura** do deal/song?" | 1 linha por evento de captura (independente da quantidade de playlists) |
| `curator_playlists.is_baseline` (esta fase) | "Esta playlist já estava ligada ao **deal/song** no momento da captura inicial?" | (deal, song, playlist) |

São quatro camadas distintas. Resumindo:
- **campaign** = fotografia da **campanha** (plano).
- **deal_snapshots** = fotografia de **contadores de plays** (série temporal).
- **deal_logs** = marcação de **eventos** de captura (ledger event-level).
- **deal_playlists** = roster de playlists do **deal** (composição inicial vs adições posteriores).

---

## Respostas obrigatórias

### 1. Responsabilidade

| Coluna | Pergunta exclusiva |
|---|---|
| `curator_deal_logs.is_baseline` | "Este log é o evento inicial de captura do deal/song?" |
| `curator_playlists.is_baseline` | "Esta playlist já existia no roster do deal/song quando começou a medição?" |

Nenhuma das duas perguntas é respondida hoje por outro componente oficial **no grão correto**. `campaign_playlist_collections` responde no grão de campanha (não deal). `curator_deal_snapshots.is_initial_capture` responde no grão de snapshot de plays (não de log/playlist).

### 2. Fonte oficial equivalente

**Não existe.** Tentativas anteriores de unificar (fases 1.A.1 e 1.A.2) chegaram à conclusão arquitetural de que cada grão precisa do seu próprio marcador "inicial".

Observação importante: 38 das 77 playlists com `is_baseline=true` estão em deals **sem campaign_id** (ver tabela abaixo). Para esses deals, `campaign_playlist_collections` é, por definição (regra da Fase 1.A.1), vazio. Logo, mesmo conceitualmente, `campaign_playlist_collections` não cobre o roster desses deals.

```
has_campaign | is_baseline | count
-------------+-------------+------
 false       | false       | 168
 false       | true        |  38   ← não há campanha → cpc não cobre
 true        | false       | 227
 true        | true        |  39
```

### 3. Quem grava

#### `curator_deal_logs.is_baseline`
- Edge Functions: `bot-ingest-snapshot`, `import-label-spreadsheet`, `extract-snapshot-from-print`, `simulate-campaign-flow`, `_shared/ingest-dom.ts` (via `record_curator_deal_capture`).
- SQL: função `record_curator_deal_capture` (insert oficial do log).
- Triggers: nenhum trigger grava — só `trg_enforce_song_id_logs` valida.

#### `curator_playlists.is_baseline`
- Edge Functions: `bot-ingest-snapshot`, `extract-snapshot-from-print`, `_shared/ingest-dom.ts`, `register-curator-playlist`, `enrich-curator-paste`, `import-label-spreadsheet`.
- SQL: `record_curator_deal_capture` (default no insert), trigger `trg_enforce_curator_playlist_baseline` (não escreve — bloqueia inserts inconsistentes).
- Nenhum bot/worker escreve direto fora dos canais acima.

### 4. Quem lê

#### `curator_deal_logs.is_baseline`
- Frontend: `PlaylistDeals.tsx` (badge "tem baseline"), `HeatmapEntregas.tsx` (exclui baseline da série), `CampanhaExecucao.tsx` (uploads baseline vs operacionais), `DealDetail.tsx`, `CuratorPage.tsx`.
- RPC/SQL: `get_curator_deal_snapshot_history` (separar log inicial dos demais).
- Edge Functions: `get-curator-deal-public`, `get-client-campaign-public`, `extract-snapshot-from-print` (deduplicação).

#### `curator_playlists.is_baseline`
- Frontend: `CuratorPage.tsx` (separa baseline de adicionadas), `DealDetail.tsx` (conta playlists baseline).
- RPC/SQL: `get_curator_deal_breakdown`, `get_curator_deal_snapshot_history`, `record_curator_deal_capture`, trigger `enforce_curator_playlist_baseline` (regra: não pode marcar baseline=true em playlist que não está em `campaign_playlist_collections` quando há campanha).
- Edge Functions: `get-curator-deal-public` (filtro `match_status=curator OR is_baseline=true` — define o que é "playlist do deal"), `register-curator-playlist` (decide se nova playlist herda baseline), `enrich-curator-paste`.

### 5. Necessidade

**SIM, ambas representam regra de negócio ativa:**

- `curator_deal_logs.is_baseline` separa o **primeiro evento de captura** (que define o ponto zero) de capturas subsequentes. Usado em UI ("primeira captura"), em cálculos de série temporal (excluir baseline pra não duplicar) e em retenção (não expira capturas baseline).
- `curator_playlists.is_baseline` define o **roster inicial** do deal — playlists que já estavam quando a medição começou vs playlists adicionadas depois pelo curador. É a base do cálculo de entrega de novas playlists e do filtro "playlists do deal" no portal público do curador.

A coluna `attribution_method` (existente em `curator_playlists`) usa o padrão `'baseline_observed'` reforçando o conceito — não é redundância, é metadata complementar.

---

## Critério de decisão aplicado

> "Se qualquer uma das duas colunas representar uma responsabilidade própria e ainda válida, **não executar o DROP**."

Ambas representam responsabilidades próprias e ativas. **DROP fica bloqueado.**

---

## Reescopo proposto (análogo à Fase 1.A.2)

O termo "baseline" foi reservado, na Fase 1.A.2, exclusivamente pra `campaign_playlist_collections`. As duas colunas dessa fase violam essa convenção e geram ambiguidade. Proponho **Opção B (rename, sem DROP)**, mantendo a regra arquitetural:

### Renomeações sugeridas

| De | Para | Justificativa |
|---|---|---|
| `curator_deal_logs.is_baseline` | `is_initial_capture` | Mesma semântica usada em `curator_deal_snapshots` na Fase 1.A.2 — "marco inicial da série de capturas". |
| `curator_playlists.is_baseline` | `is_initial_roster` | Representa "playlist já estava no roster quando começou a medição". Distinto de "baseline da campanha". |

**Custo estimado:** 144 + 162 = ~306 ocorrências em código (frontend, edge functions, RPC). Sem mudança de regra de negócio.

### Alternativas

- **Opção A — Aceitar como arquitetura oficial sem rename.** Encerra a Fase 1.A.3 sem mudanças. Convive com 3 colunas chamadas `is_baseline` em tabelas diferentes, cada uma com semântica própria.
- **Opção C — DROP** (não recomendado, viola o critério estabelecido).

---

**Aguardo decisão entre Opção A (aceitar e encerrar), Opção B (rename), ou solicitação de investigação adicional antes de qualquer ação.**
