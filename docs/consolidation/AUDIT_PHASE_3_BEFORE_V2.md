# AUDIT PHASE 3 — COLLECTION/INGESTION ARCHITECTURE (BEFORE) — V2
> Read-only forensic audit — NexEngine codebase · June 2026  
> Auditor: forensic-only mode · No files modified  
> **V2 adds PART 3 (dedicated RPC audit) and renumbers remaining parts accordingly. 13 parts total.**

---

## PART 1 — COMPLETE FLOW MAP

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                          COLLECTION PIPELINE — FULL MAP (V2)                          │
└──────────────────────────────────────────────────────────────────────────────────────┘

SOURCE A — BOT VPS (Spotify for Artists scraper)
─────────────────────────────────────────────────
[VPS Bot / Claudio Worker]
  │
  ├─ GET bot-collect-queue              ← picks up curator_deal_songs where auto_collect=true
  │     └─ RPC: claim_collect_queue(p_ids uuid[])
  │           • FOR UPDATE SKIP LOCKED (atomic, prevents races)
  │           • writes: curator_deal_songs (status=queued)
  │     └─ reads: v_curator_playlists_operational (whitelist)
  │     └─ writes: bot_events (step=dispatch, lifecycle_state=FETCHED)
  │
  ├─ POST bot-event-ingest              ← granular step events (STARTED, PRINT_UPLOADED…)
  │     └─ writes: bot_events
  │
  ├─ POST bot-heartbeat                 ← every ~30s, session status + optional dom_snapshots[]
  │     └─ writes: bot_heartbeats, vps_nodes
  │     └─ PIGGYBACK: calls processDomItem() [_shared/ingest-dom.ts] for each dom_snapshot
  │
  ├── PATH A1: DOM ingest (PREFERRED — no OCR)
  │   ├─ POST bot-ingest-dom
  │   │     └─ calls processDomItem() [_shared/ingest-dom.ts]
  │   │           └─ RPC: match_curator_playlist (spotify_id → name → fuzzy 0.85)
  │   │           └─ writes: curator_playlists (create if not exists)
  │   │           └─ writes: curator_deal_snapshots
  │   │           └─ writes: organic_plays_snapshots (unmatched non-algo)
  │   │           └─ writes: campaign_eco_snapshots (if shadow deal)
  │   │           └─ calls baseline-writer.ts::writeBaselineOfficial()
  │   │                 └─ RPC: ingest_campaign_collection_batch (intent='baseline')
  │   │                         └─ writes: campaign_playlist_collections
  │   │                         └─ calls sync_campaign_deals_baseline() (on first baseline)
  │   │           └─ writes: curator_deal_logs
  │   │           └─ writes: curator_deal_songs (status=idle, next_auto_collect_at)
  │   │           └─ writes: collection_logs
  │   │
  │   └─ POST bot-ingest-snapshot       ← also accepts DOM-like snapshots[] array
  │         └─ inline ensureObservedPlaylist() [NOT shared with ingest-dom.ts]
  │         └─ RPC: match_curator_playlist (called directly, not via shared helper)
  │         └─ writes: curator_playlists, curator_deal_snapshots
  │         └─ writes: campaign_eco_snapshots, curator_deal_logs
  │         └─ calls writeBaselineOfficial() → RPC: ingest_campaign_collection_batch
  │         └─ writes: bot_print_batches (if screenshots present)
  │         └─ writes: curator_deal_songs
  │
  ├── PATH A2: PRINT + OCR (legacy/fallback)
  │   ├─ POST bot-upload-print
  │   │     └─ writes: Storage bucket "bot-prints"
  │   │     └─ writes: bot_print_batches
  │   │     └─ RPC: append_print_to_batch (atomic array append, FOR UPDATE)
  │   │     └─ when batch complete: calls extract-snapshot-from-print
  │   │
  │   └─ POST extract-snapshot-from-print
  │         ├─ calls: Gemini 2.5 Flash via ai.gateway.lovable.dev
  │         ├─ cache: ai_print_cache (SHA-256 of print URLs)
  │         ├─ RPC: match_curator_playlist (x2: whitelist pass + DOM complement)
  │         ├─ writes: curator_playlists, curator_deal_snapshots
  │         ├─ writes: campaign_eco_snapshots, organic_plays_snapshots
  │         ├─ calls writeBaselineOfficial() → RPC: ingest_campaign_collection_batch
  │         ├─ writes: curator_deal_logs, curator_deal_songs
  │         ├─ writes: collection_logs, bot_events
  │         ├─ writes: ai_print_cache
  │         └─ marks bot_print_batches status=processed
  │
  ├── PATH A3: NEW unified song snapshot (bot-ingest-song-snapshot)
  │   └─ POST bot-ingest-song-snapshot
  │         └─ writes: song_snapshots (header row)
  │         └─ writes: song_snapshot_playlists (one row per playlist)
  │         └─ writes: bot_print_batches (if screenshots)
  │         └─ RPC: ingest_campaign_collection_batch DIRECTLY (no baseline-writer guard)
  │         └─ writes: curator_deal_songs (bump)
  │         └─ closes: catalog_snapshot_queue (catalog mode)
  │
  ├─ POST bot-execution-complete
  │     └─ writes: curator_deal_songs (status, backoff)
  │     └─ writes: bot_events (FINISHED/FAILED)
  │     └─ writes: playlist_execution_jobs (if job_id present)
  │
  └─ GET bot-execution-queue
        └─ executes via Spotify Web API
        └─ writes: playlist_execution_jobs (done/failed/manual)

SOURCE B — CRON: recover stuck print batches
──────────────────────────────────────────────
[pg_cron: recover-print-batches-5min → */5 * * * *]
  └─ calls: cron-recover-print-batches
        └─ RPC: recover_stuck_print_batches()
              • resets processing→complete for batches stuck >10min
              • returns list of complete-but-unprocessed batches
        └─ calls: extract-snapshot-from-print (re-dispatch per stuck batch)

SOURCE C — LABEL SPREADSHEET
────────────────────────────────────────────────────
[Client Portal Frontend] → import-label-spreadsheet
  ├─ parses XLSX/CSV (npm:xlsx@0.18.5)
  ├─ RPC: resolve_client_token(_token) → resolves client identity
  ├─ buildMatchers() → playlists, curator_playlists, managed_playlists tables
  ├─ RPC: evaluate_upload_quarantine(p_deal_id, p_content_hash, p_rows)
  │       → duplicate/regression detection (returns accept/review/quarantine)
  ├─ writes: Storage "label-spreadsheets"
  ├─ writes: label_spreadsheet_uploads, label_spreadsheet_rows
  ├─ writes: curator_playlists, curator_deal_snapshots
  ├─ writes: delivery_proofs (non-baseline internal playlists only)
  ├─ writes: curator_deal_songs (auto_collect=false)
  ├─ RPC: recompute_campaign_total_delivered(p_campaign_id)
  └─ RPC: ingest_campaign_collection_batch DIRECTLY (no baseline-writer guard)

SOURCE D — CRON: reconcile curator deals
──────────────────────────────────────────
[pg_cron: cron-deal-delivery-check]
  └─ calls: cron-reconcile-curator-deals
        └─ RPC: recompute_campaign_total_delivered (per campaign)
        └─ RPC: notify_baseline_missing (if deal has no baseline)
        └─ RPC: create_notification (milestone alerts)

SOURCE E — OBSERVER (separate system)
───────────────────────────────────────
[bot-ingest] → observe_playlist action
  └─ writes: playlist_observations, observer_runs
  ⚠ Does NOT feed campaign_playlist_collections

DATABASE LAYER
─────────────────────────────────────────────────────
TRIGGER trg_cpc_first_seen (BEFORE INSERT on campaign_playlist_collections)
  → set_collection_first_seen_at() — sets first_seen_at if null

TRIGGER trg_sync_deal_campaign_baseline_from_deal (AFTER INSERT/UPDATE curator_deals)
  → tg_sync_deal_campaign_baseline_from_deal() → sync_deal_campaign_baseline()

TRIGGER trg_sync_deal_campaign_baseline_from_song (AFTER INSERT curator_deal_songs)
  → tg_sync_deal_campaign_baseline_from_song() → sync_deal_campaign_baseline()

DELIVERY PIPELINE
─────────────────────────────────────────
campaign_playlist_collections
  → fn_playlist_delivery_accumulated(p_campaign_id) [per playlist delta]
  → fn_curator_delivery_accumulated(p_campaign_id) [per curator aggregate]
  → fn_campaign_delivery_accumulated(p_campaign_id) [curator+eco+organic buckets]
  → recompute_campaign_total_delivered(p_campaign_id)
        → campaigns.total_delivered
        → curator_deals.reconciled_total_plays
  → vw_campaign_playlist_growth (view)
  → Frontend

