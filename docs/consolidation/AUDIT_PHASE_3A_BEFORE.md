# AUDIT_PHASE_3A_BEFORE — Gateway Único de Ingestão NexEngine

> **Gerado em:** 2025-06-10 (read-only, zero alterações)  
> **Auditor:** NexEngine Forensic Auditor  
> **Regras:** 100% leitura. Todas as evidências citam `file:line`.

---

## PARTE 1 — Inventário de Portas de Entrada

### 1.1 `bot-ingest-dom`

| Campo | Valor |
|---|---|
| **Arquivo** | `supabase/functions/bot-ingest-dom/index.ts` |
| **HTTP** | `POST` |
| **verify_jwt (config.toml)** | `false` |
| **Auth custom** | `x-bot-key` OU `x-bot-token` OU `Authorization: Bearer` → compara com `BOT_API_KEY` ou `BOT_INGEST_TOKEN` |
| **Payload** | Single: `{ deal_id, song_id, playlists: [{playlist_name, spotify_url, plays_24h, plays_7d, plays_28d}], note? }` · Batch: `{ items: [...] }` |
| **Tabelas escritas** | `bot_ingest_raw` (via logRawIngest) · `curator_deal_snapshots` · `curator_deal_logs` · `organic_plays_snapshots` · `curator_playlists` · `campaign_eco_snapshots` (shadow deals) |
| **Usa `_shared/raw-ingest.ts`** | ✅ SIM — `index.ts:55-57` |
| **Usa `_shared/ingest-dom.ts`** | ✅ SIM — `processDomItem` importado em `index.ts:9` |

**Resumo de payload aceito:**
```ts
// Single
{ deal_id: uuid, song_id: uuid, playlists: DomItem["playlists"], note?: string }
// Batch
{ items: Array<{ deal_id, song_id, playlists, note? }> }
```

---

### 1.2 `bot-heartbeat`

| Campo | Valor |
|---|---|
| **Arquivo** | `supabase/functions/bot-heartbeat/index.ts` |
| **HTTP** | `POST` |
| **verify_jwt (config.toml)** | `false` |
| **Auth custom** | `x-bot-key` OU `x-bot-token` OU `Authorization: Bearer` → `BOT_API_KEY` ou `BOT_INGEST_TOKEN` |
| **Payload** | `{ status?, spotify_session_valid?, message?, metadata?, dom_snapshots?: DomItem[], bot_name?, worker_id?, hostname?, timer_id?, processing_correlation_ids?: string[] }` |
| **Tabelas escritas** | `bot_heartbeats` (index.ts:58) · `vps_nodes` (index.ts:72) · `collection_logs` (index.ts:112) · `curator_deal_snapshots` + `curator_deal_logs` + `organic_plays_snapshots` (via `processDomItem` quando `dom_snapshots` presente) |
| **Usa `_shared/raw-ingest.ts`** | ❌ NÃO — sem `logRawIngest` |
| **Usa `_shared/ingest-dom.ts`** | ✅ SIM — `processDomItem` importado em `index.ts:7` (piggyback) |

**Piggyback DOM:** quando `body.dom_snapshots[]` está presente, itera e chama `processDomItem` para cada item — mesma lógica de `bot-ingest-dom`, porém **sem** log em `bot_ingest_raw`. Evidência: `index.ts:95-119`.

---

### 1.3 `bot-event-ingest`

| Campo | Valor |
|---|---|
| **Arquivo** | `supabase/functions/bot-event-ingest/index.ts` |
| **HTTP** | `POST` |
| **verify_jwt (config.toml)** | `false` |
| **Auth custom** | `x-bot-token` OU `x-bot-key` OU `Authorization: Bearer` → `BOT_INGEST_TOKEN` ou `BOT_API_KEY` |
| **Payload** | Array ou objeto único: `[{ bot_name, session_id, deal_id, song_id, step, status, message, screenshot_url, url, duration_ms, metadata, correlation_id, lifecycle_state, discard_reason, worker_id, process_id, hostname, timer_id }]` |
| **Tabelas escritas** | `bot_events` (`index.ts:90`) |
| **Usa `_shared/raw-ingest.ts`** | ❌ NÃO |
| **Usa `_shared/ingest-dom.ts`** | ❌ NÃO |

