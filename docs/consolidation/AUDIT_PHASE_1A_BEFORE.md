# Dependency Audit — 1.A — Baseline de playlist
Gerado: 2026-06-17T15:08:05.573Z

## `curator_deal_baseline_playlists` (tabela) — 🔴 11 dependências

- **Funções SQL (5):** is_playlist_in_deal_baseline, sync_deal_campaign_baseline, fn_playlist_delivery_accumulated, is_playlist_in_deal_baseline, enforce_curator_playlist_baseline
- **Código (6 ocorrências):**
  - `supabase/functions/bot-ingest-snapshot/index.ts:711:        .from("curator_deal_baseline_playlists")`
  - `supabase/functions/extract-snapshot-from-print/index.ts:1357:        .from("curator_deal_baseline_playlists")`
  - `supabase/functions/get-client-campaign-public/index.ts:415:      // Fonte primária: curator_deal_baseline_playlists (quando populada).`
  - `supabase/functions/get-client-campaign-public/index.ts:417:        .from("curator_deal_baseline_playlists")`
  - `supabase/functions/_shared/ingest-dom.ts:313:        .from("curator_deal_baseline_playlists")`
  - `supabase/functions/simulate-campaign-flow/index.ts:64:        await admin.from("curator_deal_baseline_playlists").delete().in("deal_id", created.deal_ids);`

## `curator_deal_snapshots.is_baseline` (coluna) — 🔴 176 dependências

