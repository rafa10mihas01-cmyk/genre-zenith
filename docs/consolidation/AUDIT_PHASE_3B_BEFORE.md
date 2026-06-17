# AUDIT PHASE 3.B — BEFORE (Match Engine Único)

> Fase: 3.B — Consolidação do Match Engine
> Data: 2026-06-17
> Metodologia: Auditoria forense. **Nenhuma alteração executada** nesta etapa.
> Pré-requisito atendido: Fase 3.A.1 concluída (Gateway + Writer únicos).

---

## 1. RPC oficial — `public.match_curator_playlist`

Definida em `pg_proc`:

```
match_curator_playlist(p_deal_id uuid, p_spotify_playlist_id text,
                       p_playlist_name text, p_song_id uuid DEFAULT NULL)
  RETURNS TABLE(playlist_id uuid, match_method text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
```

Ordem do algoritmo (exatamente a regra oficial pedida):

1. `spotify_playlist_id` (chave oficial) → retorna `match_method='spotify_id'`
2. Nome normalizado (lower + translate acentos + regex `[^a-zA-Z0-9]+ → ' '` + trim) → retorna `'name'`
3. Fuzzy via `similarity(...)` (pg_trgm) com cutoff `≥ 0.85` → retorna `'fuzzy'`

`url` não é critério próprio — apenas usado **fora** da RPC pra extrair `spotify_playlist_id` via regex `playlist[/:]([a-zA-Z0-9]{16,})`. ✅ Conforme regra.

Conclusão: a RPC já implementa a ordem oficial. **Nenhuma alteração necessária.**

---

## 2. Inventário de toda implementação que envolve match

