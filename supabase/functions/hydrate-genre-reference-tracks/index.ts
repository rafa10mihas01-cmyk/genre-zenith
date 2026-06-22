// hydrate-genre-reference-tracks — preenche search_tracks com as faixas das
// playlists de referência de cada gênero.
//
// Fase 17-C (arquitetura definitiva):
//   - Listagem pública de items via OBSERVER (observerListAllPlaylistItems).
//   - popularity / ISRC via CACHE (spotify_track_cache); miss → auto-enqueue.
// Nenhuma chamada a api.spotify.com.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";
import { observerListAllPlaylistItems } from "../_shared/observer-playlist.ts";
import { getTrackCacheBatch } from "../_shared/spotify-cache.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

    let saved = 0;
    const errors: Array<{ id: string; name: string | null; error: string }> = [];

    for (const row of picked) {
      try {
        // Fase 17-C: items via Observer (leitura pública); popularity/ISRC via cache.
        const items = await observerListAllPlaylistItems(row.spotify_playlist_id, {
          maxItems: maxTracks,
          maxAgeSeconds: 3600,
        });
        const trackIds = items
          .map((it) => it.track?.id)
          .filter((id): id is string => !!id);
        const cache = await getTrackCacheBatch(trackIds);

        const rowsByTrack = new Map<string, any>();
        let pos = 0;
        for (const it of items) {
          const tr = it.track;
          if (!tr?.id) continue;
          if (rowsByTrack.has(tr.id)) continue;
          const cacheRow = cache.get(tr.id);
          const cacheRaw: any = cacheRow?.raw ?? null;
          const albumImages: Array<{ url: string }> =
            cacheRaw?.album?.images ?? tr.album?.images ?? [];
          const releaseDate = cacheRaw?.album?.release_date ?? null;
          const albumName = cacheRaw?.album?.name ?? tr.album?.name ?? null;
          const popularity = typeof cacheRow?.popularity === "number" ? cacheRow.popularity : null;
          const artistNames = (tr.artists ?? []).map((a) => a.name).filter(Boolean).join(", ");
          rowsByTrack.set(tr.id, {
            genre_id: row.genre_id,
            result_id: row.id,
            nome_musica: tr.name || "Desconhecida",
            artista: artistNames || "Desconhecido",
            spotify_track_id: tr.id,
            posicao_na_playlist: ++pos,
            coletado_em: new Date().toISOString(),
            cover_url: albumImages[0]?.url ?? albumImages[albumImages.length - 1]?.url ?? null,
            release_date: normalizeReleaseDate(releaseDate),
            popularity,
            album: albumName,
            duration_ms: typeof tr.duration_ms === "number" ? tr.duration_ms : null,
          });
          if (rowsByTrack.size >= maxTracks) break;
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