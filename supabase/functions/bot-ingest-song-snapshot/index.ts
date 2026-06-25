// bot-ingest-song-snapshot — Receptor único da coleta unificada do bot VPS.
// Recebe payload bruto do Spotify for Artists (música + lista completa de playlists
// com plays 7d + total 28d + screenshot) e armazena cru. A distribuição pra deals/
// campanhas/baseline é responsabilidade do backend, em job separado.
//
// Auth: header x-bot-key OU x-bot-token OU Authorization: Bearer <token>
//   (mesmos secrets já usados por bot-ingest-snapshot: BOT_API_KEY / BOT_INGEST_TOKEN)
//
// Contrato (POST application/json):
// {
//   "song_id": "uuid",
//   "spotify_song_id": "string",
//   "correlation_id": "uuid" (opcional),
//   "captured_at": "ISO" (opcional, default = now),
//   "window": "7d",
//   "total_plays_28d": number,
//   "screenshot_url": "string",
//   "print_urls": ["string"],
//   "playlists": [
//     { "spotify_playlist_id": "string|null", "name": "string", "owner": "string|null", "plays_7d": number }
//   ],
//   "bot_metadata": { ... } (opcional)
// }

import { createClient } from "npm:@supabase/supabase-js@2";

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

const toInt = (v: unknown): number | null => {
  if (v == null) return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ error: "method_not_allowed" }, 405);

  if (!isAuthorizedBot(req)) return jr({ error: "unauthorized" }, 401);

  let body: any;
  let rawText = "";
  try {
    rawText = await req.text();
    body = rawText ? JSON.parse(rawText) : null;
  } catch {
    return jr({ error: "invalid_json" }, 400);
  }

  // 🔍 Auditoria: grava payload bruto antes de qualquer processamento
  const _rawAuditSb = createClient(SUPABASE_URL, SERVICE_KEY);
  const { logRawIngest, markRawIngestProcessed } = await import("../_shared/raw-ingest.ts");
  const _rawAuditId = await logRawIngest(_rawAuditSb, {
    endpoint: "bot-ingest-song-snapshot",
    req,
    rawText,
    payload: body,
  });

  const {
    song_id,
    catalog_track_id,
    queue_id,
    spotify_song_id,
    spotify_track_id,
    correlation_id,
    captured_at,
    window: timeWindow,
    total_plays_28d,
    screenshot_url,
    print_urls,
    playlists,
    bot_metadata,
  } = body ?? {};
  const effectiveSpotifySongId = typeof spotify_song_id === "string" && spotify_song_id.trim().length > 0
    ? spotify_song_id.trim()
    : typeof spotify_track_id === "string" && spotify_track_id.trim().length > 0
      ? spotify_track_id.trim()
      : null;
  let effectiveCatalogTrackId = typeof catalog_track_id === "string" ? catalog_track_id : "";
  const effectiveQueueId = typeof queue_id === "string" ? queue_id : "";

  // Compat VPS: se veio queue_id de catálogo mas o build antigo não reenviou
  // catalog_track_id, recupera pelo item em processamento antes de validar.
  if (!song_id && !effectiveCatalogTrackId && effectiveQueueId) {
    const { data: qRow } = await _rawAuditSb
      .from("catalog_snapshot_queue")
      .select("catalog_track_id")
      .eq("id", effectiveQueueId)
      .eq("status", "processing")
      .maybeSingle();
    effectiveCatalogTrackId = (qRow as any)?.catalog_track_id ?? "";
  }

  // Modo catálogo: payload sem song_id mas com catalog_track_id (uuid).
  // Pula toda a lógica que depende de curator_deal_songs (batch FK, collections RPC, bump deal).
  const isCatalogMode = !song_id && effectiveCatalogTrackId.length > 0;

  // Validação: aceita song_id OU catalog_track_id
  if (!song_id && !effectiveCatalogTrackId) {
    return jr({ error: "song_id or catalog_track_id required (uuid)" }, 400);
  }
  if (song_id && typeof song_id !== "string") {
    return jr({ error: "song_id must be string (uuid)" }, 400);
  }
  if (!Array.isArray(playlists)) {
    return jr({ error: "playlists array required (may be empty)" }, 400);
  }
  const totalPlays28dValue = toInt(total_plays_28d);
  const catalogRequiresPlaylistBreakdown = isCatalogMode && (
    body?.requires_playlist_breakdown === true ||
    body?.capture_mode === "playlist_breakdown_required" ||
    bot_metadata?.requires_playlist_breakdown === true ||
    bot_metadata?.capture_mode === "playlist_breakdown_required"
  );
  const hasAggregateStreams = totalPlays28dValue != null;
  if (catalogRequiresPlaylistBreakdown && playlists.length === 0 && !hasAggregateStreams) {
    return jr({
      error: "playlist_breakdown_required",
      message: "Catalog snapshot jobs marked as playlist_breakdown_required must include playlist rows or an aggregate total_plays_28d value; empty payload was not saved.",
      catalog_track_id: effectiveCatalogTrackId,
      queue_id: effectiveQueueId || null,
    }, 422);
  }
  for (const p of playlists) {
    if (!p || typeof p.name !== "string" || !p.name.trim()) {
      return jr({ error: "each playlist must have a non-empty name" }, 400);
    }
  }


  const screenshotUrls = [
    ...(Array.isArray(print_urls) ? print_urls : []),
    ...(typeof screenshot_url === "string" && screenshot_url.length > 0 ? [screenshot_url] : []),
  ]
    .map((url) => String(url).trim())
    .filter(Boolean)
    .filter((url, idx, arr) => arr.indexOf(url) === idx);

  if (playlists.length > 30 && screenshotUrls.length <= 1) {
    return jr({
      error: "multi_print_required",
      message: `Coleta com ${playlists.length} playlists não pode ser salva com apenas ${screenshotUrls.length} print. Envie print_urls[] com todas as partes da tela.`,
      playlists_received: playlists.length,
      prints_received: screenshotUrls.length,
    }, 422);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // --- FONTE ÚNICA DE PRINTS ---
  // Quando vier screenshot_url, cria 1 linha em bot_print_batches (= a coleta)
  // e referencia via snapshot_run_id. NÃO grava mais screenshot_url na linha.
  let snapshotRunId: string | null = null;
  if (screenshotUrls.length > 0 && !isCatalogMode) {
    // Resolve deal_id pela música (FK obrigatória em bot_print_batches)
    const { data: songMeta } = await supabase
      .from("curator_deal_songs")
      .select("deal_id")
      .eq("id", song_id)
      .maybeSingle();
    const dealForBatch = (songMeta as any)?.deal_id ?? null;
    if (dealForBatch) {
      const { data: batchRow, error: batchErr } = await supabase
        .from("bot_print_batches")
        .insert({
          deal_id: dealForBatch,
          song_id,
          batch_key: `song-snapshot-${correlation_id ?? crypto.randomUUID()}`,
          total_parts: screenshotUrls.length,
          received_parts: screenshotUrls.length,
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
      else console.warn("[bot-ingest-song-snapshot] batch insert failed", batchErr);
    }
  }

  // 1) Insere header do snapshot (sem screenshot_url — fonte única é o batch)
  const { data: snap, error: snapErr } = await supabase
    .from("song_snapshots")
    .insert({
      song_id: song_id ?? null,
      catalog_track_id: effectiveCatalogTrackId || null,
      spotify_song_id: effectiveSpotifySongId,
      correlation_id: correlation_id ?? null,
      captured_at: captured_at ?? new Date().toISOString(),
      time_window: typeof timeWindow === "string" ? timeWindow : "7d",

      total_plays_28d: totalPlays28dValue,
      screenshot_url: null,
      snapshot_run_id: snapshotRunId,
      bot_metadata: {
        ...(bot_metadata ?? {}),
        ...(isCatalogMode ? {
          catalog_track_id: effectiveCatalogTrackId,
          spotify_track_id: effectiveSpotifySongId,
          spotify_song_id: effectiveSpotifySongId,
          queue_id: effectiveQueueId || queue_id || null,
        } : {}),
      },
    })
    .select("id, captured_at")
    .single();

  if (snapErr || !snap) {
    console.error("[bot-ingest-song-snapshot] insert header failed", snapErr);
    return jr({ error: "insert_failed", detail: snapErr?.message ?? null }, 500);
  }

  // 2) Insere linhas de playlist (preserva ordem com `position`)
  if (playlists.length > 0) {
    const rows = playlists.map((p: any, idx: number) => ({
      snapshot_id: snap.id,
      spotify_playlist_id: p.spotify_playlist_id ?? null,
      spotify_url: p.spotify_url ?? null,
      name: String(p.name).trim(),
      owner: p.owner ?? null,
      plays_7d: toInt(p.plays_7d),
      position: idx,
    }));
    const { error: rowsErr } = await supabase
      .from("song_snapshot_playlists")
      .insert(rows);
    if (rowsErr) {
      console.error("[bot-ingest-song-snapshot] insert playlists failed", rowsErr);
      // Não falha o request — header já foi salvo. Marca como erro de processamento.
      await supabase
        .from("song_snapshots")
        .update({ processing_error: `playlists_insert: ${rowsErr.message}` })
        .eq("id", snap.id);
      return jr({
        ok: true,
        snapshot_id: snap.id,
        warning: "header_saved_but_playlists_failed",
        error: rowsErr.message,
      }, 207);
    }
  }

  // 2.5) Distribuição para campaign_playlist_collections (espelha bot-ingest-snapshot).
  //      Resolve campaign_id via deal → se baseline_status='pending', vira baseline
  //      oficial. RPC é atômica e idempotente. Falha silenciosa — header já salvo.
  //      [CATALOG MODE] pula totalmente — catálogo não tem deal/campanha.
  let collectionCampaignId: string | null = null;
  let collectionIntent: string | null = null;
  let collectionResult: any = null;

  if (!isCatalogMode) {
    try {
      const { data: songJoin } = await supabase
        .from("curator_deal_songs")
        .select("deal_id, curator_deals!inner(campaign_id)")
        .eq("id", song_id)
        .maybeSingle();

      collectionCampaignId =
        ((songJoin as any)?.curator_deals?.campaign_id as string | null) ?? null;

      if (collectionCampaignId && playlists.length > 0) {
        const { data: campRow } = await supabase
          .from("campaigns")
          .select("baseline_status")
          .eq("id", collectionCampaignId)
          .maybeSingle();
        collectionIntent =
          (campRow as any)?.baseline_status === "pending" ? "baseline" : "periodic";

        const capturedAt = snap.captured_at ?? new Date().toISOString();
        const rpcRows = playlists
          .map((p: any) => {
            const pid = p.spotify_playlist_id ?? null;
            if (!pid) return null;
            return {
              playlist_id: pid,
              playlist_url: p.spotify_url ?? `https://open.spotify.com/playlist/${pid}`,
              playlist_name_at_capture: String(p.name ?? "").trim() || null,
              plays_7d: Math.max(0, toInt(p.plays_7d) ?? 0),
              captured_at: capturedAt,
              source: "s4a_dom",
            };
          })
          .filter(Boolean);

        if (rpcRows.length > 0) {
          const { data: ingestRes, error: ingestErr } = await supabase.rpc(
            "ingest_campaign_collection_batch",
            {
              p_campaign_id: collectionCampaignId,
              p_intent: collectionIntent,
              p_rows: rpcRows,
              p_snapshot_run_id: snapshotRunId,
            },
          );
          if (ingestErr) {
            console.warn(
              "[bot-ingest-song-snapshot] collections rpc failed:",
              ingestErr.message,
              { campaign_id: collectionCampaignId, intent: collectionIntent },
            );
          } else {
            collectionResult = ingestRes;
            console.log(
              "[bot-ingest-song-snapshot] collections ingested:",
              JSON.stringify(ingestRes),
              { campaign_id: collectionCampaignId, intent: collectionIntent },
            );
          }
        }
      }
    } catch (e) {
      console.warn(
        "[bot-ingest-song-snapshot] collections error:",
        (e as Error).message,
      );
    }
  }

  // Marca snapshot como processado pra não reprocessar futuramente.
  await supabase
    .from("song_snapshots")
    .update({ processed_at: new Date().toISOString() })
    .eq("id", snap.id);

  // 3) Bump curator_deal_songs (só faz sentido em modo deal). [CATALOG MODE] pula.
  let nextAt: string | null = null;
  let bumpedDealSong = false;
  if (!isCatalogMode) {
    const { data: songRow } = await supabase
      .from("curator_deal_songs")
      .select("id, auto_collect_interval_minutes")
      .eq("id", song_id)
      .maybeSingle();

    if (songRow) {
      const intervalMin = (songRow as any).auto_collect_interval_minutes ?? 2880;
      nextAt = new Date(Date.now() + intervalMin * 60_000).toISOString();
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
      bumpedDealSong = true;
    }
  }

  // 4) [CATALOG MODE] fecha o item da fila de catálogo
  let catalogQueueClosed = false;
  if (isCatalogMode) {
    try {
      const updateTarget = supabase
        .from("catalog_snapshot_queue")
        .update({
          status: "done",
          completed_snapshot_id: snap.id,
          locked_at: null,
          locked_by: null,
          lease_expires_at: null,
        });
      const { error: qErr } = queue_id
        ? await updateTarget.eq("id", queue_id)
        : await updateTarget.eq("catalog_track_id", effectiveCatalogTrackId).eq("status", "processing");
      if (qErr) {
        console.warn("[bot-ingest-song-snapshot] catalog queue close failed:", qErr.message);
      } else {
        catalogQueueClosed = true;
      }
    } catch (e) {
      console.warn("[bot-ingest-song-snapshot] catalog queue close exception:", (e as Error).message);
    }
  }

  console.log(
    `[bot-ingest-song-snapshot] saved snapshot=${snap.id} mode=${isCatalogMode ? "catalog" : "deal"} ref=${song_id ?? effectiveCatalogTrackId} playlists=${playlists.length} total_28d=${total_plays_28d ?? "-"} bumped=${bumpedDealSong} catalog_closed=${catalogQueueClosed} next=${nextAt ?? "-"}`,
  );

  return jr({
    ok: true,
    mode: isCatalogMode ? "catalog" : "deal_song",
    snapshot_id: snap.id,
    captured_at: snap.captured_at,
    playlists_recorded: playlists.length,
    next_auto_collect_at: nextAt,
    deal_song_bumped: bumpedDealSong,
    catalog_queue_closed: catalogQueueClosed,
    campaign_id: collectionCampaignId,
    collection_intent: collectionIntent,
    collection_result: collectionResult,
  });
});