- **Triggers (5):** curator_deal_snapshots.reject_snapshot_regression, curator_deal_snapshots.reject_snapshot_regression, curator_deal_snapshots.trg_curator_snapshots_recompute, curator_deal_snapshots.trg_reject_snapshot_regression, curator_deal_snapshots.trg_sync_curator_playlist_streams
- **Funções SQL (7):** get_campaign_analytics_overview, record_curator_deal_capture, get_curator_deal_progress, get_curator_deal_breakdown, get_curator_deal_snapshot_history, recompute_curator_deal_state, fn_deal_delivery_accumulated
- **Código (164 ocorrências):**
  - `src/pages/ClientCampaignPage.tsx:85:  is_baseline: boolean;`
  - `src/pages/ClientCampaignPage.tsx:823:                                  {entry.is_baseline ? "Baseline" : "Coleta"} ·{" "}`
  - `supabase/functions/enrich-curator-paste/index.ts:400:            is_baseline: cls.match_status === "baseline",`
  - `supabase/functions/curator-deal-followup/index.ts:69:        .eq("is_baseline", false)`
  - `supabase/functions/cleanup-snapshots/index.ts:24:  // Gap 13: curator_deal_snapshots — TTL 90d, preserva is_baseline=true e o snapshot mais recente por deal`
  - `supabase/functions/cleanup-snapshots/index.ts:40:      .or("is_baseline.is.null,is_baseline.eq.false");`
  - `supabase/functions/_shared/ingest-dom.ts:74:      is_baseline: isBaseline,`
  - `supabase/functions/_shared/ingest-dom.ts:266:      is_baseline: isBaseline,`
  - `supabase/functions/_shared/ingest-dom.ts:324:    is_baseline: isBaseline,`
  - `supabase/functions/bot-ingest-snapshot/index.ts:135:      is_baseline: isBaseline,`
  - `supabase/functions/bot-ingest-snapshot/index.ts:180:      metadata: { mode: "aggregate", total, is_baseline: isBaseline, correlation_id: cid ?? null, source: source ?? null },`
  - `supabase/functions/bot-ingest-snapshot/index.ts:183:    return jr({ ok: true, mode: "aggregate", total_plays: total, is_baseline: isBaseline, next_auto_collect_at: nextAt });`
  - `supabase/functions/bot-ingest-snapshot/index.ts:389:        is_baseline: isBaseline,`
  - `supabase/functions/bot-ingest-snapshot/index.ts:560:      is_baseline: isBaseline,`
  - `supabase/functions/bot-ingest-snapshot/index.ts:732:    is_baseline: isBaseline,`
  - `src/pages/PlaylistDeals.tsx:204:    () => new Set(logs.filter((l) => l.is_baseline).map((l) => l.deal_id)),`
  - `supabase/functions/_shared/snapshot-ttl.ts:14:  // curator_deal_snapshots tratado separadamente em cleanup-snapshots (preserva is_baseline + último por deal, TTL 90d)`
  - `src/pages/Campanhas.tsx:534:              is_baseline: true,`
  - `src/pages/Campanhas.tsx:569:          is_baseline: true,`
  - `src/pages/Campanhas.tsx:598:        is_baseline: true,`
  - `src/pages/CampanhaExecucao.tsx:86:  is_baseline: boolean | null;`
  - `src/pages/CampanhaExecucao.tsx:129:  is_baseline?: boolean | null;`
  - `src/pages/CampanhaExecucao.tsx:380:        .select("id, created_at, rows_imported, total_streams, status, file_name, file_path, is_baseline, reference_date")`
  - `src/pages/CampanhaExecucao.tsx:430:          .eq("is_baseline", true),`
  - `src/pages/CampanhaExecucao.tsx:435:          .eq("is_baseline", true)`
  - `src/pages/CampanhaExecucao.tsx:687:          .select("playlist_id, playlist_url, playlist_name_at_capture, plays_7d, captured_at, is_baseline, created_at, upload_id, excluded, window_days")`
  - `src/pages/CampanhaExecucao.tsx:773:          const baseline = latest(list.filter((r) => !!r.is_baseline), uploads);`
  - `src/pages/CampanhaExecucao.tsx:1005:                baselineTotalStreams={recentUploads.find((u) => u.is_baseline)?.total_streams ?? null}`
  - `src/pages/CampanhaExecucao.tsx:1006:                baselinePlaylistsCount={recentUploads.find((u) => u.is_baseline)?.rows_imported ?? null}`
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
  - `supabase/functions/extract-snapshot-from-print/index.ts:1389:    is_baseline: isBaseline,`
  - `supabase/functions/get-client-campaign-public/index.ts:256:      .select("captured_at, plays, is_baseline, playlist_id")`
  - `supabase/functions/get-client-campaign-public/index.ts:391:        .select("spotify_playlist_id, spotify_url, added_at, last_paste_at, match_status, is_baseline")`
  - `supabase/functions/get-client-campaign-public/index.ts:394:        .eq("is_baseline", false)`
  - `supabase/functions/get-client-campaign-public/index.ts:429:      // Fallback: deriva da primeira coleta marcada como is_baseline em`
  - `supabase/functions/get-client-campaign-public/index.ts:435:        .eq("is_baseline", true)`
  - `supabase/functions/get-client-campaign-public/index.ts:663:      is_baseline: Boolean(entry.is_baseline),`
  - `supabase/functions/get-curator-deal-public/index.ts:79:          "id, deal_id, song_id, spotify_url, playlist_name, followers, is_baseline, added_at, spotify_playlist_id, spotify_owner_id, spotify_owner_name, image_url, added_at_spotify, match_status, match_reason, last_paste_at",`
  - `supabase/functions/get-curator-deal-public/index.ts:82:        .or("match_status.eq.curator,is_baseline.eq.true")`
  - …e mais 114

## `curator_deal_logs.is_baseline` (coluna) — 🔴 168 dependências

