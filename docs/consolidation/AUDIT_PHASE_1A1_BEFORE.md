# Dependency Audit — 1.A.1 BEFORE — curator_deal_baseline_playlists
Gerado: 2026-06-17T15:16:27.212Z

## `curator_deal_baseline_playlists` (tabela) — 🔴 12 dependências

- **Funções SQL (6):** is_playlist_in_deal_baseline, sync_deal_campaign_baseline, fn_playlist_delivery_accumulated, is_playlist_in_deal_baseline, get_campaign_baseline, enforce_curator_playlist_baseline
- **Código (6 ocorrências):**
  - `supabase/functions/bot-ingest-snapshot/index.ts:711:        .from("curator_deal_baseline_playlists")`
  - `supabase/functions/_shared/ingest-dom.ts:313:        .from("curator_deal_baseline_playlists")`
  - `supabase/functions/extract-snapshot-from-print/index.ts:1357:        .from("curator_deal_baseline_playlists")`
  - `supabase/functions/get-client-campaign-public/index.ts:415:      // Fonte primária: curator_deal_baseline_playlists (quando populada).`
  - `supabase/functions/get-client-campaign-public/index.ts:417:        .from("curator_deal_baseline_playlists")`
  - `supabase/functions/simulate-campaign-flow/index.ts:64:        await admin.from("curator_deal_baseline_playlists").delete().in("deal_id", created.deal_ids);`

---
**TOTAL DE DEPENDÊNCIAS: 12**
🔴 DROP bloqueado — resolver acima primeiro.