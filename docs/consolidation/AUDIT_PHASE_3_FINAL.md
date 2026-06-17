# AUDIT PHASE 3 — FINAL

**Status:** Arquitetura de Coleta CONSOLIDADA.
**Escopo:** Certificação final das Fases 3.A (Gateway), 3.B (Match) e 3.C/3.C.1 (Snapshots).
**Tipo:** Read-only. Nenhuma alteração de código, banco, frontend, migration ou DROP.
**Referências:** `AUDIT_PHASE_3A_AFTER.md`, `AUDIT_PHASE_3B_AFTER.md`, `AUDIT_PHASE_3C_BEFORE.md`, `AUDIT_PHASE_3C1_BEFORE.md`.

---

## 1. GATEWAY

| Pergunta | Resposta |
|---|---|
| Existe apenas um Gateway Oficial? | **Sim.** |
| Qual é? | `supabase/functions/_shared/collection-writer.ts` (`writeCollectionBatch` / `writeBaselineOfficial`), com `raw-ingest.ts` como ponto de captura HTTP bruto. |
| Existe algum bypass? | **Não.** Todas as Edge Functions de ingestão (`bot-ingest-snapshot`, `bot-ingest-dom`, `extract-snapshot-from-print`, `import-label-spreadsheet`, `register-cohort-baseline`, `bot-heartbeat` piggyback) chamam exclusivamente o writer. |
| Existe Edge Function gravando fora do Gateway? | **Não.** `rg "campaign_playlist_collections"` em `supabase/functions/` retorna apenas: (a) leituras em `register-curator-playlist` e `get-curator-deal-public`; (b) escritas em `collection-writer.ts` e `baseline-writer.ts` (este último encapsulado pelo writer). |

---

## 2. PARSERS

Todos os parsers entregam o contrato unificado `CollectionRow` definido em `collection-writer.ts`:

| Parser | Edge Function | Contrato |
|---|---|---|
| DOM | `_shared/ingest-dom.ts` (consumido por `bot-ingest-dom` e `bot-heartbeat`) | `CollectionRow` |
| OCR (print) | `extract-snapshot-from-print` | `CollectionRow` |
| Spreadsheet | `import-label-spreadsheet` | `CollectionRow` |
| Snapshot manual | `bot-ingest-snapshot` + `register-cohort-baseline` | `CollectionRow` |

**Existe parser divergente?** Não.

---

## 3. MATCH

| Pergunta | Resposta |
|---|---|
| Existe apenas um Match Engine? | **Sim.** |
| RPC `match_curator_playlist` é a única autoridade? | **Sim.** |
| Match fora dela? | **Não.** |
| Comparação por nome fora dela? | **Não.** Removidas em 3.B (`normalizeText`/`normalizeName`/`buildSnapshotMatches` purgados do frontend). |
| Fuzzy fora dela? | **Não.** Fuzzy vive somente dentro da RPC SQL. |

Helper unificado: `_shared/observed-playlist.ts` (`ensureObservedPlaylist`) — sem duplicatas.

---

## 4. WRITER

| Pergunta | Resposta |
|---|---|
| Existe apenas um Collection Writer? | **Sim** — `collection-writer.ts`. |
| Algum INSERT direto em `campaign_playlist_collections`? | **Não** (verificado por `rg`). |
| Algum UPSERT paralelo? | **Não.** Toda escrita passa pela RPC `ingest_campaign_collection_batch`. |
| Algum bypass? | **Não.** |

---

## 5. BASELINE

| Pergunta | Resposta |
|---|---|
| Fonte oficial única? | **Sim** — `writeBaselineOfficial()` (wrapper sobre `baseline-writer.ts`) gravando em `campaign_playlist_collections (is_baseline=true)` via RPC oficial. |
| Duplicação remanescente? | **Não.** `catalog_track_baselines` continua existindo, mas responde outra pergunta de negócio (baseline de track de catálogo no onboarding), conforme regra `mem://preference/consolidation-rule` (nome ≠ responsabilidade). |

---

## 6. SNAPSHOTS

Resultado da auditoria 3.C (19 estruturas mapeadas):

| Pergunta | Resposta |
|---|---|
| Todos possuem responsabilidade documentada? | **Sim.** |
| Algum snapshot duplicado? | **Não.** |
| Alguma estrutura sem responsabilidade definida? | **Não.** `observed_playlist_snapshots` está dormente mas pertence ao módulo Observer (fora do escopo da Fase 3). |

---

## 7. DELIVERY

| Nível | Fonte oficial | Cálculo paralelo? |
|---|---|---|
| Playlist | `curator_deal_snapshots` → `vw_campaign_playlist_growth` | Não |
| Curador | agregação SQL sobre `curator_deal_snapshots` | Não |
| Campanha | `campaigns.total_delivered` (cache mantido por trigger) | Não |
| Deal | `curator_deals` + `curator_deal_snapshots` | Não |

---

## 8. FRONTEND

| Pergunta | Resposta |
|---|---|
| Só consome dados? | **Sim** (após Fase 3.B). |
| Regra de negócio no navegador? | **Não.** |
| Match no frontend? | **Não.** |
| Delivery no frontend? | **Não** — apenas formatação. |
| Baseline no frontend? | **Não** — `LogPrintDialog` agora delega a `register-cohort-baseline`. |
| Writer no frontend? | **Não.** |

---

## 9. EDGE FUNCTIONS — fluxo oficial

Fluxo: **Gateway → Parser → RPC Match → Writer → Delivery**.

