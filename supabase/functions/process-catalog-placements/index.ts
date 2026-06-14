// process-catalog-placements — Worker definitivo da fila do catálogo.
//
// Passo 3: migração total para claim atômico via SQL.
//
// Fluxo:
//   1) claim_next_catalog_placements(worker_id, limit) — SKIP LOCKED + lease 2min.
//   2) enrich (managed_playlists.spotify_playlist_id/owner + catalog_tracks.spotify_*).
//   3) addPlaylistTracks → reconsulta playlist → confirmação.
//   4) sucesso → status='active'; retry transitório → status='retry' +
//      scheduled_for=now()+backoff; fatal → status='failed'.
//   5) sempre limpa locked_at/locked_by/lease_expires_at e grava last_error_code.
//   6) sempre escreve catalog_placement_execution_log.
//
// Body opcional: { limit?: number }  (default 200, máx 500 — bate com claim cap)
//
// Não usa mais SELECT direto em catalog_placements WHERE status='pending'.
// Nada fora do claim é processado. Ordenação (priority/scheduled_for/created_at)
// é responsabilidade exclusiva do SQL.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  addPlaylistTracks,
  findPlaylistTrackIndex,
  listPlaylistTrackRefs,
  type PlaylistTrackRef,
} from "../_shared/spotify-playlist.ts";
import { getUserToken } from "../_shared/spotify-client.ts";
import { backoffSecondsForAttempt } from "../_shared/playlist-queue.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function trim(s: string | null | undefined, max = 480): string | null {
  if (s == null) return null;
  const str = String(s);
  return str.length > max ? str.slice(0, max) : str;
}

type ClaimedRow = {
  id: string;
  catalog_track_id: string;
  managed_playlist_id: string;
  position: number | null;
  attempts: number;
  max_attempts: number;
};

type Enriched = ClaimedRow & {
  spotify_playlist_id: string;
  owner_spotify_user_id: string | null;
  spotify_track_id: string;
  spotify_uri: string | null;
};

