// apply-playlist-suggestions — insere as faixas sugeridas pelo último diagnóstico
// na playlist gerenciada do Spotify, nas posições recomendadas.
//
// Body: { playlist_id: string (managed_playlists.id), limit?: number, dry_run?: boolean }
// Estratégia: insere todas as sugestões em bloco na posição 0 (topo),
// preservando a ordem do ranking → faixas viram #1, #2, #3... como mostrado no card.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";
import { getUserAccessToken, getSpotifyToken } from "../_shared/spotify.ts";
import { addPlaylistTracks, getPlaylistMeta, listPlaylistTrackUris, SpotifyApiError } from "../_shared/spotify-playlist.ts";
import { getProtectedTracksForPlaylist, protectedUriSet, logProtectedBlock } from "../_shared/protected-tracks.ts";
import {
  acquirePlaylistLock,
  releasePlaylistLock,
  finishPlaylistOperation,
  formatPlaylistError,
  lockedResponseBody,
} from "../_shared/playlist-lock.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  try {
    const body = await req.json().catch(() => ({}));
    const playlistId: string = body?.playlist_id;
    const limit: number = Math.max(1, Math.min(Number(body?.limit ?? 15), 50));
    const dryRun: boolean = !!body?.dry_run;
    if (!playlistId) return jr({ ok: false, error: "playlist_id obrigatório" }, 400);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // 1) Playlist gerenciada (precisa do spotify_playlist_id)
    const { data: pl } = await supabase
      .from("managed_playlists")
      .select("id, spotify_playlist_id, name")
      .eq("id", playlistId)
      .maybeSingle();
    if (!pl?.spotify_playlist_id) return jr({ ok: false, error: "playlist sem spotify_playlist_id" }, 404);

    // 2) Último diagnóstico → tracks_suggestions
    const { data: diag } = await supabase
      .from("playlist_diagnoses")
      .select("id, tracks_suggestions, created_at")
      .eq("playlist_id", pl.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const suggestions = Array.isArray(diag?.tracks_suggestions) ? (diag!.tracks_suggestions as any[]) : [];
    const selected = suggestions
      .filter((s) => s?.spotify_track_id)
      .slice(0, limit);
    if (selected.length === 0) return jr({ ok: false, error: "sem sugestões para aplicar" }, 400);

    const uris = selected.map((s) => `spotify:track:${s.spotify_track_id}`);

    if (dryRun) {
      return jr({ ok: true, dry_run: true, would_insert: selected.length, uris });
    }

    // 3) Token OAuth — precisa ser o DONO da playlist no Spotify.
    //    Descobre o owner via API pública, depois acha o token correspondente.
    let ownerId: string | null = null;
    try {
      const appToken = await getSpotifyToken();
      const meta = await getPlaylistMeta(pl.spotify_playlist_id, appToken);
      ownerId = meta.owner_id;
    } catch { /* segue sem ownerId, cai no default */ }

    let token: string;
    try {
      const r = await getUserAccessToken(ownerId ?? undefined);
      token = r.token;
    } catch (e) {
      return jr({
        ok: false,
        error: ownerId
          ? `conta do dono "${ownerId}" não está conectada. Conecte em Configurações → Spotify.`
          : `nenhuma conta Spotify conectada: ${(e as Error).message}`,
      }, 412);
    }

    // 4) Adquire lock + POST /playlists/{id}/items — insere todas em bloco na posição 0 (topo)
    //    Spotify aceita até 100 URIs por chamada; nosso limit é 50.
    const lock = await acquirePlaylistLock(supabase, pl.id, "MANUAL_EDITOR", null);
    if (!lock.ok) {
      return jr(lockedResponseBody(lock), 423);
    }

    let snapshot: string | null = null;
    try {
      const res = await addPlaylistTracks(pl.spotify_playlist_id, uris, token, { position: 0 });
      snapshot = res.snapshot_id ?? null;
      await finishPlaylistOperation(supabase, lock, {
        status: "success",
        tracks_changed: selected.length,
      });
    } catch (e) {
      await finishPlaylistOperation(supabase, lock, {
        status: "failed",
        error: formatPlaylistError(e),
      });
      await releasePlaylistLock(supabase, lock);
      if (e instanceof SpotifyApiError) {
        const hint = e.status === 403
          ? ` — dono da playlist é "${ownerId ?? "?"}"; reconecte essa conta em Configurações com escopos playlist-modify-public/private.`
          : "";
        return jr({ ok: false, error: `Spotify ${e.status}: ${e.body.slice(0, 300)}${hint}` }, 502);
      }
      throw e;
    }
    await releasePlaylistLock(supabase, lock);

    // 5) Log
    await supabase.from("collection_logs").insert({
      acao: "apply-playlist-suggestions",
      status: "sucesso",
      mensagem: `playlist ${pl.spotify_playlist_id}: +${selected.length} faixas no topo (snapshot ${snapshot ?? "?"})`,
    });

    return jr({
      ok: true,
      inserted: selected.length,
      snapshot_id: snapshot,
      tracks: selected.map((s, i) => ({
        position: i + 1,
        spotify_track_id: s.spotify_track_id,
        nome: s.nome,
        artista: s.artista,
        from_missing_artist: !!s.from_missing_artist,
      })),
    });
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