---

### 1.4 `bot-ingest` (legado observer)

| Campo | Valor |
|---|---|
| **Arquivo** | `supabase/functions/bot-ingest/index.ts` |
| **HTTP** | `POST` |
| **verify_jwt (config.toml)** | não listado (default `true`) |
| **Auth custom** | `Authorization: Bearer <BOT_INGEST_TOKEN>` — compara token literal |
| **Payload** | `{ action: "list_playlists_to_observe" | "observe_playlist" | "log_run_start" | "log_run_end", playlist_id?, snapshot?, hostname?, run_id?, playlists_processed?, status?, error? }` |
| **Tabelas escritas** | `playlists_to_observe` (read) · `playlist_observations` (insert, `index.ts:56`) · `observer_runs` (insert/update, `index.ts:68,80`) |
| **Usa `_shared/raw-ingest.ts`** | ❌ NÃO |
| **Usa `_shared/ingest-dom.ts`** | ❌ NÃO |

**Nota:** importa de `npm:@supabase/supabase-js@2/cors` (path incorreto — padrão legado). Responsabilidade: registro de run do observer de playlists, não coleta de deals/plays.

---

### 1.5 `bot-ingest-snapshot`

| Campo | Valor |
|---|---|
| **Arquivo** | `supabase/functions/bot-ingest-snapshot/index.ts` |
| **HTTP** | `POST` |
| **verify_jwt (config.toml)** | não listado (default `true`) |
| **Auth custom** | `x-bot-key` OU `x-bot-token` OU `Authorization: Bearer` → `BOT_API_KEY` ou `BOT_INGEST_TOKEN` |
| **Payload** | Modo agregado: `{ deal_id, song_id, plays/plays_total, plays_24h, plays_7d, plays_28d, print_url?, correlation_id?, source? }` · Modo breakdown: `{ deal_id, song_id, total_plays, snapshots: [{playlist_name, spotify_url, plays}], note?, print_urls?, print_taken?, error?, correlation_id? }` |
| **Tabelas escritas** | `bot_ingest_raw` (logRawIngest, `index.ts:56-62`) · `bot_print_batches` · `curator_deal_logs` · `curator_deal_songs` · `curator_deals` · `curator_deal_snapshots` · `campaign_playlist_collections` · `organic_plays_snapshots` · `collection_logs` |
| **Usa `_shared/raw-ingest.ts`** | ✅ SIM — `index.ts:56-62` |
| **Usa `_shared/ingest-dom.ts`** | ❌ NÃO |

**Arquivo extenso:** 770 linhas. Contém 2 modos de payload (agregado/breakdown) + gate de ciclo de vida de deal.

---

### 1.6 `bot-ingest-song-snapshot`

| Campo | Valor |
|---|---|
| **Arquivo** | `supabase/functions/bot-ingest-song-snapshot/index.ts` |
| **HTTP** | `POST` |
| **verify_jwt (config.toml)** | não listado (default `true`) |
| **Auth custom** | `x-bot-key` OU `x-bot-token` OU `Authorization: Bearer` → `BOT_API_KEY` ou `BOT_INGEST_TOKEN` |
| **Payload** | `{ song_id?, catalog_track_id?, queue_id?, spotify_song_id?, correlation_id?, captured_at?, window?, total_plays_28d?, screenshot_url?, print_urls?: string[], playlists: [{spotify_playlist_id, name, owner, plays_7d}], bot_metadata? }` |
| **Tabelas escritas** | `bot_ingest_raw` (logRawIngest, `index.ts:78-84`) · `bot_print_batches` · `song_snapshots` · `song_snapshot_playlists` · `campaign_playlist_collections` · `curator_deal_songs` · `curator_deal_logs` |
| **Usa `_shared/raw-ingest.ts`** | ✅ SIM — `index.ts:78-84` |
| **Usa `_shared/ingest-dom.ts`** | ❌ NÃO |

