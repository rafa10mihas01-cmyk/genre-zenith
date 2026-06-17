# AUDIT PHASE 3 — COLLECTION/INGESTION ARCHITECTURE (BEFORE)
> Read-only forensic audit — NexEngine codebase · June 2026  
> Auditor: forensic-only mode · No files modified

---

## PART 1 — COMPLETE FLOW MAP

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                          COLLECTION PIPELINE — FULL MAP                               │
└──────────────────────────────────────────────────────────────────────────────────────┘

SOURCE A — BOT VPS (Spotify for Artists scraper)
─────────────────────────────────────────────────
[VPS Bot / Claudio Worker]
  │
  ├─ GET bot-collect-queue              ← picks up curator_deal_songs where auto_collect=true
  │     └─ RPC: claim_collect_queue     ← atomic FOR UPDATE SKIP LOCKED (prevents races)
  │     └─ reads: v_curator_playlists_operational (whitelist)
  │     └─ writes: curator_deal_songs (status=queued, correlation_id)
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
  │   ├─ POST bot-ingest-dom            ← playlists from page.evaluate() with plays_7d
  │   │     └─ calls processDomItem() [_shared/ingest-dom.ts]
  │   │           └─ RPC: match_curator_playlist (spotify_id → exact name → fuzzy 0.85)
  │   │           └─ writes: curator_playlists (create if not exists)
  │   │           └─ writes: curator_deal_snapshots
  │   │           └─ writes: organic_plays_snapshots (unmatched non-algo)
  │   │           └─ writes: campaign_eco_snapshots (if shadow deal)
  │   │           └─ calls writeBaselineOfficial() → ingest_campaign_collection_batch RPC (baseline only)
  │   │           └─ writes: curator_deal_logs
  │   │           └─ writes: curator_deal_songs (status=idle, next_auto_collect_at)
  │   │           └─ writes: collection_logs
  │   │
  │   └─ POST bot-ingest-snapshot       ← also accepts DOM-like snapshots[] array
  │         └─ same flow but inline (no shared ingest-dom.ts)
  │         └─ calls ensureObservedPlaylist() → writes curator_playlists
  │         └─ writes: curator_deal_snapshots (per playlist)
  │         └─ writes: campaign_eco_snapshots (for managed playlists)
  │         └─ writes: curator_deal_logs
  │         └─ calls writeBaselineOfficial() → ingest_campaign_collection_batch (baseline)
  │         └─ writes: bot_print_batches (if screenshots present)
  │         └─ writes: curator_deal_songs
  │
  ├── PATH A2: PRINT + OCR (legacy/fallback)
  │   ├─ POST bot-upload-print          ← PNG/JPEG multipart or base64
  │   │     └─ writes: Storage bucket "bot-prints" (signed URL, 1yr TTL)
  │   │     └─ writes: bot_print_batches (groups multi-part prints by correlation_id)
  │   │     └─ calls RPC: append_print_to_batch (atomic array append)
  │   │     └─ when batch complete: calls extract-snapshot-from-print
  │   │
  │   └─ POST extract-snapshot-from-print  ← Gemini Vision OCR OR DOM direct (preferred)
  │         ├─ calls: Gemini 2.5 Flash via ai.gateway.lovable.dev (chunked 2-prints)
  │         ├─ cache: ai_print_cache (SHA-256 of print URLs)
  │         ├─ calls RPC: match_curator_playlist
  │         ├─ writes: curator_playlists (create if not exists)
  │         ├─ writes: curator_deal_snapshots (upsertSnapshot)
  │         ├─ writes: campaign_eco_snapshots (managed playlists only)
  │         ├─ writes: organic_plays_snapshots (unmatched)
  │         ├─ calls writeBaselineOfficial() → ingest_campaign_collection_batch
  │         ├─ writes: curator_deal_logs
  │         ├─ writes: curator_deal_songs
  │         ├─ writes: collection_logs (x2: extract_print + extract_window_coverage)
  │         └─ marks bot_print_batches status=processed
  │
  ├── PATH A3: NEW unified song snapshot (bot-ingest-song-snapshot)
  │   └─ POST bot-ingest-song-snapshot  ← raw S4A payload (song header + playlists[])
  │         └─ writes: song_snapshots (header row, no screenshot_url)
  │         └─ writes: song_snapshot_playlists (one row per playlist, with position)
  │         └─ writes: bot_print_batches (if screenshots)
  │         └─ calls RPC: ingest_campaign_collection_batch (directly, no baseline-writer)
  │         └─ writes: curator_deal_songs (bump)
  │         └─ closes: catalog_snapshot_queue (catalog mode)
  │
  ├─ POST bot-execution-complete        ← collector reports done/failed for a song
  │     └─ writes: curator_deal_songs (status, backoff)
  │     └─ writes: bot_events (lifecycle_state=FINISHED/FAILED)
  │     └─ writes: playlist_execution_jobs (if job_id present)
  │
  └─ GET bot-execution-queue            ← execution jobs (playlist.track.add/remove/reorder)
        └─ executes inline via Spotify Web API
        └─ writes: playlist_execution_jobs (status=done/failed/manual)

SOURCE B — CRON: recover stuck print batches
──────────────────────────────────────────────
[pg_cron: recover-print-batches-5min → */5 * * * *]
  └─ calls: cron-recover-print-batches
        └─ RPC: recover_stuck_print_batches
        └─ calls: extract-snapshot-from-print (re-dispatch)

