// spotify-pipeline-audit — Auditoria end-to-end do pipeline ADD_TRACK.
//
// Executa EXATAMENTE o caminho de produção:
//   1. INSERT em playlist_execution_jobs (job_type=playlist.track.add)
//   2. Invoca bot-execution-queue (service-role) — ele claima, chama addPlaylistTracks → POST /items
//   3. Lê o job final (status, last_error, completed_at)
//   4. Lê a playlist no Spotify (listPlaylistTrackUris) — confirma se a faixa entrou
//
// Body: { managed_playlist_id: uuid, spotify_track_id: string (22 chars), cleanup?: boolean }
// Auth: service-role bearer (Lovable preview injeta automaticamente).
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getUserToken, forceRefreshUserToken } from "../_shared/spotify-client.ts";
import { listPlaylistTrackUris, removePlaylistTracks, SpotifyApiError } from "../_shared/spotify-playlist.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function listUrisSafe(playlistId: string, ownerId: string): Promise<{ uris: string[]; via: string; error?: string }> {
  try {
    const { token } = await getUserToken(ownerId);
    try {
      const uris = await listPlaylistTrackUris(playlistId, token);
      return { uris, via: "owner_token" };
    } catch (e) {
      if (e instanceof SpotifyApiError && e.status === 401) {
        const refreshed = await forceRefreshUserToken(ownerId);
        const uris = await listPlaylistTrackUris(playlistId, refreshed.token);
        return { uris, via: "owner_token_refreshed" };
      }
      throw e;
    }
  } catch (e) {
    return { uris: [], via: "failed", error: (e as Error).message };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const body = await req.json().catch(() => ({}));
  const managedId: string = body?.managed_playlist_id;
  const trackId: string = body?.spotify_track_id;
  const cleanup: boolean = body?.cleanup !== false; // default true: remove a faixa no final
  if (!managedId || !trackId) {
    return jr({ ok: false, error: "managed_playlist_id e spotify_track_id são obrigatórios" }, 400);
  }

  const evidence: any = {
    started_at: new Date().toISOString(),
    input: { managed_playlist_id: managedId, spotify_track_id: trackId, cleanup },
    steps: {},
  };

  // ---------- 0) Resolve playlist + owner ----------
  const { data: mp, error: mpErr } = await sb
    .from("managed_playlists")
    .select("id, spotify_playlist_id, owner_spotify_user_id, name")
    .eq("id", managedId)
    .maybeSingle();
  if (mpErr || !mp?.spotify_playlist_id || !mp?.owner_spotify_user_id) {
    return jr({ ok: false, error: "managed_playlist inválida (sem spotify_playlist_id ou owner)", mp, mpErr }, 404);
  }
  evidence.steps["0_lookup"] = {
    managed_playlist_id: mp.id,
    spotify_playlist_id: mp.spotify_playlist_id,
    owner_spotify_user_id: mp.owner_spotify_user_id,
    name: mp.name,
  };

  // Resolve playlists.id canônico (FK do job)
  const { data: canon } = await sb
    .from("playlists")
    .select("id")
    .eq("spotify_playlist_id", mp.spotify_playlist_id)
    .maybeSingle();
  const canonicalPlaylistId = canon?.id ?? null;
  evidence.steps["0_lookup"].canonical_playlist_id = canonicalPlaylistId;

  const trackUri = `spotify:track:${trackId}`;

  // ---------- 1) Snapshot inicial da playlist ----------
  const before = await listUrisSafe(mp.spotify_playlist_id, mp.owner_spotify_user_id);
  evidence.steps["1_playlist_before"] = {
    total: before.uris.length,
    contains_target: before.uris.includes(trackUri),
    via: before.via,
    error: before.error ?? null,
    last_5_uris: before.uris.slice(-5),
  };

  if (before.error) {
    return jr({ ok: false, stage: "playlist_before", evidence }, 502);
  }
  if (before.uris.includes(trackUri)) {
    return jr({ ok: false, error: "faixa já está na playlist — escolha outra para auditoria limpa", evidence }, 409);
  }

  // ---------- 2) INSERT job ADD ----------
  const bucket = Math.floor(Date.now() / 5000);
  const dedupeKey = `add:${mp.spotify_playlist_id}:${trackId}:pipeline-audit:b${bucket}:${crypto.randomUUID().slice(0,8)}`;
  const { data: insertedJob, error: insErr } = await sb
    .from("playlist_execution_jobs")
    .insert({
      job_type: "playlist.track.add",
      playlist_id: canonicalPlaylistId,
      spotify_playlist_id: mp.spotify_playlist_id,
      spotify_track_id: trackId,
      dedupe_key: dedupeKey,
      status: "pending",
      metadata: { source: "spotify-pipeline-audit" },
    })
    .select("id, job_type, status, created_at, scheduled_for")
    .single();
  if (insErr || !insertedJob) {
    return jr({ ok: false, stage: "insert_job", error: insErr?.message ?? "insert falhou", evidence }, 500);
  }
  evidence.steps["2_job_inserted"] = insertedJob;

  // ---------- 3) Invoca bot-execution-queue (service-role) ----------
  const queueStart = Date.now();
  let queueResp: Response;
  try {
    queueResp = await fetch(`${SUPABASE_URL}/functions/v1/bot-execution-queue?limit=10`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
      },
    });
  } catch (e) {
    return jr({ ok: false, stage: "invoke_queue", error: (e as Error).message, evidence }, 500);
  }
  const queueText = await queueResp.text();
  evidence.steps["3_queue_invoked"] = {
    http_status: queueResp.status,
    duration_ms: Date.now() - queueStart,
    body_preview: queueText.slice(0, 500),
  };

  // ---------- 4) Poll status do job ----------
  let finalJob: any = null;
  for (let i = 0; i < 15; i++) {
    await sleep(800);
    const { data: j } = await sb
      .from("playlist_execution_jobs")
      .select("id, status, attempts, max_attempts, last_error, completed_at, claimed_at, claimed_by, lease_expires_at, scheduled_for")
      .eq("id", insertedJob.id)
      .maybeSingle();
    finalJob = j;
    if (j && (j.status === "done" || j.status === "failed")) break;
  }
  evidence.steps["4_job_final"] = finalJob;

  // ---------- 5) Snapshot final da playlist ----------
  const after = await listUrisSafe(mp.spotify_playlist_id, mp.owner_spotify_user_id);
  evidence.steps["5_playlist_after"] = {
    total: after.uris.length,
    contains_target: after.uris.includes(trackUri),
    target_position_1indexed: after.uris.indexOf(trackUri) === -1 ? null : after.uris.indexOf(trackUri) + 1,
    via: after.via,
    error: after.error ?? null,
    last_5_uris: after.uris.slice(-5),
  };

  // ---------- 6) Veredito ----------
  const jobDone = finalJob?.status === "done";
  const trackPresent = after.uris.includes(trackUri);
  let verdict: string;
  if (jobDone && trackPresent) verdict = "PIPELINE_OK";
  else if (jobDone && !trackPresent) verdict = "JOB_DONE_BUT_TRACK_MISSING";
  else if (!jobDone && trackPresent) verdict = "TRACK_ADDED_BUT_JOB_NOT_DONE";
  else if (finalJob?.status === "failed") verdict = "JOB_FAILED";
  else if (finalJob?.status === "pending" || finalJob?.status === "claimed") verdict = "JOB_STUCK";
  else verdict = "UNKNOWN";
  evidence.verdict = verdict;

  // ---------- 7) Cleanup opcional ----------
  if (cleanup && trackPresent) {
    try {
      const { token } = await getUserToken(mp.owner_spotify_user_id);
      const r = await removePlaylistTracks(mp.spotify_playlist_id, [trackUri], token);
      evidence.cleanup = { ok: true, snapshot_id: r.snapshot_id };
    } catch (e) {
      evidence.cleanup = { ok: false, error: (e as Error).message };
    }
  } else {
    evidence.cleanup = { ok: false, reason: cleanup ? "track_not_present" : "disabled" };
  }

  evidence.finished_at = new Date().toISOString();
  return jr({ ok: verdict === "PIPELINE_OK", ...evidence });
});