**Dual-mode:** deals (`song_id`) e catálogo (`catalog_track_id`). Quando catálogo, pula lógica de deal/campanha.

---

### 1.7 `bot-upload-print`

| Campo | Valor |
|---|---|
| **Arquivo** | `supabase/functions/bot-upload-print/index.ts` |
| **HTTP** | `POST` |
| **verify_jwt (config.toml)** | não listado (default `true`) |
| **Auth custom** | `x-bot-key` OU `x-bot-token` OU `Authorization: Bearer` → `BOT_API_KEY` ou `BOT_INGEST_TOKEN` |
| **Payload** | `multipart/form-data` (file PNG + deal_id, song_id, label?) OU `application/octet-stream` (query params: `?deal_id=&song_id=&label=`) |
| **Tabelas escritas** | `bot_ingest_raw` (logRawIngest, `index.ts:233-237`) · `bot_print_batches` (insert/update) · `bot_events` (PRINT_UPLOADED) |
| **Usa `_shared/raw-ingest.ts`** | ✅ SIM — `index.ts:233-237` |
| **Usa `_shared/ingest-dom.ts`** | ❌ NÃO |

**Pipeline delegado:** quando batch completar (todas partes `playlists-part-X-of-Y`), dispara `extract-snapshot-from-print` via `supabase.functions.invoke`.

---

### 1.8 `extract-snapshot-from-print`

| Campo | Valor |
|---|---|
| **Arquivo** | `supabase/functions/extract-snapshot-from-print/index.ts` |
| **HTTP** | `POST` |
| **verify_jwt (config.toml)** | não listado (default `true`) |
| **Auth custom** | `x-bot-key` OU `Authorization: Bearer` |
| **Payload** | `{ deal_id: uuid, song_id?: uuid, print_urls: string[], batch_id?: uuid, correlation_id?: uuid, dom_playlists?: [{position, name, url, made_by, plays_text, plays_24h, plays_7d, plays_28d}] }` |
| **Tabelas escritas** | `curator_deal_snapshots` · `curator_deal_logs` · `organic_plays_snapshots` · `bot_print_batches` · `bot_events` |
| **Usa `_shared/raw-ingest.ts`** | ❌ NÃO — 1504 linhas, sem logRawIngest |
| **Usa `_shared/ingest-dom.ts`** | ❌ NÃO — lógica própria via Gemini Vision |

**OCR Engine:** chama Gemini 2.5 Pro para extração de playlists do print. Maior função do namespace (1.504 linhas).

---

### 1.9 `import-label-spreadsheet`

| Campo | Valor |
|---|---|
| **Arquivo** | `supabase/functions/import-label-spreadsheet/index.ts` |
| **HTTP** | `POST` |
| **verify_jwt (config.toml)** | não listado (default `true`) |
| **Auth custom** | `client_token` no body (portal público) ou JWT de equipe |
| **Payload** | `{ client_token, file_base64, file_name, mode: "preview" | "commit" }` — aceita XLSX ou CSV |
| **Tabelas escritas** | `label_spreadsheet_uploads` · `label_spreadsheet_rows` · `curator_deal_snapshots` · `campaign_playlist_collections` · `curator_deal_logs` |
| **Usa `_shared/raw-ingest.ts`** | ❌ NÃO |
| **Usa `_shared/ingest-dom.ts`** | ❌ NÃO |

**Frontend:** chamada direta do frontend em `src/components/client-portal/SpreadsheetUploadCard.tsx:159,186`.

---

### 1.10 `collect-batch` (DEPRECATED Fase 1)

| Campo | Valor |
|---|---|
| **Arquivo** | `supabase/functions/collect-batch/index.ts` |
| **HTTP** | `POST` |
| **verify_jwt** | default `true` |
| **Auth custom** | `requireTeamAccess` (JWT equipe) |
| **Payload** | `{ genre_ids: string[], terms_per_genre?, max_results?, delay_ms?, force?, skip_enrich?, enrich_limit? }` |
| **Tabelas escritas** | `collection_logs` (indiretamente via `run-search`, `analyze-genre`) |
| **Usa `_shared/raw-ingest.ts`** | ❌ NÃO |
| **Usa `_shared/ingest-dom.ts`** | ❌ NÃO |
| **Status** | 🔴 `deprecationGate` ativo (`index.ts:41`) |