type Outcome = "active" | "already_present" | "retry" | "failed";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ ok: false, error: "method_not_allowed" }, 405);

  const startedAt = Date.now();
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body allowed */ }
  const rawLimit = Number(body?.limit ?? 200);
  const limit = Number.isFinite(rawLimit) ? Math.min(500, Math.max(1, Math.floor(rawLimit))) : 200;

  const workerId = `proc-cat-${crypto.randomUUID().slice(0, 8)}`;

  // 1) Claim atômico
  const { data: claimed, error: claimErr } = await sb.rpc(
    "claim_next_catalog_placements",
    { _worker: workerId, _limit: limit },
  );
  if (claimErr) {
    return jr({ ok: false, error: "claim_failed", message: claimErr.message }, 500);
  }

  const claimedRows: ClaimedRow[] = (claimed ?? []).map((r: any) => ({
    id: r.id,
    catalog_track_id: r.catalog_track_id,
    managed_playlist_id: r.managed_playlist_id,
    position: r.position,
    attempts: r.attempts ?? 1,
    max_attempts: r.max_attempts ?? 5,
  }));

  if (claimedRows.length === 0) {
    return jr({
      ok: true,
      worker_id: workerId,
      claimed: 0,
      processed: 0,
      active: 0,
      already_present: 0,
      retry: 0,
      failed: 0,
      circuit_open: 0,
      duration_ms: Date.now() - startedAt,
    });
  }

  // 2) Enrich — busca playlists + tracks em duas queries IN (sem N+1).
  const trackIds = Array.from(new Set(claimedRows.map((r) => r.catalog_track_id)));
  const playlistIds = Array.from(new Set(claimedRows.map((r) => r.managed_playlist_id)));

  const [{ data: tracks, error: trackErr }, { data: playlists, error: plErr }] = await Promise.all([
    sb.from("catalog_tracks")
      .select("id, spotify_track_id, spotify_uri, track_name")
      .in("id", trackIds),
    sb.from("managed_playlists")
      .select("id, spotify_playlist_id, owner_spotify_user_id")
      .in("id", playlistIds),
  ]);
  if (trackErr || plErr) {
    // Não conseguimos enriquecer — devolve o claim pra fila pra próxima rodada.
    await sb.from("catalog_placements")
      .update({ status: "pending", locked_at: null, locked_by: null, lease_expires_at: null })
      .in("id", claimedRows.map((r) => r.id));
    return jr({
      ok: false,
      error: "enrich_failed",
      message: trackErr?.message ?? plErr?.message,
    }, 500);
  }

  const trackMap = new Map<string, any>();
  for (const t of tracks ?? []) trackMap.set(t.id, t);
  const plMap = new Map<string, any>();
  for (const p of playlists ?? []) plMap.set(p.id, p);

  const enriched: Enriched[] = [];
  const invalid: ClaimedRow[] = [];
  for (const r of claimedRows) {
    const t = trackMap.get(r.catalog_track_id);
    const p = plMap.get(r.managed_playlist_id);
    if (!t?.spotify_track_id || !p?.spotify_playlist_id) {
      invalid.push(r);
      continue;
    }
    enriched.push({
      ...r,
      spotify_playlist_id: p.spotify_playlist_id,
      owner_spotify_user_id: p.owner_spotify_user_id ?? null,
      spotify_track_id: t.spotify_track_id,
      spotify_uri: t.spotify_uri ?? null,
    });
  }

  // Inválidos (sem track/playlist no banco) → fatal direto.
  for (const r of invalid) {
    await sb.from("catalog_placements").update({
      status: "failed",
      last_error_code: "enrich_missing",
      removed_reason: "managed_playlist ou catalog_track ausente no enrich",
      locked_at: null, locked_by: null, lease_expires_at: null,
    }).eq("id", r.id);
    await sb.from("catalog_placement_execution_log").insert({
      placement_id: r.id,
      catalog_track_id: r.catalog_track_id,
      managed_playlist_id: r.managed_playlist_id,
      outcome: "failed",
      error_code: "enrich_missing",
      error_message: "managed_playlist ou catalog_track ausente",
    });
  }

  // Token cache por owner (refresh sob demanda em 401).
  const tokenCache = new Map<string, string>();
  async function tokenFor(ownerId: string | null): Promise<string> {
    const key = ownerId ?? "__default__";
    const cached = tokenCache.get(key);
    if (cached) return cached;
    const r = await getUserToken(ownerId ?? undefined);
    tokenCache.set(key, r.token);
    return r.token;
  }

  // Refs cache por playlist na MESMA execução.
  const refsCache = new Map<string, PlaylistTrackRef[]>();
  async function getRefs(playlistId: string, token: string, force = false): Promise<PlaylistTrackRef[]> {
    if (!force) {
      const cached = refsCache.get(playlistId);
      if (cached) return cached;
    }
    const refs = await listPlaylistTrackRefs(playlistId, token);
    refsCache.set(playlistId, refs);
    return refs;
  }

  let cntActive = 0;
  let cntAlready = 0;
  let cntRetry = 0;
  let cntFailed = invalid.length;
  let cntCircuit = 0;

  // Classifica erro como retry transitório ou fatal definitivo.
  function classify(err: any): { kind: "retry" | "fatal"; code: string } {
    const status: number | null = typeof err?.status === "number" ? err.status : null;
    const name = err?.name as string | undefined;
    if (name === "SpotifyCircuitOpenError") return { kind: "retry", code: "spotify_circuit_open" };
    if (name === "SpotifyAuthInvalidError") return { kind: "fatal", code: "spotify_auth_invalid" };
    if (status === 429) return { kind: "retry", code: "spotify_429" };
    if (status != null && status >= 500 && status < 600) return { kind: "retry", code: `spotify_${status}` };
    if (status === 400) return { kind: "fatal", code: "spotify_400" };
    if (status === 401) return { kind: "fatal", code: "spotify_401" };
    if (status === 403) return { kind: "fatal", code: "spotify_403" };
    if (status === 404) return { kind: "fatal", code: "spotify_404" };
    const msg = String(err?.message ?? err ?? "").toLowerCase();
    if (msg.includes("timeout") || msg.includes("network") || msg.includes("fetch failed")) {
      return { kind: "retry", code: "network_error" };
    }
    return { kind: "fatal", code: status ? `spotify_${status}` : "exception" };
  }

  async function markRetry(p: Enriched, code: string, msg: string | null, snapshotId: string | null = null) {
    const isCircuit = code === "spotify_circuit_open";
    if (isCircuit) cntCircuit++;
    // Se já bateu max_attempts, vira fatal.
    if (p.attempts >= p.max_attempts) {
      await markFailed(p, code, msg ?? "max_attempts_reached", snapshotId);
      return;
    }
    const backoffSec = backoffSecondsForAttempt(p.attempts);
    const scheduledFor = new Date(Date.now() + backoffSec * 1000).toISOString();
    await sb.from("catalog_placements").update({
      status: "retry",
      scheduled_for: scheduledFor,
      last_error_code: code,
      locked_at: null, locked_by: null, lease_expires_at: null,
    }).eq("id", p.id);
    await sb.from("catalog_placement_execution_log").insert({
      placement_id: p.id,
      catalog_track_id: p.catalog_track_id,
      managed_playlist_id: p.managed_playlist_id,
      spotify_playlist_id: p.spotify_playlist_id,
      spotify_track_id: p.spotify_track_id,
      position: p.position,
      outcome: "skipped",
      error_code: code,
      error_message: trim(`retry in ${backoffSec}s: ${msg ?? ""}`),
      snapshot_id: snapshotId,
    });
    cntRetry++;
  }

  async function markFailed(p: Enriched, code: string, msg: string | null, snapshotId: string | null = null) {
    await sb.from("catalog_placements").update({
      status: "failed",
      last_error_code: code,
      removed_reason: trim(`${code}: ${msg ?? ""}`),
      locked_at: null, locked_by: null, lease_expires_at: null,
    }).eq("id", p.id);
    await sb.from("catalog_placement_execution_log").insert({
      placement_id: p.id,
      catalog_track_id: p.catalog_track_id,
      managed_playlist_id: p.managed_playlist_id,
      spotify_playlist_id: p.spotify_playlist_id,
      spotify_track_id: p.spotify_track_id,
      position: p.position,
      outcome: "failed",
      error_code: code,
      error_message: trim(msg),
      snapshot_id: snapshotId,
    });
    cntFailed++;
  }

  async function markActive(p: Enriched, outcome: Outcome, snapshotId: string | null = null) {
    await sb.from("catalog_placements").update({
      status: "active",
      added_at: new Date().toISOString(),
      last_error_code: null,
      locked_at: null, locked_by: null, lease_expires_at: null,
    }).eq("id", p.id);
    await sb.from("catalog_placement_execution_log").insert({
      placement_id: p.id,
      catalog_track_id: p.catalog_track_id,
      managed_playlist_id: p.managed_playlist_id,
      spotify_playlist_id: p.spotify_playlist_id,
      spotify_track_id: p.spotify_track_id,
      position: p.position,
      outcome,
      snapshot_id: snapshotId,
    });
    if (outcome === "already_present") cntAlready++;
    else cntActive++;
  }

  // 3) Loop principal — processa só linhas claimadas por este worker.
  for (const p of enriched) {
    const uri = p.spotify_uri ?? `spotify:track:${p.spotify_track_id}`;
    try {
      const token = await tokenFor(p.owner_spotify_user_id);

      // Anti-duplicidade pré-POST
      let refs = await getRefs(p.spotify_playlist_id, token);
      if (findPlaylistTrackIndex(refs, p.spotify_track_id) >= 0) {
        await markActive(p, "already_present");
        continue;
      }

      // Insere clampando posição em refs.length (evita 400 "Index out of bounds")
      const insertOpts: { position?: number } = {};
      if (typeof p.position === "number" && p.position >= 0) {
        insertOpts.position = Math.min(p.position, refs.length);
      }
      const addRes = await addPlaylistTracks(p.spotify_playlist_id, [uri], token, insertOpts);

      // Confirmação obrigatória
      refs = await getRefs(p.spotify_playlist_id, token, true);
      if (findPlaylistTrackIndex(refs, p.spotify_track_id) < 0) {
        // ghost_add — Spotify aceitou mas faixa não apareceu.
        // Primeira ocorrência vira retry; persistente (max_attempts) vira fatal via markRetry.
        await markRetry(p, "ghost_add", "POST aceito mas faixa não apareceu na reconsulta", addRes.snapshot_id ?? null);
        continue;
      }

      await markActive(p, "active", addRes.snapshot_id ?? null);
    } catch (e: any) {
      const { kind, code } = classify(e);
      const msg = trim(e?.message ?? String(e));

      if (kind === "retry") {
        await markRetry(p, code, msg);
      } else {
        await markFailed(p, code, msg);
        // 401 → derruba cache pra próximo refresh.
        if (code === "spotify_401" && p.owner_spotify_user_id) {
          tokenCache.delete(p.owner_spotify_user_id);
        }
      }
    }
  }

  const processed = enriched.length + invalid.length;
  return jr({
    ok: true,
    worker_id: workerId,
    claimed: claimedRows.length,
    processed,
    active: cntActive,
    already_present: cntAlready,
    retry: cntRetry,
    failed: cntFailed,
    circuit_open: cntCircuit,
    duration_ms: Date.now() - startedAt,
  });
});
