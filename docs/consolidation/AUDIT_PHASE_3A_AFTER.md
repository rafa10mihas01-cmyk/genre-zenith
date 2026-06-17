# AUDIT PHASE 3.A.1 — AFTER (Gateway Único de Ingestão)

> Fase: 3.A.1 — Consolidação do Gateway de Ingestão
> Data: 2026-06-17
> Metodologia: idêntica às Fases 1.A e 2.A (Auditor BEFORE → Consolidação → Auditor AFTER, sem DROP enquanto houver dependências).
> Escopo: APENAS arquitetura. Nenhuma regra de negócio, cálculo, match, baseline, delivery, frontend, contrato do bot ou payload do VPS foi alterado.

---

## 1. Gateway Oficial

**`bot-ingest-dom`** é, a partir desta fase, o **Gateway Oficial de Ingestão**.

Responsabilidades exclusivas:

| Responsabilidade            | Implementação                                                                 |
|----------------------------|-------------------------------------------------------------------------------|
| Autenticação                | `isAuthorizedBot(req)` (x-bot-key / x-bot-token / Bearer)                     |
| Validação                   | parsing JSON + normalização single/batch                                      |
| `raw_ingest` obrigatório    | `logRawIngest(..., endpoint: "bot-ingest-dom", ...)` antes de qualquer escrita |
| Roteamento                  | `processDomItem()` por item → match RPC → writer                              |
| Observabilidade             | `collection_logs (acao=bot_ingest_dom)` + `recordMetric(...)`                 |
| Métricas                    | `recordMetric(scope=bot, operation=bot-ingest-dom)`                           |
| Envio ao parser/writer      | `processDomItem` (parser DOM) → `writeBaselineOfficial` / `writeCollectionBatch` (writer único) |

Nenhum outro endpoint executa esse conjunto de responsabilidades.

---

## 2. Mudanças aplicadas nesta fase

### 2.1 Writer Único — `_shared/collection-writer.ts` (NOVO)

Novo módulo compartilhado, único ponto autorizado a escrever em `campaign_playlist_collections`:

- `writeBaselineOfficial(...)` — re-export do helper anterior (`_shared/baseline-writer.ts`), preservando contrato.
- `writeCollectionBatch(supabase, { writer, campaign_id, intent, rows, snapshot_run_id?, upload_id?, default_source? })` — novo, generaliza `baseline` e `periodic`, suporta vinculação opcional de `upload_id` (rastreabilidade de planilha).
- Contrato único `CollectionRow = { spotify_playlist_id, playlist_name?, playlist_url?, plays_7d?, captured_at?, source? }` — todos os parsers entregam esse shape.

`_shared/baseline-writer.ts` permanece como módulo interno (compatibilidade — regra "nome ≠ responsabilidade"), apenas re-exportado pelo writer oficial. Nenhuma Edge Function importa mais `baseline-writer.ts` diretamente.

### 2.2 `bot-heartbeat` — deixou de gravar coleta

Antes: `dom_snapshots[]` era processado localmente via `processDomItem` (gravava direto em `curator_deal_snapshots`, `curator_deal_logs`, etc.).

Depois: heartbeat **delega** o lote ao Gateway Oficial via HTTP interno:

```ts
POST {SUPABASE_URL}/functions/v1/bot-ingest-dom
  x-bot-key: <BOT_API_KEY|BOT_INGEST_TOKEN>
  body: { items: dom_snapshots }
```

O heartbeat agora só grava em:
- `bot_heartbeats` (status do bot)
- `vps_nodes` (last_heartbeat_at)
- `collection_logs` (registro operacional do delegate, `acao=bot_ingest_dom_delegated`)
- `cron_health` (amostragem)

Nenhuma escrita em tabelas de coleta acontece dentro de `bot-heartbeat`. O contrato `docs/BOT_VPS_HEARTBEAT_DOM_PIGGYBACK.md` é preservado — para o cliente HTTP, o comportamento é idêntico.

### 2.3 `import-label-spreadsheet` — passa pelo writer

Antes:
- `admin.rpc("ingest_campaign_collection_batch", ...)` chamado direto.
- `admin.from("campaign_playlist_collections").update({ upload_id })` chamado direto.
- Sem `logRawIngest`.

Depois:
- Adicionado `logRawIngest(..., endpoint: "import-label-spreadsheet", ...)` no início do handler (com `file_base64` e `client_token` redacted).
- Substituído o bloco RPC + UPDATE por uma única chamada a `writeCollectionBatch(admin, { ..., upload_id })`.
- Contrato de linhas convertido para `CollectionRow` (`spotify_playlist_id`/`playlist_name`/`playlist_url`/`plays_7d`/`source`).

### 2.4 `extract-snapshot-from-print` — `raw_ingest` adicionado

Antes: parser OCR não registrava `bot_ingest_raw` (era coberto indiretamente por `bot-upload-print`).

Depois: registra `bot_ingest_raw` com `endpoint = extract-snapshot-from-print` independentemente do chamador (preserva auditoria do parser propriamente dito). Continua escrevendo em `campaign_playlist_collections` **exclusivamente via `writeBaselineOfficial` do `collection-writer.ts`**.

### 2.5 Imports — todos via `collection-writer.ts`

