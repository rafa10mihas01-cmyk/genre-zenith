// bot-execution-queue — Devolve fila de execução (add/remove track em playlist).
// Jobs do tipo `playlist.track.reorder` são executados INLINE aqui (chamando
// a Web API do Spotify via reorderPlaylistTracks) e NÃO são entregues ao bot.
// Auth: header x-bot-key (compara com env BOT_API_KEY).
// GET ?limit=3
import { createClient } from "npm:@supabase/supabase-js@2";
import { reportCronHealth } from "../_shared/cron-health.ts";
import { reorderPlaylistTracks, listPlaylistTrackUris, listPlaylistTrackRefs, findPlaylistTrackIndex, addPlaylistTracks, removePlaylistTracks } from "../_shared/spotify-playlist.ts";
import { getUserToken, forceRefreshUserToken, installSpotifyCircuitFetchGuard } from "../_shared/spotify-client.ts";
import { SpotifyApiError } from "../_shared/spotify-playlist.ts";
import { classifyManualReason, enqueueManual } from "../_shared/manual-fallback.ts";

// Defesa em profundidade: garante que o guard global de fetch p/ Spotify
// esteja instalado antes de qualquer chamada (add/remove/reorder no Spotify).
// O guard intercepta 429 e abre o circuit breaker — sem ele, rajadas durante
// rate-limit podem queimar tokens OAuth e corromper playlists.
installSpotifyCircuitFetchGuard();

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

function parseJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    return JSON.parse(atob(payload)) as Record<string, unknown>;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();

  // Auth: aceita BOT_API_KEY (bot desktop) OU Bearer JWT com role=service_role (cron interno)
  const botKey = req.headers.get("x-bot-key");
  const auth = req.headers.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const isBot = !!botKey && botKey === BOT_API_KEY;
  const claims = bearer ? parseJwtClaims(bearer) : null;
  const isInternal = !!claims && (claims as any).role === "service_role";
  if (!isBot && !isInternal) return jr({ error: "unauthorized" }, 401);

  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "3"), 1), 10);


  const workerId = req.headers.get("x-worker-id") || (isInternal ? "internal-cron" : "unknown");
  const processId = req.headers.get("x-process-id") || null;
  const hostname = req.headers.get("x-hostname") || null;
  const timerId = req.headers.get("x-timer-id") || null;
  const botName = req.headers.get("x-bot-name") || (isInternal ? "internal-cron" : "spotify-artists-bot");
  const session = req.headers.get("x-bot-session") || null;

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // EXECUTION_FREEZE_MODE: kill-switch global. Não entrega jobs a nenhum worker
  // (bot externo ou cron interno) enquanto a flag estiver ligada.
  {
    const { data: frozenFlag } = await supabase
      .from("system_flags")
      .select("execution_frozen")
      .eq("singleton_key", "app")
      .maybeSingle();
    if (frozenFlag?.execution_frozen) {
      await reportCronHealth(supabase, {
        job_name: "bot-execution-queue",
        status: "ok",
        startedAt,
        metrics: { skipped: true, reason: "execution_frozen" },
        message: "skipped: EXECUTION_FROZEN",
      });
      return jr({ ok: true, skipped: true, reason: "execution_frozen", jobs: [] });
    }
  }

  // Feature flag: drenamento interno pode ser desligado instantaneamente
  if (isInternal) {
    const { data: flags } = await supabase
      .from("system_flags")
      .select("execution_queue_internal_enabled")
      .eq("singleton_key", "app")
      .maybeSingle();
    if (!flags?.execution_queue_internal_enabled) {
      await reportCronHealth(supabase, {
        job_name: "bot-execution-queue",
        status: "ok",
        startedAt,
        metrics: { skipped: true, reason: "flag_disabled" },
        message: "internal cron skipped: flag disabled",
      });
      return jr({ ok: true, skipped: true, reason: "flag_disabled" });
    }
  }


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

      let { token } = await getUserToken(ownerId);

      // Em playlists privadas/colaborativas, leitura também precisa do token do dono.
      // Retry uma vez com refresh forçado em 401 (token pode estar stale no cache).
      let uris: string[];
      try {
        uris = await listPlaylistTrackUris(j.spotify_playlist_id, token);
      } catch (ge) {
        if (ge instanceof SpotifyApiError && ge.status === 401) {
          console.log(JSON.stringify({ evt: "reorder.token_refresh", job_id: j.id }));
          const refreshed = await forceRefreshUserToken(ownerId);
          token = refreshed.token;
          uris = await listPlaylistTrackUris(j.spotify_playlist_id, token);
        } else {
          throw ge;
        }
      }
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
      const manualReason = classifyManualReason(e);
      if (manualReason) {
        await enqueueManual(supabase, { job: j, reason: manualReason, fallback: true, position: j.to_position ?? null });
        await supabase.from("playlist_execution_jobs")
          .update({ status: "manual", last_error: msg, claimed_by: null, claimed_at: null, lease_expires_at: null })
          .eq("id", j.id);
        console.log(JSON.stringify({ evt: "reorder.manual_fallback", job_id: j.id, reason: manualReason }));
        reorderFailed++;
        continue;
      }
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
    .select("id, job_type, campaign_id, spotify_playlist_id, spotify_track_id, attempts, max_attempts, to_position, metadata")
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
        .select("id, owner_spotify_user_id, tracks_count")
        .eq("spotify_playlist_id", j.spotify_playlist_id)
        .maybeSingle();
      if (mpErr) throw new Error(`lookup managed_playlists falhou: ${mpErr.message}`);
      const ownerId = mp?.owner_spotify_user_id ?? null;
      if (!ownerId) throw new Error("owner_spotify_user_id não encontrado em managed_playlists");
      const managedId = mp!.id as string;
      const currentCount = Number(mp?.tracks_count ?? 0);

      const { token } = await getUserToken(ownerId);
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
        // ============= Planned position =============
        let plannedPos: number | null = null;
        if (Number.isInteger(j.to_position) && j.to_position >= 1) {
          plannedPos = Number(j.to_position);
        } else if (j.campaign_id) {
          const { data: eco } = await supabase
            .from("campaign_eco_allocations")
            .select("position")
            .eq("campaign_id", j.campaign_id)
            .eq("managed_playlist_id", managedId)
            .maybeSingle();
          plannedPos = eco?.position ? Number(eco.position) : null;
        }

        // ============= PRE-FLIGHT: faixa já presente? (anti-duplicação) =============
        // Mesma regra de apply-meta-plan/apply-playlist-plan: lista refs canônicas
        // (com linked_from), localiza a faixa, e converte ADD em REORDER/SKIP.
        let activeToken = token;
        let preRefs;
        try {
          preRefs = await listPlaylistTrackRefs(j.spotify_playlist_id, activeToken);
        } catch (ge) {
          if (ge instanceof SpotifyApiError && ge.status === 401) {
            const refreshed = await forceRefreshUserToken(ownerId);
            activeToken = refreshed.token;
            preRefs = await listPlaylistTrackRefs(j.spotify_playlist_id, activeToken);
          } else { throw ge; }
        }
        const existingIdx = findPlaylistTrackIndex(preRefs, trackUri);

        if (existingIdx >= 0) {
          const total = preRefs.length;
          const targetIdx0 = plannedPos && plannedPos > 0
            ? Math.min(plannedPos - 1, Math.max(0, total - 1))
            : existingIdx;

          if (existingIdx === targetIdx0) {
            // SKIP — já está na posição planejada
            await supabase.from("playlist_execution_jobs")
              .update({
                status: "done",
                completed_at: new Date().toISOString(),
                last_error: null,
                metadata: { ...(j as any).metadata, skipped: "already_present", existing_position: existingIdx + 1 },
              })
              .eq("id", j.id);
            console.log(JSON.stringify({
              evt: "mutation.skipped_already_present",
              job_id: j.id,
              spotify_playlist_id: j.spotify_playlist_id,
              spotify_track_id: j.spotify_track_id,
              position: existingIdx + 1,
            }));
            addRemoveDone++;
            continue;
          }

          // REORDER — faixa existe em posição diferente da planejada
          const insertBefore = existingIdx < targetIdx0
            ? Math.min(targetIdx0 + 1, total)
            : targetIdx0;
          await reorderPlaylistTracks(
            j.spotify_playlist_id,
            { range_start: existingIdx, insert_before: insertBefore, range_length: 1 },
            activeToken,
          );
          await supabase.from("playlist_execution_jobs")
            .update({
              status: "done",
              completed_at: new Date().toISOString(),
              last_error: null,
              metadata: {
                ...(j as any).metadata,
                converted_to: "reorder",
                from_position: existingIdx + 1,
                to_position: targetIdx0 + 1,
              },
            })
            .eq("id", j.id);
          console.log(JSON.stringify({
            evt: "mutation.converted_add_to_reorder",
            job_id: j.id,
            spotify_playlist_id: j.spotify_playlist_id,
            spotify_track_id: j.spotify_track_id,
            from: existingIdx + 1,
            to: targetIdx0 + 1,
          }));
          addRemoveDone++;
          continue;
        }

        // ============= ADD: faixa NÃO presente, segue fluxo normal =============
        await addPlaylistTracks(
          j.spotify_playlist_id,
          [trackUri],
          activeToken,
          plannedPos && plannedPos > 0 ? { position: Math.max(0, plannedPos - 1) } : {},
        );

        // ============= Conferência pós-ADD: só corrige se o Spotify não respeitar position =============
        try {
          if (plannedPos && plannedPos > 0) {
            let uris: string[];
            try {
              uris = await listPlaylistTrackUris(j.spotify_playlist_id, activeToken);
            } catch (ge) {
              if (ge instanceof SpotifyApiError && ge.status === 401) {
                console.log(JSON.stringify({ evt: "post_add_reorder.token_refresh", job_id: j.id }));
                const refreshed = await forceRefreshUserToken(ownerId);
                activeToken = refreshed.token;
                uris = await listPlaylistTrackUris(j.spotify_playlist_id, activeToken);
              } else {
                throw ge;
              }
            }
            const total = uris.length;
            let from0 = -1;
            for (let i = uris.length - 1; i >= 0; i--) {
              if (uris[i] === trackUri) { from0 = i; break; }
            }
            const to0 = Math.min(plannedPos - 1, Math.max(0, total - 1));
            if (from0 < 0) {
              console.log(JSON.stringify({ evt: "post_add_reorder.skipped", job_id: j.id, reason: "track_not_found", total }));
            } else if (from0 === to0) {
              console.log(JSON.stringify({ evt: "post_add_reorder.skipped", job_id: j.id, reason: "already_in_position", position: plannedPos }));
            } else {
              const insertBefore = to0 > from0 ? to0 + 1 : to0;
              await reorderPlaylistTracks(
                j.spotify_playlist_id,
                { range_start: from0, insert_before: insertBefore, range_length: 1 },
                activeToken,
              );
              console.log(JSON.stringify({
                evt: "post_add_reorder.done",
                job_id: j.id,
                spotify_playlist_id: j.spotify_playlist_id,
                from: from0 + 1,
                to: plannedPos,
                total,
              }));
            }
          } else {
            console.log(JSON.stringify({ evt: "post_add_reorder.skipped", job_id: j.id, reason: "no_planned_position" }));
          }
        } catch (re) {
          const remsg = (re as Error).message ?? String(re);
          console.log(JSON.stringify({ evt: "post_add_reorder.error", job_id: j.id, error: remsg }));
        }
      } else {
        await removePlaylistTracks(j.spotify_playlist_id, [trackUri], token);

        // Sync local: remove de managed_playlist_tracks e decrementa tracks_count
        const { data: deletedRows, error: delErr } = await supabase
          .from("managed_playlist_tracks")
          .delete()
          .eq("playlist_id", managedId)
          .eq("spotify_track_id", j.spotify_track_id)
          .select("id");
        if (delErr) {
          console.log(JSON.stringify({ evt: "mutation.sync_error", job_id: j.id, error: delErr.message }));
        }
        const removed = deletedRows?.length ?? 0;
        if (removed > 0) {
          await supabase
            .from("managed_playlists")
            .update({ tracks_count: Math.max(0, currentCount - removed), updated_at: new Date().toISOString() })
            .eq("id", managedId);
        }
        console.log(JSON.stringify({ evt: "mutation.sync", job_id: j.id, managed_id: managedId, deleted: removed, new_count: Math.max(0, currentCount - removed) }));
      }

      await supabase.from("playlist_execution_jobs")
        .update({ status: "done", completed_at: new Date().toISOString(), last_error: null })
        .eq("id", j.id);
      console.log(JSON.stringify({ evt: "mutation.done", job_id: j.id, job_type: j.job_type, owner_id: ownerId }));
      addRemoveDone++;
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      const manualReason = classifyManualReason(e);
      if (manualReason) {
        await enqueueManual(supabase, { job: j, reason: manualReason, fallback: true, position: j.to_position ?? null });
        await supabase.from("playlist_execution_jobs")
          .update({ status: "manual", last_error: msg, claimed_by: null, claimed_at: null, lease_expires_at: null })
          .eq("id", j.id);
        console.log(JSON.stringify({ evt: "mutation.manual_fallback", job_id: j.id, job_type: j.job_type, reason: manualReason }));
        addRemoveFailed++;
        continue;
      }
      const nextStatus = ((j.attempts ?? 0) + 1) >= (j.max_attempts ?? 3) ? "failed" : "pending";
      console.log(JSON.stringify({ evt: "mutation.error", job_id: j.id, job_type: j.job_type, error: msg, next_status: nextStatus }));
      await supabase.from("playlist_execution_jobs")
        .update({ status: nextStatus, last_error: msg, claimed_by: null, claimed_at: null, lease_expires_at: null })
        .eq("id", j.id);
      addRemoveFailed++;
    }
  }

  // ============= 2) Dispatch pro bot (compat futuro — não inclui add/remove/reorder) =============
  const { data: candidates, error: selErr } = await supabase
    .from("playlist_execution_jobs")
    .select("id, job_type, allocation_id, campaign_id, playlist_id, spotify_playlist_id, spotify_track_id, attempts, max_attempts, playlists(name)")
    .eq("status", "pending")
    .in("job_type", [] as string[])
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(limit);

  if (selErr) {
    await reportCronHealth(supabase, {
      job_name: "bot-execution-queue",
      status: "error",
      startedAt,
      metrics: { error: "select_failed" },
      message: selErr.message,
    });
    return jr({ error: selErr.message }, 500);
  }

  const claimed: any[] = [];
  if (candidates && candidates.length > 0) {
    const updates = candidates.map((c: any) => ({ id: c.id, correlation_id: crypto.randomUUID() }));
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
        .eq("status", "pending")
        .select("id, job_type, allocation_id, campaign_id, playlist_id, spotify_playlist_id, spotify_track_id, correlation_id, attempts, max_attempts")
        .maybeSingle();
      if (!error && data) {
        const src: any = candidates.find((c: any) => c.id === u.id);
        (data as any).playlist_name = src?.playlists?.name ?? null;
        claimed.push(data);
      }
    }

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
  }

  // ============= Health: SEMPRE registra (claimed/completed/failed/pending_remaining/duration_ms) =============
  const { count: pendingRemaining } = await supabase
    .from("playlist_execution_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .lte("scheduled_for", new Date().toISOString());

  const totalClaimed = reorderDone + reorderFailed + addRemoveDone + addRemoveFailed + claimed.length;
  const totalCompleted = reorderDone + addRemoveDone;
  const totalFailed = reorderFailed + addRemoveFailed;
  const duration = Date.now() - startedAt;

  await reportCronHealth(supabase, {
    job_name: "bot-execution-queue",
    status: totalFailed > 0 ? "degraded" : "ok",
    startedAt,
    metrics: {
      source: isInternal ? "internal_cron" : "bot_desktop",
      claimed: totalClaimed,
      completed: totalCompleted,
      failed: totalFailed,
      pending_remaining: pendingRemaining ?? null,
      duration_ms: duration,
      reorder: { done: reorderDone, failed: reorderFailed },
      mutations: { done: addRemoveDone, failed: addRemoveFailed },
      dispatched: claimed.length,
    },
    message: `claimed=${totalClaimed} done=${totalCompleted} failed=${totalFailed} pending=${pendingRemaining ?? "?"} dur=${duration}ms`,
  });

  return jr({
    ok: true,
    source: isInternal ? "internal_cron" : "bot_desktop",
    count: claimed.length,
    queue: claimed,
    reorder: { done: reorderDone, failed: reorderFailed },
    mutations: { done: addRemoveDone, failed: addRemoveFailed },
    pending_remaining: pendingRemaining ?? null,
    duration_ms: duration,
  });
});

