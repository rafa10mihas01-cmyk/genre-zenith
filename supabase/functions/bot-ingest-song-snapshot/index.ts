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
  try {
    body = await req.json();
  } catch {
    return jr({ error: "invalid_json" }, 400);
  }

  const {
    song_id,
    spotify_song_id,
    correlation_id,
    captured_at,
    window: timeWindow,
    total_plays_28d,
    screenshot_url,
    playlists,
    bot_metadata,
  } = body ?? {};

  // Validação mínima
  if (!song_id || typeof song_id !== "string") {
    return jr({ error: "song_id required (uuid)" }, 400);
  }
  if (!Array.isArray(playlists)) {
    return jr({ error: "playlists array required (may be empty)" }, 400);
  }
  for (const p of playlists) {
    if (!p || typeof p.name !== "string" || !p.name.trim()) {
      return jr({ error: "each playlist must have a non-empty name" }, 400);
    }
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // 1) Insere header do snapshot
  const { data: snap, error: snapErr } = await supabase
    .from("song_snapshots")
    .insert({
      song_id,
      spotify_song_id: spotify_song_id ?? null,
      correlation_id: correlation_id ?? null,
      captured_at: captured_at ?? new Date().toISOString(),
      time_window: typeof timeWindow === "string" ? timeWindow : "7d",
      total_plays_28d: toInt(total_plays_28d),
      screenshot_url: screenshot_url ?? null,
      bot_metadata: bot_metadata ?? {},
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

  console.log(
    `[bot-ingest-song-snapshot] saved snapshot=${snap.id} song=${song_id} playlists=${playlists.length} total_28d=${total_plays_28d ?? "-"}`,
  );

  return jr({
    ok: true,
    snapshot_id: snap.id,
    captured_at: snap.captured_at,
    playlists_recorded: playlists.length,
  });
});