SOURCE C — LABEL SPREADSHEET (client portal upload)
────────────────────────────────────────────────────
[Client Portal Frontend] → import-label-spreadsheet
  ├─ parses XLSX/CSV (npm:xlsx@0.18.5)
  ├─ buildMatchers() → playlists table (by spotify_playlist_id) + curators (by name/spotify_owner_id)
  ├─ resolveKnownPlaylistNames() → curator_playlists, managed_playlists, playlists
  ├─ RPC: evaluate_upload_quarantine (duplicate/regression detection)
  ├─ writes: Storage bucket "label-spreadsheets"
  ├─ writes: label_spreadsheet_uploads
  ├─ writes: label_spreadsheet_rows (detail rows with match)
  ├─ writes: curator_playlists (ensures existence)
  ├─ writes: curator_deal_snapshots
  ├─ writes: delivery_proofs (non-baseline internal playlists only)
  ├─ writes: curator_deal_songs (auto_collect=false for spreadsheet deals)
  ├─ RPC: recompute_campaign_total_delivered
  └─ RPC: ingest_campaign_collection_batch (mirrors to campaign_playlist_collections)

SOURCE D — OBSERVER (playlist observation — separate older system)
───────────────────────────────────────────────────────────────────
[bot-ingest] → observe_playlist action
  └─ writes: playlist_observations (snapshot JSONB)
  └─ writes: observer_runs

DATABASE LAYER (SQL → campaign_playlist_collections)
─────────────────────────────────────────────────────
TRIGGER trg_cpc_first_seen (BEFORE INSERT) → set_collection_first_seen_at()
RPC ingest_campaign_collection_batch → writes campaign_playlist_collections (idempotent baseline lock)
                                     → calls sync_campaign_deals_baseline() on baseline capture
                                     → updates campaigns.baseline_status='captured'

DELIVERY PIPELINE (from Phase 2 — unchanged)
─────────────────────────────────────────────
campaign_playlist_collections
  → fn_playlist_delivery_accumulated (SQL view/function)
  → recompute_campaign_total_delivered (RPC)
  → campaigns.total_delivered
  → vw_campaign_playlist_growth (view)
  → Frontend