- **Triggers (2):** curator_deal_logs.trg_enforce_song_id_logs, curator_deal_logs.trg_enforce_song_id_logs
- **Funções SQL (2):** record_curator_deal_capture, get_curator_deal_snapshot_history
- **Código (164 ocorrências):**
  - `src/hooks/useDealTodayPlaylistBreakdown.ts:25:  is_baseline: boolean;`
  - `src/hooks/useDealTodayPlaylistBreakdown.ts:90:          "id, spotify_playlist_id, spotify_url, playlist_name, spotify_owner_name, image_url, match_status, is_baseline",`
  - `src/hooks/useDealTodayPlaylistBreakdown.ts:169:          is_baseline: !!p.is_baseline,`
  - `src/hooks/useCuratorDeals.ts:150:  is_baseline?: boolean;`
  - `src/hooks/useCuratorDeals.ts:1015:        is_baseline: opts.isBaseline,`
  - `src/hooks/useCuratorDeals.ts:1036:          is_baseline: input.is_baseline ?? false,`
  - `src/hooks/useCuratorDeals.ts:1063:          is_baseline: true,`
  - `src/hooks/useCuratorDeals.ts:1077:          is_baseline: true,`
  - `supabase/functions/bot-ingest-snapshot/index.ts:135:      is_baseline: isBaseline,`
  - `supabase/functions/bot-ingest-snapshot/index.ts:180:      metadata: { mode: "aggregate", total, is_baseline: isBaseline, correlation_id: cid ?? null, source: source ?? null },`
  - `supabase/functions/bot-ingest-snapshot/index.ts:183:    return jr({ ok: true, mode: "aggregate", total_plays: total, is_baseline: isBaseline, next_auto_collect_at: nextAt });`
  - `supabase/functions/bot-ingest-snapshot/index.ts:389:        is_baseline: isBaseline,`
  - `supabase/functions/bot-ingest-snapshot/index.ts:560:      is_baseline: isBaseline,`
  - `supabase/functions/bot-ingest-snapshot/index.ts:732:    is_baseline: isBaseline,`
  - `src/lib/dealClosurePdf.ts:177:      const sa = (a.match_status ?? (a.is_baseline ? "baseline" : "curator")) as string;`
  - `src/lib/dealClosurePdf.ts:178:      const sb = (b.match_status ?? (b.is_baseline ? "baseline" : "curator")) as string;`
  - `src/lib/dealClosurePdf.ts:186:        const status = (p.match_status ?? (p.is_baseline ? "baseline" : "curator")) as string;`
  - `src/lib/curatorDealsUtils.ts:75:  is_baseline: boolean;`
  - `src/lib/curatorDealsUtils.ts:182:  is_baseline: boolean;`
  - `src/lib/curatorDealsUtils.ts:240:  const nonBaselineLogs = dealLogs.filter((l) => !l.is_baseline);`
  - `src/lib/curatorDealsUtils.ts:241:  const hasBaseline = !!deal.baseline_captured_at || dealLogs.some((l) => l.is_baseline);`
  - `src/lib/curatorDealsUtils.ts:277:  const newPlaylists = dealPlaylists.filter((p) => !p.is_baseline);`
  - `src/lib/curatorDealsUtils.ts:278:  const baselinePlaylists = dealPlaylists.filter((p) => p.is_baseline);`
  - `src/pages/PlaylistDeals.tsx:204:    () => new Set(logs.filter((l) => l.is_baseline).map((l) => l.deal_id)),`
  - `src/pages/HeatmapEntregas.tsx:29:        .select("created_at, total_plays, is_baseline")`
  - `src/pages/HeatmapEntregas.tsx:31:        .eq("is_baseline", false);`
  - `supabase/functions/cleanup-snapshots/index.ts:24:  // Gap 13: curator_deal_snapshots — TTL 90d, preserva is_baseline=true e o snapshot mais recente por deal`
  - `supabase/functions/cleanup-snapshots/index.ts:40:      .or("is_baseline.is.null,is_baseline.eq.false");`
  - `supabase/functions/import-label-spreadsheet/index.ts:622:        is_baseline: isBaseline && !willQuarantine,`
  - `supabase/functions/import-label-spreadsheet/index.ts:777:        is_baseline: isBaseline,`
  - `supabase/functions/import-label-spreadsheet/index.ts:945:      is_baseline: isBaseline,`
  - `src/pages/DealDetail.tsx:69:    return dealPlaylists.filter((p) => p.is_baseline).length;`
  - `supabase/functions/enrich-curator-paste/index.ts:400:            is_baseline: cls.match_status === "baseline",`
  - `supabase/functions/curator-deal-followup/index.ts:69:        .eq("is_baseline", false)`
  - `supabase/functions/_shared/snapshot-ttl.ts:14:  // curator_deal_snapshots tratado separadamente em cleanup-snapshots (preserva is_baseline + último por deal, TTL 90d)`
  - `supabase/functions/cron-reconcile-curator-deals/index.ts:47:      .eq("is_baseline", true);`
  - `src/pages/CuratorPage.tsx:96:  is_baseline: boolean;`
  - `src/pages/CuratorPage.tsx:135:  is_baseline: boolean;`
  - `src/pages/CuratorPage.tsx:187:  is_baseline: boolean;`
  - `src/pages/CuratorPage.tsx:421:        if (p.is_baseline) return false;`
  - `src/pages/CuratorPage.tsx:439:    const baseAll = playlists.filter((p) => p.is_baseline);`
  - `src/pages/CuratorPage.tsx:454:    const base = playlists.filter((p) => p.is_baseline);`
  - `src/pages/CuratorPage.tsx:667:    .filter((p) => !p.is_baseline && curatorOwnedPlaylistIds.has(p.playlist_id))`
  - `src/pages/CuratorPage.tsx:2278:                                {entry.is_baseline ? "Baseline" : "Coleta"} ·{" "}`
  - `supabase/functions/get-curator-deal-public/index.ts:79:          "id, deal_id, song_id, spotify_url, playlist_name, followers, is_baseline, added_at, spotify_playlist_id, spotify_owner_id, spotify_owner_name, image_url, added_at_spotify, match_status, match_reason, last_paste_at",`
  - `supabase/functions/get-curator-deal-public/index.ts:82:        .or("match_status.eq.curator,is_baseline.eq.true")`
  - `supabase/functions/get-curator-deal-public/index.ts:95:        .select("playlist_id, captured_at, plays_24h, plays_7d, plays_28d, is_baseline")`
  - `supabase/functions/get-curator-deal-public/index.ts:97:        .eq("is_baseline", false)`
  - `supabase/functions/get-curator-deal-public/index.ts:223:        .eq("is_baseline", true);`
  - `supabase/functions/get-curator-deal-public/index.ts:277:            .select("playlist_id, playlist_name_at_capture, plays_7d, captured_at, is_baseline")`
  - …e mais 114

