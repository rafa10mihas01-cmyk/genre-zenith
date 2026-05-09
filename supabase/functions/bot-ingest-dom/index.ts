// bot-ingest-dom — Recebe dados DOM (playsMap) do bot diretamente, sem prints.
// Permite coleta diária independente do ciclo de prints (que ocorre a cada 7 dias).
//
// Auth: header x-bot-key.
//
// Aceita 2 formatos:
//
// 1) Single song:
// POST {
//   deal_id, song_id,
//   playlists: [{ playlist_name, spotify_url, plays_24h, plays_7d, plays_28d, followers? }],
//   note?
// }
//
// 2) Batch (múltiplas songs):
// POST {
//   items: [
//     { deal_id, song_id, playlists: [...], note? },
//     ...
//   ]
// }
//
// Retorna: { ok, results: [{ song_id, inserted, skipped, deduped?, error? }] }
import { createClient } from "npm:@supabase/supabase-js@2";
import { assertDealOperable } from "../_shared/deal-access.ts";
import { recordMetric } from "../_shared/ops-metrics.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-bot-key, x-worker-id, x-process-id, x-hostname, x-timer-id, x-bot-name, x-bot-session, x-correlation-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

const extractId = (url: string | null | undefined) => {
  if (!url) return null;
  const m = url.match(/playlist[/:]([a-zA-Z0-9]{16,})/);
  return m ? m[1] : null;
};

const toInt = (v: unknown) => {
  const n = parseInt(String(v ?? "")) || 0;
  return n > 0 ? n : 0;
};

type DomItem = {
  deal_id: string;
  song_id: string;
  playlists: Array<{
    playlist_name?: string | null;
    spotify_url?: string | null;
    plays_24h?: number | string | null;
    plays_7d?: number | string | null;
    plays_28d?: number | string | null;
    followers?: number | null;
    source?: string | null;
  }>;
  note?: string | null;
  correlation_id?: string | null;
};