FRONTEND RPCs (read-only / UI)
────────────────────────────────
get_curator_deal_progress(p_deal_id, p_song_id)
fn_playlist_delivery_accumulated(p_campaign_id)
get_curator_deal_snapshot_history(p_deal_id)
get_spotify_apps_status / get_spotify_app_for_playlist / get_blocked_playlist_ids
approve_campaign / suggest_campaign_playlists
evaluate_playlist_by_url / evaluate_playlists_batch
community_* RPCs (separate domain)
```

---

## PART 2 — EDGE FUNCTIONS TABLE

| Function | Responsibility | Caller | Callees | Tables Read | Tables Written | RPCs Used | Active? | Duplicate? |
|---|---|---|---|---|---|---|---|---|
| **bot-collect-queue** | Queue delivery: returns curator_deal_songs eligible for collection | VPS bot (GET, poll) | spotify-client (getAppToken) | curator_deal_songs, v_curator_playlists_operational, curator_deals, campaigns, clients, curators | curator_deal_songs (queued), bot_events, notifications | `claim_collect_queue`, `create_notification` | ✅ Yes | Partial: bot-ingest-song-snapshot handles catalog mode separately |
| **bot-event-ingest** | Records granular lifecycle events per song | VPS bot (POST) | — | — | bot_events | — | ✅ Yes | No |
| **bot-heartbeat** | Session health + piggyback DOM ingest | VPS bot (POST every ~30s) | processDomItem [_shared/ingest-dom.ts], send-transactional-email | bot_heartbeats, notifications, email_send_log | bot_heartbeats, vps_nodes, collection_logs | `create_notification` (via ingest-dom: `match_curator_playlist`, `ingest_campaign_collection_batch`) | ✅ Yes | DOM ingest duplicated in bot-ingest-dom |
| **bot-ingest** | Observer protocol: list/observe playlists, log runs | VPS observer bot | — | playlists_to_observe | playlist_observations, observer_runs | — | ✅ Yes (observer, separate domain) | No |
| **bot-ingest-dom** | DOM-parsed playlist data: writes snapshots without prints | VPS bot (POST) | processDomItem [_shared/ingest-dom.ts] | curator_deals, curator_deal_songs, curator_deal_logs, curator_playlists | curator_deal_snapshots, curator_playlists, organic_plays_snapshots, campaign_eco_snapshots, curator_deal_logs, curator_deal_songs, collection_logs | `match_curator_playlist`, `ingest_campaign_collection_batch` (via baseline-writer) | ✅ Yes | **DUPLICATE** with bot-heartbeat (piggyback) and bot-ingest-snapshot |
| **bot-ingest-snapshot** | Receives collected data: aggregate OR snapshots[] per playlist | VPS bot (POST) | assertDealOperable, classifyPlaylistKind | curator_deals, curator_deal_songs, curator_deal_logs | curator_deal_snapshots, curator_playlists, curator_deal_logs, curator_deal_songs, bot_print_batches, campaign_eco_snapshots, collection_logs | `match_curator_playlist`, `ingest_campaign_collection_batch` (via baseline-writer), `create_notification` | ✅ Yes | **DUPLICATE** with bot-ingest-dom (same job, different payload format) |
| **bot-ingest-song-snapshot** | NEW unified endpoint: raw S4A song+playlists payload | VPS bot (POST) | logRawIngest | curator_deal_songs, campaigns, song_snapshots | song_snapshots, song_snapshot_playlists, bot_print_batches, curator_deal_songs, catalog_snapshot_queue | `ingest_campaign_collection_batch` (DIRECT — no baseline-writer guard) | ✅ Yes | **RISK**: bypasses baseline-writer guard |
| **bot-upload-print** | Stores PNG prints, groups multi-part batches | VPS bot (POST) | assertDealOperable, logRawIngest | curator_deals, bot_print_batches, catalog_snapshot_queue | Storage [bot-prints], bot_print_batches, bot_ingest_raw | `append_print_to_batch` | ✅ Yes | No (print storage is its own domain) |
| **extract-snapshot-from-print** | OCR via Gemini Vision → playlists → snapshots | bot-upload-print (auto), cron-recover-print-batches, manual | callGeminiChunked, classifyPlaylistKind, fetchPlaylistMeta | bot_print_batches, curator_playlists, managed_playlists, curator_deals, curator_deal_snapshots, ai_print_cache | curator_deal_snapshots, curator_playlists, organic_plays_snapshots, campaign_eco_snapshots, curator_deal_logs, curator_deal_songs, bot_print_batches, collection_logs, bot_events, ai_print_cache | `match_curator_playlist` (x2), `ingest_campaign_collection_batch` (via baseline-writer), `create_notification` | ✅ Yes | No (sole OCR processor) |
| **cron-recover-print-batches** | Re-dispatches stuck complete-but-unprocessed print batches | pg_cron every 5min | extract-snapshot-from-print | bot_print_batches | bot_print_batches | `recover_stuck_print_batches` | ✅ Yes | No (recovery-only) |
| **cron-reconcile-curator-deals** | Reconciles deals: recomputes delivered, notifies missing baseline | pg_cron | — | curator_deals, campaigns, campaign_playlist_collections | curator_deals, campaigns, notifications | `recompute_campaign_total_delivered`, `notify_baseline_missing`, `create_notification`, `get_cron_secret` | ✅ Yes | No |
| **import-label-spreadsheet** | Parse XLSX/CSV from client portal → write collections | Client portal frontend | evaluate_upload_quarantine, buildMatchers | label_spreadsheet_uploads, campaigns, curator_playlists, managed_playlists, playlists, curators | label_spreadsheet_uploads, label_spreadsheet_rows, curator_playlists, curator_deal_snapshots, delivery_proofs, curator_deal_songs, Storage [label-spreadsheets] | `resolve_client_token`, `evaluate_upload_quarantine`, `recompute_campaign_total_delivered`, `ingest_campaign_collection_batch` (DIRECT) | ✅ Yes | No (sole spreadsheet importer) |
| **bot-execution-queue** | Playlist track add/remove/reorder jobs (Spotify Web API) | VPS bot (GET), pg_cron | spotify-playlist.ts, spotify-client.ts | playlist_execution_jobs, managed_playlists, system_flags | playlist_execution_jobs, bot_events, manual_distribution_queue | — | ✅ Yes | No |
| **bot-execution-complete** | Reports collect/execution done or failed | VPS bot (POST) | — | curator_deal_songs, playlist_execution_jobs | curator_deal_songs, playlist_execution_jobs, bot_events | — | ✅ Yes | No |
| **collect-batch** | Genre search batch (deprecated) | Team/internal | run-search, analyze-genre | genres, search_terms, search_results | collection_logs, genres | `deprecationGate` | ⚠️ Deprecated | Genre domain only |
| **daily-collect** | Daily genre collection cron (deprecated) | Cron | run-search, analyze-genre | genres, search_terms | collection_logs | `deprecationGate`, `reportCronHealth` | ⚠️ Deprecated | Superseded by collect-batch |

---

## PART 3 — RPC AUDIT (NEW)

> Every SQL function used by the collection/ingestion domain, sourced from `supabase/migrations/`. Evidence cited with migration file name.

---

### RPC-01: `claim_collect_queue(p_ids uuid[])`

| Attribute | Value |
|---|---|
| **Responsibility** | Atomic claim of bot collect queue items. Prevents race conditions between parallel VPS workers. |
| **Language / Volatility** | SQL · SECURITY DEFINER |
| **Defined in** | `20260609130807_1c54da54.sql` (replaces prior `(integer,integer)` signature dropped same day) |
| **Parameters** | `p_ids uuid[]` — candidate IDs selected by edge function |
| **Returns** | `TABLE(id uuid)` — the IDs actually claimed |
| **Algorithm** | `FOR UPDATE SKIP LOCKED` on `curator_deal_songs WHERE id = ANY(p_ids) AND auto_collect_status IN ('idle','error')` → UPDATE status to `queued`, set `queued_at`, `updated_at` |
| **Callers** | `bot-collect-queue/index.ts:303` |
| **Tables read** | `curator_deal_songs` |
| **Tables written** | `curator_deal_songs` (status=queued, queued_at, updated_at) |
| **Dependencies** | None |
| **Duplicates** | Previous version `(integer,integer)` dropped in same migration. Current is authoritative. |
| **Grant** | `service_role` only — anon/authenticated revoked |

---

### RPC-02: `append_print_to_batch(p_batch_id, p_path, p_signed_url, p_dom, p_correlation)`

| Attribute | Value |
|---|---|
| **Responsibility** | Atomically appends one print part to a `bot_print_batches` row; deduplicates by path; merges DOM payloads; marks batch `complete` when received_parts ≥ total_parts. |
| **Language / Volatility** | PL/pgSQL · SECURITY DEFINER |
| **Defined in** | `20260616172626_23cbb954.sql` |
| **Parameters** | `p_batch_id uuid`, `p_path text`, `p_signed_url text`, `p_dom jsonb`, `p_correlation uuid DEFAULT NULL` |
| **Returns** | `TABLE(batch_id, received_parts, total_parts, is_complete, print_paths, print_urls, dom_payload, status, was_duplicate)` |
| **Algorithm** | `SELECT … FOR UPDATE` on `bot_print_batches` (pessimistic lock). Idempotent on duplicate path. Merges dom_payload with DISTINCT ON URL deduplication. Sets `status='complete'` + `completed_at` when done. |
| **Callers** | `bot-upload-print/index.ts:411` |
| **Tables read** | `bot_print_batches` |
| **Tables written** | `bot_print_batches` (print_paths, print_urls, received_parts, dom_payload, status, completed_at, correlation_id) |
| **Dependencies** | None |
| **Duplicates** | None — sole batch-assembly function. |
| **Grant** | `service_role` only |

---

### RPC-03: `match_curator_playlist(p_deal_id, p_spotify_playlist_id, p_playlist_name, p_song_id DEFAULT NULL)`

| Attribute | Value |
|---|---|
| **Responsibility** | Official playlist match: resolves a raw Spotify playlist ID/name into a `curator_playlists.id`. Three-tier priority: spotify_id exact → name normalized exact → pg_trgm fuzzy ≥ 0.85. |
| **Language / Volatility** | PL/pgSQL · STABLE · SECURITY DEFINER |
| **Defined in** | `20260522164414_e570679e.sql` (final version; prior versions in `20260503224417`, `20260505122242`) |
| **Parameters** | `p_deal_id uuid`, `p_spotify_playlist_id text`, `p_playlist_name text`, `p_song_id uuid DEFAULT NULL` |
| **Returns** | `TABLE(playlist_id uuid, match_method text)` — method ∈ {`spotify_id`, `name`, `fuzzy`} |
| **Algorithm** | (1) Exact `spotify_playlist_id` match scoped to deal + optional song. (2) Normalized name match (lowercase, remove accents, collapse non-alphanumeric). (3) `similarity()` ≥ 0.85. Returns first match found. |
| **Callers** | `_shared/ingest-dom.ts` (processDomItem) · `bot-ingest-snapshot/index.ts` (direct) · `extract-snapshot-from-print/index.ts` (x2: whitelist pass + DOM complement) |
| **NOT called by** | `bot-ingest-song-snapshot` (no match at all — stores raw) · `import-label-spreadsheet` (uses `buildMatchers()` against `playlists` table, not this RPC) |
| **Tables read** | `curator_playlists` |
| **Tables written** | None (STABLE) |
| **Dependencies** | `pg_trgm` extension (similarity function) |
| **Duplicates** | ⚠️ THREE parallel implementations: (1) this RPC, (2) `ensureObservedPlaylist()` in bot-ingest-snapshot (JS, spotify_id only, no fuzzy), (3) `buildMatchers()` in import-label-spreadsheet (JS, queries `playlists` not `curator_playlists`). |
| **Grant** | `service_role`; `anon`/`authenticated` revoked (`20260524205222`) |

---

### RPC-04: `recover_stuck_print_batches()`

| Attribute | Value |
|---|---|
| **Responsibility** | (1) Resets `bot_print_batches` stuck in `processing` >10min back to `complete`. (2) Returns all `complete` batches not yet processed (no `processed_at`), up to 20, for re-dispatch by edge function. |
| **Language / Volatility** | PL/pgSQL · SECURITY DEFINER |
| **Defined in** | `20260515234435_1b44a0bd.sql` (latest; earlier version in `20260505120355`) |
| **Parameters** | None |
| **Returns** | `TABLE(batch_id uuid, deal_id uuid, song_id uuid, print_urls jsonb)` |
| **Algorithm** | UPDATE processing→complete for stuck >10min. RETURN QUERY complete+unprocessed where completed_at <5min ago, LIMIT 20. |
| **Callers** | `cron-recover-print-batches/index.ts:23` |
| **Tables read** | `bot_print_batches` |
| **Tables written** | `bot_print_batches` (status, updated_at, error) |
| **Dependencies** | None |
| **Duplicates** | None — sole recovery function. |
| **Grant** | `service_role` only |

---

### RPC-05: `ingest_campaign_collection_batch(p_campaign_id, p_intent, p_rows, p_snapshot_run_id DEFAULT NULL)`

| Attribute | Value |
|---|---|
| **Responsibility** | THE central write gateway for `campaign_playlist_collections`. Accepts a batch of playlist+plays rows, validates intent, enforces baseline-once invariant, inserts rows idempotently, triggers `sync_campaign_deals_baseline` on first baseline capture. |
| **Language / Volatility** | PL/pgSQL · SECURITY DEFINER |
| **Defined in** | `20260610202710_0bcf0ccf.sql` (final version with `p_snapshot_run_id`; prior versions in `20260531161857`, `20260531175554`, `20260603221901`, dropped at `20260608162415`) |
| **Parameters** | `p_campaign_id uuid`, `p_intent text` ∈ {`baseline`,`periodic`}, `p_rows jsonb` (array), `p_snapshot_run_id uuid DEFAULT NULL` |
| **Returns** | `jsonb` — `{skipped, reason, inserted, campaign_id, …}` |
| **Algorithm** | (1) Validates intent + rows. (2) `SELECT … FOR UPDATE` on campaigns (baseline_status). (3) If intent=baseline AND already captured → calls `sync_campaign_deals_baseline`, returns skipped. (4) Inserts rows to `campaign_playlist_collections` with ON CONFLICT DO UPDATE (plays_7d, updated fields). (5) If newly captured baseline → UPDATE `campaigns.baseline_status='captured'`, calls `sync_campaign_deals_baseline`. |
| **Callers** | `_shared/baseline-writer.ts:167` (guarded path — used by bot-ingest-dom, bot-heartbeat, bot-ingest-snapshot, extract-snapshot-from-print) · `bot-ingest-song-snapshot/index.ts:290` (DIRECT, no guard) · `import-label-spreadsheet/index.ts:894` (DIRECT, no guard, via `admin.rpc`) |
| **Tables read** | `campaigns` |
| **Tables written** | `campaign_playlist_collections` · `campaigns` (baseline_status, baseline_captured_at) |
| **Internal calls** | `sync_campaign_deals_baseline(p_campaign_id)` on baseline capture |
| **Trigger fired** | `trg_cpc_first_seen` BEFORE INSERT → `set_collection_first_seen_at()` |
| **Duplicates** | Signature evolved 4 times since May 2026. Current is authoritative. Two callers bypass the baseline-writer guard layer. |
| **Grant** | `service_role` only — `anon`/`authenticated`/PUBLIC revoked (`20260610202835`) |

---

### RPC-06: `sync_campaign_deals_baseline(p_campaign_id)`  +  `sync_deal_campaign_baseline(p_deal_id)`

| Attribute | Value |
|---|---|
| **Responsibility** | After campaign baseline is captured: propagates baseline playlist data into `curator_deal_baseline_playlists` for each deal+song in the campaign. `sync_campaign_deals_baseline` iterates all deals; `sync_deal_campaign_baseline` handles one deal. |
| **Language / Volatility** | PL/pgSQL · SECURITY DEFINER |
| **Defined in** | `20260610202710_0bcf0ccf.sql` |
| **Parameters** | `p_campaign_id uuid` / `p_deal_id uuid` |
| **Returns** | `jsonb` — counts |
| **Algorithm** | Reads `campaign_playlist_collections WHERE campaign_id=p AND is_baseline=true`. Upserts into `curator_deal_baseline_playlists` for every song in every deal. |
| **Callers** | `ingest_campaign_collection_batch` (on baseline capture + on skipped-already-captured) · `trg_sync_deal_campaign_baseline_from_deal` (AFTER INSERT/UPDATE on curator_deals) · `trg_sync_deal_campaign_baseline_from_song` (AFTER INSERT on curator_deal_songs) |
| **Tables read** | `curator_deals`, `curator_deal_songs`, `campaign_playlist_collections`, `campaigns` |
| **Tables written** | `curator_deal_baseline_playlists`, `curator_deals` (baseline_captured_at) |
| **Duplicates** | None — these are chained, not duplicate. |
| **Grant** | `authenticated`, `service_role` |

---

### RPC-07: `fn_playlist_delivery_accumulated(p_campaign_id)`

| Attribute | Value |
|---|---|
| **Responsibility** | Computes per-playlist incremental delivery (plays delta) from `campaign_playlist_collections`. Calculates `delivery_accumulated` as sum of positive deltas over time-ordered readings, treating first row as baseline (delta=0). |
| **Language / Volatility** | SQL · STABLE · SECURITY DEFINER |
| **Defined in** | `20260611143541_d0da740d.sql` (latest; prior versions in `20260609234713`, `20260610005130`) |
| **Parameters** | `p_campaign_id uuid` |
| **Returns** | `TABLE(playlist_id text, delivery_accumulated bigint, current_reading bigint, last_reading_at timestamptz, readings_count int, last_import_delta bigint)` |
| **Algorithm** | CTEs: `valid` (non-excluded, non-quarantined rows) → `ordered` (ROW_NUMBER + LAG per playlist) → `with_delta` (GREATEST(0, plays - prev_plays)) → `totals` (SUM per playlist) → JOIN `last_row` for last_import_delta. |
| **Callers** | `fn_curator_delivery_accumulated` · `fn_campaign_delivery_accumulated` · frontend via `supabase.rpc` |
| **Tables read** | `campaign_playlist_collections`, `label_spreadsheet_uploads` |
| **Tables written** | None (STABLE) |
| **Dependencies** | `label_spreadsheet_uploads` (quarantine filter via LEFT JOIN) |
| **Duplicates** | Prior version `fn_campaign_delivery_accumulated`-level logic was restructured to three-function hierarchy. Current is authoritative. |
| **Grant** | `authenticated`, `anon`, `service_role` |

---

### RPC-08: `fn_curator_delivery_accumulated(p_campaign_id)`

| Attribute | Value |
|---|---|
| **Responsibility** | Aggregates per-playlist delivery (from `fn_playlist_delivery_accumulated`) grouped by curator. Used to compute `curator_deals.reconciled_total_plays`. |
| **Language / Volatility** | SQL · STABLE (assumed) · SECURITY DEFINER |
| **Defined in** | `20260609234713_40ca1276.sql` |
| **Parameters** | `p_campaign_id uuid` |
| **Returns** | `TABLE(curator_id uuid, delivery_accumulated bigint)` |
| **Callers** | `recompute_campaign_total_delivered` (internal call) |
| **Tables read** | via `fn_playlist_delivery_accumulated`; `curator_campaign_playlists` |
| **Tables written** | None |
| **Duplicates** | None |
| **Grant** | `authenticated`, `anon`, `service_role` |

---

### RPC-09: `fn_campaign_delivery_accumulated(p_campaign_id)`

| Attribute | Value |
|---|---|
| **Responsibility** | Classifies each playlist's delivery into three buckets (curator / eco / organic) and returns aggregate plays per bucket plus total observed. |
| **Language / Volatility** | SQL · STABLE · SECURITY DEFINER |
| **Defined in** | `20260611144251_38130cc7.sql` (recreated after CASCADE drop; prior in `20260609234713`, `20260609234833`) |
| **Parameters** | `p_campaign_id uuid` |
| **Returns** | `TABLE(curator_plays, eco_plays, organic_plays, total_plays, observed_plays)` all bigint |
| **Algorithm** | Reads `fn_playlist_delivery_accumulated` → LEFT JOINs `curator_campaign_playlists` (curator bucket) and `campaign_eco_allocations`/`managed_playlists` (eco bucket) → aggregates by bucket. |
| **Callers** | `recompute_campaign_total_delivered` · frontend (useCuratorDealBreakdown) |
| **Tables read** | via `fn_playlist_delivery_accumulated`; `curator_campaign_playlists`; `campaign_eco_allocations`; `managed_playlists` |
| **Tables written** | None |
| **Duplicates** | None |
| **Grant** | `authenticated`, `anon`, `service_role` |

---

### RPC-10: `recompute_campaign_total_delivered(p_campaign_id)`

| Attribute | Value |
|---|---|
| **Responsibility** | Recomputes and persists `campaigns.total_delivered` and per-deal `curator_deals.reconciled_total_plays`. The single authoritative trigger for delivery KPI refresh. |
| **Language / Volatility** | PL/pgSQL · SECURITY DEFINER |
| **Defined in** | `20260611144251_38130cc7.sql` (latest; prior versions in `20260529124637`, `20260609234713`) |
| **Parameters** | `p_campaign_id uuid` |
| **Returns** | `void` |
| **Algorithm** | Calls `fn_campaign_delivery_accumulated` → UPDATE `campaigns.total_delivered`. Calls `fn_curator_delivery_accumulated` → UPDATE `curator_deals.reconciled_total_plays` (IS DISTINCT FROM guard). |
| **Callers** | `import-label-spreadsheet/index.ts:856` · `cron-reconcile-curator-deals/index.ts:189` · frontend `useCuratorDeals` hook |
| **Tables read** | via sub-functions |
| **Tables written** | `campaigns` (total_delivered) · `curator_deals` (reconciled_total_plays) |
| **Dependencies** | `fn_campaign_delivery_accumulated`, `fn_curator_delivery_accumulated` |
| **Duplicates** | None — sole recompute trigger. |
| **Grant** | `authenticated`, `service_role` |

---

### RPC-11: `evaluate_upload_quarantine(p_deal_id, p_content_hash, p_rows)`

| Attribute | Value |
|---|---|
| **Responsibility** | Guard for label spreadsheet uploads. Detects: (1) exact duplicate content hash, (2) first upload (accept as baseline), (3) insufficient overlap with prior upload, (4) corrupted/partial window (avg ratio < 0.05), (5) partial 7d window (ratio < 0.30), (6) massive regression (ratio < 0.50 or >50% rows regressed), (7) large loss (>30% of prior total). |
| **Language / Volatility** | PL/pgSQL · SECURITY DEFINER |
| **Defined in** | `20260611141026_77c1fcad.sql` (latest; prior in `20260609232613`) |
| **Parameters** | `p_deal_id uuid`, `p_content_hash text`, `p_rows jsonb` |
| **Returns** | `jsonb` — `{decision, reason, mode, window_kind, signals:{…}}` where decision ∈ {`accept`,`review`,`quarantine`,`reject`} |
| **Callers** | `import-label-spreadsheet/index.ts:518` |
| **Tables read** | `label_spreadsheet_uploads`, `label_spreadsheet_rows` |
| **Tables written** | None |
| **Duplicates** | None — sole quarantine evaluator. |
| **Grant** | `service_role`, `authenticated` |

---

### RPC-12: `notify_baseline_missing(p_deal_id)`

| Attribute | Value |
|---|---|
| **Responsibility** | Creates a `notifications` row of type `baseline_missing` if no such notification exists for the deal in the past 7 days. Deduplication guard prevents notification spam. |
| **Language / Volatility** | PL/pgSQL · SECURITY DEFINER |
| **Defined in** | `20260522162940_6ad6b692.sql` |
| **Parameters** | `p_deal_id uuid` |
| **Returns** | `void` |
| **Callers** | `cron-reconcile-curator-deals/index.ts:49` |
| **Tables read** | `notifications` |
| **Tables written** | `notifications` |
| **Duplicates** | None |
| **Grant** | `service_role`; anon revoked (`20260524205222`) |

---

### RPC-13: `resolve_client_token(_token TEXT)`

| Attribute | Value |
|---|---|
| **Responsibility** | Resolves a client portal token to `{client_id, deal_id, campaign_id}`. Used as authentication/identity for client-facing operations. |
| **Language / Volatility** | PL/pgSQL · SECURITY DEFINER |
| **Defined in** | `20260522195510_b8262e8b.sql` (latest; prior in `20260522185737`) |
| **Parameters** | `_token TEXT` |
| **Returns** | `TABLE(client_id uuid, deal_id uuid, campaign_id uuid)` (inferred) |
| **Callers** | `import-label-spreadsheet/index.ts:401` · `placement-template-download/index.ts:37` |
| **Tables read** | Client token table (exact name TBD — not migrated in scope of this audit) |
| **Tables written** | None |
| **Duplicates** | None |
| **Grant** | `anon`, `authenticated` |

---

### RPC-14: Trigger-support functions (not directly callable as RPCs but defined via migrations)

| Function | Trigger | Event | Responsibility |
|---|---|---|---|
| `set_collection_first_seen_at()` | `trg_cpc_first_seen` BEFORE INSERT on `campaign_playlist_collections` | Every insert | Sets `first_seen_at = now()` if NULL |
| `tg_sync_deal_campaign_baseline_from_deal()` | `trg_sync_deal_campaign_baseline_from_deal` AFTER INSERT/UPDATE(campaign_id) on `curator_deals` | New deal or deal linked to campaign | Calls `sync_deal_campaign_baseline(NEW.id)` |
| `tg_sync_deal_campaign_baseline_from_song()` | `trg_sync_deal_campaign_baseline_from_song` AFTER INSERT on `curator_deal_songs` | New song added to deal | Calls `sync_deal_campaign_baseline(NEW.deal_id)` |

---

### RPC Summary Table

| # | RPC | Domain | Callers | Writes | Guard? | Risk |
|---|---|---|---|---|---|---|
| 1 | `claim_collect_queue` | Queue | bot-collect-queue | curator_deal_songs | SKIP LOCKED | ✅ None |
| 2 | `append_print_to_batch` | Print assembly | bot-upload-print | bot_print_batches | FOR UPDATE | ✅ None |
| 3 | `match_curator_playlist` | Match engine | ingest-dom, ingest-snapshot, extract-print | None | STABLE | ⚠️ 3 parallel implementations |
| 4 | `recover_stuck_print_batches` | Recovery | cron-recover-print-batches | bot_print_batches | Cron-gated | ✅ None |
| 5 | `ingest_campaign_collection_batch` | Core writer | baseline-writer (guarded ×3), song-snapshot (direct), label-spreadsheet (direct) | campaign_playlist_collections, campaigns | Partial | ⚠️ 2 callers bypass guard |
| 6 | `sync_campaign_deals_baseline` / `sync_deal_campaign_baseline` | Baseline propagation | ingest_campaign_collection_batch, triggers | curator_deal_baseline_playlists | Internal | ✅ None |
| 7 | `fn_playlist_delivery_accumulated` | Delivery compute | fn_curator_delivery_accumulated, fn_campaign_delivery_accumulated, frontend | None (STABLE) | — | ✅ None |
| 8 | `fn_curator_delivery_accumulated` | Delivery compute | recompute_campaign_total_delivered | None | — | ✅ None |
| 9 | `fn_campaign_delivery_accumulated` | Delivery compute | recompute_campaign_total_delivered | None | — | ✅ None |
| 10 | `recompute_campaign_total_delivered` | KPI refresh | import-label-spreadsheet, cron-reconcile, frontend | campaigns, curator_deals | — | ✅ None |
| 11 | `evaluate_upload_quarantine` | Spreadsheet guard | import-label-spreadsheet | None | — | ✅ None |
| 12 | `notify_baseline_missing` | Alert | cron-reconcile | notifications | 7d dedup | ✅ None |
| 13 | `resolve_client_token` | Auth | import-label-spreadsheet, placement-template-download | None | — | ✅ None |

---

## PART 4 — BOTS INVENTORY

| Bot Type | Name | Location | Protocol | Responsibility | Tables | Edge Fns | RPCs |
|---|---|---|---|---|---|---|---|
| **VPS Main Bot** | `spotify-artists-bot` | External VPS | HTTP → edge fns | Opens S4A, navigates song stats, reads playlist data, uploads prints/DOM | curator_deal_songs, bot_print_batches | bot-collect-queue, bot-event-ingest, bot-ingest-dom, bot-upload-print, bot-ingest-song-snapshot, bot-execution-complete | claim_collect_queue, append_print_to_batch, ingest_campaign_collection_batch |
| **Browser/DOM** | Same VPS worker | VPS | Playwright page.evaluate() | Extracts playlist rows from DOM with spotify URLs, plays_7d/28d/24h | — | bot-ingest-dom, bot-ingest-song-snapshot | match_curator_playlist, ingest_campaign_collection_batch |
| **OCR/Print** | Same VPS worker | VPS | Playwright page.screenshot() | Screenshots S4A playlist tab, sends PNG for OCR | bot_print_batches | bot-upload-print, extract-snapshot-from-print | append_print_to_batch, match_curator_playlist, ingest_campaign_collection_batch |
| **Heartbeat** | Same VPS worker | VPS | POST every ~30s | Session health; piggybacks DOM snapshots as emergency fallback | bot_heartbeats, vps_nodes | bot-heartbeat | (via ingest-dom path) |
| **Event Logger** | Same VPS worker | VPS | POST after each step | Granular lifecycle steps: FETCHED, STARTED, PRINT_UPLOADED, FINISHED, FAILED | bot_events | bot-event-ingest | — |
| **Queue Poller** | Same VPS worker | VPS | GET poll | Gets next songs to collect (limit=N), atomic claim | curator_deal_songs | bot-collect-queue | claim_collect_queue |
| **Execution Bot** | Same VPS worker | VPS | GET poll | Playlist track add/remove/reorder via Spotify Web API | playlist_execution_jobs | bot-execution-queue, bot-execution-complete | — |
| **Observer Bot** | Separate process | VPS | HTTP POST | Observes public playlist tracks; writes observations | playlist_observations, observer_runs | bot-ingest (observe_playlist action) | — |
| **Catalog Bot** | Same or separate | VPS | HTTP POST | Collects S4A snapshots for catalog tracks (not deal-tied) | catalog_snapshot_queue, song_snapshots | bot-ingest-song-snapshot (catalog_track_id mode) | ingest_campaign_collection_batch |
| **Spreadsheet Import** | Client Portal | Browser → Edge | multipart/form-data | Parses XLSX/CSV, writes label upload data | label_spreadsheet_uploads, label_spreadsheet_rows | import-label-spreadsheet | resolve_client_token, evaluate_upload_quarantine, recompute_campaign_total_delivered, ingest_campaign_collection_batch |

**Key identifiers transmitted by bot:** `x-worker-id`, `x-process-id`, `x-hostname`, `x-timer-id`, `x-bot-name`, `x-bot-session`, `correlation_id` (per-song dispatch UUID).

---

## PART 5 — WRITERS PER TABLE

### `campaign_playlist_collections`

| Writer | Call Path | When | Guard? | Mode |
|---|---|---|---|---|
| `ingest_campaign_collection_batch` RPC (via baseline-writer.ts) | bot-ingest-dom → processDomItem → writeBaselineOfficial | Baseline only | ✅ baseline-writer | baseline |
| `ingest_campaign_collection_batch` RPC (via baseline-writer.ts) | bot-heartbeat piggyback → processDomItem → writeBaselineOfficial | Baseline only | ✅ baseline-writer | baseline |
| `ingest_campaign_collection_batch` RPC (via baseline-writer.ts) | bot-ingest-snapshot → writeBaselineOfficial | Baseline only | ✅ baseline-writer | baseline |
| `ingest_campaign_collection_batch` RPC (via baseline-writer.ts) | extract-snapshot-from-print → writeBaselineOfficial | Baseline only | ✅ baseline-writer | baseline |
| `ingest_campaign_collection_batch` RPC **DIRECTLY** | bot-ingest-song-snapshot:290 | Every collect | ❌ No guard | baseline or periodic |
| `ingest_campaign_collection_batch` RPC **DIRECTLY** | import-label-spreadsheet:894 (`admin.rpc`) | Every commit | ❌ No guard | baseline or periodic |
| SQL TRIGGER `trg_cpc_first_seen` | BEFORE INSERT | Always | — | Sets first_seen_at |

**RISK:** Two of six writers bypass `baseline-writer.ts`. The guard logs structured skip events to `bot_events` when `campaign_id` is absent — bypassing it means silent failures in that case.

---

### `curator_campaign_playlists`

| Writer | Notes |
|---|---|
| Migration data inserts | `20260531161110_00ef01f1` |
| No edge function writes detected | Not written by any active edge function |

### `curator_playlists`

| Writer | Call Path | Notes |
|---|---|---|
| `bot-ingest-snapshot::ensureObservedPlaylist()` | Every snapshot, inline JS | Creates if not exists; spotify_id exact only |
| `_shared/ingest-dom.ts::ensureObservedPlaylist()` | processDomItem | Creates if not exists |
| `extract-snapshot-from-print` | For whitelisted, algorithmic, DOM complement | Creates if not exists |
| `import-label-spreadsheet` | Batch INSERT missing rows | All playlist rows in spreadsheet |
| Frontend (manual) | `enrich-curator-paste`, `register-curator-playlist` | Manual curation |

### `curator_deal_snapshots`

| Writer | Call Path |
|---|---|
| `_shared/ingest-dom.ts::processDomItem()` | bot-ingest-dom, bot-heartbeat piggyback |
| `bot-ingest-snapshot` | inline snapshot loop |
| `extract-snapshot-from-print::upsertSnapshot()` | OCR path, DOM complement |
| `import-label-spreadsheet` | spreadsheet commit |

### `delivery_proofs`

| Writer | Call Path | Notes |
|---|---|---|
| `bot-ingest-snapshot` | For each snapshot with print_url | `supabase.from("delivery_proofs").insert()` |
| `import-label-spreadsheet` | Non-baseline, internal playlists only | After curator_deal_snapshots |

### `bot_events`

| Writer | Call Path |
|---|---|
| `bot-event-ingest` | Direct bulk insert from VPS |
| `bot-collect-queue` | dispatch events (FETCHED) |
| `bot-execution-complete` | FINISHED/FAILED events |
| `extract-snapshot-from-print` | On Gemini failures (FAILED lifecycle) |
| `_shared/baseline-writer.ts::logBaselineSkip()` | Skip events from all 4 guarded callers |

### `label_spreadsheet_uploads`

| Writer | Call Path |
|---|---|
| `import-label-spreadsheet` | Only writer |

---

## PART 6 — MATCH ENGINE

### Official Key: `spotify_playlist_id` (exact match)

**Function:** `public.match_curator_playlist(p_deal_id, p_spotify_playlist_id, p_playlist_name, p_song_id)`  
**Defined in:** `supabase/migrations/20260522164414_e570679e.sql`  
**Type:** `STABLE SECURITY DEFINER`, returns `TABLE(playlist_id uuid, match_method text)`

### Priority Chain (inside `match_curator_playlist`):
1. **`spotify_id`** — Exact match on `curator_playlists.spotify_playlist_id` scoped to `deal_id` + optional `song_id`.
2. **`name`** — Normalized exact match: lowercase, remove accents, collapse non-alphanumeric.
3. **`fuzzy`** — `pg_trgm similarity()` ≥ 0.85, ordered by score DESC, limit 1.

### Who calls `match_curator_playlist`:
- `_shared/ingest-dom.ts` — processDomItem (bot-ingest-dom + heartbeat piggyback)
- `bot-ingest-snapshot/index.ts` — called directly (not via shared helper)
- `extract-snapshot-from-print/index.ts` — x2: whitelist pass + DOM complement pass

### Who does NOT use `match_curator_playlist`:
- `bot-ingest-song-snapshot` — no match whatsoever; stores raw to `song_snapshot_playlists`
- `import-label-spreadsheet` — uses `buildMatchers()` in JS, querying `playlists` table (not `curator_playlists`)

### All match implementations:

| Location | Method | Fuzzy? | Table queried | Notes |
|---|---|---|---|---|
| `match_curator_playlist` RPC | spotify_id → name → fuzzy(0.85) | ✅ | `curator_playlists` | Official |
| `bot-ingest-snapshot::ensureObservedPlaylist()` | spotify_id exact only | ❌ | `curator_playlists` | Inline JS, no fuzzy |
| `import-label-spreadsheet::buildMatchers()` | spotify_playlist_id exact + curator name/owner | Partial | `playlists` (not `curator_playlists`) | Different table |
| `bot-ingest-song-snapshot` | None | — | — | Raw storage, no match |

**Finding:** Four divergent implementations. Official RPC covers ~60% of pipelines; two active pipelines bypass it entirely.

---

## PART 7 — PIPELINES

### Pipeline 1: DOM Fast Path (no OCR) — CURRENT PRIMARY
```
curator_deal_songs [auto_collect=true, status=idle]
  → bot-collect-queue (RPC: claim_collect_queue)
  → VPS bot navigates S4A, page.evaluate()
  → POST bot-ingest-dom
  → _shared/ingest-dom.ts::processDomItem()
  → RPC: match_curator_playlist
  → curator_deal_snapshots (INSERT)
  → baseline-writer.ts::writeBaselineOfficial()
  → RPC: ingest_campaign_collection_batch (intent='baseline')
  → campaign_playlist_collections (INSERT)
  → [delivery pipeline]
