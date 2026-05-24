// build-genre-reference-pool — Fase 9.
// Por subgênero ativo, monta o pool de 40 referências misturando 4 baldes:
//   10 historic  — top recorrência ponderada por tempo (search_tracks)
//   15 recent    — trend_velocity moderado (já calculado em genre_trends)
//   10 leader    — tracks que aparecem em playlists com leadership ≥ 0.55
//    5 viral     — emergence score alto (bucket=viral)
//
// Os baldes historic e leader são (re)calculados aqui e gravados em genre_trends.
// recent e viral já vêm prontos de compute-trend-velocity.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { temporalWeight } from "../_shared/recency.ts";
import { reportCronHealth } from "../_shared/cron-health.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const QUOTAS = { historic: 10, recent: 15, leader: 10, viral: 5 };
const LEADER_THRESHOLD = 0.55;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    let gQ = sb.from("genres").select("id, slug, nome").eq("ativo", true);
    if (body.genre_id) gQ = gQ.eq("id", body.genre_id);
    const { data: genres, error } = await gQ;
    if (error) throw error;
    if (!genres?.length) {
      return new Response(JSON.stringify({ ok: true, processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const summary: Array<{ genre: string; historic: number; leader: number }> = [];
    const now = new Date().toISOString();

    for (const g of genres as any[]) {
      // ── HISTORIC: agrega search_tracks ponderado por tempo (últimos 18 meses)
      const since = new Date(Date.now() - 540 * 86400_000).toISOString();
      const { data: tracks, error: tErr } = await sb
        .from("search_tracks")
        .select("spotify_track_id, nome_musica, artista, coletado_em")
        .eq("genre_id", g.id)
        .not("spotify_track_id", "is", null)
        .gte("coletado_em", since)
        .limit(10000);
      if (tErr) console.error("historic err", g.slug, tErr.message);

      const hMap = new Map<string, { score: number; name: string; artist: string; last: string }>();
      for (const t of (tracks ?? []) as any[]) {
        const w = temporalWeight(t.coletado_em);
        const cur = hMap.get(t.spotify_track_id) ?? { score: 0, name: t.nome_musica, artist: t.artista, last: t.coletado_em };
        cur.score += w;
        if (t.coletado_em > cur.last) cur.last = t.coletado_em;
        hMap.set(t.spotify_track_id, cur);
      }

      const historicTop = [...hMap.entries()]
        .sort((a, b) => b[1].score - a[1].score)
        .slice(0, QUOTAS.historic);

      // ── LEADER: tracks coletadas a partir de search_results de playlists com leadership ≥ 0.55
      // (search_tracks.result_id → search_results.id → spotify_playlist_id)
      const { data: leaderPls } = await sb
        .from("playlist_leadership")
        .select("playlists!inner(spotify_playlist_id, genre_id)")
        .gte("leadership_score", LEADER_THRESHOLD)
        .eq("playlists.genre_id", g.id);
      const leaderSpIds = (leaderPls ?? []).map((r: any) => r.playlists?.spotify_playlist_id).filter(Boolean);

      const lMap = new Map<string, { score: number; name: string; artist: string; last: string }>();
      if (leaderSpIds.length) {
        const { data: leaderResults } = await sb
          .from("search_results")
          .select("id")
          .in("spotify_playlist_id", leaderSpIds);
        const resultIds = (leaderResults ?? []).map((r: any) => r.id);
        if (resultIds.length) {
          const { data: lTracks } = await sb
            .from("search_tracks")
            .select("spotify_track_id, nome_musica, artista, coletado_em")
            .in("result_id", resultIds)
            .not("spotify_track_id", "is", null)
            .limit(5000);
          for (const t of (lTracks ?? []) as any[]) {
            const w = temporalWeight(t.coletado_em);
            const cur = lMap.get(t.spotify_track_id) ?? { score: 0, name: t.nome_musica, artist: t.artista, last: t.coletado_em };
            cur.score += w;
            if (t.coletado_em > cur.last) cur.last = t.coletado_em;
            lMap.set(t.spotify_track_id, cur);
          }
        }
      }
      const leaderTop = [...lMap.entries()]
        .sort((a, b) => b[1].score - a[1].score)
        .slice(0, QUOTAS.leader);

      // ── escreve: limpa historic+leader antigos do gênero, insere novos
      await sb.from("genre_trends").delete()
        .eq("genre_id", g.id)
        .in("bucket", ["historic", "leader"]);

      const rows: Array<any> = [];
      for (const [tid, v] of historicTop) {
        rows.push({
          genre_id: g.id, track_id: tid, bucket: "historic",
          score: Number(v.score.toFixed(4)), velocity: null,
          artist: v.artist, track_name: v.name,
          evidence: { source: "search_tracks", weighted: true },
          last_seen_at: v.last, updated_at: now,
        });
      }
      for (const [tid, v] of leaderTop) {
        rows.push({
          genre_id: g.id, track_id: tid, bucket: "leader",
          score: Number(v.score.toFixed(4)), velocity: null,
          artist: v.artist, track_name: v.name,
          evidence: { source: "leader_playlists", count: leaderSpIds.length },
          last_seen_at: v.last, updated_at: now,
        });
      }
      if (rows.length) {
        const { error: insErr } = await sb.from("genre_trends").insert(rows);
        if (insErr) console.error("insert genre_trends", g.slug, insErr.message);
      }

      summary.push({ genre: g.slug, historic: historicTop.length, leader: leaderTop.length });
    }

    return new Response(JSON.stringify({ ok: true, processed: summary.length, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
