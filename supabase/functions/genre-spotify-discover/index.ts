// genre-spotify-discover — Caminho B: bypass do bot scraper.
// Busca playlists públicas + tracks no Spotify API direto e popula
// search_results + search_tracks. Habilita o ciclo de aprendizado.
//
// POST { genre_id: string, max_terms?: number, max_playlists_per_term?: number, max_tracks_per_playlist?: number }
//
// Idempotente — upsert por spotify_playlist_id / spotify_track_id.
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";
import { getSpotifyToken } from "../_shared/spotify.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const YEAR = new Date().getFullYear();

// Termos default quando o gênero não tem search_terms cadastrados ainda.
function defaultTerms(slug: string, nome: string): string[] {
  const base = nome || slug;
  return [
    `${base} ${YEAR}`,
    `${base} atualizada`,
    `${base} top`,
    `${base} as melhores`,
    `${base} mais tocadas`,
    `${base} viral`,
    `${base} hits`,
    `melhor ${base}`,
  ];
}

async function spotifyFetch(token: string, url: string): Promise<any> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 429) {
    const retry = Number(r.headers.get("retry-after") ?? "2");
    await new Promise((res) => setTimeout(res, (retry + 1) * 1000));
    return spotifyFetch(token, url);
  }
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`spotify ${r.status}: ${t.slice(0, 200)}`);
  }
  return r.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  try {
    const body = await req.json().catch(() => ({}));
    const genreId: string = body?.genre_id;
    const maxTerms = Math.min(Math.max(Number(body?.max_terms ?? 8), 1), 20);
    const maxPlsPerTerm = Math.min(Math.max(Number(body?.max_playlists_per_term ?? 20), 1), 50);
    const maxTracksPerPl = Math.min(Math.max(Number(body?.max_tracks_per_playlist ?? 40), 1), 100);

    if (!genreId) return jr({ ok: false, error: "genre_id obrigatório" }, 400);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: genre } = await supabase
      .from("genres")
      .select("id, slug, nome")
      .eq("id", genreId)
      .maybeSingle();
    if (!genre) return jr({ ok: false, error: "gênero não encontrado" }, 404);

    const stats = {
      genre: { id: genre.id, slug: genre.slug, nome: genre.nome },
      terms_used: 0,
      playlists_seen: 0,
      playlists_upserted: 0,
      tracks_upserted: 0,
      errors: [] as string[],
    };

    // 1) Termos: do banco ou defaults.
    let { data: termRows } = await supabase
      .from("search_terms")
      .select("id, termo")
      .eq("genre_id", genreId)
      .limit(maxTerms);

    if (!termRows || termRows.length === 0) {
      const defaults = defaultTerms(genre.slug, genre.nome);
      const inserted: { id: string; termo: string }[] = [];
      for (const termo of defaults.slice(0, maxTerms)) {
        const { data: ins, error: insErr } = await supabase
          .from("search_terms")
          .insert({ genre_id: genreId, termo, tipo: "auto" })
          .select("id, termo")
          .single();
        if (insErr) stats.errors.push(`insert term "${termo}": ${insErr.message}`);
        if (ins) inserted.push(ins);
      }
      termRows = inserted;
    }
    stats.terms_used = termRows.length;

    const token = await getSpotifyToken();

    // 2) Pra cada termo, busca playlists.
    const seenPlaylistIds = new Set<string>();
    const newPlaylistRows: Array<{ result_id: string; spotify_playlist_id: string }> = [];

    for (let ti = 0; ti < termRows.length; ti++) {
      const term = termRows[ti];
      try {
        const url = `https://api.spotify.com/v1/search?type=playlist&limit=${maxPlsPerTerm}&q=${encodeURIComponent(term.termo)}`;
        const data = await spotifyFetch(token, url);
        const items = data?.playlists?.items ?? [];

        for (let i = 0; i < items.length; i++) {
          const p = items[i];
          if (!p || !p.id) continue;
          stats.playlists_seen++;
          if (seenPlaylistIds.has(p.id)) continue;
          seenPlaylistIds.add(p.id);

          const followers = p.followers?.total ?? null;
          const totalTracks = p.tracks?.total ?? null;
          const img = p.images?.[0]?.url ?? null;

          const payload = {
            genre_id: genreId,
            term_id: term.id,
            nome_playlist: p.name ?? "(sem nome)",
            posicao: i + 1,
            spotify_url: p.external_urls?.spotify ?? `https://open.spotify.com/playlist/${p.id}`,
            spotify_playlist_id: p.id,
            seguidores: followers,
            imagem_url: img,
            descricao: p.description ?? null,
            total_musicas: totalTracks,
            followers_source: "spotify_api",
            followers_verified_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
          };

          // Procura existente por spotify_playlist_id+genre
          const { data: existing } = await supabase
            .from("search_results")
            .select("id")
            .eq("spotify_playlist_id", p.id)
            .eq("genre_id", genreId)
            .maybeSingle();

          if (existing) {
            await supabase.from("search_results").update({
              ...payload,
              times_seen: undefined,
            }).eq("id", existing.id);
            newPlaylistRows.push({ result_id: existing.id, spotify_playlist_id: p.id });
          } else {
            const { data: ins } = await supabase
              .from("search_results")
              .insert(payload)
              .select("id")
              .single();
            if (ins) {
              stats.playlists_upserted++;
              newPlaylistRows.push({ result_id: ins.id, spotify_playlist_id: p.id });
            }
          }
        }
      } catch (e) {
        stats.errors.push(`term "${term.termo}": ${(e as Error).message}`);
      }
    }

    // 3) Pega detalhes (followers + total_tracks) + tracks das playlists top. Limita pra não estourar tempo.
    const topPlaylists = newPlaylistRows.slice(0, 30);

    for (const pl of topPlaylists) {
      try {
        const url = `https://api.spotify.com/v1/playlists/${pl.spotify_playlist_id}?fields=followers(total),tracks(total,items(track(id,name,artists(name))))&limit=${maxTracksPerPl}`;
        const data = await spotifyFetch(token, url);
        const followers = data?.followers?.total ?? null;
        const totalTracks = data?.tracks?.total ?? null;
        if (followers !== null || totalTracks !== null) {
          await supabase.from("search_results").update({
            seguidores: followers,
            total_musicas: totalTracks,
            followers_source: "spotify_api",
            followers_verified_at: new Date().toISOString(),
          }).eq("id", pl.result_id);
        }
        const items = data?.tracks?.items ?? [];

        const trackRows = items
          .map((it: any, idx: number) => {
            const t = it?.track;
            if (!t || !t.id) return null;
            return {
              genre_id: genreId,
              result_id: pl.result_id,
              nome_musica: t.name ?? "",
              artista: (t.artists ?? []).map((a: any) => a.name).filter(Boolean).join(", "),
              spotify_track_id: t.id,
              posicao_na_playlist: idx + 1,
            };
          })
          .filter(Boolean);

        if (trackRows.length > 0) {
          // Delete antigos dessa playlist+genre e insere novos
          await supabase.from("search_tracks")
            .delete()
            .eq("result_id", pl.result_id);
          const { error: tErr } = await supabase.from("search_tracks").insert(trackRows);
          if (!tErr) stats.tracks_upserted += trackRows.length;
        }
      } catch (e) {
        stats.errors.push(`playlist ${pl.spotify_playlist_id}: ${(e as Error).message}`);
      }
    }

    return jr({ ok: true, ...stats });
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
