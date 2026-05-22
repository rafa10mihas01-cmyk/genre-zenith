// compute-trend-velocity — Fase 9.
// Mede crescimento de presença de cada track no universo de playlists rastreadas.
//   trend_velocity = presença últimos 14d / max(1, presença 60d/4)
// Identifica tracks "emergentes" (velocity ≥ 2.5) por subgênero.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const WINDOW_RECENT = 14;
const WINDOW_HISTORIC = 60;
const VIRAL_THRESHOLD = 2.5;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

    const cutoffRecent = new Date(Date.now() - WINDOW_RECENT * 86400_000).toISOString();
    const cutoffHistoric = new Date(Date.now() - WINDOW_HISTORIC * 86400_000).toISOString();

    // 1) busca snapshots dos últimos 60d
    const { data: snaps, error } = await sb
      .from("playlist_track_snapshots")
      .select("playlist_spotify_id, track_ids, captured_at")
      .gte("captured_at", cutoffHistoric)
      .limit(20000);
    if (error) throw error;

    if (!snaps?.length) {
      return new Response(JSON.stringify({ ok: true, tracks: 0, note: "no snapshots" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) mapa playlist→genre (via playlists)
    const plIds = [...new Set(snaps.map((s: any) => s.playlist_spotify_id))];
    const { data: pls } = await sb
      .from("playlists")
      .select("spotify_playlist_id, genre_id")
      .in("spotify_playlist_id", plIds)
      .not("genre_id", "is", null);
    const plGenre = new Map<string, string>();
    for (const p of (pls ?? []) as any[]) plGenre.set(p.spotify_playlist_id, p.genre_id);

    // 3) conta presença (track, genre) em janelas
    type Bucket = { recent: number; historic: number };
    const counter = new Map<string, Bucket>(); // key = `${genre_id}|${track_id}`

    for (const s of snaps as any[]) {
      const g = plGenre.get(s.playlist_spotify_id);
      if (!g) continue;
      const isRecent = s.captured_at >= cutoffRecent;
      for (const tid of (s.track_ids ?? [])) {
        const k = `${g}|${tid}`;
        const b = counter.get(k) ?? { recent: 0, historic: 0 };
        if (isRecent) b.recent++;
        b.historic++;
        counter.set(k, b);
      }
    }

    // 4) calcula velocity, prepara upserts
    type Row = {
      genre_id: string; track_id: string; bucket: "recent" | "viral";
      score: number; velocity: number; evidence: any; last_seen_at: string; updated_at: string;
    };
    const rows: Row[] = [];
    const now = new Date().toISOString();

    for (const [k, b] of counter.entries()) {
      const [genre_id, track_id] = k.split("|");
      const baseline = Math.max(1, b.historic / (WINDOW_HISTORIC / WINDOW_RECENT));
      const velocity = b.recent / baseline;
      // TEMP: baseline relaxado (b.recent<1) enquanto playlist_track_snapshots
      // ainda está acumulando histórico. Voltar a `<2` quando snaps>500.
      if (b.recent < 1 && velocity < 1.5) continue; // ruído
      const bucket: "recent" | "viral" = velocity >= VIRAL_THRESHOLD && b.recent >= 3 ? "viral" : "recent";
      const score = Number((velocity * Math.log10(1 + b.recent)).toFixed(4));
      rows.push({
        genre_id, track_id, bucket,
        score, velocity: Number(velocity.toFixed(4)),
        evidence: { presence_14d: b.recent, presence_60d: b.historic },
        last_seen_at: now, updated_at: now,
      });
    }

    // 5) upsert em lotes
    let written = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const slice = rows.slice(i, i + 500);
      const { error: upErr } = await sb
        .from("genre_trends")
        .upsert(slice, { onConflict: "genre_id,track_id,bucket" });
      if (upErr) { console.error(upErr.message); continue; }
      written += slice.length;
    }

    const viralCount = rows.filter(r => r.bucket === "viral").length;
    return new Response(JSON.stringify({
      ok: true, tracks: rows.length, viral: viralCount, snapshots: snaps.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
