// bot-execution-queue — Devolve fila de execução (add/remove track em playlist).
// Jobs do tipo `playlist.track.reorder` são executados INLINE aqui (chamando
// a Web API do Spotify via reorderPlaylistTracks) e NÃO são entregues ao bot.
// Auth: header x-bot-key (compara com env BOT_API_KEY).
// GET ?limit=3
import { createClient } from "npm:@supabase/supabase-js@2";
import { reportCronHealth } from "../_shared/cron-health.ts";
import { reorderPlaylistTracks, listPlaylistTrackUris, addPlaylistTracks, removePlaylistTracks } from "../_shared/spotify-playlist.ts";
import { getSpotifyToken, getUserAccessToken } from "../_shared/spotify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "content-type, x-bot-key, x-worker-id, x-process-id, x-hostname, x-timer-id, x-bot-name, x-bot-session",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_API_KEY = Deno.env.get("BOT_API_KEY")!;

const LEASE_MS = 5 * 60 * 1000;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();
  if (req.headers.get("x-bot-key") !== BOT_API_KEY) return jr({ error: "unauthorized" }, 401);

  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "3"), 1), 10);

  const workerId = req.headers.get("x-worker-id") || "unknown";
  const processId = req.headers.get("x-process-id") || null;
  const hostname = req.headers.get("x-hostname") || null;
  const timerId = req.headers.get("x-timer-id") || null;
  const botName = req.headers.get("x-bot-name") || "spotify-artists-bot";
  const session = req.headers.get("x-bot-session") || null;

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Recovery: jobs claimed com lease vencido voltam pra pending
  const nowIso = new Date().toISOString();
  await supabase
    .from("playlist_execution_jobs")
    .update({ status: "pending", claimed_by: null, claimed_at: null, lease_expires_at: null })
    .eq("status", "claimed")
    .lt("lease_expires_at", nowIso);

  const lease = new Date(Date.now() + LEASE_MS).toISOString();

  // ============= 1) REORDER: executa inline e marca done/failed antes do dispatch =============
  const { data: reorderJobs } = await supabase
    .from("playlist_execution_jobs")
    .select("id, playlist_id, spotify_playlist_id, spotify_track_id, from_position, to_position, attempts, max_attempts")
    .eq("status", "pending")
    .eq("job_type", "playlist.track.reorder")
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(10);

  let reorderDone = 0, reorderFailed = 0;
  for (const j of (reorderJobs ?? []) as any[]) {
    // claim
    const { data: claimedRow } = await supabase
      .from("playlist_execution_jobs")
      .update({ status: "claimed", claimed_by: workerId, claimed_at: nowIso, lease_expires_at: lease, attempts: (j.attempts ?? 0) + 1 })
      .eq("id", j.id).eq("status", "pending")
      .select("id").maybeSingle();
    if (!claimedRow) continue;

    try {
      // Owner = fonte de verdade em managed_playlists (sem chamada extra ao Spotify)
      const { data: mp, error: mpErr } = await supabase
        .from("managed_playlists")
        .select("owner_spotify_user_id")
        .eq("spotify_playlist_id", j.spotify_playlist_id)
        .maybeSingle();
      if (mpErr) throw new Error(`lookup managed_playlists falhou: ${mpErr.message}`);
      const ownerId = mp?.owner_spotify_user_id ?? null;
      if (!ownerId) throw new Error("owner_spotify_user_id não encontrado em managed_playlists");

      const { token } = await getUserAccessToken(ownerId);

      // listing usa app token (read-only, sem filtro de mercado por usuário)
      const appToken = await getSpotifyToken();
      const uris = await listPlaylistTrackUris(j.spotify_playlist_id, appToken);
      const total = uris.length;
      console.log(JSON.stringify({
        evt: "reorder.attempt",
        job_id: j.id,
        spotify_playlist_id: j.spotify_playlist_id,
        owner_id: ownerId,
        total,
        from: j.from_position,
        to: j.to_position,
        attempt: (j.attempts ?? 0) + 1,
      }));
      const from0 = Number(j.from_position) - 1;
      const to0 = Number(j.to_position) - 1;
      if (from0 < 0 || from0 >= total) throw new Error(`from_position fora da faixa (total=${total})`);
      if (to0 < 0 || to0 >= total) throw new Error(`to_position fora da faixa (total=${total})`);
      // valida que a faixa na from_position é mesmo a esperada (best-effort)
      const expectedUri = `spotify:track:${j.spotify_track_id}`;
      if (uris[from0] && uris[from0] !== expectedUri) {
        throw new Error(`faixa em from_position=${j.from_position} não é a esperada (snapshot dessincronizado)`);
      }
      // insert_before: se for pra frente (to > from) usa to0+1; pra trás usa to0.
      const insertBefore = to0 > from0 ? to0 + 1 : to0;
      await reorderPlaylistTracks(
        j.spotify_playlist_id,
        { range_start: from0, insert_before: insertBefore, range_length: 1 },
        token,
      );

      await supabase.from("playlist_execution_jobs")
        .update({ status: "done", completed_at: new Date().toISOString(), last_error: null })
        .eq("id", j.id);
      console.log(JSON.stringify({ evt: "reorder.done", job_id: j.id, owner_id: ownerId, total }));
      reorderDone++;
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      const nextStatus = ((j.attempts ?? 0) + 1) >= (j.max_attempts ?? 3) ? "failed" : "pending";
      console.log(JSON.stringify({ evt: "reorder.error", job_id: j.id, error: msg, next_status: nextStatus }));
      await supabase.from("playlist_execution_jobs")
        .update({ status: nextStatus, last_error: msg, claimed_by: null, claimed_at: null, lease_expires_at: null })
        .eq("id", j.id);
      reorderFailed++;
    }
  }

  // ============= 1b) ADD / REMOVE: executa inline via Web API do Spotify =============
  const { data: mutationJobs } = await supabase
    .from("playlist_execution_jobs")
    .select("id, job_type, spotify_playlist_id, spotify_track_id, attempts, max_attempts")
    .eq("status", "pending")
    .in("job_type", ["playlist.track.add", "playlist.track.remove"])
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(10);

  let addRemoveDone = 0, addRemoveFailed = 0;
  for (const j of (mutationJobs ?? []) as any[]) {
    const { data: claimedRow } = await supabase
      .from("playlist_execution_jobs")
      .update({ status: "claimed", claimed_by: workerId, claimed_at: nowIso, lease_expires_at: lease, attempts: (j.attempts ?? 0) + 1 })
      .eq("id", j.id).eq("status", "pending")
      .select("id").maybeSingle();
    if (!claimedRow) continue;

    try {
      const { data: mp, error: mpErr } = await supabase
        .from("managed_playlists")
        .select("owner_spotify_user_id")
        .eq("spotify_playlist_id", j.spotify_playlist_id)
        .maybeSingle();
      if (mpErr) throw new Error(`lookup managed_playlists falhou: ${mpErr.message}`);
      const ownerId = mp?.owner_spotify_user_id ?? null;
      if (!ownerId) throw new Error("owner_spotify_user_id não encontrado em managed_playlists");

      const { token } = await getUserAccessToken(ownerId);
      const trackUri = `spotify:track:${j.spotify_track_id}`;

      console.log(JSON.stringify({
        evt: "mutation.attempt",
        job_id: j.id,
        job_type: j.job_type,
        spotify_playlist_id: j.spotify_playlist_id,
        spotify_track_id: j.spotify_track_id,
        owner_id: ownerId,
        attempt: (j.attempts ?? 0) + 1,
      }));

      if (j.job_type === "playlist.track.add") {
        await addPlaylistTracks(j.spotify_playlist_id, [trackUri], token);
      } else {
        await removePlaylistTracks(j.spotify_playlist_id, [trackUri], token);
      }

      await supabase.from("playlist_execution_jobs")
        .update({ status: "done", completed_at: new Date().toISOString(), last_error: null })
        .eq("id", j.id);
      console.log(JSON.stringify({ evt: "mutation.done", job_id: j.id, job_type: j.job_type, owner_id: ownerId }));
      addRemoveDone++;
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      const nextStatus = ((j.attempts ?? 0) + 1) >= (j.max_attempts ?? 3) ? "failed" : "pending";
      console.log(JSON.stringify({ evt: "mutation.error", job_id: j.id, job_type: j.job_type, error: msg, next_status: nextStatus }));
      await supabase.from("playlist_execution_jobs")
        .update({ status: nextStatus, last_error: msg, claimed_by: null, claimed_at: null, lease_expires_at: null })
        .eq("id", j.id);
      addRemoveFailed++;
    }
  }

  // ============= 2) Dispatch pro bot (já não inclui add/remove — agora rodam inline acima) =============
  // Mantido por compatibilidade caso surjam novos job_types futuros que precisem do bot.
  const { data: candidates, error: selErr } = await supabase
    .from("playlist_execution_jobs")
    .select("id, job_type, allocation_id, campaign_id, playlist_id, spotify_playlist_id, spotify_track_id, attempts, max_attempts, playlists(name)")
    .eq("status", "pending")
    .in("job_type", [] as string[])
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(limit);

  if (selErr) return jr({ error: selErr.message }, 500);
  if (!candidates || candidates.length === 0) {
    return jr({ ok: true, count: 0, queue: [], reorder: { done: reorderDone, failed: reorderFailed }, mutations: { done: addRemoveDone, failed: addRemoveFailed } });
  }


  const ids = candidates.map((c: any) => c.id);


  // Marca claimed e gera correlation_id
  const updates = candidates.map((c: any) => ({
    id: c.id,
    correlation_id: crypto.randomUUID(),
  }));

  // Update um a um pra ter correlation_id por linha (poucas linhas, ok)
  const claimed: any[] = [];
  for (const u of updates) {
    const { data, error } = await supabase
      .from("playlist_execution_jobs")
      .update({
        status: "claimed",
        claimed_by: workerId,
        claimed_at: nowIso,
        lease_expires_at: lease,
        correlation_id: u.correlation_id,
        attempts: (candidates.find((c: any) => c.id === u.id) as any).attempts + 1,
      })
      .eq("id", u.id)
      .eq("status", "pending") // double-check
      .select("id, job_type, allocation_id, campaign_id, playlist_id, spotify_playlist_id, spotify_track_id, correlation_id, attempts, max_attempts")
      .maybeSingle();
    if (!error && data) {
      const src: any = candidates.find((c: any) => c.id === u.id);
      (data as any).playlist_name = src?.playlists?.name ?? null;
      claimed.push(data);
    }
  }

  // Eventos de lifecycle
  if (claimed.length) {
    const events = claimed.map((c: any) => ({
      bot_name: botName,
      session_id: session,
      step: "execution_dispatch",
      status: "running",
      lifecycle_state: "FETCHED",
      correlation_id: c.correlation_id,
      worker_id: workerId,
      process_id: processId,
      hostname,
      timer_id: timerId,
      message: `Execution dispatched: ${c.job_type}`,
      metadata: {
        job_id: c.id,
        spotify_playlist_id: c.spotify_playlist_id,
        spotify_track_id: c.spotify_track_id,
        allocation_id: c.allocation_id,
        attempt: c.attempts,
      },
    }));
    await supabase.from("bot_events").insert(events);
  }

  // Health: só loga quando houve dispatch real ou erro acima
  if (claimed.length > 0) {
    await reportCronHealth(supabase, {
      job_name: "bot-execution-queue",
      status: "ok",
      startedAt,
      metrics: { claimed: claimed.length, candidates: candidates.length },
      message: `claimed=${claimed.length} candidates=${candidates.length}`,
    });
  }

  return jr({ ok: true, count: claimed.length, queue: claimed });
});