| # | Arquivo                                                     | Símbolo                              | Responsabilidade                                                                                        | Critério                                                       | Chama RPC? | Status                                              |
|---|-------------------------------------------------------------|--------------------------------------|---------------------------------------------------------------------------------------------------------|----------------------------------------------------------------|------------|-----------------------------------------------------|
| 1 | SQL `public.match_curator_playlist`                         | RPC                                  | **OFICIAL** — identificar `curator_playlists` no deal                                                   | spotify_id → nome normalizado → fuzzy ≥0.85                    | —          | ✅ Match Engine Oficial                              |
| 2 | SQL `public.match_curator_campaign_playlists`               | RPC                                  | Promove `curator_campaign_playlists.status: pending_match → matched` quando há vínculo real             | Join SQL — não classifica playlist nova                        | —          | ✅ Responsabilidade diferente (status, não match)    |
| 3 | `supabase/functions/_shared/ingest-dom.ts:199`              | `processDomItem`                     | Parser DOM — chama RPC pra cada playlist do payload                                                     | — (delega à RPC)                                               | ✅          | ✅ Conforme                                          |
| 4 | `supabase/functions/bot-ingest-snapshot/index.ts:448`       | handler                              | Adapter snapshot legado — chama RPC pra cada snapshot                                                   | — (delega à RPC)                                               | ✅          | ✅ Conforme                                          |
| 5 | `supabase/functions/extract-snapshot-from-print/index.ts:1047, 1269` | OCR parser                  | Parser OCR — chama RPC pra cada playlist extraída do print                                              | — (delega à RPC)                                               | ✅          | ✅ Conforme                                          |
| 6 | `supabase/functions/import-label-spreadsheet/index.ts:933, 952` | handler                           | Aciona `match_curator_campaign_playlists` pós-ingest (promoção de status)                                | — (delega à RPC #2)                                            | ✅          | ✅ Conforme (responsabilidade #2)                    |
| 7 | `supabase/functions/_shared/ingest-dom.ts:44 (ensureObservedPlaylist)` | helper                  | Cria `curator_playlists` no shadow de campanha **quando a RPC retorna null** e `sId` existe              | Apenas `spotify_playlist_id` — sem comparar nome/fuzzy         | ✅ (após)   | ⚠️ Pós-match, não bypass. **Duplicado** em #8.       |
| 8 | `supabase/functions/bot-ingest-snapshot/index.ts:362 (ensureObservedPlaylist)` | helper inline      | Idem #7, copiado dentro do adapter snapshot                                                              | Idem #7                                                        | ✅ (após)   | ⚠️ **Duplicação de #7** — candidato a consolidação   |
| 9 | `supabase/functions/_shared/algorithmic-classifier.ts (classifyPlaylistKind)` | helper             | Classifica playlist NÃO-cadastrada em `algorithmic`/`editorial`/`organic` pra `organic_plays_snapshots` | Lista canônica + regex (`daily mix`, `mix N`, `on repeat`...)  | ❌          | ✅ **Não é match** — categorização semântica         |
| 10 | `supabase/functions/import-label-spreadsheet/index.ts:292 (buildMatchers)` | helper interno         | Anota planilha do label com `matched_playlist_id` (tabela `playlists`) e `matched_curator_id`            | `spotify_playlist_id` + `owner_name` ilike                     | ❌          | ⚠️ **Match paralelo** (tabela `playlists`, não `curator_playlists`) — responsabilidade distinta, mas duplica lógica de "achar playlist por id/nome". |
| 11 | `src/pages/Campanhas.tsx:491-504`                           | `managedByName`/`existingByKey` map  | **FRONTEND** — durante import de cohort, casa matches IA com managed playlists + dedup com existing      | `normalizeText(name)` + `spotify_playlist_id` chaveado         | ❌          | ❌ **VIOLAÇÃO** — match no frontend                  |
| 12 | `src/components/playlist-deals/LogPrintDialog.tsx:440-460` | `buildSnapshotMatches`               | **FRONTEND** — casa playlists extraídas por IA com `curator_playlists` do deal                          | `normalizeName(name)` (case/acento-insensitive)                | ❌          | ❌ **VIOLAÇÃO** — match no frontend                  |
| 13 | `src/pages/Campanhas.tsx:498`, `LogPrintDialog.tsx:548-554` | dedup local                          | Dedup defensivo no client antes de mandar pro backend                                                    | `normalizeName`                                                | ❌          | ⚠️ Aceitável se for **só dedup**, não atribuição.    |
| 14 | `supabase/functions/analyze-genre/index.ts:28-70`           | `levenshtein`                        | Match de tokens de **gênero** (não playlist)                                                             | Levenshtein ≤ 2                                                | ❌          | ✅ Fora de escopo (domínio gênero)                   |
| 15 | `supabase/functions/generate-templates/index.ts:454`        | `normalizeName`                      | Geração de template — não toca playlist real                                                             | —                                                              | ❌          | ✅ Fora de escopo                                    |

---

## 3. Respostas ao AUDITOR

| Pergunta                                                                       | Resposta atual                                                                                                                                                |
|--------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Alguma Edge Function ainda faz Match próprio?                                  | **Não.** Todas as 5 edge functions de coleta delegam ao RPC oficial. `buildMatchers` no spreadsheet é responsabilidade distinta (anota cadastro de label, tabela `playlists`), mas está em zona cinza — ver item 10. |
| Alguma Edge Function compara nomes fora da RPC?                                | **Não** pra `curator_playlists`. `buildMatchers` compara `owner_name` (curador) por ilike — domínio diferente.                                                |
| Alguma Edge Function compara URL fora da RPC?                                  | **Não.** URL só é usada pra extrair `spotify_playlist_id` (regex local) e passar à RPC.                                                                       |
| Alguma faz fuzzy local?                                                        | **Não** (edge functions). Único fuzzy vive na RPC (`similarity ≥ 0.85`).                                                                                      |
| Alguma cria playlist sem passar pela RPC?                                      | **Não** — `ensureObservedPlaylist` (itens 7 e 8) só é invocada **depois** que a RPC retornou null, e somente quando há `spotify_playlist_id` válido em shadow de campanha. Não é caminho paralelo de match, é fallback de cadastro auditável (`attribution_method='s4a_observed'`). |
| Existe parser fazendo Match?                                                   | **Não.** DOM/OCR/Snapshot apenas chamam RPC. Spreadsheet só promove status via RPC #2.                                                                        |
| Existe Writer fazendo Match?                                                   | **Não.** `_shared/collection-writer.ts` recebe `CollectionRow` já casado upstream.                                                                            |
| Existe Frontend fazendo Match?                                                 | **SIM (2 ocorrências).** `src/pages/Campanhas.tsx` (cohort import) e `src/components/playlist-deals/LogPrintDialog.tsx` (snapshot AI matches). Ver itens 11 e 12. |
| Existe bypass do Gateway?                                                      | **Não** (Fase 3.A.1 já validou).                                                                                                                              |

---

## 4. Diagnóstico — o que falta consolidar

Três famílias de pendência:

### A. Frontend faz match (VIOLAÇÃO direta da regra)

- `src/pages/Campanhas.tsx:491-504` — usa `normalizeText(name)` pra casar matches IA contra `managed_playlists`/`curator_playlists` antes de inserir cohort.
- `src/components/playlist-deals/LogPrintDialog.tsx:440-460` — `buildSnapshotMatches` casa matches IA contra `curator_playlists` por nome normalizado.

**Diagnóstico:** ambos resolvem `playlist_id` no client antes do INSERT. Deve ser delegado à RPC (server-side). Frontend só monta payload e envia.

### B. `ensureObservedPlaylist` duplicado em 2 lugares

- `supabase/functions/_shared/ingest-dom.ts:44` (versão de referência)
- `supabase/functions/bot-ingest-snapshot/index.ts:362` (cópia inline)

**Diagnóstico:** mesma responsabilidade, mesma lógica, código colado. Consolidar movendo o helper compartilhado para `_shared/observed-playlist.ts` (ou expor `ensureObservedPlaylist` em `_shared/ingest-dom.ts`) e re-importar no snapshot adapter. **Nenhum bypass**, mas viola DRY.

### C. `buildMatchers` no spreadsheet — responsabilidade distinta, ambiguidade de nome

`buildMatchers` em `import-label-spreadsheet/index.ts:292` faz lookup de:
- `playlists.spotify_playlist_id` → resolve `matched_playlist_id` + `ownership`
- `curators.spotify_owner_id` / `curators.name` (ilike) → resolve `matched_curator_id`

Não escreve em `curator_playlists`. Não disputa com a RPC. Mas o nome "match" cria confusão.

**Diagnóstico (regra "nome ≠ responsabilidade"):**
- Responsabilidade real: **enriquecimento de linhas da planilha** com `matched_playlist_id`/`matched_curator_id`/`is_internal` pra alimentar `label_spreadsheet_rows`.
- Decisão: **renomear** pra `buildSpreadsheetEnrichment` (ou similar) — **NÃO** consolidar com `match_curator_playlist` (são tabelas e perguntas de negócio diferentes).

---

## 5. Arquitetura final pretendida (após Fase 3.B)

```text
Gateway (bot-ingest-dom)
    │
    ▼
Parser (DOM | OCR | Spreadsheet | Snapshot)  ──►  CollectionRow
    │
    ▼
match_curator_playlist  (RPC OFICIAL — único algoritmo)
    │
    ▼
Collection Writer  (_shared/collection-writer.ts)
    │
    ▼
campaign_playlist_collections
    │
    ▼
Delivery Engine
```

**Frontend:** zero match. Apenas monta payload e chama a edge function.
**Parsers:** zero match. Apenas extraem e devolvem CollectionRow.
**Writer:** zero match. Apenas grava o resultado já casado.
**RPC:** única autoridade de decisão.

---

## 6. Plano sugerido para a Fase 3.B.1 (consolidação)

1. **Frontend → server (item A):**
   - `Campanhas.tsx`: mover o map `managedByName`/`existingByKey` pra dentro da edge function que persiste o cohort, delegando match à RPC oficial.
   - `LogPrintDialog.tsx`: mover `buildSnapshotMatches` pra `analyze-deal-prints` (ou similar) — frontend envia matches IA crus, server resolve via RPC.
2. **Consolidar `ensureObservedPlaylist` (item B):** extrair pra `_shared/observed-playlist.ts`; reusar em ingest-dom e bot-ingest-snapshot.
3. **Renomear `buildMatchers` (item C):** `buildSpreadsheetEnrichment` ou similar — sem mudança de comportamento; só desambiguação semântica.
4. **Auditor AFTER:** confirmar que `rg "normalizeName|normalizeText" src/` não retorna mais nenhum uso de "match playlist por nome".

**Bloqueio atual:** itens A, B, C presentes → DROP/RENAME estrutural **não autorizado** ainda. Esta auditoria sinaliza explicitamente o que precisa ser consolidado antes da Fase 3.B encerrar.

---

## 7. O que NÃO foi alterado nesta auditoria

- Nenhuma migration.
- Nenhuma edge function tocada.
- Nenhum frontend tocado.
- Nenhuma RPC alterada.
- Nenhum DROP/RENAME.

Apenas evidências e diagnóstico — pronto para revisão antes de iniciar a Fase 3.B.1.