**Domínio:** coleta de gêneros/Apify. Não é porta de ingestão de deals/bot.

---

### 1.11 `daily-collect` (DEPRECATED Fase 1)

| Campo | Valor |
|---|---|
| **Arquivo** | `supabase/functions/daily-collect/index.ts` |
| **HTTP** | `POST` |
| **verify_jwt** | default `true` |
| **Auth custom** | `requireTeamAccess` (JWT equipe) |
| **Payload** | vazio (cron) |
| **Tabelas escritas** | `collection_logs` (via `run-search`, `analyze-genre`) |
| **Usa `_shared/raw-ingest.ts`** | ❌ NÃO |
| **Usa `_shared/ingest-dom.ts`** | ❌ NÃO |
| **Status** | 🔴 `deprecationGate` ativo (`index.ts:14`) |

**Domínio:** cron diário de coleta Apify de gêneros. Não recebe payload de bot.

---

### 1.12 `observer-ingest-tracks`

| Campo | Valor |
|---|---|
| **Arquivo** | `supabase/functions/observer-ingest-tracks/index.ts` |
| **HTTP** | `POST` |
| **verify_jwt** | não listado (default `true`) |
| **Auth custom** | `x-bot-token` ou `x-bot-key` → `BOT_INGEST_TOKEN` ou `BOT_API_KEY` |
| **Payload** | `{ spotify_playlist_id, correlation_id?, tracks: [{spotify_track_id, position, name, artist, album_name, album_cover_url, duration_ms}] }` |
| **Tabelas escritas** | `observer_playlist_tracks` (upsert, `index.ts:57`) |
| **Usa `_shared/raw-ingest.ts`** | ❌ NÃO |
| **Usa `_shared/ingest-dom.ts`** | ❌ NÃO |

**Domínio:** coleta de tracklist de playlists públicas pelo observer. Não toca em deals/plays.

---

## PARTE 2 — Responsabilidades (pergunta de negócio)

| Porta | Pergunta de negócio que responde |
|---|---|
| `bot-ingest-dom` | **"Quais playlists e plays gerou essa música nos deals ativos?"** — processa snapshot DOM do Spotify for Artists com breakdowns por playlist |
| `bot-heartbeat` | **"O bot ainda está vivo e a sessão Spotify é válida?"** — sinal de vida + estado da sessão; piggyback de DOM é secundário |
| `bot-event-ingest` | **"O que o bot fez a cada passo deste dispatch?"** — log de lifecycle granular por `correlation_id` |
| `bot-ingest` (legado) | **"Qual é a fila de playlists a observar e o resultado desta rodada do observer?"** — registro de run do observer antigo, não de coleta de deals |
| `bot-ingest-snapshot` | **"Qual o total de plays/breakdown de playlists desta música neste deal?"** — endpoint histórico do bot VPS, aceita formato agregado e breakdown |
| `bot-ingest-song-snapshot` | **"Quais playlists estavam tocando esta música no Spotify for Artists neste momento?"** — snapshot unificado (deal ou catálogo), armazena `song_snapshots` + `song_snapshot_playlists` |
| `bot-upload-print` | **"Aqui está um print de evidência desta coleta"** — armazenamento de PNG em Storage, agrupamento por batch, disparo de OCR |
| `extract-snapshot-from-print` | **"O que está escrito neste print? Extrai as playlists e plays via Gemini Vision"** — OCR/AI para transformar imagem em dados estruturados |
| `import-label-spreadsheet` | **"A gravadora enviou uma planilha com dados de playlists; importar e cruzar com nosso catálogo"** — canal externo de gravadoras |
| `collect-batch` | **"Executar batch de discovery de gêneros via Apify"** — domínio de descoberta, não de deals |
| `daily-collect` | **"Cron diário de discovery de gêneros"** — idêntico ao collect-batch, automatizado |
| `observer-ingest-tracks` | **"Quais faixas estão na playlist X hoje?"** — tracklist snapshot de playlists públicas |

