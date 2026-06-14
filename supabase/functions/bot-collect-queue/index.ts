// bot-collect-queue — Devolve fila de campanhas com auto_collect=true prontas pra coletar.
// Auth: header x-bot-key (compara com env BOT_API_KEY).
// GET ?limit=5
import { createClient } from "npm:@supabase/supabase-js@2";
import { recordMetric } from "../_shared/ops-metrics.ts";
import { reportCronHealth } from "../_shared/cron-health.ts";
import { getAppToken } from "../_shared/spotify-client.ts";

// Resolve spotify_artist_id automaticamente via Spotify API quando o cliente
// não tem cadastrado. Tenta casar pelo nome (song_artist) e cacheia no client.
async function resolveArtistIdFromTrack(
  supabase: any,
  trackId: string,
  songArtist: string | null,
  clientId: string | null,
  songId: string | null = null,
): Promise<{ artistId: string | null; artistUrl: string | null }> {
  try {
    const token = await getAppToken();
    const res = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { artistId: null, artistUrl: null };
    const data = await res.json();
    const artists: Array<{ id: string; name: string }> = data?.artists ?? [];
    if (!artists.length) return { artistId: null, artistUrl: null };
    const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const match = songArtist
      ? artists.find((a) => norm(a.name) === norm(songArtist))
        ?? artists.find((a) => norm(songArtist).includes(norm(a.name)) || norm(a.name).includes(norm(songArtist)))
      : null;
    const chosen = match ?? artists[0];
    const artistUrl = `https://open.spotify.com/artist/${chosen.id}`;
    if (clientId) {
      await supabase
        .from("clients")
        .update({ spotify_artist_id: chosen.id, spotify_artist_url: artistUrl })
        .eq("id", clientId)
        .is("spotify_artist_id", null);
    }
    // Persiste também na song (cobre deals sem campanha/cliente vinculados)
    if (songId) {
      await supabase
        .from("curator_deal_songs")
        .update({ spotify_artist_id: chosen.id, spotify_artist_url: artistUrl })
        .eq("id", songId)
        .is("spotify_artist_id", null);
    }
    return { artistId: chosen.id, artistUrl };
  } catch (_) {
    return { artistId: null, artistUrl: null };
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-bot-key, x-worker-id, x-process-id, x-hostname, x-timer-id, x-bot-name, x-bot-session",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_API_KEY = Deno.env.get("BOT_API_KEY")!;
const BOT_INGEST_TOKEN = Deno.env.get("BOT_INGEST_TOKEN") ?? "";

function isAuthorizedBotKey(value: string | null) {
  const normalize = (v: string | null | undefined) => (v ?? "").trim().replace(/^Bearer\s+/i, "").replace(/^['\"]|['\"]$/g, "");
  const got = normalize(value);
  return Boolean(got) && (got === normalize(BOT_API_KEY) || got === normalize(BOT_INGEST_TOKEN));
}

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();

  const authKey = req.headers.get("x-bot-key") ?? req.headers.get("x-bot-token") ?? req.headers.get("authorization");
  if (!isAuthorizedBotKey(authKey)) {
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
  // E deal não fechado/pausado (state ∈ {collecting, active})
  // awaiting_playlists fica DE FORA: sem playlist declarada pelo curador, não coleta.
  // (Reversão 30/05: removido 'awaiting_baseline' — deal nasce 'active', bot
  // coleta como antes; baseline é captura natural, não estado intermediário.)
  //
  // NOTA (2026-05-30): NÃO filtramos mais por curator_deals.collection_mode aqui.
  // A flag canônica de "esse deal deve ser coletado pelo bot?" é curator_deal_songs.auto_collect
  // (que já está no .eq abaixo). O campo collection_mode é só pra UI/badge.
  // A migration de 25/05 que reclassificou deals como 'spreadsheet' baseado em
  // spotify_owner_id calou 6 deals coletáveis (Roninho/Igor/Plug). Bug evitado removendo o filtro.
  const { data, error } = await supabase
    .from("curator_deal_songs")
    .select(`
      id, deal_id, song_name, song_artist, artist_candidates, song_spotify_url, spotify_track_id,
      spotify_artist_id, spotify_artist_url,
      auto_collect_status, last_auto_collect_at, next_auto_collect_at,
      auto_collect_interval_minutes, last_print_at,
      collect_attempt_count, collect_error_code, collect_paused_until,
      curator_deals!inner ( id, curator_name, song_name, user_id, closed_at, state, source, token_revoked_at, token_expires_at, curator_id, campaign_id, curators ( paused_at ), campaigns!curator_deals_campaign_id_fkey ( client_id, collection_mode, deal_id, clients ( spotify_artist_id, spotify_artist_url ) ) ),
      curator_playlists ( id, playlist_name, spotify_url, spotify_playlist_id )
    `)
    .eq("auto_collect", true)
    .in("auto_collect_status", ["idle", "error"])
    .is("curator_deals.closed_at", null)
    .is("curator_deals.token_revoked_at", null)
    .in("curator_deals.state", ["awaiting_playlists", "collecting", "active"])
    .or(`collect_paused_until.is.null,collect_paused_until.lte.${new Date().toISOString()}`)
    .or(`next_auto_collect_at.is.null,next_auto_collect_at.lte.${new Date().toISOString()}`)
    .order("next_auto_collect_at", { ascending: true, nullsFirst: true })
    // Over-fetch: o filtro JS abaixo descarta deals em modo planilha, curador pausado
    // e tokens expirados. Sem isso, 1 song "envenenada" no topo (ex.: spreadsheet
    // sobrando) pode zerar a fila inteira quando o bot pede limit=1.
    // Bug histórico: 02/06/2026 → 04/06/2026 — Eu Já Era Trap (spreadsheet) bloqueou
    // a coleta das baselines de Sorriso/Se Fosse Eu/Cabeça/Primeira Lágrima por 36h.
    .limit(Math.min(50, Math.max(limit * 5, 10)));

  if (error) return jr({ error: error.message }, 500);

  // Coleta de campanha interna: não exige whitelist. O bot precisa abrir a
  // música no Spotify for Artists e capturar TODAS as playlists onde ela já
  // aparece; a baseline nasce dessa foto, não das playlists planejadas.
  // Deals de curador comuns continuam exigindo playlists cadastradas.
  const nowMs = Date.now();
  const candidates = (data ?? []).filter((s: any) => {
    const lastCollectAt = s?.last_auto_collect_at ? new Date(s.last_auto_collect_at).getTime() : null;
    const intervalMs = Math.max(Number(s?.auto_collect_interval_minutes ?? 60), 5) * 60_000;
    // Corta retry quente causado por corrida entre complete/recovery/claim:
    // mesmo com next_auto_collect_at stale, uma música não deve reentrar antes do intervalo.
    if (lastCollectAt && Number.isFinite(lastCollectAt) && Date.now() - lastCollectAt < intervalMs) return false;
    // Curador pausado: bloqueia coleta
    if (s?.curator_deals?.curators?.paused_at) return false;
    // Campanha em modo planilha: planilha é a única fonte de verdade da BASELINE,
    // então bloqueia APENAS shadow deals do ecossistema (source='campaign_internal').
    // Curadores reais (source IS NULL) continuam coletando normalmente — a planilha
    // governa baseline, não a entrega curatorial. Regra arquitetural confirmada
    // 05/06/2026 (caso Carnívoro: Manolo + Plug bloqueados indevidamente).
    if (
      s?.curator_deals?.campaigns?.collection_mode === "spreadsheet" &&
      s?.curator_deals?.source === "campaign_internal"
    ) return false;
    // Em campanha com múltiplos deals, o shadow "Campanha" só coleta se for o
    // deal oficial da campanha. Isso impede dois coletores S4A para a mesma música.
    const officialDealId = s?.curator_deals?.campaigns?.deal_id ?? null;
    if (
      s?.curator_deals?.source === "campaign_internal" &&
      officialDealId &&
      officialDealId !== s.deal_id
    ) return false;
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
      .from("v_curator_playlists_operational")
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

  const isCampaignInternal = (s: any) => s?.curator_deals?.source === "campaign_internal";
  const eligibleAll = candidates.filter((s: any) => isCampaignInternal(s) || dealsWithWhitelist.has(s.deal_id));
  // Respeita o `limit` pedido pelo bot — over-fetch acima é só pra atravessar
  // deals filtrados (spreadsheet/pausado), não pra inflar o batch entregue.
  const eligible = eligibleAll.slice(0, limit);
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
  const blocked = candidates.filter((s: any) => !isCampaignInternal(s) && !dealsWithWhitelist.has(s.deal_id));

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


  // Claim atômico via RPC: FOR UPDATE SKIP LOCKED garante que cada song só seja
  // entregue a um caller, mesmo com workers paralelos do VPS (w0, w1, ...) batendo
  // na edge no mesmo instante. Sem isso, race condition entre SELECT e UPDATE
  // entregava a mesma música pra 2 workers → 2 prints duplicados (caso 09/06/2026).
  const candidateIds = eligible.map((s: any) => s.id);
  let ids: string[] = [];
  let claimedEligible: any[] = [];
  if (candidateIds.length) {
    const { data: claimedRows, error: claimErr } = await supabase
      .rpc("claim_collect_queue", { p_ids: candidateIds });
    if (claimErr) return jr({ error: `claim_failed: ${claimErr.message}` }, 500);
    const claimedSet = new Set((claimedRows ?? []).map((r: any) => r.id));
    ids = Array.from(claimedSet) as string[];
    claimedEligible = (eligible as any[]).filter((s) => claimedSet.has(s.id));
  }


  // ====== Observabilidade Fase A: correlation_id por dispatch ======
  // Cada song dispatchada recebe um correlation_id único. O bot DEVE devolver esse
  // mesmo id em todos os eventos/uploads/snapshots dessa execução. Sem id, perdemos
  // capacidade de rastrear onde a coleta morreu.
  for (const s of claimedEligible as any[]) {
    s.correlation_id = crypto.randomUUID();
    const client = s?.curator_deals?.campaigns?.clients;
    const clientId = s?.curator_deals?.campaigns?.client_id ?? null;
    // Ordem de prioridade: song row → client → resolve via Spotify API
    let artistId: string | null = s.spotify_artist_id ?? client?.spotify_artist_id ?? null;
    let artistUrl: string | null = s.spotify_artist_url ?? client?.spotify_artist_url ?? null;
    if (!artistId && s.spotify_track_id) {
      const resolved = await resolveArtistIdFromTrack(supabase, s.spotify_track_id, s.song_artist, clientId, s.id);
      artistId = resolved.artistId;
      artistUrl = resolved.artistUrl;
    }
    s.spotify_artist_id = artistId;
    s.spotify_artist_url = artistUrl;
    // URL S4A no formato novo exigido pelo Spotify (track_id sozinho = 404).
    // Mantemos aliases no payload para compatibilidade com versões antigas do worker
    // que ainda leem `url`/`song_spotify_url` em vez de `s4a_song_url`.
    const s4aSongUrl = artistId && s.spotify_track_id
      ? `https://artists.spotify.com/c/pt/artist/${artistId}/song/${s.spotify_track_id}/stats`
      : null;
    s.s4a_song_url = s4aSongUrl;
    s.song_s4a_url = s4aSongUrl;
    s.url = s4aSongUrl;
    // Backend (bot-ingest-snapshot) rejeita payload agregado para QUALQUER song
    // com auto_collect=true (não só campaign_internal). Como bot-collect-queue
    // só entrega rows com auto_collect=true, 100% precisa de breakdown.
    // Alinhar a flag aqui evita o 422 "playlist_breakdown_required" no worker.
    s.requires_playlist_breakdown = true;
    s.capture_mode = "playlist_breakdown_required";
    s.ingest_contract = isCampaignInternal(s)
      ? "send_playlist_rows_not_aggregate"
      : "send_curator_playlist_rows";
    if (s4aSongUrl) s.song_spotify_url = s4aSongUrl;
  }
  if (claimedEligible.length) {
    const events = (claimedEligible as any[]).map((s) => ({
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
      dispatched_correlation_ids: (claimedEligible as any[]).map((s) => s.correlation_id),
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

  // ====== Catálogo (VPS-first telemetry) ======
  // Fila independente de deal_song. Itens vêm de catalog_snapshot_queue via
  // RPC `claim_next_catalog_snapshots`. Retrocompat: items de deal recebem
  // kind='deal_song' (default no bot); itens novos chegam com kind='catalog'.
  // Workers antigos que ignoram `kind` continuam funcionando porque os itens
  // de deal mantêm exatamente o mesmo shape.
  for (const s of claimedEligible as any[]) {
    s.kind = "deal_song";
  }

  let catalogClaimed: any[] = [];
  try {
    const remaining = Math.max(0, limit - claimedEligible.length);
    if (remaining > 0) {
      const workerId = callerWorkerId || callerHostname || `vps-${crypto.randomUUID().slice(0, 8)}`;
      const { data: catRows, error: catErr } = await supabase.rpc(
        "claim_next_catalog_snapshots",
        { p_worker_id: workerId, p_limit: remaining, p_lease_seconds: 600 },
      );
      if (catErr) {
        console.warn("[bot-collect-queue] catalog claim failed:", catErr.message);
      } else if (Array.isArray(catRows) && catRows.length) {
        // 1) Resolve spotify_artist_id em batch a partir de catalog_tracks
        //    (fonte de verdade — evita chamada extra à Spotify API).
        const trackIds = catRows.map((r: any) => r.catalog_track_id).filter(Boolean);
        const artistByTrack = new Map<string, string>();
        if (trackIds.length) {
          const { data: ctRows } = await supabase
            .from("catalog_tracks")
            .select("id, spotify_artist_id")
            .in("id", trackIds);
          for (const ct of ctRows ?? []) {
            if ((ct as any).spotify_artist_id) {
              artistByTrack.set((ct as any).id, (ct as any).spotify_artist_id);
            }
          }
        }

        // 2) Enriquece — fallback Spotify API só quando catalog_tracks não tiver.
        const enriched = await Promise.all(catRows.map(async (r: any) => {
          let artistId: string | null = artistByTrack.get(r.catalog_track_id) ?? null;
          if (!artistId && r.spotify_track_id) {
            try {
              const token = await getAppToken();
              const tRes = await fetch(`https://api.spotify.com/v1/tracks/${r.spotify_track_id}`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (tRes.ok) {
                const tJson = await tRes.json();
                artistId = tJson?.artists?.[0]?.id ?? null;
                // Persiste em catalog_tracks pra próxima rodada ser instantânea
                if (artistId) {
                  await supabase
                    .from("catalog_tracks")
                    .update({ spotify_artist_id: artistId })
                    .eq("id", r.catalog_track_id)
                    .is("spotify_artist_id", null);
                }
              }
            } catch (_) { /* silent */ }
          }
          const s4aSongUrl = artistId && r.spotify_track_id
            ? `https://artists.spotify.com/c/pt/artist/${artistId}/song/${r.spotify_track_id}/stats`
            : null;
          return {
            kind: "catalog",
            id: r.id, // worker VPS lê job.id — sem isso rejeita como "id nulo"
            queue_id: r.id,
            catalog_track_id: r.catalog_track_id,
            spotify_track_id: r.spotify_track_id,
            spotify_artist_id: artistId,
            s4a_song_url: s4aSongUrl,
            song_s4a_url: s4aSongUrl,
            url: s4aSongUrl,
            correlation_id: crypto.randomUUID(),
            priority: r.priority,
            attempts: r.attempts,
            lease_expires_at: r.lease_expires_at,
            requires_playlist_breakdown: true,
            capture_mode: "playlist_breakdown_required",
          };
        }));

        // 3) Descarta itens sem artist_id (não dá pra montar URL S4A).
        //    Libera o lease pra outra rodada poder tentar resolver depois.
        const valid = enriched.filter((e) => e.spotify_artist_id);
        const invalid = enriched.filter((e) => !e.spotify_artist_id);
        if (invalid.length) {
          console.warn(
            `[bot-collect-queue] catalog: ${invalid.length} itens sem spotify_artist_id — descartados`,
            invalid.map((i) => ({ queue_id: i.queue_id, track: i.spotify_track_id })),
          );
          const invalidIds = invalid.map((i) => i.queue_id);
          await supabase
            .from("catalog_snapshot_queue")
            .update({ status: "pending", worker_id: null, lease_expires_at: null })
            .in("id", invalidIds);
        }
        catalogClaimed = valid;
      }
    }
  } catch (e) {
    console.warn("[bot-collect-queue] catalog claim exception:", (e as Error).message);
  }

  return jr({
    ok: true,
    count: ids.length + catalogClaimed.length,
    deal_song_count: ids.length,
    catalog_count: catalogClaimed.length,
    blocked_no_whitelist: blocked.length,
    queue: [...claimedEligible, ...catalogClaimed],
  });
});