## `curator_playlists.is_baseline` (coluna) — 🔴 190 dependências

- **Triggers (19):** curator_playlists.trg_auto_mark_late_discovery, curator_playlists.trg_block_curator_playlist_if_eco, curator_playlists.trg_block_curator_playlist_if_eco, curator_playlists.trg_compute_observational, curator_playlists.trg_compute_observational, curator_playlists.trg_curator_playlists_recompute, curator_playlists.trg_curator_playlists_recompute, curator_playlists.trg_curator_playlists_recompute, curator_playlists.trg_enforce_curator_playlist_baseline, curator_playlists.trg_enforce_song_id_playlists, curator_playlists.trg_enforce_song_id_playlists, curator_playlists.trg_force_observational_if_ecosystem, curator_playlists.trg_force_observational_if_ecosystem, curator_playlists.trg_sync_ccp_from_curator_playlist, curator_playlists.trg_sync_ccp_from_curator_playlist, curator_playlists.trg_sync_playlist_library, curator_playlists.trg_sync_playlist_library, curator_playlists.trg_validate_curator_playlist_match_status, curator_playlists.trg_validate_curator_playlist_match_status
- **Funções SQL (7):** record_curator_deal_capture, get_curator_deal_progress, get_curator_deal_breakdown, sync_curator_playlist_streams_from_snapshot, get_curator_deal_snapshot_history, recompute_curator_deal_state, fn_deal_delivery_accumulated
- **Código (164 ocorrências):**
  - `src/pages/HeatmapEntregas.tsx:29:        .select("created_at, total_plays, is_baseline")`
  - `src/pages/HeatmapEntregas.tsx:31:        .eq("is_baseline", false);`
  - `src/pages/DealDetail.tsx:69:    return dealPlaylists.filter((p) => p.is_baseline).length;`
  - `src/lib/dealClosurePdf.ts:177:      const sa = (a.match_status ?? (a.is_baseline ? "baseline" : "curator")) as string;`
  - `src/lib/dealClosurePdf.ts:178:      const sb = (b.match_status ?? (b.is_baseline ? "baseline" : "curator")) as string;`
  - `src/lib/dealClosurePdf.ts:186:        const status = (p.match_status ?? (p.is_baseline ? "baseline" : "curator")) as string;`
  - `src/pages/PlaylistDeals.tsx:204:    () => new Set(logs.filter((l) => l.is_baseline).map((l) => l.deal_id)),`
  - `src/lib/curatorDealsUtils.ts:75:  is_baseline: boolean;`
  - `src/lib/curatorDealsUtils.ts:182:  is_baseline: boolean;`
  - `src/lib/curatorDealsUtils.ts:240:  const nonBaselineLogs = dealLogs.filter((l) => !l.is_baseline);`
  - `src/lib/curatorDealsUtils.ts:241:  const hasBaseline = !!deal.baseline_captured_at || dealLogs.some((l) => l.is_baseline);`
  - `src/lib/curatorDealsUtils.ts:277:  const newPlaylists = dealPlaylists.filter((p) => !p.is_baseline);`
  - `src/lib/curatorDealsUtils.ts:278:  const baselinePlaylists = dealPlaylists.filter((p) => p.is_baseline);`
  - `src/pages/CuratorPage.tsx:96:  is_baseline: boolean;`
  - `src/pages/CuratorPage.tsx:135:  is_baseline: boolean;`
  - `src/pages/CuratorPage.tsx:187:  is_baseline: boolean;`
  - `src/pages/CuratorPage.tsx:421:        if (p.is_baseline) return false;`
  - `src/pages/CuratorPage.tsx:439:    const baseAll = playlists.filter((p) => p.is_baseline);`
  - `src/pages/CuratorPage.tsx:454:    const base = playlists.filter((p) => p.is_baseline);`
  - `src/pages/CuratorPage.tsx:667:    .filter((p) => !p.is_baseline && curatorOwnedPlaylistIds.has(p.playlist_id))`
  - `src/pages/CuratorPage.tsx:2278:                                {entry.is_baseline ? "Baseline" : "Coleta"} ·{" "}`
  - `src/pages/Campanhas.tsx:534:              is_baseline: true,`
  - `src/pages/Campanhas.tsx:569:          is_baseline: true,`
  - `src/pages/Campanhas.tsx:598:        is_baseline: true,`
  - `src/pages/CampanhaExecucao.tsx:86:  is_baseline: boolean | null;`
  - `src/pages/CampanhaExecucao.tsx:129:  is_baseline?: boolean | null;`
  - `src/pages/CampanhaExecucao.tsx:380:        .select("id, created_at, rows_imported, total_streams, status, file_name, file_path, is_baseline, reference_date")`
  - `src/pages/CampanhaExecucao.tsx:430:          .eq("is_baseline", true),`
  - `src/pages/CampanhaExecucao.tsx:435:          .eq("is_baseline", true)`
  - `src/pages/CampanhaExecucao.tsx:687:          .select("playlist_id, playlist_url, playlist_name_at_capture, plays_7d, captured_at, is_baseline, created_at, upload_id, excluded, window_days")`
  - `src/pages/CampanhaExecucao.tsx:773:          const baseline = latest(list.filter((r) => !!r.is_baseline), uploads);`
  - `src/pages/CampanhaExecucao.tsx:1005:                baselineTotalStreams={recentUploads.find((u) => u.is_baseline)?.total_streams ?? null}`
  - `src/pages/CampanhaExecucao.tsx:1006:                baselinePlaylistsCount={recentUploads.find((u) => u.is_baseline)?.rows_imported ?? null}`
  - `src/hooks/useDealTodayPlaylistBreakdown.ts:25:  is_baseline: boolean;`
  - `src/hooks/useDealTodayPlaylistBreakdown.ts:90:          "id, spotify_playlist_id, spotify_url, playlist_name, spotify_owner_name, image_url, match_status, is_baseline",`
  - `src/hooks/useDealTodayPlaylistBreakdown.ts:169:          is_baseline: !!p.is_baseline,`
  - `src/pages/ClientCampaignPage.tsx:85:  is_baseline: boolean;`
  - `src/pages/ClientCampaignPage.tsx:823:                                  {entry.is_baseline ? "Baseline" : "Coleta"} ·{" "}`
  - `src/hooks/useCuratorDeals.ts:150:  is_baseline?: boolean;`
  - `src/hooks/useCuratorDeals.ts:1015:        is_baseline: opts.isBaseline,`
  - `src/hooks/useCuratorDeals.ts:1036:          is_baseline: input.is_baseline ?? false,`
  - `src/hooks/useCuratorDeals.ts:1063:          is_baseline: true,`
  - `src/hooks/useCuratorDeals.ts:1077:          is_baseline: true,`
  - `supabase/functions/bot-ingest-snapshot/index.ts:135:      is_baseline: isBaseline,`
  - `supabase/functions/bot-ingest-snapshot/index.ts:180:      metadata: { mode: "aggregate", total, is_baseline: isBaseline, correlation_id: cid ?? null, source: source ?? null },`
  - `supabase/functions/bot-ingest-snapshot/index.ts:183:    return jr({ ok: true, mode: "aggregate", total_plays: total, is_baseline: isBaseline, next_auto_collect_at: nextAt });`
  - `supabase/functions/bot-ingest-snapshot/index.ts:389:        is_baseline: isBaseline,`
  - `supabase/functions/bot-ingest-snapshot/index.ts:560:      is_baseline: isBaseline,`
  - `supabase/functions/bot-ingest-snapshot/index.ts:732:    is_baseline: isBaseline,`
  - `supabase/functions/_shared/snapshot-ttl.ts:14:  // curator_deal_snapshots tratado separadamente em cleanup-snapshots (preserva is_baseline + último por deal, TTL 90d)`
  - …e mais 114

