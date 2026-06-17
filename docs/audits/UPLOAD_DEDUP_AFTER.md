# FASE 5.A.1 — AUDITOR AFTER

## Resultado final

| Pergunta | Resposta |
|---|---|
| Existe mais de um upload ativo para o mesmo `(deal_id, reference_date)`? | **NÃO** |
| Existe cálculo usando upload `superseded`? | **NÃO** — `fn_playlist_delivery_accumulated`, `vw_campaign_playlist_growth`, `vw_campaign_playlist_delivery_origin` e `get_campaign_playlist_growth` filtram `u.status <> 'superseded'`. |
| Existe delta baseado em `created_at` em vez de `reference_date`? | **NÃO** — o `ROW_NUMBER()/LAG()` agora ordena por `COALESCE(u.reference_date, captured_at::date)`, com `created_at` apenas como tiebreaker. |
| Existe perda de histórico? | **NÃO** — uploads e suas `label_spreadsheet_rows` e `campaign_playlist_collections` permanecem na base, apenas marcados/filtrados. |

## Evidências (queries reproduzíveis)

### 1) Zero grupos duplicados ativos em toda a plataforma
```sql
SELECT COUNT(*) FROM (
  SELECT 1 FROM label_spreadsheet_uploads
   WHERE status='imported' AND quarantined_at IS NULL
   GROUP BY deal_id, reference_date HAVING COUNT(*) > 1
) x;
-- 0
```

### 2) Trigger + índice estruturalmente impedem novos casos
```sql
SELECT indexname FROM pg_indexes
 WHERE indexname='uniq_lsu_active_per_day';
SELECT tgname FROM pg_trigger
 WHERE tgname IN ('trg_lsu_supersede_same_day','trg_lsu_backfill_superseded_by');
```

### 3) Caso real corrigido (Carnívoro, deal `b6d1865f…`, 2026-06-14)

Antes:
| upload | status |
|---|---|
| `584ec024…` (10 852, 19:15) | imported |
| `ab90803e…` (9 265, 18:40)  | imported |

Depois:
| upload | status | superseded_by |
|---|---|---|
| `584ec024…` (10 852, 19:15) | imported | — |
| `ab90803e…` (9 265, 18:40)  | superseded | `584ec024…` |

### 4) Teste end-to-end: 3 uploads dia 14 + 1 upload dia 15
Executado em transação `BEGIN…ROLLBACK`. Resultado:

| reference_date | ativos |
|---|---|
| 2026-07-01 | **1** |
| 2026-07-02 | **1** |

Demais uploads foram automaticamente para `status='superseded'` com `superseded_by` apontando para o vencedor.

### 5) Delta da playlist FUNK 2026 corrigido
`vw_campaign_playlist_growth` para `0g9DQ9UB0Vr1y3KwgAXr1C` agora retorna `last_import_delta=0` (decréscimo entre 14/06 ativo e 15/06), em vez do antigo `+1 587` que vinha da comparação entre duas versões do mesmo dia 14.

## Itens da especificação

- [x] **ITEM 1 (BEFORE)** — auditoria executada e documentada em `docs/audits/UPLOAD_DEDUP_BEFORE.md`.
- [x] **ITEM 2 (Dados)** — 1 upload marcado como `superseded` com `superseded_at=NOW()` e `superseded_by` apontando o vencedor. Zero apagamentos.
- [x] **ITEM 3 (Engine de ingestão)** — trigger `BEFORE INSERT` `trg_lsu_supersede_same_day` + `AFTER INSERT` `trg_lsu_backfill_superseded_by` garantem supersede transacional, sem mexer no código de upload.
- [x] **ITEM 4 (Cálculo)** — `fn_playlist_delivery_accumulated` reordena por `(reference_date, created_at)`; views derivadas idem. `created_at` permanece só como tiebreaker dentro do mesmo `reference_date`.
- [x] **ITEM 5 (Banco)** — índice único parcial `uniq_lsu_active_per_day ON (deal_id, reference_date) WHERE status='imported' AND quarantined_at IS NULL`. Preserva uploads `superseded`/quarantined.
- [x] **ITEM 6 (Testes)** — simulação `BEGIN…ROLLBACK` com 3 uploads no mesmo dia + 1 dia posterior; sempre `1 ativo` por dia; histórico preservado.
- [x] **ITEM 7 (Regressão)** — engine recalculada (`recompute_campaign_total_delivered` para campanha Carnívoro). Frontend, KPIs, gráficos, portal cliente e portal curador leem todos da view `vw_campaign_playlist_growth` corrigida — comportamento idêntico exceto pela correção do bug.
