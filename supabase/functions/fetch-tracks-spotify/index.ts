// fetch-tracks-spotify — busca tracks de uma playlist via Spotify Web API
// (substitui chamadas Apify mode:"urls" que custavam 1 unidade por playlist).
//
// Uso típico (on-demand): chamado pelo extract-blueprints / create-spotify-playlist
// quando precisa do DNA real (tracks reais) de uma playlist semente.
//
// Body: { playlist_id: string, result_id?: string, save?: boolean, max?: number }
//   - playlist_id: spotify_playlist_id (ID público do Spotify)
//   - result_id:   se passado + save=true, persiste em search_tracks
//   - save:        default false (apenas retorna). true = grava em search_tracks
//   - max:         default 100 (1 página). Use 200/300 pra playlists maiores
//
// Retorno: { ok, tracks: [{ spotify_track_id, nome_musica, artista, posicao_na_playlist }], saved }
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getAppToken } from "../_shared/spotify-client.ts";
import { listPlaylistTracksRich } from "../_shared/spotify-playlist.ts";
import { requireTeamAccess } from "../_shared/auth.ts";

import { deprecationGate } from "../_shared/_deprecation.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface Body {
  playlist_id: string;
  result_id?: string;
  save?: boolean;
  max?: number;
}

interface TrackOut {
  spotify_track_id: string | null;
  nome_musica: string;
  artista: string;
  posicao_na_playlist: number;
}

async function fetchPlaylistTracks(
  playlistId: string,
  token: string,
  max: number,
): Promise<TrackOut[]> {
  const rich = await listPlaylistTracksRich(playlistId, token, {
    max,
    fields: "items(track(id,name,artists(name))),next",
  });
  return rich.map((t, i) => ({
    spotify_track_id: t.spotify_track_id,
    nome_musica: t.name || "Unknown",
    artista: t.artists || "Unknown",
    posicao_na_playlist: i + 1,
  }));
}

Deno.serve(async (req) => {
  const __dep = await deprecationGate(req, "fetch-tracks-spotify");
  if (__dep) return __dep;
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "OPTIONS") {
    const guard = await requireTeamAccess(req);
    if (!guard.ok) return guard.resp;
  }
  const start = Date.now();

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!body.playlist_id || typeof body.playlist_id !== "string") {
    return new Response(JSON.stringify({ error: "playlist_id é obrigatório" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const max = Math.max(1, Math.min(body.max ?? 100, 500));
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const token = await getAppToken();
    const tracks = await fetchPlaylistTracks(body.playlist_id, token, max);

    let saved = 0;
    if (body.save && body.result_id && tracks.length > 0) {
      // Resolve genre_id pelo result_id pra preencher search_tracks consistente
      const { data: result } = await supabase
        .from("search_results")
        .select("genre_id")
        .eq("id", body.result_id)
        .maybeSingle();

      // Limpa tracks antigas dessa playlist (snapshot atual)
      await supabase.from("search_tracks").delete().eq("result_id", body.result_id);

      const nowIso = new Date().toISOString();
      const rows = tracks.map((t) => ({
        result_id: body.result_id!,
        genre_id: result?.genre_id ?? null,
        spotify_track_id: t.spotify_track_id,
        nome_musica: t.nome_musica,
        artista: t.artista,
        posicao_na_playlist: t.posicao_na_playlist,
        coletado_em: nowIso,
      }));
      const { error: insErr } = await supabase.from("search_tracks").insert(rows);
      if (insErr) throw new Error(`save tracks: ${insErr.message}`);
      saved = rows.length;
    }

    await supabase.from("collection_logs").insert({
      acao: "fetch-tracks-spotify",
      status: "sucesso",
      mensagem: `playlist ${body.playlist_id}: ${tracks.length} tracks${saved ? ` (saved ${saved})` : ""}`,
      duracao_ms: Date.now() - start,
    });

    return new Response(JSON.stringify({
      ok: true,
      playlist_id: body.playlist_id,
      tracks,
      total: tracks.length,
      saved,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = (e as Error).message;
    await supabase.from("collection_logs").insert({
      acao: "fetch-tracks-spotify",
      status: "erro",
      mensagem: `playlist ${body.playlist_id}: ${msg}`.slice(0, 500),
      duracao_ms: Date.now() - start,
    });
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
