// bot-ingest-snapshot — Recebe coleta do bot e grava via record_curator_deal_capture.
// Auth: header x-bot-key.
// POST { song_id, deal_id, total_plays, snapshots: [{playlist_name, spotify_url, plays, source?}], note?, print_urls? }
import { createClient } from "npm:@supabase/supabase-js@2";
import { assertDealOperable } from "../_shared/deal-access.ts";
import { recordMetric } from "../_shared/ops-metrics.ts";
import { classifyPlaylistKind } from "../_shared/algorithmic-classifier.ts";
import { extractPlaylistId } from "../_shared/spotify-playlist-id.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-bot-key, x-bot-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_API_KEY = Deno.env.get("BOT_API_KEY") ?? "";
const BOT_INGEST_TOKEN = Deno.env.get("BOT_INGEST_TOKEN") ?? "";

function isAuthorizedBot(req: Request): boolean {
  const candidates = [
    req.headers.get("x-bot-key"),
    req.headers.get("x-bot-token"),
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""),
  ].map((v) => (v ?? "").trim()).filter(Boolean);
  const allowed = [BOT_API_KEY, BOT_INGEST_TOKEN].filter(Boolean);
  return candidates.some((c) => allowed.includes(c));
}

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const t0 = Date.now();
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ error: "method_not_allowed" }, 405);

  if (!isAuthorizedBot(req)) {
    return jr({ error: "unauthorized" }, 401);
  }

  let body: any;
  let rawText = "";
  try {
    rawText = await req.text();
    body = rawText ? JSON.parse(rawText) : null;
  } catch { return jr({ error: "invalid_json" }, 400); }

  // 🔍 Auditoria: grava payload bruto antes de qualquer processamento
  const _rawAuditSb = createClient(SUPABASE_URL, SERVICE_KEY);
  const { logRawIngest, markRawIngestProcessed } = await import("../_shared/raw-ingest.ts");
  const _rawAuditId = await logRawIngest(_rawAuditSb, {
    endpoint: "bot-ingest-snapshot",
    req,
    rawText,
    payload: body,
  });

  // ====== Adaptador para payload "agregado" do worker VPS ======
  // O handler spotifyDealCollect.js (VPS) manda um objeto único com `plays` (total),
  // sem array `snapshots[]`. Quando isso acontece, gravamos só o total agregado
  // em curator_deal_logs e atualizamos o agendamento da song — sem tentar bater
  // por playlist (não há breakdown disponível em /song/{id}/stats).
  if (body && !Array.isArray(body.snapshots) && (body.plays != null || body.plays_total != null)) {
    const { deal_id: d_id, song_id: s_id, plays, plays_total, plays_24h, plays_7d, plays_28d, print_url, correlation_id: cid, source } = body;
    if (!d_id || !s_id) return jr({ error: "deal_id and song_id required" }, 400);
    const total = Number(plays_total ?? plays ?? 0) || 0;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Gate de ciclo de vida
    const { data: dealRow } = await supabase
      .from("curator_deals")
      .select("id, state, closed_at, token_revoked_at, token_expires_at, source, campaign_id")
      .eq("id", d_id)
      .maybeSingle();
    const gate = assertDealOperable(dealRow as any);
    if (!gate.ok) {
      await supabase.from("curator_deal_songs").update({
        auto_collect_status: "idle",
        auto_collect_error: gate.error,
        next_auto_collect_at: new Date(Date.now() + 2880 * 60_000).toISOString(),
        queued_at: null,
      }).eq("id", s_id);
      return jr({ ok: false, error: gate.error, code: gate.code, gated: true }, gate.status);
    }

    const { data: songContract } = await supabase
      .from("curator_deal_songs")
      .select("auto_collect")
      .eq("id", s_id)
      .maybeSingle();
    const requiresPlaylistBreakdown =
      (dealRow as any)?.source === "campaign_internal" ||
      !!(dealRow as any)?.campaign_id ||
      (songContract as any)?.auto_collect === true;
    if (requiresPlaylistBreakdown) {
      await supabase.from("curator_deal_songs").update({
        auto_collect_status: "error",
        auto_collect_error: "Payload agregado recusado: coleta automática exige prints por partes ou snapshots por playlist",
        next_auto_collect_at: new Date(Date.now() + 5 * 60_000).toISOString(),
        queued_at: null,
      }).eq("id", s_id);

      await supabase.from("collection_logs").insert({
        acao: "bot_collect",
        status: "error",
        mensagem: `song=${s_id} aggregate payload rejected: playlist breakdown required`,
      });

      return jr({
        ok: false,
        error: "playlist_breakdown_required",
        message: "Coleta automática não aceita total agregado; envie snapshots[] por playlist ou prints playlists-part-X-of-Y com dom_playlists.",
      }, 422);
    }

    const { count: existingLogs } = await supabase
      .from("curator_deal_logs")
      .select("id", { count: "exact", head: true })
      .eq("song_id", s_id);
    const isBaseline = (existingLogs ?? 0) === 0;
    const capturedAt = new Date().toISOString();

    await supabase.from("curator_deal_logs").insert({
      deal_id: d_id,
      song_id: s_id,
      total_plays: Math.max(0, total),
      note: `[bot/agregado] ${isBaseline ? "baseline" : "coleta"} total=${total} 24h=${plays_24h ?? "-"} 7d=${plays_7d ?? "-"} 28d=${plays_28d ?? "-"}`,
      print_urls: print_url ? [print_url] : [],
      is_initial_capture_event: isBaseline,
    });

    const { data: songRow } = await supabase
      .from("curator_deal_songs")
      .select("auto_collect_interval_minutes")
      .eq("id", s_id)
      .single();
    const intervalMin = songRow?.auto_collect_interval_minutes ?? 1440;
    const nextAt = new Date(Date.now() + intervalMin * 60_000).toISOString();
    const songUpdate: Record<string, unknown> = {
      auto_collect_status: "idle",
      auto_collect_error: null,
      last_auto_collect_at: capturedAt,
      next_auto_collect_at: nextAt,
      queued_at: null,
    };
    if (isBaseline) songUpdate.baseline_plays = Math.max(0, total);
    await supabase.from("curator_deal_songs").update(songUpdate).eq("id", s_id);

    if (isBaseline) {
      await supabase
        .from("curator_deals")
        .update({
          baseline_plays: Math.max(0, total),
          baseline_captured_at: capturedAt,
          state: "collecting",
        })
        .eq("id", d_id)
        .eq("state", "awaiting_baseline");
    }

    await supabase.from("collection_logs").insert({
      acao: "bot_collect",
      status: "ok",
      mensagem: `song=${s_id} agregado total=${total} (sem breakdown)`,
    });

    recordMetric(supabase, {
      scope: "bot",
      operation: "bot-ingest-snapshot",
      status: "success",
      duration_ms: Date.now() - t0,
      deal_id: d_id,
      song_id: s_id,
      metadata: { mode: "aggregate", total, is_baseline: isBaseline, correlation_id: cid ?? null, source: source ?? null },
    });

    return jr({ ok: true, mode: "aggregate", total_plays: total, is_baseline: isBaseline, next_auto_collect_at: nextAt });
  }

  const { song_id, deal_id, total_plays, snapshots, note, print_urls, print_taken, error: bot_error, correlation_id } = body ?? {};
  if (!deal_id || !song_id) return jr({ error: "deal_id and song_id required" }, 400);
  const screenshotUrls: string[] = Array.isArray(print_urls) ? print_urls.map((u: any) => String(u)).filter(Boolean) : [];
  const screenshotUrl: string | null = screenshotUrls.length > 0 ? screenshotUrls[0] : null;


  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // ====== Gate de ciclo de vida (Fase 5B) ======
  // Bloqueia ingestão se o deal estiver fechado/pausado/completed/token revogado.
  {
    const { data: dealRow } = await supabase
      .from("curator_deals")
      .select("id, state, closed_at, token_revoked_at, token_expires_at")
      .eq("id", deal_id)
      .maybeSingle();
    const gate = assertDealOperable(dealRow as any);
    if (!gate.ok) {
      await supabase
        .from("curator_deal_songs")
        .update({
          auto_collect_status: "idle",
          auto_collect_error: gate.error,
          next_auto_collect_at: new Date(Date.now() + 60 * 60_000).toISOString(),
          queued_at: null,
        })
        .eq("id", song_id);
      return jr({ ok: false, error: gate.error, code: gate.code, gated: true }, gate.status);
    }
  }

  // --- FONTE ÚNICA DE PRINTS ---
  // Cria 1 linha em bot_print_batches representando esta coleta e referencia
  // via snapshot_run_id. Evita duplicar URLs em curator_deal_snapshots e
  // campaign_playlist_collections.
  let snapshotRunId: string | null = null;
  if (screenshotUrls.length > 0) {
    const { data: batchRow, error: batchErr } = await supabase
      .from("bot_print_batches")
      .insert({
        deal_id,
        song_id,
        batch_key: `bot-snapshot-${correlation_id ?? crypto.randomUUID()}`,
        total_parts: 1,
        received_parts: 1,
        print_paths: [],
        print_urls: screenshotUrls,
        status: "complete",
        correlation_id: correlation_id ?? null,
        completed_at: new Date().toISOString(),
        processed_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (!batchErr && batchRow?.id) snapshotRunId = batchRow.id as string;
    else console.warn("[bot-ingest-snapshot] batch insert failed", batchErr);
  }




  if (bot_error) {
    await supabase
      .from("curator_deal_songs")
      .update({
        auto_collect_status: bot_error === "auth_required" ? "auth_required" : "error",
        auto_collect_error: String(bot_error).slice(0, 500),
        queued_at: null,
      })
      .eq("id", song_id);

    await supabase.from("collection_logs").insert({
      acao: "bot_collect",
      status: "error",
      mensagem: `song=${song_id} error=${bot_error}`,
    });

    if (bot_error === "auth_required") {
      await supabase.rpc("create_notification", {
        p_type: "warning",
        p_title: "Bot Spotify precisa reautenticar",
        p_message: "A sessão do Spotify for Artists expirou. Refaça o login no servidor do bot.",
        p_action_url: "/playlist-deals",
        p_metadata: { song_id, deal_id },
      });
    }
    return jr({ ok: true, recorded_error: true });
  }

  // Resolve user_id do dono do deal pra impersonar via service role (record_curator_deal_capture exige auth.uid())
  // -> Como o RPC usa auth.uid(), e estamos com service role, precisamos inserir direto.
  // Vamos inserir snapshot via insert direto (não usa RPC pra evitar precisar de JWT).

  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    return jr({ error: "snapshots required" }, 400);
  }

  // Dedupe: se já existe log dessa song nos últimos 90s, ignora (evita coleta duplicada
  // quando o cron e o "forçar coleta" disparam quase juntos)
  {
    const since = new Date(Date.now() - 90_000).toISOString();
    const { data: recent } = await supabase
      .from("curator_deal_logs")
      .select("id, created_at")
      .eq("song_id", song_id)
      .gte("created_at", since)
      .limit(1);
    if (recent && recent.length > 0) {
      const { data: songRow } = await supabase
        .from("curator_deal_songs")
        .select("auto_collect_interval_minutes")
        .eq("id", song_id)
        .single();
      const intervalMin = songRow?.auto_collect_interval_minutes ?? 1440;
      const nextAt = new Date(Date.now() + intervalMin * 60_000).toISOString();
      // Atualiza status pra não ficar travado em "queued"
      await supabase
        .from("curator_deal_songs")
        .update({
          auto_collect_status: "idle",
          auto_collect_error: null,
          last_auto_collect_at: new Date().toISOString(),
          next_auto_collect_at: nextAt,
          queued_at: null,
        })
        .eq("id", song_id);
      return jr({ ok: true, deduped: true, reason: "log within 90s exists" });
    }
  }

  // Detecta se essa é a PRIMEIRA coleta dessa song → marca como baseline
  const { count: existingLogs } = await supabase
    .from("curator_deal_logs")
    .select("id", { count: "exact", head: true })
    .eq("song_id", song_id);
  const isBaseline = (existingLogs ?? 0) === 0;

  // Pega nome da faixa pra delivery_proofs + spotify_track_id pra espelhar em campaign_eco_snapshots
  const { data: songInfo } = await supabase
    .from("curator_deal_songs")
    .select("song_name, song_artist, spotify_track_id")
    .eq("id", song_id)
    .maybeSingle();
  const trackName = [songInfo?.song_name, songInfo?.song_artist].filter(Boolean).join(" — ") || "unknown";

  const { data: dealInfo } = await supabase
    .from("curator_deals")
    .select("campaign_id, source")
    .eq("id", deal_id)
    .maybeSingle();
  const isCampaignShadow = !!(dealInfo as any)?.campaign_id && (dealInfo as any)?.source === "campaign_internal";

  // Resolve campanha ativa por spotify_track_id (uma única vez por ingestão).
  // Se existir campanha + a playlist for managed, espelhamos o snapshot em
  // campaign_eco_snapshots pra alimentar o timeline do portal do cliente.
  let ecoCampaignId: string | null = null;
  if (songInfo?.spotify_track_id) {
    const { data: campRow } = await supabase
      .from("campaigns")
      .select("id")
      .eq("spotify_track_id", songInfo.spotify_track_id)
      .in("status", ["active", "draft"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    ecoCampaignId = (campRow?.id as string | undefined) ?? null;
  }


  // Para cada snapshot, achar/criar curator_playlist e inserir snapshot.
  // Função utilitária inline pra extrair playlist id do url.
  const extractId = (url: string | null | undefined) => {
    if (!url) return null;
    const m = url.match(/playlist[/:]([a-zA-Z0-9]{16,})/);
    return m ? m[1] : null;
  };
  const ensureObservedPlaylist = async (snap: any, spotifyPlaylistId: string | null) => {
    const playlistName = String(snap.playlist_name ?? "").trim();
    if (!spotifyPlaylistId || !playlistName) return null;
    const { data: existing } = await supabase
      .from("curator_playlists")
      .select("id")
      .eq("deal_id", deal_id)
      .eq("song_id", song_id)
      .eq("spotify_playlist_id", spotifyPlaylistId)
      .maybeSingle();
    if ((existing as any)?.id) return (existing as any).id as string;
    const kind = classifyPlaylistKind(playlistName, snap.made_by ?? null, spotifyPlaylistId);
    const matchStatus = kind === "editorial" ? "editorial" : "organic";
    const toInt = (v: unknown) => {
      const n = parseInt(String(v ?? "")) || 0;
      return n > 0 ? n : 0;
    };
    const { data: inserted } = await supabase
      .from("curator_playlists")
      .insert({
        deal_id,
        song_id,
        spotify_url: snap.spotify_url ?? `https://open.spotify.com/playlist/${spotifyPlaylistId}`,
        spotify_playlist_id: spotifyPlaylistId,
        playlist_name: playlistName,
        followers: snap.followers ?? null,
        spotify_owner_name: snap.made_by ?? null,
        is_initial_roster: isBaseline,
        match_status: matchStatus,
        attribution_method: "s4a_observed",
        attribution_reason: "Detectada automaticamente na aba Playlists do Spotify for Artists",
        streams_7d: toInt(snap.plays_7d ?? snap.plays ?? 0),
        streams_28d: toInt(snap.plays_28d ?? 0),
        streams_total: toInt(snap.plays_28d ?? snap.plays_7d ?? snap.plays ?? snap.plays_24h ?? 0),
        last_paste_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();
    return ((inserted as any)?.id as string | undefined) ?? null;
  };

  // Dedupe dentro do lote (bot manda mesma playlist em vários scrolls)
  const scoreSnap = (x: any) =>
    (x.plays_24h != null ? 1 : 0) +
    (x.plays_7d  != null ? 1 : 0) +
    (x.plays_28d != null ? 1 : 0) +
    (x.plays     != null ? 1 : 0) +
    (x.followers != null ? 1 : 0);
  const dedupMap = new Map<string, any>();
  for (const s of snapshots) {
    const sid = extractId(s.spotify_url);
    let key: string | null = sid;
    if (!key) {
      const nameKey = String(s.playlist_name ?? "").trim().toLowerCase();
      if (!nameKey) continue;
      console.warn(`[WARN] bot-ingest-snapshot: dedupe por playlist_name fallback (sem spotify_url). deal=${deal_id} name="${nameKey}"`);
      key = `name:${nameKey}`;
    }
    const prev = dedupMap.get(key);
    if (!prev || scoreSnap(s) > scoreSnap(prev)) dedupMap.set(key, s);
  }
  const dedupedSnapshots = Array.from(dedupMap.values());
  const dedupedOut = snapshots.length - dedupedSnapshots.length;

  let inserted = 0;
  let skipped = 0;
  for (const snap of dedupedSnapshots) {
    const sUrl = snap.spotify_url ?? "";
    const sName = snap.playlist_name ?? null;
    const sId = extractId(sUrl);
    // Janelas (novo contrato). Se o bot só mandar `plays` (legado), assumimos 7d.
    const toInt = (v: unknown) => {
      const n = parseInt(String(v ?? "")) || 0;
      return n > 0 ? n : 0;
    };
    const plays24h = snap.plays_24h != null ? toInt(snap.plays_24h) : null;
    const plays7d  = snap.plays_7d  != null ? toInt(snap.plays_7d)  : (snap.plays != null ? toInt(snap.plays) : null);
    const plays28d = snap.plays_28d != null ? toInt(snap.plays_28d) : null;
    // Para o campo legado `plays` (não-nulo no schema): janela oficial agora é 7d.
    // Fallback: 7d → 28d → 24h (compat com payloads antigos) → 0.
    const plays = plays7d ?? plays28d ?? plays24h ?? 0;

    // Match robusto via RPC: spotify_id → nome normalizado → fuzzy ≥0.6
    let playlistId: string | null = null;
    let matchMethod: string | null = null;
    {
      const { data: matchData } = await supabase.rpc("match_curator_playlist", {
        p_deal_id: deal_id,
        p_spotify_playlist_id: sId,
        p_playlist_name: sName,
        p_song_id: song_id,
      });
      const row = Array.isArray(matchData) ? matchData[0] : null;
      if (row?.playlist_id) {
        playlistId = row.playlist_id as string;
        matchMethod = (row.match_method as string) ?? null;
      }
    }

    // Se não encontrou: NÃO cria nova playlist no deal. Antes de descartar,
    // classifica a playlist e grava em organic_plays_snapshots quando há
    // spotify_playlist_id válido — preserva tração de:
    //  - 'algorithmic' (Rádio, Daily Mix, Discover Weekly, Smart Shuffle...)
    //  - 'editorial'   (made_by Spotify com id real, ex.: "This Is X")
    //  - 'organic'     (playlists de terceiros fora do ecossistema)
    // Sem sId real → não dá pra deduplicar nem enriquecer depois → vira no_match.
    if (!playlistId) {
      if (isCampaignShadow) {
        playlistId = await ensureObservedPlaylist(snap, sId);
        matchMethod = playlistId ? "s4a_observed" : matchMethod;
      }
    }

    if (!playlistId) {
      const madeBy = (snap as any).made_by ?? null;
      const kind = classifyPlaylistKind(sName, madeBy, sId);
      if (kind && sId) {
        await supabase.from("organic_plays_snapshots").insert({
          deal_id,
          song_id,
          spotify_track_id: songInfo?.spotify_track_id ?? null,
          spotify_playlist_id: sId,
          playlist_name: sName,
          kind,
          plays_24h: plays24h,
          plays_7d: plays7d,
          plays_28d: plays28d,
          source: snap.source ?? "spotify_for_artists",
        });
        continue;
      }

      const ref = sId ?? sName ?? "unknown";
      await supabase.from("collection_logs").insert({
        acao: "no_match",
        status: "alerta",
        mensagem: `[WARN] no_match: playlist ${ref} not registered in deal ${deal_id}`,
      });
      await supabase.rpc("create_notification", {
        p_type: "playlist_nao_identificada",
        p_title: "Playlist não identificada no deal",
        p_message: `Playlist não cadastrada no deal — verificar manualmente: ${ref}`,
        p_action_url: `/playlist-deals/${deal_id}`,
        p_metadata: { deal_id, song_id, spotify_playlist_id: sId, playlist_name: sName },
      });
      skipped++;
      continue;
    }


    // ===== FIX A: anti-spike / anti-drop validation =====
    let flagged = false;
    let flagReason: string | null = null;
    if (!isBaseline && plays > 0) {
      const { data: prevSnap } = await supabase
        .from("curator_deal_snapshots")
        .select("plays, captured_at")
        .eq("song_id", song_id)
        .eq("playlist_id", playlistId)
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const prevPlays = Number(prevSnap?.plays ?? 0);
      if (prevPlays > 0) {
        if (plays < prevPlays * 0.5) {
          flagged = true;
          flagReason = `plays_decrease: ${plays} < ${prevPlays} * 0.5`;
        } else if (plays > prevPlays * 10) {
          flagged = true;
          flagReason = `plays_spike: ${plays} > ${prevPlays} * 10`;
        }
        if (flagged) {
          await supabase.from("collection_logs").insert({
            acao: "bot_collect",
            status: "alerta",
            mensagem: `flag song=${song_id} playlist=${playlistId} ${flagReason}`,
          });
          await supabase.rpc("create_notification", {
            p_type: "warning",
            p_title: "Snapshot suspeito detectado",
            p_message: `Deal ${deal_id}: ${flagReason}`,
            p_action_url: `/playlist-deals/${deal_id}`,
            p_metadata: { deal_id, song_id, playlist_id: playlistId, plays, prev_plays: prevPlays },
          });
        }
      }
    }

    const { error: insErr } = await supabase.from("curator_deal_snapshots").insert({
      deal_id,
      song_id,
      playlist_id: playlistId,
      plays,
      plays_24h: plays24h,
      plays_7d:  plays7d,
      plays_28d: plays28d,
      source: snap.source ?? "spotify_for_artists",
      match_method: matchMethod ?? (sId ? "spotify_id" : "name"),
      is_initial_capture: isBaseline,
      flagged,
      flag_reason: flagReason,
    });
    if (insErr) {
      skipped++;
    } else {
      inserted++;
      // Prova imutável de entrega
      await supabase.from("delivery_proofs").insert({
        deal_id,
        song_id,
        playlist_id: playlistId,
        spotify_playlist_id: sId ?? "",
        spotify_track_id: songInfo?.spotify_track_id ?? null,
        playlist_name: sName ?? "unknown",
        track_name: trackName,
        plays_total: plays,
        plays_24h: plays24h,
        plays_7d: plays7d,
        position_in_playlist: snap.position ?? snap.position_in_playlist ?? null,
        source: snap.source ?? "spotify_for_artists",
        screenshot_url: screenshotUrl,
        bot_correlation_id: correlation_id ?? null,
        captured_at: new Date().toISOString(),
      });

      // Espelha snapshot em campaign_eco_snapshots se: (a) existe campanha
      // ativa para a faixa; (b) a playlist é uma managed_playlist do ecossistema.
      // Falha silenciosa — nunca bloqueia ingestão principal.
      if (ecoCampaignId && sId) {
        try {
          const { data: mp } = await supabase
            .from("managed_playlists")
            .select("id")
            .eq("spotify_playlist_id", sId)
            .maybeSingle();
          if (mp?.id) {
            const { error: ecoErr } = await supabase
              .from("campaign_eco_snapshots")
              .upsert({
                campaign_id: ecoCampaignId,
                managed_playlist_id: mp.id,
                spotify_playlist_id: sId,
                plays_24h: plays24h,
                plays_7d: plays7d,
                plays_28d: plays28d,
                source: snap.source ?? "spotify_for_artists",
                correlation_id: correlation_id ?? null,
              }, { onConflict: "campaign_id,managed_playlist_id,captured_at", ignoreDuplicates: true });
            if (ecoErr) {
              console.warn("[bot-ingest-snapshot] eco_snapshots upsert failed:", ecoErr.message, { ecoCampaignId, sId });
            }
          }
        } catch (e) { console.warn("[bot-ingest-snapshot] eco mirror error:", (e as Error).message); }
      }
    }
  }


  // ====== Espelho em campaign_playlist_collections (nova arquitetura) ======
  // Fatos imutáveis do S4A indexados pela identidade canônica (playlist_id).
  // Se a campanha está com baseline_status='pending', esta coleta vira a baseline
  // oficial (intent='baseline'); senão é snapshot. RPC é atômica e idempotente
  // (rejeita 2ª baseline). Falha silenciosa — nunca bloqueia o fluxo legado.
  const collectionCampaignId: string | null =
    ((dealInfo as any)?.campaign_id as string | null) ?? ecoCampaignId;
  if (collectionCampaignId && dedupedSnapshots.length > 0) {
    try {
      const { data: campRow } = await supabase
        .from("campaigns")
        .select("baseline_status")
        .eq("id", collectionCampaignId)
        .maybeSingle();
      const intent =
        (campRow as any)?.baseline_status === "pending" ? "baseline" : "periodic";

      const capturedAt = new Date().toISOString();
      const rows = dedupedSnapshots
        .map((snap: any) => {
          const pid = extractPlaylistId(snap.spotify_url);
          if (!pid) return null;
          const name = String(snap.playlist_name ?? "").trim() || null;
          const plays7d =
            snap.plays_7d != null
              ? Math.max(0, parseInt(String(snap.plays_7d)) || 0)
              : snap.plays != null
              ? Math.max(0, parseInt(String(snap.plays)) || 0)
              : 0;
          return {
            playlist_id: pid,
            playlist_url:
              snap.spotify_url ?? `https://open.spotify.com/playlist/${pid}`,
            playlist_name_at_capture: name,
            plays_7d: plays7d,
            captured_at: capturedAt,
            source: "s4a_dom",
            // prints ficam SÓ em bot_print_batches (referenciado por snapshot_run_id)
          };
        })
        .filter(Boolean);

      if (rows.length > 0) {
        const { data: ingestRes, error: ingestErr } = await supabase.rpc(
          "ingest_campaign_collection_batch",
          {
            p_campaign_id: collectionCampaignId,
            p_intent: intent,
            p_rows: rows,
            p_snapshot_run_id: snapshotRunId,
          },
        );
        if (ingestErr) {
          console.warn(
            "[bot-ingest-snapshot] campaign_playlist_collections rpc failed:",
            ingestErr.message,
          );
        } else {
          console.log(
            "[bot-ingest-snapshot] campaign_playlist_collections ingested:",
            JSON.stringify(ingestRes),
          );
        }
      }
    } catch (e) {
      console.warn(
        "[bot-ingest-snapshot] campaign_playlist_collections error:",
        (e as Error).message,
      );
    }
  }


  // Fase 1.A.1 — baseline oficial vai exclusivamente para
  // `campaign_playlist_collections` via RPC (ver bloco "Espelho" acima).
  // Aqui apenas garantimos auditoria: se o deal não tem campanha vinculada,
  // registramos skip estruturado em bot_events (nenhuma escrita em legado).
  if (isBaseline && !collectionCampaignId) {
    const { logBaselineSkip } = await import("../_shared/baseline-writer.ts");
    await logBaselineSkip(supabase, {
      writer: "bot-ingest-snapshot",
      deal_id,
      song_id,
      reason: "deal_without_campaign",
      details: { snapshot_run_id: snapshotRunId ?? null },
    });
  }

  // Log do total na tabela curator_deal_logs.
  // Se total_plays vier ausente ou zero, calcula automaticamente somando snapshots[].plays.
  const computedTotal =
    typeof total_plays === "number" && total_plays > 0
      ? total_plays
      : snapshots.reduce(
          (acc: number, s: any) => acc + Math.max(0, parseInt(String(s.plays ?? 0)) || 0),
          0,
        );

  await supabase.from("curator_deal_logs").insert({
    deal_id,
    song_id,
    total_plays: Math.max(0, computedTotal),
    note: note ?? (isBaseline ? `[bot] baseline inicial` : `[bot] auto-collect`),
    print_urls: print_urls ?? [],
    is_initial_capture_event: isBaseline,
  });

  // Atualiza song com next_auto_collect_at
  const { data: songRow } = await supabase
    .from("curator_deal_songs")
    .select("auto_collect_interval_minutes, queued_at")
    .eq("id", song_id)
    .single();
  const intervalMin = songRow?.auto_collect_interval_minutes ?? 2880;
  const nextAt = new Date(Date.now() + intervalMin * 60_000).toISOString();
  const queueAgeMs = (songRow as any)?.queued_at ? Date.now() - new Date((songRow as any).queued_at).getTime() : null;

  const updatePayload: Record<string, unknown> = {
    auto_collect_status: "idle",
    auto_collect_error: null,
    last_auto_collect_at: new Date().toISOString(),
    next_auto_collect_at: nextAt,
    queued_at: null,
  };
  if (print_taken === true) {
    updatePayload.last_print_at = new Date().toISOString();
  }

  await supabase
    .from("curator_deal_songs")
    .update(updatePayload)
    .eq("id", song_id);

  await supabase.from("collection_logs").insert({
    acao: "bot_collect",
    status: skipped > 0 ? "parcial" : "ok",
    mensagem: `song=${song_id} inserted=${inserted} skipped=${skipped} deduped_in_batch=${dedupedOut}`,
  });

  recordMetric(supabase, {
    scope: "bot",
    operation: "bot-ingest-snapshot",
    status: skipped > 0 ? "partial" : "success",
    duration_ms: Date.now() - t0,
    deal_id,
    song_id,
    metadata: { inserted, skipped, queue_age_ms: queueAgeMs },
  });

  return jr({ ok: true, inserted, skipped, deduped_in_batch: dedupedOut, next_auto_collect_at: nextAt });
});
