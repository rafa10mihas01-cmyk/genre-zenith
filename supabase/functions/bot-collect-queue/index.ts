// bot-collect-queue — Devolve fila de campanhas com auto_collect=true prontas pra coletar.
// Auth: header x-bot-key (compara com env BOT_API_KEY).
// GET ?limit=5
import { createClient } from "npm:@supabase/supabase-js@2";
import { recordMetric } from "../_shared/ops-metrics.ts";
import { reportCronHealth } from "../_shared/cron-health.ts";
import { assertSpotifyCircuitClosed, SpotifyCircuitOpenError, getUserAccessToken, guardedSpotifyFetch } from "../_shared/spotify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-bot-key, x-worker-id, x-process-id, x-hostname, x-timer-id, x-bot-name, x-bot-session",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_API_KEY = Deno.env.get("BOT_API_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();

  if (req.headers.get("x-bot-key") !== BOT_API_KEY) {
    return jr({ error: "unauthorized" }, 401);
  }

  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "5"), 1), 20);

  // ====== Identidade do caller (Fase A — atribuição de worker) ======
  // Headers que o bot da VPS DEVE enviar para que possamos atribuir cada
  // dispatch a um worker/processo/timer específico e detectar duplicação.
  const callerWorkerId = req.headers.get("x-worker-id") || null;
  const callerProcessId = req.headers.get("x-process-id") || null;
  const callerHostname = req.headers.get("x-hostname") || null;
  const callerTimerId = req.headers.get("x-timer-id") || null;
  const callerBotName = req.headers.get("x-bot-name") || "spotify-artists-bot";
  const callerSession = req.headers.get("x-bot-session") || null;
  const callerUserAgent = req.headers.get("user-agent") || null;

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Gap 4 — Circuit breaker por app default: se o Spotify está em backoff,
  // devolve vazio sem tocar em nada. Log discreto, sem poluir cron_health.
  try {
    await assertSpotifyCircuitClosed();
  } catch (e) {
    if (!(e instanceof SpotifyCircuitOpenError)) throw e;
    console.log(`[bot-collect-queue] CB open, skipping collection (until ${e.blockedUntil})`);
    return jr({
      ok: true,
      count: 0,
      skipped: "circuit_breaker_open",
      blocked_until: e.blockedUntil,
      queue: [],
    });
  }

  // Recovery de handoff: se a música ficou "queued" por mais de 5 min sem o bot
  // devolver print/snapshot, assumimos que a entrega se perdeu (bot reiniciou,
  // crash, queda de rede). Reseta para 'idle' pra reentrega imediata sem
  // intervenção manual. Cobre tanto rows com queued_at antigo quanto rows sem
  // queued_at (legado / inserts manuais).
  const STUCK_MS = 5 * 60 * 1000;
  const stuckCutoff = new Date(Date.now() - STUCK_MS).toISOString();
  const { data: stuckRows } = await supabase
    .from("curator_deal_songs")
    .select("id, queued_at, updated_at")
    .eq("auto_collect_status", "queued")
    .or(`queued_at.lt.${stuckCutoff},and(queued_at.is.null,updated_at.lt.${stuckCutoff})`);
  if (stuckRows && stuckRows.length) {
    await supabase
      .from("curator_deal_songs")
      .update({
        auto_collect_status: "idle",
        auto_collect_error: "Queued >5min sem retorno do bot — reset automático",
        queued_at: null,
      })
      .in("id", stuckRows.map((r: any) => r.id));
    for (const r of stuckRows as any[]) {
      const ageMs = r.queued_at ? Date.now() - new Date(r.queued_at).getTime() : null;
      try {
        await supabase.from("bot_events").insert({
          bot_name: callerBotName,
          session_id: callerSession,
          song_id: r.id,
          step: "recovery",
          status: "warning",
          message: "queued >5min — reset para idle",
          metadata: { queue_age_ms: ageMs },
        });
      } catch (_) { /* ignore */ }
    }
  }

  // Candidatas: auto_collect=true E (next_auto_collect_at <= now OR next null)
  // E (status idle OU error) — não pega running/queued
  // E deal não fechado/pausado (state ∈ {awaiting_baseline, collecting, active})
  // awaiting_baseline = deal recém-aprovado, bot vai tirar a 1ª foto S4A.
  // Quando extract-snapshot-from-print processa isBaseline=true, vira collecting.
  // awaiting_playlists fica DE FORA: sem playlist declarada pelo curador, não coleta
  const { data, error } = await supabase
    .from("curator_deal_songs")
    .select(`
      id, deal_id, song_name, song_artist, artist_candidates, song_spotify_url, spotify_track_id,
      auto_collect_status, last_auto_collect_at, next_auto_collect_at,
      auto_collect_interval_minutes, last_print_at,
      curator_deals!inner ( id, curator_name, song_name, user_id, closed_at, state, token_revoked_at, token_expires_at, curator_id, curators ( paused_at ) ),
      curator_playlists ( id, playlist_name, spotify_url, spotify_playlist_id )
    `)
    .eq("auto_collect", true)
    .in("auto_collect_status", ["idle", "error"])
    .is("curator_deals.closed_at", null)
    .is("curator_deals.token_revoked_at", null)
    .in("curator_deals.state", ["awaiting_baseline", "collecting", "active"])
    .neq("curator_deals.collection_mode", "spreadsheet")
    .or(`next_auto_collect_at.is.null,next_auto_collect_at.lte.${new Date().toISOString()}`)
    .order("next_auto_collect_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error) return jr({ error: error.message }, 500);

  // 🔒 BLINDAGEM: só coleta se o deal já tem playlists do curador cadastradas
  // (com spotify_playlist_id e não-algorítmicas). Sem whitelist, não roda.
  // Pós-filtro: token_expires_at no passado também desqualifica
  const nowMs = Date.now();
  const candidates = (data ?? []).filter((s: any) => {
    // Curador pausado: bloqueia coleta
    if (s?.curator_deals?.curators?.paused_at) return false;
    const exp = s?.curator_deals?.token_expires_at;
    if (!exp) return true;
    const t = new Date(exp).getTime();
    return !Number.isFinite(t) || t > nowMs;
  });
  const dealIds = Array.from(new Set(candidates.map((s: any) => s.deal_id)));
  const dealsWithWhitelist = new Set<string>();
  const whitelistsByDeal = new Map<string, any[]>();
  if (dealIds.length) {
    const { data: wl } = await supabase
      .from("curator_playlists")
      .select("id, deal_id, song_id, playlist_name, spotify_url, spotify_playlist_id")
      .in("deal_id", dealIds)
      .in("match_status", ["curator", "baseline"]) // baseline = seed de campanha (managed playlists)
      .not("spotify_playlist_id", "is", null);
    for (const r of wl ?? []) {
      const row = r as any;
      if (row.song_id && !candidates.some((s: any) => s.id === row.song_id)) continue;
      dealsWithWhitelist.add(row.deal_id);
      const arr = whitelistsByDeal.get(row.deal_id) ?? [];
      arr.push(row);
      whitelistsByDeal.set(row.deal_id, arr);
    }
  }

  const eligible = candidates.filter((s: any) => dealsWithWhitelist.has(s.deal_id));
  for (const s of eligible as any[]) {
    const rows = whitelistsByDeal.get(s.deal_id) ?? [];
    const scoped = rows.filter((p: any) => !p.song_id || p.song_id === s.id);
    s.curator_playlists = scoped.map((p: any) => ({
      id: p.id,
      playlist_name: p.playlist_name,
      spotify_url: p.spotify_url,
      spotify_playlist_id: p.spotify_playlist_id,
    }));
  }
  const blocked = candidates.filter((s: any) => !dealsWithWhitelist.has(s.deal_id));

  // Marca songs sem whitelist com status informativo (não polui logs nem fica 'idle' eterno)
  if (blocked.length) {
    await supabase
      .from("curator_deal_songs")
      .update({
        auto_collect_status: "idle",
        auto_collect_error: "Aguardando curador cadastrar playlists",
        next_auto_collect_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      })
      .in("id", blocked.map((s: any) => s.id));

    // Notifica 1x por deal (dedupe 24h via metadata.kind + deal_id)
    const blockedDealIds = Array.from(new Set(blocked.map((s: any) => s.deal_id)));
    const dayAgo = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    for (const dId of blockedDealIds) {
      const deal = blocked.find((s: any) => s.deal_id === dId)?.curator_deals as any;
      const { count } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .gte("created_at", dayAgo)
        .contains("metadata", { kind: "no_whitelist", deal_id: dId });
      if ((count ?? 0) > 0) continue;
      try {
        await supabase.rpc("create_notification" as any, {
          p_type: "warning",
          p_title: "Curador sem playlists cadastradas",
          p_message: `${deal?.curator_name ?? "Curador"} ainda não cadastrou playlists para "${deal?.song_name ?? "a faixa"}". Coleta pausada.`,
          p_action_url: `/playlist-deals?deal=${dId}`,
          p_metadata: { kind: "no_whitelist", deal_id: dId },
        });
      } catch (_) { /* ignore */ }
    }
  }

  // Resolve spotify_artist_id (artista primário do track) via Spotify API.
  // O bot precisa desse ID para montar a URL S4A:
  // artists.spotify.com/c/pt/artist/<ARTIST_ID>/song/<TRACK_ID>/stats
  if (eligible.length) {
    const trackIds = Array.from(new Set(
      (eligible as any[]).map((s) => s.spotify_track_id).filter(Boolean),
    ));
    console.log(`[resolve-artist] eligible=${eligible.length} trackIds=${trackIds.length}`);
    const artistByTrack = new Map<string, string>();
    try {
      const { token, row } = await getUserAccessToken();
      console.log(`[resolve-artist] user token ok (user=${row.spotify_user_id} app=${row.app_id ?? "env"})`);
      for (let i = 0; i < trackIds.length; i += 50) {
        const chunk = trackIds.slice(i, i + 50);
        const r = await guardedSpotifyFetch(
          `https://api.spotify.com/v1/tracks?market=BR&ids=${chunk.join(",")}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        console.log(`[resolve-artist] chunk=${chunk.length} status=${r.status}`);
        if (!r.ok) {
          const errTxt = await r.text();
          console.log(`[resolve-artist] err body=${errTxt.slice(0, 300)}`);
          continue;
        }
        const j = await r.json();
        for (const t of j.tracks ?? []) {
          if (t?.id && t?.artists?.[0]?.id) artistByTrack.set(t.id, t.artists[0].id);
        }
      }
      console.log(`[resolve-artist] resolved=${artistByTrack.size}/${trackIds.length}`);
    } catch (e) {
      console.log("[resolve-artist] EXCEPTION:", (e as Error).message, (e as Error).stack?.slice(0, 300));
    }
    for (const s of eligible as any[]) {
      s.spotify_artist_id = artistByTrack.get(s.spotify_track_id) ?? null;
    }
  }

  // Marca elegíveis como queued para evitar dupla execução
  const ids = eligible.map((s: any) => s.id);
  if (ids.length) {
    await supabase
      .from("curator_deal_songs")
      .update({
        auto_collect_status: "queued",
        auto_collect_error: "Entregue ao robô; aguardando print/snapshot",
        queued_at: new Date().toISOString(),
      })
      .in("id", ids);
  }


  // ====== Observabilidade Fase A: correlation_id por dispatch ======
  // Cada song dispatchada recebe um correlation_id único. O bot DEVE devolver esse
  // mesmo id em todos os eventos/uploads/snapshots dessa execução. Sem id, perdemos
  // capacidade de rastrear onde a coleta morreu.
  for (const s of eligible as any[]) {
    s.correlation_id = crypto.randomUUID();
  }
  if (eligible.length) {
    const events = (eligible as any[]).map((s) => ({
      bot_name: callerBotName,
      session_id: callerSession,
      deal_id: s.deal_id,
      song_id: s.id,
      step: "dispatch",
      status: "running",
      lifecycle_state: "FETCHED",
      correlation_id: s.correlation_id,
      worker_id: callerWorkerId,
      process_id: callerProcessId,
      hostname: callerHostname,
      timer_id: callerTimerId,
      message: `Dispatched to bot queue (limit=${limit})`,
      metadata: {
        song_name: s.song_name,
        spotify_track_id: s.spotify_track_id,
        spotify_artist_id: s.spotify_artist_id ?? null,
        interval_minutes: s.auto_collect_interval_minutes,
        user_agent: callerUserAgent,
      },
    }));
    await supabase.from("bot_events").insert(events);
  }

  recordMetric(supabase, {
    scope: "collect",
    operation: "bot-collect-queue",
    status: "success",
    metadata: {
      queued: ids.length,
      blocked_no_whitelist: blocked.length,
      total_candidates: candidates.length,
      caller: {
        worker_id: callerWorkerId,
        process_id: callerProcessId,
        hostname: callerHostname,
        timer_id: callerTimerId,
        bot_name: callerBotName,
        session: callerSession,
        user_agent: callerUserAgent,
      },
      dispatched_correlation_ids: (eligible as any[]).map((s) => s.correlation_id),
      dispatched_song_ids: ids,
    },
  });

  // Health report — só quando houve trabalho real ou bloqueio (evita inundar cron_health)
  if (ids.length > 0 || blocked.length > 0) {
    await reportCronHealth(supabase, {
      job_name: "bot-collect-queue",
      status: "ok",
      startedAt,
      metrics: { dispatched: ids.length, blocked_no_whitelist: blocked.length, candidates: candidates.length, stuck_recovered: stuckRows?.length ?? 0 },
      message: `dispatched=${ids.length} blocked=${blocked.length} candidates=${candidates.length}`,
    });
  }

  return jr({
    ok: true,
    count: ids.length,
    blocked_no_whitelist: blocked.length,
    queue: eligible,
  });
});