```
$ rg "baseline-writer" supabase/functions/ | grep -v "_shared/baseline-writer.ts"
supabase/functions/_shared/collection-writer.ts:31: } from "./baseline-writer.ts";  ← re-export interno
supabase/functions/_shared/collection-writer.ts:35: // Re-exports — ...
```

Todos os consumidores (`_shared/ingest-dom.ts`, `extract-snapshot-from-print`, `bot-ingest-snapshot`, `import-label-spreadsheet`) agora importam exclusivamente de `_shared/collection-writer.ts`.

---

## 3. AUDITOR AFTER

| # | Pergunta                                                                                           | Resposta |
|---|----------------------------------------------------------------------------------------------------|----------|
| 1 | Existe apenas um Gateway Oficial?                                                                  | **Sim** — `bot-ingest-dom`. Demais endpoints são parsers, adapters ou puro lifecycle. |
| 2 | Existe algum endpoint gravando diretamente em `campaign_playlist_collections`?                     | **Não.** `rg 'from("campaign_playlist_collections")' supabase/functions` retorna apenas leituras (`register-curator-playlist`, `get-curator-deal-public`). O writer único é o único caminho de INSERT/UPSERT. |
| 3 | Existe algum endpoint sem `raw_ingest`?                                                            | **Não** entre os portais de coleta auditados (`bot-ingest-dom`, `bot-ingest-snapshot`, `bot-ingest-song-snapshot`, `bot-upload-print`, `extract-snapshot-from-print`, `import-label-spreadsheet`). `bot-heartbeat` não grava coleta — delega ao gateway que faz o log; `bot-event-ingest` é lifecycle (fora do escopo). |
| 4 | Existe algum writer paralelo em `campaign_playlist_collections`?                                   | **Não.** Único módulo: `_shared/collection-writer.ts` (que internamente reusa `baseline-writer.ts` como wrapper de compat). |
| 5 | Existe algum parser gravando diretamente em `campaign_playlist_collections`?                       | **Não.** Parsers DOM/OCR/Spreadsheet/Snapshot entregam `CollectionRow` ao writer. |
| 6 | Existe algum bypass do Gateway (heartbeat, cron, frontend) que escreva sem passar pelo writer?     | **Não.** Heartbeat delega; crons (`daily-collect`) acionam o pipeline via gateway/parsers; frontend só lê. |
| 7 | Existe algum fluxo que ainda não passa pelo Collection Writer?                                     | **Não.** Todas as escritas em `campaign_playlist_collections` originadas na aplicação passam por `writeBaselineOfficial` ou `writeCollectionBatch`. |

**Conclusão:** todas as respostas são **NÃO**. A Fase 3.A.1 está **CONCLUÍDA**.

---

## 4. Fluxo final consolidado

```
Bot (VPS)
  │
  ├─► bot-heartbeat  ── (dom_snapshots? delega via HTTP) ──┐
  │                                                         ▼
  └─► bot-ingest-dom  ◄── (gateway oficial) ◄────────── (delegate)
            │
            ├── logRawIngest("bot-ingest-dom")
            ├── processDomItem (parser DOM)
            │     ├── match RPC oficial (match_curator_playlist)
            │     ├── curator_deal_snapshots (delta)
            │     └── isBaseline → writeBaselineOfficial(...) ──┐
            │                                                    ▼
            └── recordMetric / collection_logs            collection-writer.ts
                                                                 │
Parsers paralelos (mesmo writer):                                │
  • extract-snapshot-from-print (OCR)  ──► CollectionRow ──┐    │
  • import-label-spreadsheet    (XLSX) ──► CollectionRow ──┼────┤
  • bot-ingest-snapshot         (adapter snapshot legado) ─┘    │
                                                                 ▼
                                          ingest_campaign_collection_batch (RPC SQL)
                                                                 │
                                                                 ▼
                                                campaign_playlist_collections
                                                                 │
                                                                 ▼
                                       fn_playlist_delivery_accumulated
                                                                 │
                                                                 ▼
                                                  campaigns.total_delivered
                                                                 │
                                                                 ▼
                                              vw_campaign_playlist_growth
                                                                 │
                                                                 ▼
                                                              Frontend
```

---

## 5. O que NÃO foi alterado (regra de escopo)

- Nenhuma migration SQL — RPC `ingest_campaign_collection_batch`, view `vw_campaign_playlist_growth`, function `fn_playlist_delivery_accumulated`, trigger `recompute_campaign_total_delivered` permanecem **intactos**.
- Nenhuma alteração de business logic, cálculo, baseline, match ou delivery.
- Nenhuma alteração no contrato do bot (VPS) — `dom_snapshots[]` em heartbeat continua sendo aceito; o pipeline interno foi reorganizado.
- Nenhum DROP, RENAME ou remoção de Edge Function. `_shared/baseline-writer.ts` mantido pra compatibilidade (regra "nome ≠ responsabilidade").
- Frontend não foi tocado (esperado: consolidação 100% backend).

---

## 6. Próxima fase

**Fase 3.B — Match Engine Único**: consolidar implementações de match na RPC oficial `match_curator_playlist`. Iniciar com `AUDIT_PHASE_3B_BEFORE.md`.
