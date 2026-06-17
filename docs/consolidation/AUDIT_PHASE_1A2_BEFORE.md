# Dependency Audit — 1.A.2 — curator_deal_snapshots.is_baseline
Gerado: 2026-06-17T15:42:39.567Z

## `curator_deal_snapshots.is_baseline` (coluna) — 🔴 174 dependências

- **Triggers (5):** curator_deal_snapshots.reject_snapshot_regression, curator_deal_snapshots.reject_snapshot_regression, curator_deal_snapshots.trg_curator_snapshots_recompute, curator_deal_snapshots.trg_reject_snapshot_regression, curator_deal_snapshots.trg_sync_curator_playlist_streams
- **Funções SQL (7):** get_campaign_analytics_overview, record_curator_deal_capture, get_curator_deal_progress, get_curator_deal_breakdown, get_curator_deal_snapshot_history, recompute_curator_deal_state, fn_deal_delivery_accumulated
- **Código (162 ocorrências):**
  - `supabase/functions/_shared/ingest-dom.ts:74:      is_baseline: isBaseline,`
  - `supabase/functions/_shared/ingest-dom.ts:266:      is_baseline: isBaseline,`
  - `supabase/functions/_shared/ingest-dom.ts:328:    is_baseline: isBaseline,`
  - `supabase/functions/bot-ingest-snapshot/index.ts:135:      is_baseline: isBaseline,`
  - `supabase/functions/bot-ingest-snapshot/index.ts:180:      metadata: { mode: "aggregate", total, is_baseline: isBaseline, correlation_id: cid ?? null, source: source ?? null },`
  - `supabase/functions/bot-ingest-snapshot/index.ts:183:    return jr({ ok: true, mode: "aggregate", total_plays: total, is_baseline: isBaseline, next_auto_collect_at: nextAt });`
  - `supabase/functions/bot-ingest-snapshot/index.ts:389:        is_baseline: isBaseline,`
  - `supabase/functions/bot-ingest-snapshot/index.ts:560:      is_baseline: isBaseline,`
  - `supabase/functions/bot-ingest-snapshot/index.ts:724:    is_baseline: isBaseline,`
  - `src/pages/PlaylistDeals.tsx:204:    () => new Set(logs.filter((l) => l.is_baseline).map((l) => l.deal_id)),`
  - `supabase/functions/curator-deal-followup/index.ts:69:        .eq("is_baseline", false)`
  - `supabase/functions/cleanup-snapshots/index.ts:24:  // Gap 13: curator_deal_snapshots — TTL 90d, preserva is_baseline=true e o snapshot mais recente por deal`
  - `supabase/functions/cleanup-snapshots/index.ts:40:      .or("is_baseline.is.null,is_baseline.eq.false");`
  - `supabase/functions/_shared/snapshot-ttl.ts:14:  // curator_deal_snapshots tratado separadamente em cleanup-snapshots (preserva is_baseline + último por deal, TTL 90d)`
  - `src/pages/HeatmapEntregas.tsx:29:        .select("created_at, total_plays, is_baseline")`
  - `src/pages/HeatmapEntregas.tsx:31:        .eq("is_baseline", false);`
  - `src/pages/DealDetail.tsx:69:    return dealPlaylists.filter((p) => p.is_baseline).length;`
  - `supabase/functions/cron-reconcile-curator-deals/index.ts:47:      .eq("is_baseline", true);`
  - `src/pages/CuratorPage.tsx:96:  is_baseline: boolean;`
  - `src/pages/CuratorPage.tsx:135:  is_baseline: boolean;`
  - `src/pages/CuratorPage.tsx:187:  is_baseline: boolean;`
  - `src/pages/CuratorPage.tsx:421:        if (p.is_baseline) return false;`
  - `src/pages/CuratorPage.tsx:439:    const baseAll = playlists.filter((p) => p.is_baseline);`
  - `src/pages/CuratorPage.tsx:454:    const base = playlists.filter((p) => p.is_baseline);`
  - `src/pages/CuratorPage.tsx:667:    .filter((p) => !p.is_baseline && curatorOwnedPlaylistIds.has(p.playlist_id))`
  - `src/pages/CuratorPage.tsx:2278:                                {entry.is_baseline ? "Baseline" : "Coleta"} ·{" "}`
  - `supabase/functions/register-curator-playlist/index.ts:265:        .select("spotify_playlist_id, spotify_owner_id, playlist_name, match_status, song_id, is_baseline")`
  - `supabase/functions/register-curator-playlist/index.ts:278:      // Fonte de verdade: flag is_baseline=true (setada quando a playlist já listava`
  - `supabase/functions/register-curator-playlist/index.ts:285:            r.is_baseline === true`
  - `supabase/functions/register-curator-playlist/index.ts:333:          .eq("is_baseline", true);`
  - `supabase/functions/register-curator-playlist/index.ts:508:          is_baseline: it.match_status === "baseline",`
  - `supabase/functions/enrich-curator-paste/index.ts:400:            is_baseline: cls.match_status === "baseline",`
  - `supabase/functions/extract-snapshot-from-print/index.ts:397:    is_baseline: boolean;`
  - `supabase/functions/extract-snapshot-from-print/index.ts:416:    is_baseline: row.is_baseline,`
  - `supabase/functions/extract-snapshot-from-print/index.ts:767:      .select("id, created_at, is_baseline")`
  - `supabase/functions/extract-snapshot-from-print/index.ts:796:        .eq("is_baseline", recentLog.is_baseline)`
  - `supabase/functions/extract-snapshot-from-print/index.ts:955:            is_baseline: isBaseline,`
  - `supabase/functions/extract-snapshot-from-print/index.ts:975:        await supabase.from("curator_playlists").update({ is_baseline: true }).eq("id", algoId);`
  - `supabase/functions/extract-snapshot-from-print/index.ts:987:          is_baseline: false,`
  - `supabase/functions/extract-snapshot-from-print/index.ts:1099:            is_baseline: isBaseline,`
  - `supabase/functions/extract-snapshot-from-print/index.ts:1124:            is_baseline: isBaseline,`
  - `supabase/functions/extract-snapshot-from-print/index.ts:1213:      is_baseline: isBaseline,`
  - `supabase/functions/extract-snapshot-from-print/index.ts:1278:        is_baseline: false,`
  - `supabase/functions/extract-snapshot-from-print/index.ts:1333:      .eq("is_baseline", true);`
  - `supabase/functions/extract-snapshot-from-print/index.ts:1388:    is_baseline: isBaseline,`
  - `supabase/functions/get-curator-deal-public/index.ts:79:          "id, deal_id, song_id, spotify_url, playlist_name, followers, is_baseline, added_at, spotify_playlist_id, spotify_owner_id, spotify_owner_name, image_url, added_at_spotify, match_status, match_reason, last_paste_at",`
  - `supabase/functions/get-curator-deal-public/index.ts:82:        .or("match_status.eq.curator,is_baseline.eq.true")`
  - `supabase/functions/get-curator-deal-public/index.ts:95:        .select("playlist_id, captured_at, plays_24h, plays_7d, plays_28d, is_baseline")`
  - `supabase/functions/get-curator-deal-public/index.ts:97:        .eq("is_baseline", false)`
  - `supabase/functions/get-curator-deal-public/index.ts:223:        .eq("is_baseline", true);`
  - …e mais 112

---
**TOTAL DE DEPENDÊNCIAS: 174**
🔴 DROP bloqueado — resolver acima primeiro.