```

---

## PART 2 — EDGE FUNCTIONS TABLE

| Function | Responsibility | Caller | Callees | Tables Read | Tables Written | RPCs | Active? | Duplicate? |
|---|---|---|---|---|---|---|---|---|
| **bot-collect-queue** | Queue delivery: returns curator_deal_songs eligible for collection | VPS bot (GET, poll) | spotify-client (getAppToken) | curator_deal_songs, v_curator_playlists_operational, curator_deals, campaigns, clients, curators | curator_deal_songs (queued), bot_events, notifications | claim_collect_queue, create_notification | ✅ Yes | Partial: bot-ingest-song-snapshot handles catalog mode separately |
| **bot-event-ingest** | Records granular lifecycle events per song | VPS bot (POST) | — | — | bot_events | — | ✅ Yes | No |
| **bot-heartbeat** | Session health + piggyback DOM ingest | VPS bot (POST every ~30s) | processDomItem [_shared/ingest-dom.ts], send-transactional-email | bot_heartbeats, notifications, email_send_log | bot_heartbeats, vps_nodes, collection_logs | create_notification | ✅ Yes | DOM ingest duplicated: also in bot-ingest-dom |
| **bot-ingest** | Observer protocol: list/observe playlists, log runs | VPS observer bot | — | playlists_to_observe | playlist_observations, observer_runs | — | ✅ Yes (observer, separate domain) | No |
| **bot-ingest-dom** | DOM-parsed playlist data: writes snapshots without prints | VPS bot (POST) | processDomItem [_shared/ingest-dom.ts] | curator_deals, curator_deal_songs, curator_deal_logs, curator_playlists | curator_deal_snapshots, curator_playlists, organic_plays_snapshots, campaign_eco_snapshots, curator_deal_logs, curator_deal_songs, collection_logs | match_curator_playlist, ingest_campaign_collection_batch (via baseline-writer) | ✅ Yes | **DUPLICATE** with bot-heartbeat (piggyback) and bot-ingest-snapshot |
| **bot-ingest-snapshot** | Receives collected data: aggregate OR snapshots[] per playlist | VPS bot (POST) | assertDealOperable, classifyPlaylistKind, extractPlaylistId | curator_deals, curator_deal_songs, curator_deal_logs | curator_deal_snapshots, curator_playlists, curator_deal_logs, curator_deal_songs, bot_print_batches, campaign_eco_snapshots, collection_logs | ingest_campaign_collection_batch (baseline), create_notification | ✅ Yes | **DUPLICATE** with bot-ingest-dom (same job, different payload format) |
| **bot-ingest-song-snapshot** | NEW unified endpoint: raw S4A song+playlists payload | VPS bot (POST) | logRawIngest | curator_deal_songs, campaigns, song_snapshots | song_snapshots, song_snapshot_playlists, bot_print_batches, curator_deal_songs, catalog_snapshot_queue | ingest_campaign_collection_batch (directly, no baseline-writer) | ✅ Yes | **DIFFERENT WRITER**: calls RPC directly without baseline-writer guard |
| **bot-upload-print** | Stores PNG prints in storage, groups multi-part batches | VPS bot (POST) | assertDealOperable, logRawIngest, append_print_to_batch (RPC) | curator_deals, bot_print_batches, catalog_snapshot_queue | Storage [bot-prints], bot_print_batches, bot_ingest_raw | append_print_to_batch | ✅ Yes | No (print storage is its own domain) |
| **extract-snapshot-from-print** | OCR via Gemini Vision → playlists → snapshots | bot-upload-print (auto), cron-recover-print-batches, manual | callGeminiChunked, classifyPlaylistKind, fetchPlaylistMeta | bot_print_batches, curator_playlists, managed_playlists, curator_deals, curator_deal_snapshots, curator_deal_logs, ai_print_cache | curator_deal_snapshots, curator_playlists, organic_plays_snapshots, campaign_eco_snapshots, curator_deal_logs, cursor_deal_songs, bot_print_batches, collection_logs, bot_events, ai_print_cache | match_curator_playlist, ingest_campaign_collection_batch (via baseline-writer), create_notification | ✅ Yes | No (sole OCR processor) |
| **collect-batch** | Genre search batch: run-search per term + analyze-genre | Team/internal | run-search, analyze-genre, enrich-playlists, generate-terms | genres, search_terms, search_results | collection_logs, genres | deprecationGate | ⚠️ Deprecated (deprecationGate) | Genre domain only, no overlap with bot collection |
| **daily-collect** | Daily genre collection cron | Cron | run-search, analyze-genre | genres, search_terms | collection_logs | deprecationGate, reportCronHealth | ⚠️ Deprecated (deprecationGate) | Superseded by collect-batch |
| **cron-recover-print-batches** | Re-dispatches stuck (complete but unprocessed) print batches | pg_cron every 5min | extract-snapshot-from-print | bot_print_batches | bot_print_batches | recover_stuck_print_batches | ✅ Yes | No (recovery-only) |
| **import-label-spreadsheet** | Parse XLSX/CSV from client portal → write collections | Client portal frontend | evaluate_upload_quarantine, buildMatchers, ingest_campaign_collection_batch | label_spreadsheet_uploads, campaigns, curator_playlists, managed_playlists, playlists, curators | label_spreadsheet_uploads, label_spreadsheet_rows, curator_playlists, curator_deal_snapshots, delivery_proofs, curator_deal_songs, campaign_playlist_collections (via RPC), Storage [label-spreadsheets] | evaluate_upload_quarantine, ingest_campaign_collection_batch, recompute_campaign_total_delivered, resolve_client_token | ✅ Yes | No (sole spreadsheet importer) |
| **bot-execution-queue** | Playlist track add/remove/reorder jobs (Spotify Web API inline) | VPS bot (GET), pg_cron | spotify-playlist.ts, spotify-client.ts, manual-fallback.ts | playlist_execution_jobs, managed_playlists, system_flags, campaign_eco_allocations | playlist_execution_jobs, bot_events, manual_distribution_queue | — | ✅ Yes | No |
| **bot-execution-complete** | Reports collect/execution done or failed | VPS bot (POST) | — | curator_deal_songs, playlist_execution_jobs | curator_deal_songs, playlist_execution_jobs, bot_events | — | ✅ Yes | No |

---

## PART 3 — BOTS INVENTORY

| Bot Type | Name | Location | Entry Point | Protocol | What It Does |
|---|---|---|---|---|---|
| **VPS Main Bot** | `spotify-artists-bot` | External VPS server | Worker process (Node.js/Playwright) | HTTP → edge functions | Opens Spotify for Artists, navigates to song stats page, reads playlist data, uploads prints/DOM |
| **Browser/DOM** | Same VPS worker | VPS | Playwright `page.evaluate()` | Sends JSON payload to bot-ingest-dom or bot-ingest-song-snapshot | Extracts playlist rows from DOM with spotify URLs, plays_7d/28d/24h without screenshotting |
| **OCR/Print** | Same VPS worker | VPS | Playwright `page.screenshot()` | Sends PNG to bot-upload-print → extract-snapshot-from-print → Gemini Vision | Screenshot of Spotify for Artists playlist tab, sent as multi-part prints |
| **Heartbeat** | Same VPS worker | VPS | Timer loop (~30s) | POST to bot-heartbeat | Session health check; piggybacks DOM snapshots if available (`dom_snapshots[]`) |
| **Event Logger** | Same VPS worker | VPS | After each step | POST to bot-event-ingest | Logs granular lifecycle steps: FETCHED, STARTED, PRINT_UPLOADED, SNAPSHOT_SENT, FINISHED, FAILED |
| **Queue Poller** | Same VPS worker | VPS | GET bot-collect-queue | Poll every cycle | Gets next batch of songs to collect (limit=N); atomic claim via RPC |
| **Execution Bot** | Same VPS worker | VPS | GET bot-execution-queue | Poll | Receives playlist.track.add/remove/reorder jobs; executes via Spotify Web API |
| **Observer Bot** | Separate process | VPS | bot-ingest (observe_playlist action) | HTTP | Observes public playlist tracks; writes to playlist_observations, observer_runs |
| **Catalog Bot** | Same or separate | VPS | bot-ingest-song-snapshot (catalog_track_id mode) | HTTP | Collects S4A snapshots for catalog tracks (not deal-tied); updates catalog_snapshot_queue |

**Key identifiers transmitted by bot:** `x-worker-id`, `x-process-id`, `x-hostname`, `x-timer-id`, `x-bot-name`, `x-bot-session`, `correlation_id` (per-song dispatch UUID).

---

## PART 4 — PIPELINES

### Pipeline 1: DOM Fast Path (no OCR) — CURRENT PRIMARY
```
curator_deal_songs [auto_collect=true, status=idle]
  → bot-collect-queue (claim_collect_queue RPC)
  → VPS bot navigates S4A
  → page.evaluate() extracts playlists
  → POST bot-ingest-dom OR POST bot-ingest-song-snapshot
  → _shared/ingest-dom.ts::processDomItem() OR inline logic
  → match_curator_playlist RPC
  → curator_deal_snapshots (INSERT)
  → baseline-writer.ts::writeBaselineOfficial() [if isBaseline]
  → ingest_campaign_collection_batch RPC
  → campaign_playlist_collections (INSERT)
  → [delivery pipeline from Phase 2]
