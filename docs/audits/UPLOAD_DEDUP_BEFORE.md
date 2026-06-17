# FASE 5.A.1 — AUDITOR BEFORE

## Escopo
Tabela: `public.label_spreadsheet_uploads`
Chave esperada de unicidade do ativo: `(deal_id, reference_date)`
Critério "ativo": `status = 'imported' AND quarantined_at IS NULL`

## Resultado da varredura (snapshot pré-correção)

| Métrica | Valor |
|---|---|
| Grupos `(deal_id, reference_date)` com mais de 1 upload ativo | **1** |
| Deals afetados | **1** |
| Campanhas afetadas | **1** |
| Uploads excedentes (precisam ser superseded) | **1** |

## Detalhe do(s) grupo(s) duplicado(s)

| campaign | track | deal_id | reference_date | upload_id | total_streams | created_at | status |
|---|---|---|---|---|---|---|---|
| `0170d78a-97f1-41f7-99eb-a5b31c367053` | Carnívoro | `b6d1865f-1619-48d3-a704-b496c6ef0a8f` | 2026-06-14 | `584ec024-b970-45ad-9e9a-be63c464152e` | 133 346 | 2026-06-17 19:15:12+00 | imported (vencedor) |
| `0170d78a-97f1-41f7-99eb-a5b31c367053` | Carnívoro | `b6d1865f-1619-48d3-a704-b496c6ef0a8f` | 2026-06-14 | `ab90803e-9168-4db0-a847-da832b3a8907` | 123 708 | 2026-06-17 18:40:50+00 | imported (a marcar superseded) |

## Causa raiz identificada

1. **Engine ordena por `created_at` (`up_created`), não por `reference_date`.**
   - `fn_playlist_delivery_accumulated` calcula deltas com `ROW_NUMBER() OVER (PARTITION BY playlist_id ORDER BY up_created, captured_at)`.
   - Quando há 2 uploads ativos para o mesmo `reference_date`, o delta é calculado **entre as duas versões do mesmo dia**, e não entre dias consecutivos.
2. **Não há blindagem estrutural.** Não existe constraint/índice único parcial garantindo um único upload ativo por `(deal_id, reference_date)`.
3. **Filtro de ingestão ausente.** `import-label-spreadsheet` insere o novo upload sem marcar o anterior como `superseded`.

## Itens a corrigir
- [ ] Marcar 1 upload existente como `status='superseded'`.
- [ ] Adicionar coluna `superseded_at` (auditoria).
- [ ] Criar índice único parcial `(deal_id, reference_date)` para uploads ativos.
- [ ] Criar trigger `BEFORE INSERT` que faz supersede automático do upload ativo anterior do mesmo dia.
- [ ] Atualizar `fn_playlist_delivery_accumulated`, `vw_campaign_playlist_growth`, `vw_campaign_playlist_delivery_origin`, `get_campaign_playlist_growth` para:
  - Excluir collections cujo upload está `superseded`.
  - Ordenar deltas por `reference_date` (com `created_at` apenas como tiebreaker dentro do mesmo dia).
- [ ] Recalcular `campaigns.total_delivered` da campanha afetada.