```
**Status:** ✅ Active, primary path

### Pipeline 2: Print+OCR Path (fallback)
```
curator_deal_songs [auto_collect=true, status=idle]
  → bot-collect-queue
  → VPS bot page.screenshot()
  → POST bot-upload-print → Storage [bot-prints]
  → RPC: append_print_to_batch → bot_print_batches
  → [all parts received] → extract-snapshot-from-print
  → Gemini 2.5 Flash Vision OR DOM direct
  → RPC: match_curator_playlist
  → curator_deal_snapshots (upsertSnapshot)
  → baseline-writer.ts::writeBaselineOfficial()
  → RPC: ingest_campaign_collection_batch
  → campaign_playlist_collections (INSERT)
  → [delivery pipeline]
```
**Status:** ✅ Active. Legacy label `playlists-part-*` blocked (HTTP 410). Recovery via cron every 5min.

### Pipeline 3: bot-ingest-song-snapshot (NEW — unified)
```
curator_deal_songs [auto_collect=true, status=queued]
  → POST bot-ingest-song-snapshot (song_id + playlists[])
  → song_snapshots INSERT (header)
  → song_snapshot_playlists INSERT (per playlist row)
  → RPC: ingest_campaign_collection_batch DIRECTLY (no baseline-writer guard)
  → campaign_playlist_collections
  → curator_deal_songs bump