Funções de ingestão auditadas (todas seguem o fluxo): `bot-ingest-snapshot`, `bot-ingest-dom`, `bot-heartbeat` (piggyback DOM), `extract-snapshot-from-print`, `import-label-spreadsheet`, `register-cohort-baseline`.

**Exceções:** Nenhuma.

---

## 10. CRONS

| Cron | Responsabilidade | Ativo | Documentado | Necessário |
|---|---|---|---|---|
| `cron-reconcile-curator-deals` | Recalcula `total_delivered` a partir de snapshots | Sim | `docs/ARCHITECTURE.md` | Sim |
| `enrich-playlists` | Atualiza followers via Spotify API (semanal) | Sim | `docs/ARCHITECTURE.md` | Sim |
| `sync-kworb-charts` | Sincroniza charts Kworb | Sim | `config.toml` | Sim |
| `sync-spotify-editorial-charts` | Sincroniza editoriais Spotify | Sim | `config.toml` | Sim |
| `detect-curator-fraud` | Detecção de fraude | Sim | `config.toml` | Sim |
| `cleanup-snapshots` | GC de snapshots antigos | Sim | função | Sim |
| `auto-complete-campaigns` | Fecha campanhas atingidas | Sim | função | Sim |
| `check-spreadsheet-reminders` | Lembretes XLSX | Sim | função | Sim |
| `process-email-queue` | Envio transacional | Sim | função | Sim |

**Crons legados ativos?** Não identificados na Fase 3.

---

## 11. TRIGGERS

- Trigger de cache `campaigns.total_delivered` ← `curator_deal_snapshots` — **oficial**.
- Triggers de auditoria em `bot_ingest_raw` — **oficial**.
- Nenhum trigger morto, duplicado ou sem responsabilidade identificado no escopo de coleta.

---

## 12. RPCs OFICIAIS

| Domínio | RPC oficial |
|---|---|
| Match | `match_curator_playlist` |
| Writer (Collection) | `ingest_campaign_collection_batch` |
| Baseline | `ingest_campaign_collection_batch` (intent='baseline') |
| Delivery | trigger SQL + `vw_campaign_playlist_growth` + `cron-reconcile-curator-deals` |
| Analytics | `vw_campaign_playlist_growth` (view materializada de leitura) |

---

## 13. FONTES DE VERDADE

| Domínio | Fonte Oficial | Responsabilidade |
|---|---|---|
| Baseline | `campaign_playlist_collections (is_baseline=true)` via `writeBaselineOfficial` | Ponto-zero de plays/posição por campanha+playlist |
| Match | RPC `match_curator_playlist` | Identificar playlist canônica (spotify_id → name → fuzzy) |
| Collection | `campaign_playlist_collections` | Série temporal de coletas por campanha |
| Delivery | `curator_deal_snapshots` + `campaigns.total_delivered` (cache) | Plays entregues por deal/campanha |
| Campaign | `campaigns` | Estado/configuração de campanha |
| Curator | `curators` + `curator_deals` | Entidade curador e seus deals |
| Proofs | `delivery_proofs` (imutável) | Provas auditáveis (screenshot, DOM, posição) |
| Snapshots (templates) | `playlist_metrics_snapshots` | Métricas internas de playlists gerenciadas |
| Snapshots (Spotify) | `playlist_followers_snapshots` | Histórico global de followers |
| Snapshots (catálogo) | `catalog_track_snapshots` + `song_snapshots` | Presença/série de tracks |
| Organic | `organic_plays_snapshots` | Plays orgânicos fora de deal |
| Ecosystem | `playlist_ecosystem_score` / `track_ecosystem_score` | Score de saúde de ecossistema |

---

## 14. FLUXO FINAL OFICIAL

```text
Bot / VPS
   │
   ▼
Gateway Oficial  (raw-ingest + collection-writer)
   │
   ▼
Parser  (DOM | OCR | Spreadsheet | Snapshot)
   │
   ▼
CollectionRow  (contrato unificado)
   │
   ▼
Match Engine Oficial  (RPC match_curator_playlist)
   │
   ▼
Collection Writer  (RPC ingest_campaign_collection_batch)
   │
   ▼
campaign_playlist_collections
   │
   ▼
Delivery Engine  (trigger SQL + reconcile cron)
   │
   ▼
campaigns.total_delivered  (cache)
   │
   ▼
vw_campaign_playlist_growth
   │
   ▼
Frontend  (consumo read-only)
```

---

## 15. CERTIFICAÇÃO

| Pergunta | Resposta |
|---|---|
| Existe apenas um Gateway? | **SIM** |
| Existe apenas um Match Engine? | **SIM** |
| Existe apenas um Writer? | **SIM** |
| Existe apenas uma arquitetura de coleta? | **SIM** |
| Existe apenas uma fonte de verdade por responsabilidade? | **SIM** |
| Componentes legados ainda ativos? | **Não no fluxo de coleta.** `observed_playlist_snapshots` permanece dormente (módulo Observer, fora de escopo). |
| Riscos arquiteturais conhecidos? | (1) Observer dormente — endereçar em Fase 4 caso seja reativado. (2) `baseline-writer.ts` mantido como wrapper de compat — encapsulado pelo writer oficial. |
| Arquitetura consolidada? | **SIM.** |

---

## 16. CONCLUSÃO

A **Fase 3 — Consolidação da Arquitetura de Coleta — está oficialmente ENCERRADA**.

Este documento passa a ser a referência oficial da Arquitetura de Coleta da NexEngine.

**O sistema está pronto para iniciar a Fase 4 — Hardening** (Performance, Segurança, Observabilidade, APIs, Crons e Testes).
