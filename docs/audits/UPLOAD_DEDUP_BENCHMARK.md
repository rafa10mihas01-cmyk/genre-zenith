# FASE 5.A.1 — BENCHMARK

## Resumo executivo

| Métrica | Antes | Depois |
|---|---:|---:|
| Uploads duplicados ativos por `(deal_id, reference_date)` | **1 grupo / 2 uploads** | **0** |
| Uploads marcados como `superseded` | 0 (campo inexistente em uso) | **1** |
| Cálculos/queries corrigidos | 0 | **4** (`fn_playlist_delivery_accumulated`, `vw_campaign_playlist_growth`, `vw_campaign_playlist_delivery_origin`, `get_campaign_playlist_growth`) |
| Blindagens estruturais novas | 0 | **3** (índice único parcial + 2 triggers) |

## Causa raiz

1. Engine ordenava deltas por `up_created` (hora do upload), em vez do eixo temporal correto (`reference_date`).
2. Não havia barreira no banco que impedisse dois uploads ativos para o mesmo dia.
3. A função de import inseria uploads novos sem demover os anteriores.

Resultado prático observado pelo usuário: na campanha **Carnívoro**, dia 14/06 tinha dois uploads ativos (9 265 às 18:40 e 10 852 às 19:15). O `last_import_delta` aparecia como `+1 587` (10 852 − 9 265, comparando duas versões do mesmo dia) em vez de comparar 14/06 vs 15/06.

## O que mudou

### Banco
- `ALTER TABLE label_spreadsheet_uploads ADD COLUMN superseded_at TIMESTAMPTZ`.
- `CREATE UNIQUE INDEX uniq_lsu_active_per_day ON (deal_id, reference_date) WHERE status='imported' AND quarantined_at IS NULL`.
- Trigger `BEFORE INSERT trg_lsu_supersede_same_day` → demove uploads antigos antes do unique check.
- Trigger `AFTER INSERT trg_lsu_backfill_superseded_by` → fecha o link `superseded_by` (separado para não violar FK auto-referente).

### Engine
- `fn_playlist_delivery_accumulated`:
  - Filtro `valid`: `(u.id IS NULL OR (u.quarantined_at IS NULL AND COALESCE(u.status,'imported') <> 'superseded'))`.
  - Novo eixo `up_ref_date = COALESCE(u.reference_date, captured_at::date)`.
  - `ROW_NUMBER()/LAG() ORDER BY up_ref_date, up_created, captured_at`.
- Views `vw_campaign_playlist_growth`, `vw_campaign_playlist_delivery_origin` e função `get_campaign_playlist_growth`: mesmo filtro de `superseded`.

### Dados existentes
- 1 upload antigo do Carnívoro (14/06, 18:40, 9 265) marcado como `superseded`.
- `recompute_campaign_total_delivered('0170d78a…')` executado.

## Garantias

- **Histórico preservado**: nenhum DELETE; `label_spreadsheet_rows` e `campaign_playlist_collections` intactos. `superseded_at` + `superseded_by` formam trilha de auditoria.
- **Idempotência**: re-uploads do mesmo dia sempre resultam em exatamente 1 ativo, sem erro pro usuário (trigger BEFORE roda antes do unique check).
- **Race-safety**: índice único parcial é a barreira final; mesmo dois inserts concorrentes nunca conseguem coexistir como ativos.
- **Compatibilidade**: nenhuma assinatura de API, edge function ou contrato público mudou; frontend continua usando os mesmos endpoints.

## Respostas finais

- Uploads duplicados encontrados: **1 par** (`ab90803e`/`584ec024`).
- Uploads marcados como `superseded`: **1**.
- Cálculos corrigidos: **4** (1 função pl/pgsql + 2 views + 1 função SQL).
- Causa raiz: **engine ordenava deltas por `created_at` em vez de `reference_date`, sem barreira no banco contra dois uploads ativos por dia**.
- Confirmação: **agora existe exatamente 1 upload ativo por `(deal_id, reference_date)` em toda a plataforma**, e tentativas concorrentes são neutralizadas pela trigger + índice único parcial.