```
**Status:** ✅ Active. **RISK:** Calls `ingest_campaign_collection_batch` directly without `baseline-writer.ts` — bypasses structured skip-logging.

### Pipeline 4: Label Spreadsheet (client portal)
```
Client Portal → import-label-spreadsheet
  → parseBuf() [XLSX/CSV parser]
  → RPC: resolve_client_token (identity)
  → buildMatchers() [playlist/curator lookup]
  → RPC: evaluate_upload_quarantine [duplicate/regression guard]
  → label_spreadsheet_uploads INSERT
  → label_spreadsheet_rows INSERT
  → curator_playlists INSERT (ensure existence)
  → curator_deal_snapshots INSERT
  → delivery_proofs INSERT (non-baseline internal only)
  → RPC: ingest_campaign_collection_batch DIRECTLY (admin.rpc)
  → RPC: recompute_campaign_total_delivered
```
**Status:** ✅ Active. `collection_mode='spreadsheet'` disables bot collection for shadow deals.

### Pipeline 5: Heartbeat Piggyback DOM (emergency channel)
```
VPS bot heartbeat → POST bot-heartbeat [dom_snapshots:[...]]
  → processDomItem() for each item
  → [same as Pipeline 1 from processDomItem onward]
```
**Status:** ✅ Active. **RISK:** Duplicate execution — same `processDomItem()` called by both bot-heartbeat and bot-ingest-dom. 90s dedup window inside processDomItem is the only guard.

### Pipeline 6: Observer (separate domain)
```
VPS observer → POST bot-ingest (observe_playlist action)
  → playlist_observations INSERT
  → observer_runs INSERT/UPDATE
