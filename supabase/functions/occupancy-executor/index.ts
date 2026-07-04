// ============================================================================
// catalog-executor (mantém o nome de path `occupancy-executor` por compat de cron).
//
// Arquitetura síncrona (28/06/2026):
//   - Não existe mais Occupancy Engine permanente.
//   - O executor é a ÚNICA fonte da distribuição. A cada tick:
//       1) Claim de N catalog_placements (pending/retry/skipped/waiting_circuit_breaker).
//       2) Para cada placement, chama `fn_decide_placement_action(placement_id)`.
//       3) Aplica a decisão diretamente no Spotify:
//            - INSERT          → adiciona a faixa.
//            - REMOVE_INSERT   → remove a ThirdParty e adiciona a faixa do catálogo.
//            - SKIP            → registra motivo e libera o placement (sem efeito).
//       4) Atualiza catalog_placements + catalog_placement_execution_log.
//
// Toda a infra antiga (occupancy_plans, occupancy_plan_ops, rebuild queue, worker,
// triggers trg_occ_*) será removida em migration destrutiva subsequente.
//
// Body opcional: { placements_limit?: number }
// ============================================================================
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getAppToken, getUserToken, setSpotifyCtx } from "../_shared/spotify-client.ts";
import {
  addPlaylistTracks,
  removePlaylistTracks,
} from "../_shared/spotify-playlist.ts";
import { backoffSecondsForAttempt } from "../_shared/playlist-queue.ts";
import {
  mptInsertFromCatalog,
  mptRemoveFromCatalog,
} from "../_shared/managed-tracks-writer.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const jr = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const toUri = (id: string) =>
  id.startsWith("spotify:track:") ? id : `spotify:track:${id}`;

const _trim = (s: string | null | undefined, max = 480): string | null => {
  if (s == null) return null;
  const str = String(s);
  return str.length > max ? str.slice(0, max) : str;
};

type CPRow = {
  id: string;
  catalog_track_id: string;
  managed_playlist_id: string;
  position: number | null;
  attempts: number;
  max_attempts: number;
};

type CPEnriched = CPRow & {
  spotify_playlist_id: string;
  owner_spotify_user_id: string | null;
  tracks_count: number | null;
  spotify_track_id: string;
  spotify_uri: string | null;
};

type Decision =
  | { action: "INSERT" }
  | { action: "REMOVE_INSERT"; remove_track_id: string }
  | { action: "SKIP"; reason: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: flagRow } = await supabase
    .from("system_flags")
    .select("catalog_executor_per_minute_limit")
    .limit(1)
    .maybeSingle();

  const PLACEMENTS_PER_MIN_DEFAULT = 10;
  let placementsLimit = Math.max(
    1,
    Math.min(50, Number((flagRow as any)?.catalog_executor_per_minute_limit ?? PLACEMENTS_PER_MIN_DEFAULT)),
  );

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    if (typeof body?.placements_limit === "number") {
      placementsLimit = Math.max(1, Math.min(50, body.placements_limit));
    }
  } catch (_) { /* noop */ }

  const t0 = Date.now();
  const report = await runCatalogPlacements(supabase, placementsLimit)
    .catch((e) => ({ ok: false, error: e?.message ?? String(e) }));

  return jr({
    ok: true,
    duration_ms: Date.now() - t0,
    rate_limit: { placements_per_min: placementsLimit },
    placements: report,
  });
});