## `curator_campaign_playlists.baseline_conflict_at` (coluna) — 🔴 10 dependências

- **Triggers (3):** curator_campaign_playlists.trg_ccp_match_on_insert, curator_campaign_playlists.trg_ccp_match_on_insert, curator_campaign_playlists.trg_ccp_updated_at
- **Código (7 ocorrências):**
  - `supabase/functions/get-curator-deal-public/index.ts:248:      baseline_conflict_at: string | null;`
  - `supabase/functions/get-curator-deal-public/index.ts:261:            "playlist_id, playlist_url, status, registered_at, matched_at, baseline_conflict_at",`
  - `supabase/functions/get-curator-deal-public/index.ts:294:          const conflictAt = r.baseline_conflict_at`
  - `supabase/functions/get-curator-deal-public/index.ts:295:            ? new Date(r.baseline_conflict_at).getTime()`
  - `supabase/functions/get-curator-deal-public/index.ts:303:            baseline_conflict_at: r.baseline_conflict_at ?? null,`
  - `src/components/curators/BaselineConflictsSection.tsx:10:  baseline_conflict_at: string | null;`
  - `src/components/curators/BaselineConflictsSection.tsx:181:                    {fmtDate(c.baseline_conflict_at ?? c.registered_at)}`

## `curator_campaign_playlists.baseline_conflict_source` (coluna) — 🔴 3 dependências

