// hydrate-genre-reference-tracks — preenche search_tracks usando Spotify API
// para playlists de referência que já existem em search_results mas ainda não
// têm faixas salvas. Resolve gêneros com referências sem DNA musical.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
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

async function spotifyFetch(token: string, url: string): Promise<any> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 429) {
    const retry = Number(r.headers.get("retry-after") ?? "2");
    await new Promise((res) => setTimeout(res, (retry + 1) * 1000));
    return spotifyFetch(token, url);
  }
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Spotify ${r.status}: ${txt.slice(0, 180)}`);
  }
  return r.json();
}

function normalizeReleaseDate(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`;
  if (/^\d{4}$/.test(raw)) return `${raw}-01-01`;
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  try {
    const body = await req.json().catch(() => ({}));
    const genreId: string | null = body?.genre_id ?? null;
    const limit = Math.min(Math.max(Number(body?.limit ?? 25), 1), 100);
    const maxTracks = Math.min(Math.max(Number(body?.max_tracks ?? 100), 10), 300);
    const onlyMissing = body?.only_missing !== false;

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    let q = supabase
      .from("search_results")
      .select("id, genre_id, spotify_playlist_id, nome_playlist, total_musicas, seguidores, coletado_em")
      .eq("is_valid", true)
      .not("spotify_playlist_id", "is", null)
      .order("seguidores", { ascending: false, nullsFirst: false })
      .limit(limit * 3);
    if (genreId) q = q.eq("genre_id", genreId);

    const { data: candidates, error } = await q;
    if (error) throw new Error(error.message);

    const picked: any[] = [];
    for (const row of candidates ?? []) {
      if (picked.length >= limit) break;
      if (onlyMissing) {
        const { count } = await supabase
          .from("search_tracks")
          .select("id", { count: "exact", head: true })
          .eq("result_id", row.id);
        if ((count ?? 0) > 0) continue;
      }
      picked.push(row);
    }

    if (picked.length === 0) return jr({ ok: true, processed: 0, saved: 0, errors: [] });

    const token = await getSpotifyToken();
    let saved = 0;
    const errors: Array<{ id: string; name: string | null; error: string }> = [];

    for (const row of picked) {
      try {
        const rowsByTrack = new Map<string, any>();
        let url: string | null =
          `https://api.spotify.com/v1/playlists/${row.spotify_playlist_id}/items` +
          `?fields=items(track(id,name,duration_ms,popularity,artists(name),album(name,release_date,images))),next&limit=100`;
        let pos = 0;
        while (url && rowsByTrack.size < maxTracks) {
          const j = await spotifyFetch(token, url);
          for (const it of j.items ?? []) {
            const tr = it?.track;
            if (!tr?.id) { pos++; continue; }
            const imgs = tr.album?.images ?? [];
            if (!rowsByTrack.has(tr.id)) rowsByTrack.set(tr.id, {
              genre_id: row.genre_id,
              result_id: row.id,
              nome_musica: tr.name ?? "Desconhecida",
              artista: (tr.artists ?? []).map((a: any) => a?.name).filter(Boolean).join(", ") || "Desconhecido",
              spotify_track_id: tr.id,
              posicao_na_playlist: ++pos,
              coletado_em: new Date().toISOString(),
              cover_url: imgs[0]?.url ?? imgs[imgs.length - 1]?.url ?? null,
              release_date: normalizeReleaseDate(tr.album?.release_date),
              popularity: typeof tr.popularity === "number" ? tr.popularity : null,
              album: tr.album?.name ?? null,
              duration_ms: tr.duration_ms ?? null,
            });
            if (rowsByTrack.size >= maxTracks) break;
          }
          url = j.next ?? null;
        }
        const rows = Array.from(rowsByTrack.values());
        if (rows.length > 0) {
          const { error: insErr } = await supabase
            .from("search_tracks")
            .upsert(rows, { onConflict: "genre_id,spotify_track_id" });
          if (insErr) throw new Error(insErr.message);
          saved += rows.length;
        }
      } catch (e) {
        errors.push({ id: row.id, name: row.nome_playlist ?? null, error: (e as Error).message });
      }
    }

    if (genreId) {
      const [{ count: pCount }, { count: tCount }] = await Promise.all([
        supabase.from("search_results").select("id", { count: "exact", head: true }).eq("genre_id", genreId).eq("is_valid", true),
        supabase.from("search_tracks").select("id", { count: "exact", head: true }).eq("genre_id", genreId),
      ]);
      await supabase.from("genres").update({
        total_playlists: pCount ?? 0,
        total_musicas: tCount ?? 0,
        ultima_coleta: new Date().toISOString(),
      }).eq("id", genreId);
    }

    return jr({ ok: true, processed: picked.length, saved, errors });
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});