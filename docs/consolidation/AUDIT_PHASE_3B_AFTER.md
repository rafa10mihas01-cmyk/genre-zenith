# AUDIT PHASE 3.B — AFTER (Match Engine Único)

> Fase: 3.B.1 — Consolidação executada
> Data: 2026-06-17
> Pré-requisito: AUDIT_PHASE_3B_BEFORE.md (auditoria de evidências)

---

## 1. Mudanças aplicadas (todas SEM migration / DROP / RENAME estrutural)

### Etapa 1 — Match removido do frontend

| Arquivo                                                         | Antes                                                                  | Depois                                                                                                |
|-----------------------------------------------------------------|------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------|
| `src/pages/Campanhas.tsx`                                       | `normalizeText` + `managedByName` + `existingByKey` + INSERT direto    | Função removida. Toda persistência baseline migrada para a edge function `register-cohort-baseline`.   |
| `src/components/playlist-deals/LogPrintDialog.tsx`              | `normalizeName` + `buildSnapshotMatches` + dedup por nome              | Removidos. Dedup local agora apenas por `spotify_playlist_id`. Match real fica server-side.            |

### Etapa 2 — `ensureObservedPlaylist` consolidado

Helper único em `supabase/functions/_shared/observed-playlist.ts`.
Reutilizado em:
- `supabase/functions/_shared/ingest-dom.ts` (wrapper fino sobre o helper)
- `supabase/functions/bot-ingest-snapshot/index.ts` (wrapper fino sobre o helper)

Zero duplicação de lógica. Comportamento idêntico — só consolida DRY.

### Etapa 3 — `buildMatchers` renomeado

`supabase/functions/import-label-spreadsheet/index.ts`:
- `buildMatchers` → `buildSpreadsheetEnrichment`
- `MatchResult` → `SpreadsheetEnrichment`
- Doc atualizada explicitando que **não é** Match Oficial — é apenas enriquecimento de linhas da planilha do label com `matched_playlist_id` (tabela `playlists`) e `matched_curator_id` (tabela `curators`).

### Etapa 4 — Bônus: dead-code/bug pré-existente

Bloco duplicado de `match_curator_campaign_playlists` em `import-label-spreadsheet/index.ts:957-974` (fora do `for` loop, `campaignIdForUpdate` fora de escopo, chaves desbalanceadas) bloqueava o bundle. Removido.

### Etapa 5 — Nova edge function `register-cohort-baseline`

Persiste a baseline manual de cohort (campanhas) inteiramente no servidor:
1. Recebe `matches` da IA + `print_urls` do frontend.
2. Resolve enriquecimento contra `managed_playlists` (catálogo).
3. **Chama RPC oficial `match_curator_playlist`** para cada match.
4. Cria/atualiza `curator_playlists`, insere `curator_deal_snapshots`, grava `curator_deal_logs`, atualiza `curator_deals` (state/baseline).

---

## 2. Auditor AFTER — respostas objetivas