**Regra aplicada:** nome ≠ responsabilidade. `bot-ingest` (sem sufixo) não é o gateway de ingestão — é o endpoint legado do observer de playlists. `bot-ingest-snapshot` e `bot-ingest-song-snapshot` têm nomes similares mas armazenam em tabelas diferentes (`curator_deal_snapshots` vs `song_snapshots`).

---

## PARTE 3 — Sobreposições

### 3.1 Sobreposição CRÍTICA: `bot-heartbeat.dom_snapshots` ↔ `bot-ingest-dom`

**Ambos processam o mesmo tipo de dado** (playsMap de playlists por deal) com a **mesma lógica** (`processDomItem` de `_shared/ingest-dom.ts`), mas por caminhos diferentes:

| Aspecto | `bot-ingest-dom` | `bot-heartbeat` (piggyback) |
|---|---|---|
| Propósito declarado | Ingestão de DOM | Sinal de vida + estado Spotify |
| Grava `bot_ingest_raw` | ✅ SIM (`index.ts:55`) | ❌ NÃO |
| Usa `processDomItem` | ✅ SIM (`index.ts:9`) | ✅ SIM (`index.ts:7`) |
| Payload DOM | campo raiz `{ deal_id, song_id, playlists }` | campo `dom_snapshots: DomItem[]` aninhado |
| Evidência no código | `bot-ingest-dom/index.ts:55-90` | `bot-heartbeat/index.ts:95-119` |

**Risco:** coletas enviadas via heartbeat piggyback **não geram registro em `bot_ingest_raw`**, tornando invisíveis na auditoria de raw payloads.

---

### 3.2 Sobreposição ALTA: `bot-ingest-snapshot` ↔ `bot-ingest-song-snapshot`

Ambos recebem dados de "snapshot de música do Spotify for Artists", mas divergem na tabela-destino:

| Aspecto | `bot-ingest-snapshot` | `bot-ingest-song-snapshot` |
|---|---|---|
| Tabela principal | `curator_deal_logs` + `curator_deal_snapshots` | `song_snapshots` + `song_snapshot_playlists` |
| Exige `deal_id` | ✅ obrigatório | ❌ opcional (aceita só `catalog_track_id`) |
| Aceita payload agregado | ✅ SIM (total plays sem breakdown) | ❌ NÃO (exige `playlists[]`) |
| Integra com campanha | ✅ via `campaign_playlist_collections` | ✅ via `campaign_playlist_collections` |
| Evidência sobreposição | `bot-ingest-snapshot/index.ts:479,517,550` | `bot-ingest-song-snapshot/index.ts:192,232,324` |

**Risco:** o VPS pode chamar qualquer um dos dois para a mesma coleta, gerando dados duplicados em tabelas distintas com semântica diferente.

---

### 3.3 Sobreposição MÉDIA: `bot-ingest-snapshot` ↔ `extract-snapshot-from-print`

Ambos gravam em `curator_deal_snapshots` e `curator_deal_logs` para o mesmo `deal_id`/`song_id`:

- `bot-ingest-snapshot`: a partir de dados já estruturados (JSON)
- `extract-snapshot-from-print`: a partir de imagens (OCR via Gemini) — mas o resultado final é o mesmo registro

Se o bot envia tanto o JSON estruturado via `bot-ingest-snapshot` quanto os prints via `bot-upload-print` → `extract-snapshot-from-print`, a mesma coleta pode ser gravada **duas vezes** em `curator_deal_snapshots`.

Evidência: `bot-ingest-snapshot/index.ts:517-555` e `extract-snapshot-from-print/index.ts:428,458`.

---

## PARTE 4 — Uso de raw-ingest

### Funções que JÁ logam em `bot_ingest_raw` (via `logRawIngest`):