async function processItem(
  supabase: ReturnType<typeof createClient>,
  item: DomItem,
): Promise<{ song_id: string; ok: boolean; inserted?: number; skipped?: number; deduped?: boolean; error?: string }> {
  const { deal_id, song_id, playlists, note } = item;

  if (!deal_id || !song_id) {
    return { song_id: song_id ?? "", ok: false, error: "deal_id and song_id required" };
  }
  if (!Array.isArray(playlists) || playlists.length === 0) {
    return { song_id, ok: false, error: "playlists array required" };
  }

  // Gate de ciclo de vida do deal
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
    return { song_id, ok: false, error: gate.error };
  }

  // Dedupe: se já existe log dessa song nos últimos 90s, ignora
  {
    const since = new Date(Date.now() - 90_000).toISOString();
    const { data: recent } = await supabase
      .from("curator_deal_logs")
      .select("id")
      .eq("song_id", song_id)
      .gte("created_at", since)
      .limit(1);
    if (recent && recent.length > 0) {
      const { data: songRow } = await supabase
        .from("curator_deal_songs")
        .select("auto_collect_interval_minutes")
        .eq("id", song_id)
        .single();
      const intervalMin = (songRow as any)?.auto_collect_interval_minutes ?? 1440;
      const nextAt = new Date(Date.now() + intervalMin * 60_000).toISOString();
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
      return { song_id, ok: true, deduped: true, inserted: 0, skipped: 0 };
    }
  }

  // Detecta baseline (primeira coleta)
  const { count: existingLogs } = await supabase
    .from("curator_deal_logs")
    .select("id", { count: "exact", head: true })
    .eq("song_id", song_id);
  const isBaseline = (existingLogs ?? 0) === 0;

  let inserted = 0;
  let skipped = 0;
  let totalPlays = 0;

  for (const p of playlists) {
    const sUrl = p.spotify_url ?? "";
    const sName = p.playlist_name ?? null;
    const sId = extractId(sUrl);

    const plays24h = p.plays_24h != null ? toInt(p.plays_24h) : null;
    const plays7d  = p.plays_7d  != null ? toInt(p.plays_7d)  : null;
    const plays28d = p.plays_28d != null ? toInt(p.plays_28d) : null;
    // Campo legado `plays` (NOT NULL): preferimos 24h → 7d → 28d → 0
    const plays = plays24h ?? plays7d ?? plays28d ?? 0;
    totalPlays += plays;

    // Match playlist via RPC
    let playlistId: string | null = null;
    let matchMethod: string | null = null;
    {
      const { data: matchData } = await supabase.rpc("match_curator_playlist", {
        p_deal_id: deal_id,
        p_spotify_playlist_id: sId,
        p_playlist_name: sName,
      });
      const row = Array.isArray(matchData) ? matchData[0] : null;
      if ((row as any)?.playlist_id) {
        playlistId = (row as any).playlist_id as string;
        matchMethod = ((row as any).match_method as string) ?? null;
      }
    }

    if (!playlistId) {
      const { data: created, error: cErr } = await supabase
        .from("curator_playlists")
        .insert({
          deal_id,
          song_id,
          spotify_url: sUrl,
          spotify_playlist_id: sId,
          playlist_name: sName ?? "Sem nome",
          followers: p.followers ?? null,
        })
        .select("id")
        .single();
      if (cErr) { skipped++; continue; }
      playlistId = (created as any).id;
      matchMethod = "created";
    }

    const { error: insErr } = await supabase.from("curator_deal_snapshots").insert({
      deal_id,
      song_id,
      playlist_id: playlistId,
      plays,
      plays_24h: plays24h,
      plays_7d:  plays7d,
      plays_28d: plays28d,
      source: p.source ?? "spotify_for_artists_dom",
      match_method: matchMethod ?? (sId ? "spotify_id" : "name"),
      is_baseline: isBaseline,
      correlation_id: item.correlation_id ?? null,
    });
    if (insErr) skipped++; else inserted++;
  }

  // Log do total
  await supabase.from("curator_deal_logs").insert({
    deal_id,
    song_id,
    total_plays: Math.max(0, totalPlays),
    note: note ?? (isBaseline ? `[bot dom] baseline inicial` : `[bot dom] coleta diária`),
    print_urls: [],
    is_baseline: isBaseline,
  });

  // Atualiza song com next_auto_collect_at
  const { data: songRow } = await supabase
    .from("curator_deal_songs")
    .select("auto_collect_interval_minutes")
    .eq("id", song_id)
    .single();
  const intervalMin = (songRow as any)?.auto_collect_interval_minutes ?? 1440;
  const nextAt = new Date(Date.now() + intervalMin * 60_000).toISOString();

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

  return { song_id, ok: true, inserted, skipped };
}

Deno.serve(async (req) => {
  const t0 = Date.now();
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ error: "method_not_allowed" }, 405);
  if (req.headers.get("x-bot-key") !== BOT_API_KEY) return jr({ error: "unauthorized" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return jr({ error: "invalid_json" }, 400); }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const correlationHeader = req.headers.get("x-correlation-id");

  // Normaliza para lista de items
  const items: DomItem[] = Array.isArray(body?.items)
    ? body.items.map((i: any) => ({ ...i, correlation_id: i.correlation_id ?? correlationHeader ?? null }))
    : [{ ...body, correlation_id: body?.correlation_id ?? correlationHeader ?? null }];

  const results: Awaited<ReturnType<typeof processItem>>[] = [];
  let totalInserted = 0;
  let totalSkipped = 0;
  let errors = 0;

  for (const item of items) {
    try {
      const r = await processItem(supabase, item);
      results.push(r);
      totalInserted += r.inserted ?? 0;
      totalSkipped += r.skipped ?? 0;
      if (!r.ok) errors++;
    } catch (e) {
      errors++;
      results.push({ song_id: (item as any)?.song_id ?? "", ok: false, error: (e as Error).message });
    }
  }

  await supabase.from("collection_logs").insert({
    acao: "bot_ingest_dom",
    status: errors > 0 ? "parcial" : "ok",
    mensagem: `items=${items.length} inserted=${totalInserted} skipped=${totalSkipped} errors=${errors}`,
  });

  recordMetric(supabase, {
    scope: "bot",
    operation: "bot-ingest-dom",
    status: errors > 0 ? "partial" : "success",
    duration_ms: Date.now() - t0,
    metadata: { items: items.length, inserted: totalInserted, skipped: totalSkipped, errors },
  });

  return jr({ ok: errors === 0, results, inserted: totalInserted, skipped: totalSkipped });
});