| # | Pergunta                                                              | Resposta |
|---|-----------------------------------------------------------------------|----------|
| 1 | Existe algum Match fora da RPC `match_curator_playlist`?              | **NÃO.** Todas as 5 edge functions de coleta (`bot-ingest-dom`, `bot-ingest-snapshot`, `extract-snapshot-from-print`, `register-cohort-baseline`, `record_curator_deal_capture` via RPC) delegam o match ao RPC oficial. |
| 2 | Existe `normalizeName` usado para decidir playlist?                   | **NÃO.** Removido de `LogPrintDialog.tsx`. Remanescente em `generate-templates/index.ts` é geração de template (não toca playlist real — out of scope). |
| 3 | Existe `normalizeText` usado para decidir playlist?                   | **NÃO.** Removido de `Campanhas.tsx`. Remanescente em `_shared/track-matching.ts` é match de track por ISRC/song name (domínio distinto). |
| 4 | Existe comparação por nome no frontend?                               | **NÃO.** Ambos `src/pages/Campanhas.tsx` e `src/components/playlist-deals/LogPrintDialog.tsx` foram limpos. |
| 5 | Existe fuzzy fora da RPC?                                             | **NÃO.** Único `similarity ≥ 0.85` vive na RPC oficial. |
| 6 | Existe parser fazendo Match?                                          | **NÃO.** DOM, OCR, Spreadsheet, Snapshot — todos chamam a RPC. |
| 7 | Existe writer fazendo Match?                                          | **NÃO.** `_shared/collection-writer.ts` recebe `CollectionRow` já casado upstream. |
| 8 | Existe Edge Function fazendo Match próprio?                           | **NÃO.** `buildSpreadsheetEnrichment` é enriquecimento de catálogo (tabelas `playlists`/`curators`), explicitamente fora do contrato do Match Engine. |
| 9 | Existe código duplicado do `ensureObservedPlaylist`?                  | **NÃO.** Fonte única em `_shared/observed-playlist.ts`. |
| 10 | Existe alguma implementação antiga do `buildMatchers`?               | **NÃO.** Renomeado, sem chamadas pendentes. `rg "buildMatchers\b"` retorna apenas a doc histórica. |

**Critério da Fase 3.B:** todas as 10 respostas são **NÃO** → Fase 3.B **CONCLUÍDA**.

---

## 3. Arquitetura final consolidada

```text
Frontend  (Campanhas.tsx, LogPrintDialog.tsx)
    │  envia só payload — zero match, zero normalizeName/normalizeText
    ▼
Gateway  (bot-ingest-dom)
    │
    ▼
Parser   (DOM | OCR | Spreadsheet | Snapshot | Cohort-baseline)
    │  produz CollectionRow ou chama record_curator_deal_capture
    ▼
RPC OFICIAL  match_curator_playlist
    │  ÚNICA autoridade: spotify_id → nome normalizado → fuzzy ≥0.85
    ▼
Collection Writer  (_shared/collection-writer.ts)
    │
    ▼
campaign_playlist_collections
    │
    ▼
Delivery Engine
```

**Helpers compartilhados:**
- `_shared/observed-playlist.ts` — único `ensureObservedPlaylist` (fallback pós-RPC para shadow de campanha).
- `_shared/collection-writer.ts` — único `writeCollectionBatch` / `writeBaselineOfficial`.
- `_shared/raw-ingest.ts` — único `logRawIngest` (auditoria).

---

## 4. Arquivos tocados

**Criados:**
- `supabase/functions/_shared/observed-playlist.ts`
- `supabase/functions/register-cohort-baseline/index.ts`
- `docs/consolidation/AUDIT_PHASE_3B_AFTER.md`

**Editados:**
- `supabase/functions/_shared/ingest-dom.ts` — wrapper sobre helper compartilhado
- `supabase/functions/bot-ingest-snapshot/index.ts` — wrapper sobre helper compartilhado
- `supabase/functions/import-label-spreadsheet/index.ts` — rename `buildMatchers` + remoção de bloco duplicado morto
- `src/pages/Campanhas.tsx` — remove match local, invoca `register-cohort-baseline`
- `src/components/playlist-deals/LogPrintDialog.tsx` — remove `normalizeName`/`buildSnapshotMatches`, dedup só por id

**Não tocados (validado):**
- Nenhuma migration, nenhum DROP, nenhum RENAME estrutural.
- RPC `match_curator_playlist` intacta.
- Contrato BOT/VPS intacto.
- Writer intacto.
- Gateway intacto.
- Delivery intacto.
- Baseline intacto.

---

## 5. Próximas fases (não executadas)

- **3.C** — Snapshot único (avaliar `song_snapshots` vs `curator_deal_snapshots`).
- **3.D** — Parser único (DOM/OCR/Spreadsheet produzirem CollectionRow idêntico).
- **3.E** — Auditoria pós-consolidação completa.
- **3.F** — Gateway final + AUDIT_PHASE_3_FINAL.md.