| Função | Arquivo:linha |
|---|---|
| `bot-ingest-dom` | `index.ts:55-57` |
| `bot-ingest-snapshot` | `index.ts:56-62` |
| `bot-ingest-song-snapshot` | `index.ts:78-84` |
| `bot-upload-print` | `index.ts:233-237` |

### Funções que NÃO logam em `bot_ingest_raw`:

| Função | Observação |
|---|---|
| `bot-heartbeat` | Processa DOM via piggyback sem raw log — **lacuna crítica** |
| `bot-event-ingest` | Evento de lifecycle, não payload de coleta — ausência aceitável |
| `bot-ingest` (legado) | Observer de playlists, não coleta de deals — ausência tolerável |
| `extract-snapshot-from-print` | Recebe URLs (não payload bruto de bot direto) — parcialmente aceitável, mas deveria logar a chamada do bot |
| `import-label-spreadsheet` | Fonte externa (gravadora), não bot VPS — ausência aceitável |
| `observer-ingest-tracks` | Observer de tracklist, não coleta de deals — ausência aceitável |
| `collect-batch` / `daily-collect` | Deprecated Fase 1 — irrelevante |

---

## PARTE 5 — Candidato a Gateway Oficial

### Recomendação: **`bot-ingest-dom`** como Gateway Único de Ingestão de Plays

**Justificativa:**

| Critério | Evidência |
|---|---|
| ✅ Já recebe o maior volume de coletas de deals | É o endpoint primário descrito no BOT_VPS_CONTRACT.md para coleta de playlists/plays por deal |
| ✅ Já usa `logRawIngest` (rastreabilidade) | `bot-ingest-dom/index.ts:55-57` |
| ✅ Já centraliza lógica em `_shared/ingest-dom.ts` | `processDomItem` — single source of truth, `index.ts:9` |
| ✅ Suporte a batch nativo | `{ items: [...] }` — `index.ts:63-65` |
| ✅ `verify_jwt = false` em config.toml | Pronto para chamada direta do bot sem JWT |
| ✅ Auth dupla (`BOT_API_KEY` + `BOT_INGEST_TOKEN`) | `isAuthorizedBot()` — `index.ts:23-32` |
| ✅ Já integra com `collection_logs` e `recordMetric` | Observabilidade completa — `index.ts:78-97` |
| ✅ Único endpoint onde heartbeat piggyback deveria ser absorvido | Consolida o fluxo paralelo do heartbeat |

**Complemento:** `bot-upload-print` → `extract-snapshot-from-print` continua como **pipeline de evidência fotográfica** (OCR), mas deve ser considerado um **parser delegado**, não uma segunda porta de ingestão de plays.

---

## PARTE 6 — Plano de Consolidação (sem executar)