// ============================================================================
// runCatalogPlacements — pipeline síncrono único.
// ============================================================================
async function runCatalogPlacements(sb: any, limit: number) {
  const workerId = `cat-exec-${crypto.randomUUID().slice(0, 8)}`;
  const t0 = Date.now();

  const { data: claimed, error: claimErr } = await sb.rpc(
    "claim_next_catalog_placements",
    { _worker: workerId, _limit: limit },
  );
  if (claimErr) return { ok: false, error: `claim_failed: ${claimErr.message}` };

  const rows: CPRow[] = (claimed ?? []).map((r: any) => ({
    id: r.id,
    catalog_track_id: r.catalog_track_id,
    managed_playlist_id: r.managed_playlist_id,
    position: r.position,
    attempts: r.attempts ?? 1,
    max_attempts: r.max_attempts ?? 5,
  }));

  if (rows.length === 0) {
    return { ok: true, worker_id: workerId, claimed: 0, duration_ms: Date.now() - t0 };
  }

  const trackIds = Array.from(new Set(rows.map((r) => r.catalog_track_id)));
  const playlistIds = Array.from(new Set(rows.map((r) => r.managed_playlist_id)));

  const [{ data: tracks, error: tErr }, { data: playlists, error: pErr }, { data: campaignsActive }] = await Promise.all([
    sb.from("catalog_tracks")
      .select("id, spotify_track_id, spotify_uri")
      .in("id", trackIds),
    sb.from("managed_playlists")
      .select("id, spotify_playlist_id, owner_spotify_user_id, tracks_count, operational_status, execution_mode")
      .in("id", playlistIds),
    sb.from("campaigns")
      .select("catalog_track_id")
      .in("catalog_track_id", trackIds)
      .eq("status", "active"),
  ]);

  if (tErr || pErr) {
    await sb.from("catalog_placements")
      .update({ status: "pending", locked_at: null, locked_by: null, lease_expires_at: null })
      .in("id", rows.map((r) => r.id));
    return { ok: false, error: `enrich_failed: ${tErr?.message ?? pErr?.message}` };
  }

  const tMap = new Map<string, any>();
  for (const t of tracks ?? []) tMap.set(t.id, t);
  const pMap = new Map<string, any>();
  for (const p of playlists ?? []) pMap.set(p.id, p);
  const activeCampaignTracks = new Set<string>();
  for (const c of campaignsActive ?? []) {
    if ((c as any).catalog_track_id) activeCampaignTracks.add((c as any).catalog_track_id);
  }

  const enriched: CPEnriched[] = [];
  let cntInvalid = 0;
  let cntPlaylistBlocked = 0;

  for (const r of rows) {
    const t = tMap.get(r.catalog_track_id);
    const p = pMap.get(r.managed_playlist_id);
    if (!t?.spotify_track_id || !p?.spotify_playlist_id) {
      cntInvalid++;
      await sb.from("catalog_placements").update({
        status: "blocked",
        skip_reason: "enrich_missing",
        skipped_at: new Date().toISOString(),
        last_error_code: "enrich_missing",
        removed_reason: "blocked: enrich_missing",
        locked_at: null, locked_by: null, lease_expires_at: null,
      }).eq("id", r.id);
      continue;
    }
    if (p.operational_status === "do_not_operate" || p.execution_mode === "MANUAL_ONLY" || p.execution_mode === "DISABLED") {
      cntPlaylistBlocked++;
      await sb.from("catalog_placements").update({
        status: "blocked",
        skip_reason: "playlist_not_operable",
        skipped_at: new Date().toISOString(),
        last_error_code: "playlist_not_operable",
        removed_reason: `blocked: playlist_not_operable (op=${p.operational_status} mode=${p.execution_mode})`,
        locked_at: null, locked_by: null, lease_expires_at: null,
      }).eq("id", r.id);
      continue;
    }
    enriched.push({
      ...r,
      spotify_playlist_id: p.spotify_playlist_id,
      owner_spotify_user_id: p.owner_spotify_user_id ?? null,
      tracks_count: typeof p.tracks_count === "number" ? p.tracks_count : null,
      spotify_track_id: t.spotify_track_id,
      spotify_uri: t.spotify_uri ?? null,
      is_campaign_active: activeCampaignTracks.has(r.catalog_track_id),
    });
  }


  // Caches por execução.
  const tokenCache = new Map<string, string>();
  async function tokenFor(ownerId: string | null): Promise<string> {
    const key = ownerId ?? "__default__";
    const cached = tokenCache.get(key);
    if (cached) return cached;
    if (!ownerId) {
      const tok = await getAppToken();
      tokenCache.set(key, tok);
      return tok;
    }
    const r = await getUserToken(ownerId);
    tokenCache.set(key, r.token);
    return r.token;
  }

  function classify(err: any): { kind: "retry" | "fatal" | "circuit" | "skip"; code: string; skipReason?: string; skipDelaySec?: number } {
    const status: number | null = typeof err?.status === "number" ? err.status : null;
    const name = err?.name as string | undefined;
    const msg = String(err?.message ?? err ?? "");
    const low = msg.toLowerCase();
    if (name === "SpotifyCircuitOpenError") return { kind: "circuit", code: "spotify_circuit_open" };
    if (name === "SpotifyAuthInvalidError") return { kind: "skip", code: "spotify_auth_invalid", skipReason: "owner_token_invalid", skipDelaySec: 3600 };
    if (low.includes("nenhuma conta spotify") || low.includes("no spotify account") || low.includes("no refresh token")) {
      return { kind: "skip", code: "owner_token_missing", skipReason: "blocked_owner_token", skipDelaySec: 6 * 3600 };
    }
    if (low.includes("spotify refresh ") || low.includes("invalid_grant")) {
      return { kind: "skip", code: "spotify_refresh_failed", skipReason: "owner_token_invalid", skipDelaySec: 3600 };
    }
    if (status === 429) return { kind: "retry", code: "spotify_429" };
    if (status != null && status >= 500 && status < 600) return { kind: "retry", code: `spotify_${status}` };
    if (status === 400 && low.includes("index out of bounds")) {
      return { kind: "skip", code: "spotify_position_oob", skipReason: "position_out_of_bounds", skipDelaySec: 300 };
    }
    if (status === 400) return { kind: "fatal", code: "spotify_400" };
    if (status === 401) return { kind: "skip", code: "spotify_401", skipReason: "owner_token_invalid", skipDelaySec: 1800 };
    if (status === 403) return { kind: "skip", code: "spotify_403", skipReason: "owner_forbidden", skipDelaySec: 3600 };
    if (status === 404) return { kind: "skip", code: "spotify_404", skipReason: "playlist_unavailable", skipDelaySec: 6 * 3600 };
    if (low.includes("timeout") || low.includes("network") || low.includes("fetch failed")) return { kind: "retry", code: "network_error" };
    return { kind: "fatal", code: status ? `spotify_${status}` : "exception" };
  }

  let cntActive = 0, cntRetry = 0, cntFailed = 0, cntSkipped = 0;
  let cntDecisionSkip = 0, cntRemoveInsert = 0, cntInsertOnly = 0;
  let cntCircuit = 0, cntBlocked = 0, cntSpotify = 0;

  const PERMANENT_ERROR_CODES = new Set([
    "owner_token_missing",
    "spotify_401",
    "spotify_auth_invalid",
    "spotify_refresh_failed",
    "blocked_owner_token",
  ]);

  // Mapeia reasons da fn_decide_placement_action em (recoverable, delaySec)
  function decisionSkipMeta(reason: string): { permanent: boolean; delaySec: number; statusReason: string } {
    if (reason === "already_present") return { permanent: false, delaySec: 0, statusReason: "already_present" };
    if (reason === "no_oauth_token") return { permanent: true, delaySec: 6 * 3600, statusReason: "blocked_owner_token" };
    if (reason === "circuit_open") return { permanent: false, delaySec: 15 * 60, statusReason: "waiting_circuit_breaker" };
    if (reason === "manual_only" || reason === "disabled" || reason === "do_not_operate" || reason === "archived" || reason === "no_spotify_id")
      return { permanent: true, delaySec: 24 * 3600, statusReason: "playlist_not_operable" };
    if (reason === "no_capacity_no_victim") return { permanent: false, delaySec: 6 * 3600, statusReason: "no_capacity" };
    if (reason === "no_track_id") return { permanent: true, delaySec: 24 * 3600, statusReason: "no_track_id" };
    return { permanent: false, delaySec: 1800, statusReason: reason };
  }

  async function logExec(p: CPEnriched, outcome: string, code: string | null, snapId: string | null, msg: string | null) {
    await sb.from("catalog_placement_execution_log").insert({
      placement_id: p.id,
      catalog_track_id: p.catalog_track_id,
      managed_playlist_id: p.managed_playlist_id,
      spotify_playlist_id: p.spotify_playlist_id,
      spotify_track_id: p.spotify_track_id,
      position: p.position,
      outcome,
      error_code: code,
      error_message: _trim(msg),
      snapshot_id: snapId,
    });
  }

  async function markActive(p: CPEnriched, source: string, snap: string | null) {
    await sb.from("catalog_placements").update({
      status: "active",
      added_at: new Date().toISOString(),
      last_error_code: null,
      locked_at: null, locked_by: null, lease_expires_at: null,
    }).eq("id", p.id);
    await logExec(p, source === "already_present" ? "already_present" : "active", null, snap, `source=${source}`);
    cntActive++;
  }

  async function markRetry(p: CPEnriched, code: string, msg: string | null) {
    if (p.attempts >= p.max_attempts) {
      await markFailed(p, code, msg ?? "max_attempts_reached");
      return;
    }
    const sec = backoffSecondsForAttempt(p.attempts);
    await sb.from("catalog_placements").update({
      status: "retry",
      scheduled_for: new Date(Date.now() + sec * 1000).toISOString(),
      last_error_code: code,
      locked_at: null, locked_by: null, lease_expires_at: null,
    }).eq("id", p.id);
    await logExec(p, "skipped", code, null, `retry in ${sec}s: ${msg ?? ""}`);
    cntRetry++;
  }

  async function markFailed(p: CPEnriched, code: string, msg: string | null) {
    await sb.from("catalog_placements").update({
      status: "failed",
      last_error_code: code,
      removed_reason: _trim(`${code}: ${msg ?? ""}`),
      locked_at: null, locked_by: null, lease_expires_at: null,
    }).eq("id", p.id);
    await logExec(p, "failed", code, null, msg);
    cntFailed++;
  }

  async function markBlocked(p: CPEnriched, code: string, reason: string, msg: string | null) {
    cntBlocked++;
    await sb.from("catalog_placements").update({
      status: "blocked",
      skip_reason: reason,
      skipped_at: new Date().toISOString(),
      last_error_code: code,
      removed_reason: _trim(`blocked after ${p.attempts}/${p.max_attempts} attempts: ${code} ${msg ?? ""}`),
      locked_at: null, locked_by: null, lease_expires_at: null,
    }).eq("id", p.id);
    await logExec(p, "failed", code, null, `BLOCKED reason=${reason} attempts=${p.attempts}/${p.max_attempts} ${msg ?? ""}`);
  }

  async function markSkipped(p: CPEnriched, code: string, reason: string, delaySec: number, msg: string | null) {
    const isPermanent = PERMANENT_ERROR_CODES.has(code);
    if (isPermanent) {
      const nextAttempts = (p.attempts ?? 1) + 1;
      if (nextAttempts >= p.max_attempts) {
        await markBlocked(p, code, reason, msg);
        return;
      }
      cntSkipped++;
      await sb.from("catalog_placements").update({
        status: "skipped",
        skip_reason: reason,
        skipped_at: new Date().toISOString(),
        scheduled_for: new Date(Date.now() + Math.max(60, delaySec) * 1000).toISOString(),
        last_error_code: code,
        attempts: nextAttempts,
        locked_at: null, locked_by: null, lease_expires_at: null,
      }).eq("id", p.id);
      await logExec(p, "skipped", code, null, `permanent reason=${reason} attempts=${nextAttempts}/${p.max_attempts} ${msg ?? ""}`);
      return;
    }
    cntSkipped++;
    await sb.from("catalog_placements").update({
      status: "skipped",
      skip_reason: reason,
      skipped_at: new Date().toISOString(),
      scheduled_for: new Date(Date.now() + Math.max(60, delaySec) * 1000).toISOString(),
      last_error_code: code,
      attempts: Math.max(0, (p.attempts ?? 1) - 1),
      locked_at: null, locked_by: null, lease_expires_at: null,
    }).eq("id", p.id);
    await logExec(p, "skipped", code, null, `reason=${reason} ${msg ?? ""}`);
  }

  async function markWaitingCircuit(p: CPEnriched, blockedUntil: string | null) {
    cntCircuit++;
    const resumeAt = blockedUntil ?? new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await sb.from("catalog_placements").update({
      status: "waiting_circuit_breaker",
      scheduled_for: resumeAt,
      last_error_code: "circuit_breaker_open",
      locked_at: null, locked_by: null, lease_expires_at: null,
    }).eq("id", p.id);
    await logExec(p, "skipped", "waiting_circuit_breaker", null, `blocked_until=${blockedUntil ?? "n/a"} resume_at=${resumeAt}`);
  }

  async function persistLocalInsert(playlistId: string, trackId: string) {
    // Refatoração definitiva (28/06/2026): grava linha CANÔNICA em
    // managed_playlist_tracks no mesmo formato do sync (track_name,
    // artist_name, album_cover, position, added_at, duration_ms, isrc).
    // Invalida tracks_hash da playlist para o próximo sync reconciliar.
    await mptInsertFromCatalog(sb, {
      playlist_id: playlistId,
      spotify_track_id: trackId,
    });
  }

  async function persistLocalRemove(playlistId: string, trackId: string) {
    await mptRemoveFromCatalog(sb, {
      playlist_id: playlistId,
      spotify_track_id: trackId,
    });
  }

  for (const p of enriched) {
    try {
      // === DECISÃO SÍNCRONA =================================================
      const { data: decisionData, error: decErr } = await sb.rpc(
        "fn_decide_placement_action",
        { p_placement_id: p.id },
      );
      if (decErr) {
        await markRetry(p, "decision_rpc_failed", decErr.message);
        continue;
      }
      const decision = (decisionData ?? { action: "SKIP", reason: "decision_null" }) as Decision;

      if (decision.action === "SKIP") {
        cntDecisionSkip++;
        const meta = decisionSkipMeta(decision.reason);
        if (decision.reason === "already_present") {
          await markActive(p, "already_present", null);
          continue;
        }
        if (decision.reason === "circuit_open") {
          await markWaitingCircuit(p, null);
          continue;
        }
        const code = `decision_${decision.reason}`;
        if (meta.permanent) {
          // Tratamento permanente reusa pipeline de skipped+attempts++
          const nextAttempts = (p.attempts ?? 1) + 1;
          if (nextAttempts >= p.max_attempts) {
            await markBlocked(p, code, meta.statusReason, decision.reason);
            continue;
          }
          await sb.from("catalog_placements").update({
            status: "skipped",
            skip_reason: meta.statusReason,
            skipped_at: new Date().toISOString(),
            scheduled_for: new Date(Date.now() + meta.delaySec * 1000).toISOString(),
            last_error_code: code,
            attempts: nextAttempts,
            locked_at: null, locked_by: null, lease_expires_at: null,
          }).eq("id", p.id);
          await logExec(p, "skipped", code, null, `decision permanent ${decision.reason}`);
          cntSkipped++;
        } else {
          await sb.from("catalog_placements").update({
            status: "skipped",
            skip_reason: meta.statusReason,
            skipped_at: new Date().toISOString(),
            scheduled_for: new Date(Date.now() + Math.max(60, meta.delaySec) * 1000).toISOString(),
            last_error_code: code,
            locked_at: null, locked_by: null, lease_expires_at: null,
          }).eq("id", p.id);
          await logExec(p, "skipped", code, null, `decision transient ${decision.reason}`);
          cntSkipped++;
        }
        continue;
      }

      // Token (necessário para INSERT e REMOVE_INSERT)
      setSpotifyCtx({
        appId: null,
        playlist_id: p.managed_playlist_id,
        owner_id: p.owner_spotify_user_id,
        spotify_user_id: p.owner_spotify_user_id,
        function_name: "catalog-executor",
      });
      const token = await tokenFor(p.owner_spotify_user_id);
      const uri = p.spotify_uri ?? `spotify:track:${p.spotify_track_id}`;

      if (decision.action === "REMOVE_INSERT") {
        cntRemoveInsert++;
        const victimUri = toUri(decision.remove_track_id);
        try {
          await removePlaylistTracks(p.spotify_playlist_id, [victimUri], token);
          await persistLocalRemove(p.managed_playlist_id, decision.remove_track_id);
        } catch (e: any) {
          // Falha na remoção: aborta e deixa o placement reciclar.
          await markRetry(p, "remove_failed", e?.message ?? String(e));
          continue;
        }
        // Em seguida, INSERT (cai no caminho comum abaixo)
      } else {
        cntInsertOnly++;
      }

      const addRes = await addPlaylistTracks(p.spotify_playlist_id, [uri], token, {});
      cntSpotify++;
      await persistLocalInsert(p.managed_playlist_id, p.spotify_track_id);
      await markActive(p, decision.action === "REMOVE_INSERT" ? "remove_insert" : "insert", addRes.snapshot_id ?? null);
    } catch (e: any) {
      const cls = classify(e);
      const msg = _trim(e?.message ?? String(e));
      if (cls.kind === "circuit") {
        await markWaitingCircuit(p, null);
      } else if (cls.kind === "retry") {
        await markRetry(p, cls.code, msg);
      } else if (cls.kind === "skip") {
        await markSkipped(p, cls.code, cls.skipReason ?? "recoverable", cls.skipDelaySec ?? 1800, msg);
        if ((cls.code === "spotify_401" || cls.code === "spotify_auth_invalid") && p.owner_spotify_user_id) {
          tokenCache.delete(p.owner_spotify_user_id);
        }
      } else {
        await markFailed(p, cls.code, msg);
      }
    }
  }

  return {
    ok: true,
    worker_id: workerId,
    claimed: rows.length,
    invalid: cntInvalid,
    playlist_blocked: cntPlaylistBlocked,
    active: cntActive,
    decision_skip: cntDecisionSkip,
    insert_only: cntInsertOnly,
    remove_insert: cntRemoveInsert,
    retry: cntRetry,
    failed: cntFailed,
    skipped: cntSkipped,
    blocked: cntBlocked,
    waiting_circuit_breaker: cntCircuit,
    spotify_calls: cntSpotify,
    duration_ms: Date.now() - t0,
  };
}