- **Triggers (3):** curator_campaign_playlists.trg_ccp_match_on_insert, curator_campaign_playlists.trg_ccp_match_on_insert, curator_campaign_playlists.trg_ccp_updated_at

## `is_playlist_in_deal_baseline()` (função SQL) — 🔴 1 dependências

- **Funções SQL (1):** enforce_curator_playlist_baseline

## `enforce_curator_playlist_baseline()` (função SQL) — 🔴 2 dependências

- **Triggers (1):** curator_playlists.trg_enforce_curator_playlist_baseline
- **Código (1 ocorrências):**
  - `supabase/functions/extract-snapshot-from-print/index.ts:1327:  // aqui será bloqueado pelo trigger enforce_curator_playlist_baseline().`

## `recalc_curator_deal_baseline_from_spreadsheet()` (função SQL) — 🔴 2 dependências

- **Código (2 ocorrências):**
  - `src/components/playlist-deals/DealRow.tsx:368:        "recalc_curator_deal_baseline_from_spreadsheet",`
  - `src/components/playlist-deals/CuratorDealCard.tsx:576:        "recalc_curator_deal_baseline_from_spreadsheet",`

## `sync_curator_playlist_streams_from_snapshot()` (função SQL) — 🔴 1 dependências

- **Triggers (1):** curator_deal_snapshots.trg_sync_curator_playlist_streams