| Porta | Classificação | Ação recomendada |
|---|---|---|
| `bot-ingest-dom` | 🟢 **GATEWAY OFICIAL** | Promover. Recebe todos os payloads de plays/playlists. Adicionar suporte a `catalog_track_id` (hoje só `bot-ingest-song-snapshot` tem). |
| `bot-heartbeat` | 🟡 **MANTER COMO ENDPOINT DEDICADO** | Responsabilidade legítima: sinal de vida + estado Spotify + `vps_nodes`. Remover piggyback DOM (`dom_snapshots`) — o bot deve chamar `bot-ingest-dom` diretamente para ingestão. Adicionar `logRawIngest` para dom_snapshots se mantido. |
| `bot-event-ingest` | 🟢 **MANTER COMO ENDPOINT DEDICADO** | Responsabilidade diferente: lifecycle log por `correlation_id`. Não toca em plays/snapshots. |
| `bot-ingest` (legado) | 🔴 **DEPRECAR** | Observer legado — funcionalidade substituída por `observer-ingest-tracks` + `bot-collect-queue`. Sem referência no BOT_VPS_CONTRACT.md atual. |
| `bot-ingest-snapshot` | 🟡 **CONVERTER EM PARSER** | Migrar consumidores VPS para `bot-ingest-dom` (DOM breakdown) ou `bot-ingest-song-snapshot` (snapshot por música). Manter temporariamente com deprecationGate para compatibilidade. |
| `bot-ingest-song-snapshot` | 🟡 **CONVERTER EM PARSER** | Lógica de `song_snapshots` pode ser delegada ao gateway; ou manter como endpoint especializado para o fluxo de catálogo (`catalog_track_id`). Avaliar após Fase 3B. |
| `bot-upload-print` | 🟢 **MANTER COMO ENDPOINT DEDICADO** | Responsabilidade específica: recepção de PNG + Storage + batch assembly. É um **pré-processador** que delega ao parser OCR. |
| `extract-snapshot-from-print` | 🟡 **CONVERTER EM PARSER** | Já é chamado internamente por `bot-upload-print`. Nunca deve ser chamado diretamente pelo bot — apenas via invocação interna. Adicionar guard. |
| `import-label-spreadsheet` | 🟢 **MANTER COMO ENDPOINT DEDICADO** | Responsabilidade diferente: canal de gravadoras (XLSX/CSV). Autenticação diferente (client_token). |
| `observer-ingest-tracks` | 🟢 **MANTER COMO ENDPOINT DEDICADO** | Domínio diferente: tracklist de playlists públicas. Não toca em deals/plays. |
| `collect-batch` | 🔴 **JÁ DEPRECATED** (Fase 1) | `deprecationGate` ativo. Aguardar kill-switch. |
| `daily-collect` | 🔴 **JÁ DEPRECATED** (Fase 1) | `deprecationGate` ativo. Aguardar kill-switch. |

---

## PARTE 7 — Riscos

### 7.1 Frontend que chama Edge Functions de ingestão diretamente

```
src/components/client-portal/SpreadsheetUploadCard.tsx:159   → import-label-spreadsheet (preview)
src/components/client-portal/SpreadsheetUploadCard.tsx:186   → import-label-spreadsheet (commit)
src/pages/Settings.tsx:310                                   → daily-collect (deprecated)
src/pages/Campanhas.tsx:471                                  → analyze-deal-prints
src/components/campanhas/BaselineAwaitingBanner.tsx:123      → bot-collect-queue
src/components/playlist-deals/LogPrintDialog.tsx:332         → analyze-deal-prints
```

**Riscos:**
- `Settings.tsx:310` chama `daily-collect` que tem `deprecationGate`. Se `DEPRECATED_PHASE1_ENABLED=true`, UI quebra silenciosamente.
- `import-label-spreadsheet` é chamado diretamente do frontend público — qualquer mudança de contrato quebra o portal do cliente.

### 7.2 Crons que invocam funções de ingestão

> **Varredura realizada via `rg "deprecationGate\|deprecation"` + docs/DEPRECATION_PHASE1.md**

Crons identificados com relação ao pipeline de ingestão:
- `recover-stuck-auto-collect` (jobid 28) — 5 min — chama lógica de re-enfileiramento de `curator_deal_songs`. Não chama diretamente as portas de ingestão, mas afeta o estado que `bot-collect-queue` lê.
- `backfill-dead-genres-6h` (jobid 19) → `cron-backfill-dead` (deprecated)
- `learning-loop-daily` (jobid 8) → `learning-loop` (deprecated)

**Nenhum cron chama diretamente `bot-ingest-dom`, `bot-ingest-snapshot` ou `bot-ingest-song-snapshot`** — essas funções são invocadas exclusivamente pelo bot VPS.

### 7.3 Contrato bot/VPS que quebraria

O `docs/BOT_VPS_CONTRACT.md` define explicitamente como endpoints contratuais:
- `POST /bot-event-ingest` — não pode ser removido
- `POST /bot-upload-print` — não pode ser removido  
- `POST /bot-heartbeat` — não pode ser removido
- `GET /bot-collect-queue` — não pode ser removido
- `GET /bot-execution-queue` — não pode ser removido
- `POST /bot-execution-complete` — não pode ser removido

**Não mencionados no contrato** (portanto candidatos a consolidação/deprecação sem quebra de contrato externo):
- `bot-ingest-snapshot` — VPS ainda usa, mas não está no contrato formal
- `bot-ingest-song-snapshot` — idem
- `bot-ingest` (legado observer) — não está no contrato

