// sync-spotify-editorial-charts
// =====================================================================
// Sincroniza charts editoriais oficiais do Spotify (Top 50 BR, Viral 50 BR,
// Top 50 Global) lendo as playlists curadas oficialmente via Web API.
//
// Diferente do `sync-kworb-charts` (scraping kworb.net = só posição + streams),
// aqui pegamos via API oficial: capa, álbum, popularidade, track_id e artist_id.
//
// Grava em public.raw_chart_daily com chart_name distinto:
//   - spotify_top50_br
//   - spotify_viral50_br
//   - spotify_top50_global
// source = 'spotify_editorial'
//
// Estratégia de token: tenta user token primeiro (mais permissivo p/ editorial),
// cai pra client_credentials se não houver usuário conectado.
// =====================================================================
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getSpotifyToken, getUserAccessToken } from "../_shared/spotify.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CHARTS: Array<{ chart_name: string; playlist_id: string; label: string }> = [
  { chart_name: "spotify_top50_br",     playlist_id: "37i9dQZEVXbMXbN3EUUhlg", label: "Top 50 — Brasil" },
  { chart_name: "spotify_viral50_br",   playlist_id: "37i9dQZEVXbKuaTI1Z1Afx", label: "Viral 50 — Brasil" },
  { chart_name: "spotify_top50_global", playlist_id: "37i9dQZEVXbMDoHDwVN2tF", label: "Top 50 — Global" },
];

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getAnyToken(): Promise<string> {
  try {
    const { token } = await getUserAccessToken();
    return token;
  } catch {
    return await getSpotifyToken();
  }
}

async function fetchPlaylistTracks(playlistId: string, token: string) {
  const url =
    `https://api.spotify.com/v1/playlists/${playlistId}` +
    `?fields=name,tracks.items(track(id,name,popularity,artists(id,name),album(name,images)))`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Spotify ${r.status}: ${t.slice(0, 200)}`);
  }
  const j = await r.json();
  const items = j?.tracks?.items ?? [];
  return items
    .map((it: any, idx: number) => {
      const tr = it?.track;
      if (!tr?.id) return null;
      const imgs = tr.album?.images ?? [];
      const cover = imgs[0]?.url ?? null;
      const artists = (tr.artists ?? []).filter(Boolean);
      return {
        position: idx + 1,
        spotify_track_id: tr.id,
        track: tr.name ?? null,
        artist: artists.map((a: any) => a?.name).filter(Boolean).join(", ") || null,
        spotify_artist_id: artists[0]?.id ?? null,
        album_name: tr.album?.name ?? null,
        cover_url: cover,
        popularity: typeof tr.popularity === "number" ? tr.popularity : null,
      };
    })
    .filter(Boolean);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const start = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  try {
    const token = await getAnyToken();
    const out: Record<string, number> = {};

    for (const chart of CHARTS) {
      try {
        const rows = await fetchPlaylistTracks(chart.playlist_id, token);
        if (rows.length === 0) {
          out[chart.chart_name] = 0;
          continue;
        }

        // Limpa snapshot do dia (idempotente)
        await supabase
          .from("raw_chart_daily")
          .delete()
          .eq("chart_name", chart.chart_name)
          .eq("chart_date", today);

        const payload = rows.map((r: any) => ({
          chart_name: chart.chart_name,
          chart_date: today,
          position: r.position,
          artist: r.artist,
          track: r.track,
          streams_day: 0, // editorial não tem streams; popularity guarda o sinal
          spotify_track_id: r.spotify_track_id,
          spotify_artist_id: r.spotify_artist_id,
          cover_url: r.cover_url,
          album_name: r.album_name,
          popularity: r.popularity,
          source: "spotify_editorial",
        }));

        const { error } = await supabase.from("raw_chart_daily").insert(payload);
        if (error) throw new Error(`insert ${chart.chart_name}: ${error.message}`);
        out[chart.chart_name] = rows.length;
      } catch (e) {
        out[chart.chart_name] = -1;
        await supabase.from("collection_logs").insert({
          acao: "sync-spotify-editorial-charts",
          status: "erro",
          mensagem: `${chart.chart_name}: ${(e as Error).message}`.slice(0, 500),
        });
      }
    }

    await supabase.from("collection_logs").insert({
      acao: "sync-spotify-editorial-charts",
      status: "sucesso",
      mensagem: `charts: ${JSON.stringify(out)}`,
      duracao_ms: Date.now() - start,
    });

    return jr({ ok: true, date: today, results: out });
  } catch (e) {
    const msg = (e as Error).message;
    await supabase.from("collection_logs").insert({
      acao: "sync-spotify-editorial-charts",
      status: "erro",
      mensagem: msg.slice(0, 500),
      duracao_ms: Date.now() - start,
    });
    return jr({ ok: false, error: msg }, 500);
  }
});
