---
name: Delivery — arquitetura canônica oficial (FASE 9.2C)
description: Cadeia oficial de delivery pós-9.2C — writers, RPCs, cache e responsabilidade do last_reconciled_at. Consulte antes de tocar qualquer cálculo de entrega.
type: architecture
---

# Delivery — Arquitetura Canônica (consolidada na FASE 9.2C, 2026-06-18)

## Dois writers oficiais por responsabilidade distinta (NÃO é duplicação)

| Writer | Path | Responsabilidades |
|---|---|---|
| `writeCuratorDealSnapshot()` (`supabase/functions/_shared/snapshot-writer.ts`) | Automatizado | Bots, OCR (`extract-snapshot-from-print`), VPS (`bot-ingest-snapshot`), imports. Insert único idempotente por `(batch_id, playlist_id)` em `curator_deal_snapshots`. |
| `record_curator_deal_capture()` (RPC PG, SECURITY DEFINER) | Manual humano | Operador via `LogPrintDialog.tsx`. Transação completa: auth.uid() + ownership + insert em `curator_deal_logs` + criação de `curator_playlists` + matching spotify_id/fuzzy + insert em `curator_deal_snapshots`. |

NÃO existe writer único de snapshots. NÃO tentar consolidar — as responsabilidades são distintas (a RPC PG faz log+playlists+matching que o writer Deno não faz).

## Cadeia única de cálculo

```
curator_deal_snapshots  ·  campaign_playlist_collections  ·  campaign_eco_snapshots
                              ↓
          fn_playlist_delivery_accumulated(playlist_id, campaign_id)   ← BASE CANÔNICA
                              ↓
       fn_curator_delivery_accumulated  ·  fn_campaign_delivery_accumulated
                              ↓
              recompute_campaign_total_delivered(campaign_id)
                              ↓
   curator_deals.reconciled_total_plays  ·  campaigns.total_delivered
```

## Writer único de `reconciled_total_plays` e `campaigns.total_delivered`

**`recompute_campaign_total_delivered`** — único. Idempotente (`IS DISTINCT FROM` em todo UPDATE).

Disparado por 3 cenários defensivos (não causam race — função é idempotente):
1. Trigger `trg_sync_campaign_total_delivered` em `curator_deals` (UPDATE OF reconciled_total_plays/campaign_id).
2. Trigger `trg_sync_campaign_total_delivered_eco` em `campaign_eco_snapshots`.
3. `cron-reconcile-curator-deals` (6h) — chama explicitamente após loop de deals.

## `cron-reconcile-curator-deals` — escopo pós-9.2C

NÃO escreve mais `reconciled_total_plays` direto. Responsabilidades atuais:
- Atualiza APENAS `last_reconciled_at` por deal.
- Lê `fn_deal_delivery_accumulated` para avaliar milestones (meta atingida / prazo vencido) e notificar baseline ausente.
- Chama `recompute_campaign_total_delivered` por campanha tocada.

## `fn_deal_delivery_accumulated` — papel residual

Função permanece como **leitura on-demand** consumida por `get_curator_deal_progress` (RPC do portal, exibe KPI em tempo real). Não escreve em lugar nenhum. Diferença vs `fn_curator_delivery_accumulated`: usa `GREATEST(engine, snapshot_delta)` — relevante apenas para deals sem campaign_id. Não usar pra escrever cache.

## `last_reconciled_at` — responsabilidade oficial

Timestamp da **última passagem do cron de reconciliação** no deal. NÃO é mais "última escrita em reconciled_total_plays". Consumidor único: `CampaignCuratorDeals.tsx` (tooltip "Último update").

## RPCs de leitura — quem usa o quê

| Caso de uso | RPC oficial |
|---|---|
| KPI consolidado (progresso, ETA, meta) | `get_curator_deal_progress` |
| Breakdown granular (curador/editorial/algorithmic/organic/suspicious) | `get_curator_deal_breakdown` — semântica ABSOLUTA por bucket, NÃO é delta acumulado. Nunca usar pra meta/financeiro. |
| Curva/heatmap | `vw_campaign_playlist_growth` / `get_campaign_playlist_growth` |
| Status aderência (on_track/lagging/spiking) | tabela `curator_deal_delivery_status` (cron diário) |

## `delivery_proofs` — camada de auditoria oficial

Append-only imutável, paralela ao pipeline de cálculo. Escrita por `bot-ingest-snapshot` e `import-label-spreadsheet`. Lida por `get-curator-deal-public` e `get-shared-campaign-plan`. NÃO participa do cálculo de delivery.

## Proibições

- Não recalcular delivery no frontend.
- Não somar snapshots brutos pra obter entrega (apenas `get_curator_deal_breakdown` faz isso, e só pra breakdown visual).
- Não criar terceiro writer de `curator_deal_snapshots`.
- Não trocar `fn_playlist_delivery_accumulated` por HWM absoluto (regressão da FASE 5.C).
