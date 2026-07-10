// fetch-tracks-spotify — busca tracks de uma playlist via Spotify Web API.
//
// Fase 17-B.6 (Onda revisada): MIGRADO para roteamento HÍBRIDO.
//   - Playlist pública  → Catalog Gateway (Client Credentials, NexEngine 10)
//   - Playlist managed  → OAuth do owner (via spotify-client + getUserToken)
//
// Decisão de rota é feita ANTES da chamada, consultando managed_playlists.
// Justificativa em docs/ops/phase-17b6-architectural-policy.md §2.3.
//
// Body: { playlist_id: string, result_id?: string, save?: boolean, max?: number }
//   - playlist_id: spotify_playlist_id (ID público do Spotify)
//   - result_id:   se passado + save=true, persiste em search_tracks
//   - save:        default false (apenas retorna). true = grava em search_tracks
//   - max:         default 100 (1 página). Use 200/300 pra playlists maiores
//
// Retorno: { ok, tracks: [{ spotify_track_id, nome_musica, artista, posicao_na_playlist }], saved, route }
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getUserToken } from "../_shared/spotify-client.ts";
import { listPlaylistTracksRich } from "../_shared/spotify-playlist.ts";
import { observerListAllPlaylistItems, ObserverApiError } from "../_shared/observer-playlist.ts";
import { requireTeamAccess } from "../_shared/auth.ts";

import { deprecationGate } from "../_shared/_deprecation.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FN = "fetch-tracks-spotify";

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

type Route = "observer" | "oauth-managed";

/** Ramo público: lê via VPS Observer (Fase 17-C). */
async function fetchPublicViaObserver(playlistId: string, max: number): Promise<TrackOut[]> {
  try {
    const items = await observerListAllPlaylistItems(playlistId, { maxItems: max });
    const out: TrackOut[] = [];
    for (const it of items) {
      const tr = it?.track;
      if (!tr?.id) continue; // skip null/local/removed
      out.push({
        spotify_track_id: tr.id,
        nome_musica: tr.name || "Unknown",
        artista: (tr.artists ?? []).map((a) => a?.name).filter(Boolean).join(", ") || "Unknown",
        posicao_na_playlist: out.length + 1,
      });
      if (out.length >= max) break;
    }
    return out;
  } catch (e) {
    if (e instanceof ObserverApiError && e.status === 404) return [];
    throw e;
  }
}

/** Ramo managed: lê via OAuth do owner (não pode usar Gateway CC — falha silenciosa). */
async function fetchManagedViaOauth(
  playlistId: string,
  ownerSpotifyUserId: string | null,
  max: number,
): Promise<TrackOut[]> {
  if (!ownerSpotifyUserId) {
    throw new Error(`managed playlist sem owner_spotify_user_id: ${playlistId}`);
  }
  const { token } = await getUserToken(ownerSpotifyUserId);
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
    // ── ROTEAMENTO HÍBRIDO (§2.3) ──────────────────────────────────────
    const { data: managed } = await supabase
      .from("managed_playlists")
      .select("spotify_playlist_id, owner_spotify_user_id")
      .eq("spotify_playlist_id", body.playlist_id)
      .maybeSingle();

    const route: Route = managed ? "oauth-managed" : "observer";

    const tracks = route === "oauth-managed"
      ? await fetchManagedViaOauth(body.playlist_id, managed!.owner_spotify_user_id ?? null, max)
      : await fetchPublicViaObserver(body.playlist_id, max);

    let saved = 0;
    if (body.save && body.result_id && tracks.length > 0) {
      const { data: result } = await supabase
        .from("search_results")
        .select("genre_id")
        .eq("id", body.result_id)
        .maybeSingle();

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
      mensagem: `[${route}] playlist ${body.playlist_id}: ${tracks.length} tracks${saved ? ` (saved ${saved})` : ""}`,
      duracao_ms: Date.now() - start,
    });

    return new Response(JSON.stringify({
      ok: true,
      route,
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