```
**Status:** ✅ Active, isolated. Does NOT feed `campaign_playlist_collections`.

### Pipeline 7: Recover Stuck Batches (cron)
```
pg_cron: recover-print-batches-5min (*/5)
  → cron-recover-print-batches
  → RPC: recover_stuck_print_batches()
  → extract-snapshot-from-print (re-dispatch per stuck batch)
  → [same as Pipeline 2 from extract onward]
```
**Status:** ✅ Active. Necessary guard for OCR failures.

### Pipeline 8: Genre/Search Collection (different domain)
```
[Cron/Manual] → daily-collect (DEPRECATED) / collect-batch (DEPRECATED)
  → run-search → search_results → analyze-genre
```
**Status:** ⚠️ Both deprecated via `deprecationGate`. Does NOT write to `campaign_playlist_collections`.

---

## PART 8 — QUEUES

### Queue 1: `curator_deal_songs` (bot collect queue)
- **Table:** `curator_deal_songs` — `auto_collect_status` ∈ {idle, queued, error, auth_required, manual}
- **Producer:** Deal activation (auto_collect=true). Recovery reset from bot-collect-queue.
- **Consumer:** `bot-collect-queue` (GET, RPC `claim_collect_queue` for atomic claim)
- **Claim mechanism:** `claim_collect_queue` uses `FOR UPDATE SKIP LOCKED`
- **Retry/backoff:** `bot-execution-complete` applies exponential backoff: 2min, 8min, 30min, 2h on consecutive failures. 5min timeout for stuck-queued recovery.
- **Race risk:** None at claim level (SKIP LOCKED). Over-fetch filter (5×limit) + atomic claim resolve parallel worker races.

### Queue 2: `bot_print_batches` (print batch assembly)
- **Table:** `bot_print_batches` — `status` ∈ {pending, complete, processing, processed, error}
- **Producer:** `bot-upload-print` — one batch per `correlation_id`
- **Consumer:** `extract-snapshot-from-print` (auto-triggered on last part arrival) + `cron-recover-print-batches` (recovery)
- **Duplicate guard:** `append_print_to_batch` RPC (FOR UPDATE); idempotent by path; UNIQUE `correlation_id`; `status=processed`/`processing` guard in extract function.
- **Legacy label blocked:** `playlists-part-*` → HTTP 410. Only `song-snapshot-{cid}-part-X-of-Y` accepted.

### Queue 3: `playlist_execution_jobs` (Spotify track operations)
- **Table:** `playlist_execution_jobs` — `status` ∈ {pending, claimed, done, failed, manual}
- **Producer:** execution-planner, Growth Engine RPCs
- **Consumer:** `bot-execution-queue` (GET, inline Spotify Web API) + `manual_distribution_queue` (fallback)
- **Lease guard:** 5min expiry; bot-execution-queue resets stale claims.

### Queue 4: `catalog_snapshot_queue` (catalog track collection)
- **Table:** `catalog_snapshot_queue` — `status` ∈ {pending, processing, done}
- **Producer:** Separate catalog domain (not audited here)
- **Consumer:** `bot-ingest-song-snapshot` (catalog mode — closes item on done)
- **Lease guard:** `lease_expires_at`, `locked_by`, `locked_at`

### Queue 5: `manual_distribution_queue` (fallback for execution failures)
- **Table:** `manual_distribution_queue`
- **Producer:** `bot-execution-queue` (via `enqueueManual`) on unrecoverable Spotify API errors
- **Consumer:** Ops team (manual) + `mark-manual-distribution-done`

---

## PART 9 — CRONS

| Job Name | Schedule | Edge Function | Responsibility | Active? | Duplicate/Legacy? |
|---|---|---|---|---|---|
| `recover-print-batches-5min` | `*/5 * * * *` | cron-recover-print-batches | Re-dispatches stuck complete-but-unprocessed `bot_print_batches` via `recover_stuck_print_batches` + `extract-snapshot-from-print` | ✅ | No — essential safety net |
| `cron-deal-delivery-check` | (schedule from pg_cron TBD) | cron-reconcile-curator-deals | Reconciles active deals: recomputes `total_delivered`, detects missing baselines (`notify_baseline_missing`), sends milestone notifications | ✅ | No |
| `execution-planner-every-minute` | `* * * * *` | execution-planner | Plans campaign execution (Growth Engine) | ✅ | Different domain |
| `process-email-queue` | `* * * * *` | process-email-queue | Email delivery queue | ✅ | Different domain |
| `cleanup-brain-every-6h` | `0 */6 * * *` | cleanup-brain | Brain cleanup | ✅ | Different domain |
| `compute-leadership-daily` | `30 3 * * *` | compute-leadership | Leadership scores | ✅ | Different domain |
| `snapshot-leadership-history-daily` | `45 4 * * *` | snapshot-playlist-leadership | Leadership history | ✅ | Different domain |
| `curator-brain-calc-daily` | `0 9 * * *` | curator-brain-calc | Curator scoring | ✅ | Different domain |
| `evaluate-adjustment-impacts-daily` | `0 6 * * *` | evaluate-adjustment-impacts | Campaign adjustments | ✅ | Different domain |
| `genre-benchmarks-calc-daily` | `0 8 * * *` | genre-benchmarks-calc | Genre benchmarks | ✅ | Different domain |
| `sync-kworb-charts-daily` | `30 11 * * *` | sync-kworb-charts | External charts sync | ✅ | Different domain |
| `track-external-metrics-daily` | `0 7 * * *` | track-external-metrics | External metrics | ✅ | Different domain |
| `track-playlist-metrics-6h` | `0 */12 * * *` | track-playlist-metrics | Playlist metrics | ✅ | Different domain |
| `weekly-followers-revalidation` | `0 4 * * 1` | recheck-archived-followers | Follower revalidation | ✅ | Different domain |
| `daily-collect` | (deprecated cron.schedule) | daily-collect | Genre search | ⚠️ DEPRECATED | Superseded by collect-batch + deprecationGate |

**Collection-related crons:** `recover-print-batches-5min` and `cron-deal-delivery-check` are the only crons directly in the bot/ingest domain.

---

## PART 10 — SOURCES OF TRUTH

| Domain | Official Table | Secondary/Derived | Notes |
|---|---|---|---|
| **Coletas (playlist collections)** | `campaign_playlist_collections` | `curator_deal_snapshots` (older, granular) | BOTH contain playlist+plays data. `campaign_playlist_collections` is the Phase 3 official table for delivery pipeline. `curator_deal_snapshots` is the operational/granular store still read for curator progress views. |
| **Uploads (spreadsheets)** | `label_spreadsheet_uploads` | `label_spreadsheet_rows` | Single writer: import-label-spreadsheet |
| **Snapshots (raw S4A data)** | `song_snapshots` + `song_snapshot_playlists` | `curator_deal_snapshots` (parallel write) | `song_snapshots` is the NEW unified store (bot-ingest-song-snapshot). `curator_deal_snapshots` is the OLD store still written by extract-print and ingest-dom. **Two parallel sources of truth for raw snapshot data.** |
| **Prints (screenshots)** | `bot_print_batches` | Storage bucket `bot-prints` | `bot_print_batches` is the source; `print_url` on snapshots/logs deprecated (set to null) |
| **Match (playlist→deal)** | `match_curator_playlist` RPC | `buildMatchers()` in import-label-spreadsheet | Two independent match systems; RPC is official |
| **Observed playlist (monitoring)** | `playlist_observations` | `curator_deal_snapshots` | bot-ingest writes `playlist_observations`; bot ingest-dom/snapshot write `curator_deal_snapshots` |
| **Assigned playlist (by curator)** | `curator_playlists` (match_status='curator') | `v_curator_playlists_operational` view | Multiple writers create rows |
| **Bot events (telemetry)** | `bot_events` | `collection_logs` | `bot_events` = structured lifecycle; `collection_logs` = freetext operation log |
| **Baseline** | `campaign_playlist_collections WHERE is_baseline=true` | `curator_deal_baseline_playlists` | `ingest_campaign_collection_batch` writes baseline rows; `sync_campaign_deals_baseline` propagates to deal-level table |
| **Delivery KPIs** | `campaigns.total_delivered`, `curator_deals.reconciled_total_plays` | computed via `fn_*` RPCs | `recompute_campaign_total_delivered` is sole update path |

---

## PART 11 — DUPLICATES TABLE

| Responsibility | Components | Verdict |
|---|---|---|
| **DOM ingest processing** | `bot-ingest-dom` (calls processDomItem), `bot-heartbeat` (piggyback, calls processDomItem), `bot-ingest-snapshot` (inline snapshot loop — NOT shared code) | **CONSOLIDATE** — ingest-dom and heartbeat piggyback both use `processDomItem` ✅ (shared). bot-ingest-snapshot duplicates the logic inline. Should refactor bot-ingest-snapshot to use `processDomItem` or merge into bot-ingest-dom. |
| **Writing to campaign_playlist_collections** | baseline-writer.ts (guards 4 callers), bot-ingest-song-snapshot (direct, no guard), import-label-spreadsheet (direct, no guard, admin.rpc) | **CONSOLIDATE** — All writers should go through baseline-writer.ts or a unified guard with structured logging. |
| **Playlist match implementation** | `match_curator_playlist` RPC (sql, 3-tier), `ensureObservedPlaylist` in bot-ingest-snapshot (JS, spotify_id only), `buildMatchers` in import-label-spreadsheet (JS, different table) | **CONSOLIDATE** — bot-ingest-snapshot should call `match_curator_playlist` RPC. import-label-spreadsheet's buildMatchers targets `playlists` table (intentional for spreadsheet domain but undocumented). |
| **Raw snapshot storage** | `song_snapshots`/`song_snapshot_playlists` (new, bot-ingest-song-snapshot), `curator_deal_snapshots` (old, extract-print + ingest-dom) | **KEEP BOTH SHORT-TERM** — document migration path. `song_snapshots` is the canonical new store; `curator_deal_snapshots` is read by curator progress views. Plan migration. |
| **Heartbeat DOM piggyback vs explicit bot-ingest-dom** | bot-heartbeat (dom_snapshots[]), bot-ingest-dom (explicit POST) | **KEEP** — heartbeat piggyback is intentional emergency fallback. Document clearly. |
| **Delivery compute hierarchy** | `fn_playlist_delivery_accumulated` → `fn_curator_delivery_accumulated` → `fn_campaign_delivery_accumulated` → `recompute_campaign_total_delivered` | **KEEP** — well-structured hierarchy, no duplication. |
| **daily-collect vs collect-batch** | Both deprecated via deprecationGate | **REMOVE** — delete functions and cron entries. |

---

## PART 12 — RISKS CHECKLIST

| # | Risk | Yes/No | Evidence |
|---|---|---|---|
| **>1 pipeline feeding campaign_playlist_collections** | ✅ YES | 4 active pipelines: DOM path (ingest-dom), Print+OCR (extract-print), bot-ingest-song-snapshot, import-label-spreadsheet — all write via `ingest_campaign_collection_batch` |
| **>1 writer for campaign_playlist_collections** | ✅ YES | 6 writers (4 guarded, 2 direct): `bot-ingest-song-snapshot/index.ts:290` and `import-label-spreadsheet/index.ts:894` bypass `baseline-writer.ts` |
| **>1 parser for snapshot data** | ✅ YES | `processDomItem` (shared, bot-ingest-dom + heartbeat), inline loop in bot-ingest-snapshot, `callGeminiChunked` parser in extract-from-print, XLSX parser in import-label-spreadsheet |
| **>1 gateway/entry point** | ✅ YES | 5 distinct HTTP entry points: bot-ingest-dom, bot-ingest-snapshot, bot-ingest-song-snapshot, extract-snapshot-from-print, import-label-spreadsheet |
| **>1 match engine** | ✅ YES | 3 implementations: `match_curator_playlist` RPC (official), `ensureObservedPlaylist()` JS (spotify_id only, bot-ingest-snapshot), `buildMatchers()` JS (playlists table, import-label-spreadsheet). 4th: bot-ingest-song-snapshot has NO match. |
| **>1 queue** | ✅ YES (by design) | 5 queues: curator_deal_songs, bot_print_batches, playlist_execution_jobs, catalog_snapshot_queue, manual_distribution_queue — each for a distinct domain. Acceptable. |
| **>1 scheduler** | ✅ YES (minimal risk) | pg_cron (recover-print-batches-5min, cron-deal-delivery-check, execution-planner) + VPS bot internal timers. Bot timers not pg_cron controlled — potential drift. |
| **Legacy coexisting with active** | ✅ YES | bot-ingest-snapshot coexists with bot-ingest-dom (same responsibility, different payload format). daily-collect/collect-batch deprecated but not deleted. Legacy `playlists-part-*` label blocked but not removed from code. |
| **Bypass paths (no guard)** | ✅ YES | `bot-ingest-song-snapshot` and `import-label-spreadsheet` call `ingest_campaign_collection_batch` directly without `baseline-writer.ts` guard. bot-collect-queue:~ sets songs to queued without checking if campaign is active. |
| **Edge function writing where RPC should be used** | ✅ YES | `bot-ingest-snapshot` and `extract-snapshot-from-print` write `curator_deal_snapshots`, `curator_playlists`, `campaign_eco_snapshots` inline (not via RPC). Only the final write to `campaign_playlist_collections` uses an RPC. |
| **Parallel writes / race conditions** | ✅ PARTIALLY MITIGATED | `claim_collect_queue` FOR UPDATE SKIP LOCKED eliminates parallel dispatch races. `append_print_to_batch` FOR UPDATE eliminates batch-assembly races. No deduplication guard between bot-heartbeat piggyback and bot-ingest-dom: both can process the same snapshot in the same session if 90s window check fails on clock skew. |
| **Silent failures on missing campaign_id** | ✅ YES | `bot-ingest-song-snapshot` calls `ingest_campaign_collection_batch` directly — if `campaign_id` is NULL or wrong, RPC raises exception but no `bot_events` skip-log is written (unlike baseline-writer path). |
| **auto_collect disabled on quarantined upload** | ✅ YES (bug) | `import-label-spreadsheet:~839` sets `auto_collect=false` for the song even if upload is quarantined. Quarantine guard prevents snapshot writes but NOT the `auto_collect=false` write — permanently disables bot collection for that song. |
| **song_snapshots not connected to delivery pipeline** | ✅ YES | `bot-ingest-song-snapshot` writes `song_snapshots`/`song_snapshot_playlists` + `campaign_playlist_collections` directly. The `song_snapshots` data does NOT flow through `curator_deal_snapshots` → curator progress views. Two parallel tracks with no reconciliation. |

---

## PART 13 — FINAL VERDICT

**13 numbered objective answers:**

1. **Is there a single pipeline?**  
   **NO.** There are 4 active ingest pipelines feeding `campaign_playlist_collections`: DOM path, Print+OCR, bot-ingest-song-snapshot (unified/new), and label spreadsheet.

2. **Is there a single writer for campaign_playlist_collections?**  
   **NO.** All four pipelines use `ingest_campaign_collection_batch` RPC, but two callers (bot-ingest-song-snapshot, import-label-spreadsheet) bypass the `baseline-writer.ts` guard layer. 6 effective write paths to the table.

3. **Is there a single parser?**  
   **NO.** 4 parsers: `processDomItem` (shared DOM), inline snapshot loop (bot-ingest-snapshot), Gemini OCR chain (extract-from-print), XLSX parser (import-label-spreadsheet).

4. **Is there a single gateway/entry point?**  
   **NO.** 5 distinct HTTP entry points accepting collection data. Proposed post-consolidation: 1 unified gateway.

5. **Is there a single match engine?**  
   **NO.** 3 implementations + 1 pipeline with no match. Official RPC `match_curator_playlist` is not used by bot-ingest-snapshot's JS match path or import-label-spreadsheet's `buildMatchers`.

6. **Is there a single queue?**  
   **NO, but by design.** 5 queues for distinct domains (collect, print-batch, execution, catalog, manual-fallback). Acceptable architecture.

7. **Is there a single scheduler?**  
   **NO.** pg_cron manages collection-related crons; VPS bot runs its own internal timers. The bot's schedule is independent of the database clock.

8. **Is legacy coexisting with active?**  
   **YES.** bot-ingest-snapshot (legacy/equivalent to bot-ingest-dom) still active and accepting production traffic. daily-collect/collect-batch deprecated but not deleted. Legacy print batch label blocked but not fully removed.

9. **Is there a bypass path?**  
   **YES.** Two active edge functions (`bot-ingest-song-snapshot`, `import-label-spreadsheet`) call `ingest_campaign_collection_batch` directly without the `baseline-writer.ts` guard.

10. **Are edge functions writing where RPCs should be used?**  
    **YES.** Multiple edge functions write to `curator_deal_snapshots`, `curator_playlists`, `campaign_eco_snapshots`, `delivery_proofs` inline via `supabase.from(...).insert()`. Only the final write to `campaign_playlist_collections` is gated behind an RPC.

11. **Are there parallel writes or race conditions?**  
    **PARTIALLY.** Collect queue and print batch races are mitigated (SKIP LOCKED, FOR UPDATE). Residual risk: heartbeat piggyback and bot-ingest-dom can both process the same DOM snapshot in the same session if the 90s dedup window is beaten by clock skew or parallel HTTP requests.

12. **Is the RPC layer complete and non-duplicated?**  
    **MOSTLY.** 13 collection-domain RPCs identified. The delivery compute hierarchy (fn_playlist → fn_curator → fn_campaign → recompute) is clean. The three oldest match_curator_playlist versions are superseded. Main gap: `match_curator_playlist` is bypassed by 2 of 5 ingest paths; `ingest_campaign_collection_batch` guard layer is bypassed by 2 of 6 callers.

13. **What is the proposed official post-consolidation architecture?**  
    See diagram below.

---

### Proposed Official Post-Consolidation Architecture

```
VPS Bot / Client Portal
        │
        ▼
  ┌─────────────────────────────────────────────┐
  │    Single Ingest Gateway                     │
  │    (bot-ingest-unified OR router layer)      │
  │                                              │
  │  1. assertDealOperable()                     │
  │  2. 90s deduplication window check           │
  │  3. RPC: match_curator_playlist              │
  │     (single match engine for all paths)      │
  │  4. write: curator_deal_snapshots            │
  │     (granular/operational store)             │
  │  5. baseline-writer.ts::writeBaselineOfficial│
  │     (always — no bypass)                     │
  └─────────────────┬───────────────────────────┘
                    │
                    ▼
      RPC: ingest_campaign_collection_batch
         (p_intent = 'baseline' | 'periodic')
                    │
                    ├─ BEFORE INSERT trigger: set_collection_first_seen_at
                    ├─ ON CONFLICT DO UPDATE (idempotent)
                    ├─ if baseline newly captured:
                    │    → sync_campaign_deals_baseline()
                    │    → UPDATE campaigns.baseline_status='captured'
                    └─ campaign_playlist_collections
                              │
                              ▼
              fn_playlist_delivery_accumulated()
                              │
                              ▼
              fn_curator_delivery_accumulated()
                              │
                              ▼
              fn_campaign_delivery_accumulated()
                              │
                              ▼
          recompute_campaign_total_delivered()
                              │
                    ┌─────────┴──────────┐
                    ▼                    ▼
          campaigns.total_delivered   curator_deals.reconciled_total_plays
                    │
                    ▼
          vw_campaign_playlist_growth
                    │
                    ▼
                Frontend
```

**Key invariants for post-consolidation (Phase 3 final):**
1. Every write to `campaign_playlist_collections` MUST go through `ingest_campaign_collection_batch` RPC.
2. Every caller MUST go through `baseline-writer.ts` guard (or equivalent) for structured skip-logging.
3. No direct `supabase.from("campaign_playlist_collections").insert()` anywhere.
4. `match_curator_playlist` RPC is THE single match function. `ensureObservedPlaylist()` (bot-ingest-snapshot) must call it; `buildMatchers()` (import-label-spreadsheet) may keep its own path for spreadsheet domain but must be documented.
5. `recompute_campaign_total_delivered` is the sole KPI write path — no direct UPDATE on `campaigns.total_delivered`.
6. `auto_collect=false` write in import-label-spreadsheet must be gated on `quarantined_at IS NULL` (bug fix).

---

*Report generated from read-only static analysis of `supabase/functions/`, `supabase/migrations/`, and `src/`. Evidence cited with file paths and migration UUIDs. No database was modified; no files were changed. V2 adds PART 3 (13 RPCs fully audited) and renumbers former PART 3–12 as PART 4–13.*