```
**Status:** ✅ Active, primary path

### Pipeline 2: Print+OCR Path (fallback)
```
curator_deal_songs [auto_collect=true, status=idle]
  → bot-collect-queue
  → VPS bot takes screenshot
  → POST bot-upload-print (stores PNG in bot-prints bucket)
  → bot_print_batches (accumulate parts)
  → [all parts received] → extract-snapshot-from-print (auto-called)
  → Gemini 2.5 Flash Vision OR DOM direct (if dom_playlists in batch)
  → match_curator_playlist RPC
  → curator_deal_snapshots (upsertSnapshot)
  → baseline-writer.ts::writeBaselineOfficial() [if isBaseline]
  → ingest_campaign_collection_batch RPC
  → campaign_playlist_collections (INSERT)
  → [delivery pipeline]
```
**Status:** ✅ Active, but label "playlists-part-*" BLOCKED (legacy_playlists_label_deprecated, HTTP 410). Only "song-snapshot-{cid}-part-X-of-Y" accepted. Recovery via cron every 5min.

### Pipeline 3: bot-ingest-song-snapshot (NEW — unified)
```
curator_deal_songs [auto_collect=true, status=queued]
  → POST bot-ingest-song-snapshot (song_id + playlists[])
  → song_snapshots INSERT (header)
  → song_snapshot_playlists INSERT (per row)
  → ingest_campaign_collection_batch RPC DIRECTLY (no baseline-writer guard)
  → campaign_playlist_collections
  → curator_deal_songs bump
```
**Status:** ✅ Active. **RISK:** Calls `ingest_campaign_collection_batch` directly without going through `baseline-writer.ts` — bypasses the structured skip-logging and campaign-resolution guard.

### Pipeline 4: Label Spreadsheet (client portal)
```
Client Portal → import-label-spreadsheet
  → parseBuf() [XLSX/CSV parser]
  → buildMatchers() [playlist/curator lookup]
  → evaluate_upload_quarantine RPC [duplicate/regression guard]
  → label_spreadsheet_uploads INSERT
  → label_spreadsheet_rows INSERT (detail)
  → curator_playlists INSERT (ensure existence)
  → curator_deal_snapshots INSERT
  → delivery_proofs INSERT (non-baseline internal only)
  → ingest_campaign_collection_batch RPC (mirror to campaign_playlist_collections)
  → recompute_campaign_total_delivered RPC
```
**Status:** ✅ Active. **FLAG:** `collection_mode='spreadsheet'` on campaign disables bot collection for shadow deals.

### Pipeline 5: Heartbeat Piggyback DOM (emergency channel)
```
VPS bot heartbeat → POST bot-heartbeat [dom_snapshots:[...]]
  → processDomItem() for each item
  → [same as Pipeline 1 from processDomItem onward]
```
**Status:** ✅ Active. **RISK:** Duplicate execution path — same `processDomItem()` called in both bot-heartbeat and bot-ingest-dom. No deduplication check between the two callers; 90s window check inside processDomItem is the only guard.

### Pipeline 6: Observer (separate domain)
```
VPS observer → POST bot-ingest (observe_playlist action)
  → playlist_observations INSERT
  → observer_runs INSERT/UPDATE
```
**Status:** ✅ Active, but isolated domain (doesn't feed campaign_playlist_collections).

### Pipeline 7: Recover Stuck Batches (cron)
```
pg_cron: recover-print-batches-5min (*/5)
  → cron-recover-print-batches
  → RPC: recover_stuck_print_batches
  → extract-snapshot-from-print (re-dispatch per stuck batch)
  → [same as Pipeline 2 from extract onward]
```
**Status:** ✅ Active. Necessary guard for OCR failures.

### Pipeline 8: Genre/Search Collection (different domain)
```
[Cron/Manual] → daily-collect (DEPRECATED) / collect-batch (DEPRECATED)
  → run-search → search_results
  → analyze-genre