### 7.4 Lacuna de auditoria: piggyback sem raw log

`bot-heartbeat` processa DOM via `dom_snapshots[]` **sem** chamar `logRawIngest`. Qualquer coleta que passe por esse caminho é **invisível em `bot_ingest_raw`**. Isso é um risco de auditoria forense, não apenas de consolidação.

Evidência: `bot-heartbeat/index.ts:95-119` — chama `processDomItem` mas não importa `raw-ingest.ts`.

### 7.5 Modo agregado legado: risco de rejeição silenciosa

`bot-ingest-snapshot` (`index.ts:83-143`) rejeita payload agregado para deals de campanha interna com `422 playlist_breakdown_required`. Se o VPS não tratar esse 422 e tentar `bot-ingest-dom` como fallback, nenhum dado é gravado para aquela coleta.

---

## Resumo de Evidências por Função

```
bot-ingest-dom/index.ts:9          → import processDomItem (shared)
bot-ingest-dom/index.ts:23-32      → isAuthorizedBot (BOT_API_KEY + BOT_INGEST_TOKEN)
bot-ingest-dom/index.ts:55-57      → logRawIngest ✅
bot-ingest-dom/index.ts:63-65      → suporte a batch (items[])
bot-ingest-dom/index.ts:78-97      → collection_logs + recordMetric

bot-heartbeat/index.ts:7           → import processDomItem (piggyback)
bot-heartbeat/index.ts:58          → bot_heartbeats.insert
bot-heartbeat/index.ts:72          → vps_nodes.update
bot-heartbeat/index.ts:95-119      → dom_snapshots loop (SEM raw-ingest) ❌

bot-event-ingest/index.ts:90       → bot_events.insert

bot-ingest/index.ts:56             → playlist_observations.insert (legado)
bot-ingest/index.ts:68,80          → observer_runs.insert/update (legado)

bot-ingest-snapshot/index.ts:56-62 → logRawIngest ✅
bot-ingest-snapshot/index.ts:224   → bot_print_batches.insert
bot-ingest-snapshot/index.ts:550   → curator_deal_snapshots.insert

bot-ingest-song-snapshot/index.ts:78-84 → logRawIngest ✅
bot-ingest-song-snapshot/index.ts:192   → song_snapshots.insert
bot-ingest-song-snapshot/index.ts:232   → song_snapshot_playlists.insert

bot-upload-print/index.ts:233-237  → logRawIngest ✅
bot-upload-print/index.ts:355,374  → bot_print_batches.insert/update
bot-upload-print/index.ts:459      → bot_events.insert (PRINT_UPLOADED)

extract-snapshot-from-print/index.ts:428,458 → curator_deal_snapshots.insert
extract-snapshot-from-print/index.ts:766,824 → curator_deal_logs.insert
extract-snapshot-from-print/index.ts:1144    → organic_plays_snapshots.insert
                                             → SEM logRawIngest ❌

import-label-spreadsheet/index.ts:583,610 → label_spreadsheet_uploads
import-label-spreadsheet/index.ts:665     → label_spreadsheet_rows
import-label-spreadsheet/index.ts:797     → curator_deal_snapshots
import-label-spreadsheet/index.ts:906     → campaign_playlist_collections
import-label-spreadsheet/index.ts:938     → curator_deal_logs
                                          → SEM logRawIngest ❌

observer-ingest-tracks/index.ts:57  → observer_playlist_tracks.upsert
                                    → SEM logRawIngest ❌

collect-batch/index.ts:41           → deprecationGate ativo 🔴
daily-collect/index.ts:14           → deprecationGate ativo 🔴

_shared/ingest-dom.ts               → processDomItem (single source of truth)
_shared/raw-ingest.ts:105           → logRawIngest (assinatura pública)

config.toml                         → verify_jwt=false: bot-event-ingest, bot-heartbeat, bot-ingest-dom
```

---

*Fim do relatório — zero arquivos alterados.*