## `notify_baseline_missing()` (função SQL) — 🔴 1 dependências

- **Código (1 ocorrências):**
  - `supabase/functions/cron-reconcile-curator-deals/index.ts:49:      await supabase.rpc("notify_baseline_missing", { p_deal_id: deal.id });`

## `sync_campaign_deals_baseline()` (função SQL) — 🔴 2 dependências

- **Funções SQL (2):** _trg_sync_baseline_on_campaign_captured, ingest_campaign_collection_batch

## `sync_deal_campaign_baseline()` (função SQL) — 🔴 5 dependências

- **Funções SQL (5):** _trg_sync_baseline_on_deal_insert, _trg_sync_baseline_on_song_insert, tg_sync_deal_campaign_baseline_from_song, tg_sync_deal_campaign_baseline_from_deal, sync_campaign_deals_baseline

## `trg_sync_baseline_on_deal_insert` (trigger) — 🔴 1 dependências

- **Triggers (1):** curator_deals.trg_sync_baseline_on_deal_insert

## `trg_sync_baseline_on_song_insert` (trigger) — 🔴 1 dependências

- **Triggers (1):** curator_deal_songs.trg_sync_baseline_on_song_insert

## `trg_sync_baseline_on_campaign_captured` (trigger) — 🔴 1 dependências

- **Triggers (1):** campaigns.trg_sync_baseline_on_campaign_captured

## `trg_sync_deal_campaign_baseline_from_deal` (trigger) — 🔴 2 dependências

- **Triggers (2):** curator_deals.trg_sync_deal_campaign_baseline_from_deal, curator_deals.trg_sync_deal_campaign_baseline_from_deal

## `trg_sync_deal_campaign_baseline_from_song` (trigger) — 🔴 1 dependências

- **Triggers (1):** curator_deal_songs.trg_sync_deal_campaign_baseline_from_song

## `trg_enforce_curator_playlist_baseline` (trigger) — 🔴 1 dependências

- **Triggers (1):** curator_playlists.trg_enforce_curator_playlist_baseline

---
**TOTAL DE DEPENDÊNCIAS: 579**
🔴 DROP bloqueado — resolver acima primeiro.