```
**Status:** ⚠️ Both functions have `deprecationGate`. Genre domain, does NOT write to campaign_playlist_collections.

---

## PART 5 — MATCH ENGINE

### Official Key: `spotify_playlist_id` (exact match)

**Function:** `public.match_curator_playlist(p_deal_id, p_spotify_playlist_id, p_playlist_name, p_song_id)`  
**Defined in:** `supabase/migrations/20260522164414_e570679e-6a88-4232-b2e9-27be3e41f38a.sql`  
**Type:** `STABLE SECURITY DEFINER`, returns `TABLE(playlist_id uuid, match_method text)`

### Priority Chain (inside `match_curator_playlist`):
1. **`spotify_id`** — Exact match on `curator_playlists.spotify_playlist_id` WHERE `deal_id = p_deal_id` AND `song_id` scope. Returns immediately if found.
2. **`name`** — Normalized exact match: lowercase, no accents, no non-alphanumeric. Applies `regexp_replace` + `translate` on both sides.
3. **`fuzzy`** — `pg_trgm similarity()` ≥ 0.85, ordered by score DESC, limit 1.

### Who calls `match_curator_playlist`:
- `_shared/ingest-dom.ts:199` — processDomItem (bot-ingest-dom, bot-heartbeat piggyback)
- `extract-snapshot-from-print/index.ts` (lines ~1070–1100) — for whitelist-confirmed playlists AND DOM complement pass
- No caller in bot-ingest-snapshot (has its own inline ensureObservedPlaylist)
- No caller in bot-ingest-song-snapshot (no match at all — writes raw to song_snapshots/song_snapshot_playlists + campaign_playlist_collections directly)

### Who writes `match_status` / changes status:
- **`match_status` on `curator_playlists`:** Set at INSERT time in bot-ingest-snapshot (`ensureObservedPlaylist`) and import-label-spreadsheet. Values: `curator`, `baseline`, `editorial`, `organic`, `algorithmic`, `s4a_observed`.
- **`match_method` on `curator_deal_snapshots`:** Written by every snapshot inserter: `spotify_id`, `name`, `fuzzy`, `algorithmic`, `s4a_observed`, `label_spreadsheet`.

### Duplicates in match logic:
| Location | Method | Notes |
|---|---|---|
| `match_curator_playlist` RPC | spotify_id → name → fuzzy(0.85) | Official, used by ingest-dom + extract-print |
| `bot-ingest-snapshot::ensureObservedPlaylist()` | spotify_id exact only (no fuzzy) | Inline, NOT using RPC |
| `import-label-spreadsheet::buildMatchers()` | spotify_playlist_id exact on `playlists` table (NOT `curator_playlists`) + curator name/owner | Different table, different scope |
| `bot-ingest-song-snapshot` | No match — stores raw song_snapshot_playlists | Never matches to curator_playlists |
| `extract-snapshot-from-print` DOM complement | RPC match_curator_playlist (line ~1310) | Official |

**Finding:** Four different match implementations. Official `match_curator_playlist` RPC is NOT used by bot-ingest-snapshot or bot-ingest-song-snapshot.

---

## PART 6 — WRITERS PER TABLE

### `campaign_playlist_collections`
| Writer | Call Path | When | Mode |
|---|---|---|---|
| `ingest_campaign_collection_batch` RPC (via baseline-writer.ts) | bot-ingest-dom → processDomItem → writeBaselineOfficial | Baseline only | baseline |
| `ingest_campaign_collection_batch` RPC (via baseline-writer.ts) | bot-ingest-snapshot → writeBaselineOfficial | Baseline only | baseline |
| `ingest_campaign_collection_batch` RPC (via baseline-writer.ts) | extract-snapshot-from-print → writeBaselineOfficial | Baseline only | baseline |
| `ingest_campaign_collection_batch` RPC **DIRECTLY** | bot-ingest-song-snapshot (line ~289) | Every collect (baseline+periodic) | baseline or periodic |
| `ingest_campaign_collection_batch` RPC (direct) | import-label-spreadsheet (line ~856) | Every commit (baseline+periodic) | baseline or periodic |
| SQL TRIGGER `trg_cpc_first_seen` | BEFORE INSERT on campaign_playlist_collections | Always | Sets first_seen_at |

**RISK:** Three writers call the RPC through the guard (`baseline-writer.ts`); two call it directly (bot-ingest-song-snapshot, import-label-spreadsheet). The guard logs structured skip events to `bot_events` when campaign_id is absent — bypassing it means silent failures.

### `curator_campaign_playlists`
| Writer | Call Path |
|---|---|
| Migration data inserts | `supabase/migrations/20260531161110_00ef01f1` |
| No edge function writes detected | — |

### `curator_playlists`
| Writer | Call Path | Notes |
|---|---|---|
| `bot-ingest-snapshot::ensureObservedPlaylist()` | Every snapshot, inline | Creates if not exists |
| `_shared/ingest-dom.ts::ensureObservedPlaylist()` | processDomItem | Creates if not exists |
| `extract-snapshot-from-print` | For whitelisted, algorithmic, DOM complement | Creates if not exists |
| `import-label-spreadsheet` | Batch INSERT missing rows | Creates curator_playlists records for all playlist rows |
| Frontend (paste/manual) | `enrich-curator-paste`, `register-curator-playlist` | Manual curation |

### `curator_deal_snapshots`
| Writer | Call Path |
|---|---|
| `_shared/ingest-dom.ts::processDomItem()` | bot-ingest-dom, bot-heartbeat piggyback |
| `bot-ingest-snapshot` | inline (handles snapshots[] format) |
| `extract-snapshot-from-print::upsertSnapshot()` | OCR path, DOM complement |
| `import-label-spreadsheet` | spreadsheet commit |

### `delivery_proofs`
| Writer | Call Path | Notes |
|---|---|---|
| `bot-ingest-snapshot` | For each snapshot with print_url | Writes via `supabase.from("delivery_proofs").insert()` |
| `import-label-spreadsheet` | Non-baseline, internal playlists only | After curator_deal_snapshots |

### `bot_events`
| Writer | Call Path |
|---|---|
| `bot-event-ingest` | Direct bulk insert from VPS |
| `bot-collect-queue` | dispatch events (FETCHED) |
| `bot-execution-complete` | FINISHED/FAILED events |
| `extract-snapshot-from-print` | On Gemini failures (FAILED lifecycle) |
| `_shared/baseline-writer.ts::logBaselineSkip()` | Skip events from all 3 guarded callers |
| `bot-ingest-song-snapshot` | (via bot_events implicitly through RPC) |

### `label_spreadsheet_uploads`
| Writer | Call Path |
|---|---|
| `import-label-spreadsheet` | Only writer |

---

## PART 7 — CRONS

| Job Name | Schedule | Function | Responsibility | Active? | Duplicate/Legacy? |
|---|---|---|---|---|---|
| `recover-print-batches-5min` | `*/5 * * * *` | cron-recover-print-batches | Re-dispatches stuck complete-but-unprocessed bot_print_batches to extract-snapshot-from-print | ✅ | No — essential safety net |
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
| `daily-collect` | (via cron.schedule, deprecated function) | daily-collect | Genre search | ⚠️ DEPRECATED | Superseded by collect-batch + deprecationGate |

**Collection-related crons: only `recover-print-batches-5min` is directly in the bot/ingest domain.** The VPS bot runs its own scheduling (timers inside the process), not pg_cron.

---

## PART 8 — QUEUES

### Queue 1: `curator_deal_songs` (bot collect queue)
- **Table:** `curator_deal_songs` — `auto_collect_status` ∈ {idle, queued, error, auth_required, manual}
- **Producer:** Any deal activation that sets `auto_collect=true`. Also: reset from `bot-collect-queue` recovery (stuckRows → idle).
- **Consumer:** `bot-collect-queue` (GET, with `claim_collect_queue` RPC for atomic claim)
- **Claim mechanism:** `claim_collect_queue` RPC uses `FOR UPDATE SKIP LOCKED` — prevents duplicate delivery to parallel workers (bug fixed 09/06/2026)
- **Retry/backoff:** `bot-execution-complete` applies exponential backoff: 2min, 8min, 30min, 2h on consecutive failures. 5min timeout for stuck-queued recovery in bot-collect-queue.
- **Duplicate risk:** None at claim level (SKIP LOCKED). Risk is multiple workers calling GET simultaneously with different `limit` — over-fetch filter (5x limit) and atomic claim resolve it.

### Queue 2: `bot_print_batches` (print batch assembly)
- **Table:** `bot_print_batches` — `status` ∈ {pending, complete, processing, processed, error}
- **Producer:** `bot-upload-print` — one batch per `correlation_id`
- **Consumer:** `extract-snapshot-from-print` (auto-triggered by bot-upload-print on last part arrival, OR by `cron-recover-print-batches` for stuck batches)
- **Duplicate guard:** `append_print_to_batch` RPC (FOR UPDATE), idempotent replay by `correlation_id` UNIQUE constraint, guard in extract-snapshot-from-print for `status=processed`/`processing`
- **Legacy label blocked:** `playlists-part-*` returns HTTP 410. Only `song-snapshot-{cid}-part-X-of-Y` accepted.

### Queue 3: `playlist_execution_jobs` (Spotify track operations)
- **Table:** `playlist_execution_jobs` — `status` ∈ {pending, claimed, done, failed, manual}
- **Producer:** execution-planner, Growth Engine RPCs
- **Consumer:** `bot-execution-queue` (GET, inline execution via Spotify Web API) + `manual_distribution_queue` (fallback)
- **Duplicate guard:** Lease expires after 5min; `bot-execution-queue` resets stale claims.

### Queue 4: `catalog_snapshot_queue` (catalog track collection)
- **Table:** `catalog_snapshot_queue` — `status` ∈ {pending, processing, done}
- **Producer:** Not audited in this phase (separate catalog domain)
- **Consumer:** `bot-ingest-song-snapshot` (catalog mode — closes item on done)
- **Lease guard:** `lease_expires_at`, `locked_by`, `locked_at`

### Queue 5: `manual_distribution_queue` (fallback for execution failures)
- **Table:** `manual_distribution_queue`
- **Producer:** `bot-execution-queue` (via `enqueueManual`) when Spotify API errors require human review
- **Consumer:** Ops team (manual) + `mark-manual-distribution-done`

---

## PART 9 — SOURCES OF TRUTH

| Domain | Official Table | Secondary/Derived | Notes |
|---|---|---|---|
| **Coletas (playlist collections)** | `campaign_playlist_collections` | `curator_deal_snapshots` (older, granular) | BOTH contain playlist+plays data. campaign_playlist_collections is the Phase 3 official table for delivery pipeline. curator_deal_snapshots is the operational/granular store still used for curator progress |
| **Uploads (spreadsheets)** | `label_spreadsheet_uploads` | — | Single writer: import-label-spreadsheet |
| **Snapshots (raw S4A data)** | `song_snapshots` + `song_snapshot_playlists` | `curator_deal_snapshots` (parallel write) | song_snapshots is the NEW unified store (bot-ingest-song-snapshot). curator_deal_snapshots is the OLD store still written by extract-print and ingest-dom. **Two parallel sources of truth for raw snapshot data.** |
| **Prints (screenshots)** | `bot_print_batches` | Storage bucket `bot-prints` | bot_print_batches is the source; `print_url` on snapshots/logs deprecated (set to null) |
| **Match (playlist→deal)** | `match_curator_playlist` RPC | `buildMatchers()` in import-label-spreadsheet | Two independent match implementations |
| **Observed playlist (monitoring)** | `playlist_observations` | `curator_deal_snapshots` | bot-ingest (observe_playlist) writes playlist_observations; bot ingest-dom/snapshot write curator_deal_snapshots |
| **Assigned playlist (by curator)** | `curator_playlists` (match_status='curator') | `v_curator_playlists_operational` view | Multiple writers create rows |
| **Bot events (telemetry)** | `bot_events` | `collection_logs` | bot_events = structured lifecycle; collection_logs = freetext operation log |

---

## PART 10 — DUPLICATES TABLE

| Responsibility | Components | Verdict |
|---|---|---|
| **DOM ingest processing** | `bot-ingest-dom` (calls processDomItem), `bot-heartbeat` (piggyback, calls processDomItem), `bot-ingest-snapshot` (inline snapshot loop, same logic but no shared code) | **CONSOLIDATE** — bot-ingest-dom and heartbeat piggyback both call `processDomItem` ✅ already shared; bot-ingest-snapshot duplicates the logic inline. bot-ingest-snapshot should be refactored to use `processDomItem` or merged into bot-ingest-dom. |
| **Writing to campaign_playlist_collections** | baseline-writer.ts (guards 3 callers), bot-ingest-song-snapshot (direct, no guard), import-label-spreadsheet (direct, no guard) | **CONSOLIDATE** — All writers should go through baseline-writer.ts or a single centralized `ingest_campaign_collection_batch` caller with structured logging. |
| **Playlist match implementation** | `match_curator_playlist` RPC (sql), `ensureObservedPlaylist` in bot-ingest-snapshot (js, spotify_id only), `buildMatchers` in import-label-spreadsheet (js, different table) | **CONSOLIDATE** — bot-ingest-snapshot should call `match_curator_playlist` RPC instead of its own lookup. import-label-spreadsheet's buildMatchers targets `playlists` table (not `curator_playlists`) — intentional for spreadsheet domain but undocumented. |
| **Raw snapshot storage** | `song_snapshots`/`song_snapshot_playlists` (new, via bot-ingest-song-snapshot), `curator_deal_snapshots` (old, via extract-print + ingest-dom) | **KEEP BOTH SHORT-TERM** but document migration path. song_snapshots is the canonical new store; curator_deal_snapshots is used by curator progress views. Plan migration. |
| **Heartbeat DOM piggyback vs explicit bot-ingest-dom** | bot-heartbeat piggyback (dom_snapshots[]), bot-ingest-dom (explicit POST) | **KEEP** — heartbeat piggyback is designed as an emergency fallback when the bot dist doesn't explicitly call bot-ingest-dom. Document clearly. |
| **daily-collect vs collect-batch** | Both marked deprecated via deprecationGate | **REMOVE** — already deprecated, can be deleted once cron is confirmed removed. |
| **curator_deal_logs** | Written by ingest-dom, ingest-snapshot, extract-print, import-label-spreadsheet | **KEEP** — aggregate log per deal/song; not a duplicate, different granularity from snapshots. |

---

## PART 11 — RISKS CHECKLIST

| # | Risk | Status | Evidence |
|---|---|---|---|
| R1 | **Duplicate collection**: same song dispatched to 2 workers simultaneously → 2 prints stored, 2 snapshot inserts | ✅ MITIGATED | `claim_collect_queue` RPC uses FOR UPDATE SKIP LOCKED. 90s deduplication window in processDomItem and extract-print. |
| R2 | **Stuck song in queued state** | ✅ MITIGATED | bot-collect-queue resets songs queued >5min to idle. Recovery event logged in bot_events. |
| R3 | **bot-ingest-song-snapshot bypasses baseline-writer guard** | ⚠️ YES | `bot-ingest-song-snapshot/index.ts:289` calls `ingest_campaign_collection_batch` directly with `p_intent` computed inline. No structured skip-log to bot_events when campaign_id absent. |
| R4 | **import-label-spreadsheet bypasses baseline-writer guard** | ⚠️ YES | `import-label-spreadsheet/index.ts:856` calls `ingest_campaign_collection_batch` directly. Same issue as R3. |
| R5 | **Multiple baseline inserts possible** | ✅ MITIGATED | `idx_cpc_baseline_unique` UNIQUE INDEX on `(campaign_id, playlist_id) WHERE is_baseline=true`. RPC checks `baseline_status='captured'` and returns early (idempotent). |
| R6 | **OCR (Gemini) fails silently** | ✅ MITIGATED | cron-recover-print-batches (*/5) re-dispatches stuck batches. Error logged in bot_events and collection_logs. |
| R7 | **Label "playlists-part-*" still accepted by old VPS builds** | ⚠️ YES | bot-upload-print returns HTTP 410 for legacy label. If VPS still uses old build, upload is dropped silently (logged in collection_logs). |
| R8 | **Two different match implementations** | ⚠️ YES | bot-ingest-snapshot uses JS-only exact spotify_id match (no fuzzy); extract-print and ingest-dom use full RPC (with fuzzy). Same playlist could match in one path but not another. |
| R9 | **bot-ingest-snapshot inline logic diverges from ingest-dom.ts** | ⚠️ YES | bot-ingest-snapshot has its own `ensureObservedPlaylist()` and snapshot loop — not shared with `_shared/ingest-dom.ts`. Bugs fixed in one won't auto-fix the other. |
| R10 | **spreadsheet upload disables auto_collect globally** | ⚠️ RISK | import-label-spreadsheet:~ line 839: sets `auto_collect=false` for the song. If spreadsheet is quarantined but `auto_collect` was already set to false, bot colection is permanently disabled. Quarantine guard does prevent snapshots/proofs but does NOT skip the `auto_collect=false` write. **Bug candidate.** |
| R11 | **Collection_mode filter bug (historical)** | ✅ FIXED | bot-collect-queue comment: "Reversão 30/05 — removido filtro por collection_mode porque bloqueava 6 deals (Roninho/Igor/Plug)". Filter removed. |
| R12 | **VPS workers race (parallel w0…wN)** | ✅ MITIGATED | claim_collect_queue FOR UPDATE SKIP LOCKED. Over-fetch (5x limit). Atomic append_print_to_batch RPC for batch assembly. |
| R13 | **song_snapshots table not connected to delivery pipeline** | ⚠️ YES | bot-ingest-song-snapshot writes song_snapshots/song_snapshot_playlists + campaign_playlist_collections directly. The song_snapshots data does NOT flow through curator_deal_snapshots → curator progress views. These are parallel tracks with no reconciliation. |
| R14 | **Observer (bot-ingest) isolated from delivery pipeline** | ℹ️ KNOWN | playlist_observations never flows to campaign_playlist_collections. Intentional — separate observation domain. |
| R15 | **ai_print_cache deduplication** | ✅ MITIGATED | SHA-256 hash of (model + print URLs without query params). Hits counter and last_hit_at maintained. |

---

## PART 12 — FINAL VERDICT

### Is there a single pipeline? 
**NO.** There are 4 active ingest pipelines feeding `campaign_playlist_collections`:
1. DOM path via `processDomItem` (ingest-dom + heartbeat piggyback) → baseline-writer
2. Print+OCR path via `extract-snapshot-from-print` → baseline-writer
3. Unified snapshot path via `bot-ingest-song-snapshot` → **DIRECT RPC** (no guard)
4. Spreadsheet path via `import-label-spreadsheet` → **DIRECT RPC** (no guard)

### Is there a single writer?
**NO.** All four pipelines write to `campaign_playlist_collections` via `ingest_campaign_collection_batch` RPC, but two bypass the `baseline-writer.ts` guard layer. Additionally, `curator_deal_snapshots` is written by three separate code paths with partially divergent logic.

### Is there a single match engine?
**NO.** Three implementations:
1. `match_curator_playlist` RPC — official (fuzzy + name + spotify_id), used by ingest-dom and extract-print
2. `ensureObservedPlaylist()` in bot-ingest-snapshot — spotify_id exact only, inline JS
3. `buildMatchers()` in import-label-spreadsheet — queries `playlists` table (not `curator_playlists`), curator name fuzzy

### Candidates for consolidation:

| Priority | Action |
|---|---|
| 🔴 HIGH | Route `bot-ingest-song-snapshot` writes through `baseline-writer.ts` (or equivalent guard) before calling `ingest_campaign_collection_batch`. |
| 🔴 HIGH | Route `import-label-spreadsheet` baseline/periodic writes through `baseline-writer.ts`. |
| 🟠 MEDIUM | Extract bot-ingest-snapshot's snapshot loop into `_shared/ingest-dom.ts::processDomItem` or a new shared `ingest-snapshot.ts`. Eliminates 3rd match implementation. |
| 🟠 MEDIUM | Fix: `import-label-spreadsheet` sets `auto_collect=false` even for quarantined uploads. Should only apply when `status != 'quarantined'`. |
| 🟡 LOW | Migrate `curator_deal_snapshots` reads (curator progress views) to use `campaign_playlist_collections` as primary source, then deprecate curator_deal_snapshots as a write target. |
| 🟡 LOW | Remove deprecated `daily-collect` and `collect-batch` functions and their pg_cron entries (already have deprecationGate). |

### Proposed official post-consolidation architecture:

```
VPS Bot / Client Portal
        │
        ▼
  [Single Ingest Gateway — tbd: bot-ingest-unified]
        │
        ├─ Validates deal operability (assertDealOperable)
        ├─ Deduplicates (90s window)
        ├─ Calls match_curator_playlist RPC (single match engine)
        ├─ Writes: curator_deal_snapshots (granular/operational)
        └─ Calls baseline-writer.ts::writeBaselineOfficial()
                │
                └─ ingest_campaign_collection_batch RPC
                        │
                        └─ campaign_playlist_collections
                                │
                                └─ [Phase 2 delivery pipeline]
                                    fn_playlist_delivery_accumulated
                                    → recompute_campaign_total_delivered
                                    → campaigns.total_delivered
                                    → vw_campaign_playlist_growth
                                    → Frontend
```

**Key invariant (Phase 3 post-consolidation):** Every write to `campaign_playlist_collections` MUST go through `ingest_campaign_collection_batch` RPC, always via `baseline-writer.ts` guard for structured logging. No direct inserts. No bypass paths.

---

*Report generated from read-only static analysis of supabase/functions/ and supabase/migrations/. No database was queried live; all evidence from source code.*
