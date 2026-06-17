// Shared helper — Fase 3.B.1 (consolidação Match Engine).
// Fonte única para ensureObservedPlaylist. Era duplicado em
// `_shared/ingest-dom.ts` e `bot-ingest-snapshot/index.ts`. Comportamento
// idêntico ao código anterior: só cria curator_playlists quando há
// spotify_playlist_id válido E nome legível. Match acontece ANTES desta
// chamada via RPC oficial `match_curator_playlist` — esta função é apenas
// fallback de cadastro auditável (attribution_method='s4a_observed') quando a
// RPC não encontra match num deal que é shadow de campanha.
import { createClient } from "npm:@supabase/supabase-js@2";
import { classifyPlaylistKind } from "./algorithmic-classifier.ts";

type SupabaseClient = ReturnType<typeof createClient>;

export type EnsureObservedPlaylistInput = {
  deal_id: string;
  song_id: string;
  spotify_playlist_id: string | null;
  playlist_name: string | null;
  spotify_url?: string | null;
  made_by?: string | null;
  followers?: number | null;
  plays_7d?: number | string | null;
  plays_28d?: number | string | null;
  plays_24h?: number | string | null;
  plays?: number | string | null;
  is_initial_roster: boolean;
};

const toInt = (v: unknown): number => {
  const n = parseInt(String(v ?? "")) || 0;
  return n > 0 ? n : 0;
};

export async function ensureObservedPlaylist(
  supabase: SupabaseClient,
  input: EnsureObservedPlaylistInput,
): Promise<string | null> {
  const playlistName = (input.playlist_name ?? "").trim();
  const spotifyPlaylistId = input.spotify_playlist_id ?? null;
  if (!spotifyPlaylistId || !playlistName) return null;

  const { data: existing } = await supabase
    .from("curator_playlists")
    .select("id")
    .eq("deal_id", input.deal_id)
    .eq("song_id", input.song_id)
    .eq("spotify_playlist_id", spotifyPlaylistId)
    .maybeSingle();
  if ((existing as any)?.id) return (existing as any).id as string;

  const kind = classifyPlaylistKind(playlistName, input.made_by ?? null, spotifyPlaylistId);
  const matchStatus = kind === "editorial" ? "editorial" : "organic";

  const { data: inserted } = await supabase
    .from("curator_playlists")
    .insert({
      deal_id: input.deal_id,
      song_id: input.song_id,
      spotify_url: input.spotify_url ?? `https://open.spotify.com/playlist/${spotifyPlaylistId}`,
      spotify_playlist_id: spotifyPlaylistId,
      playlist_name: playlistName,
      followers: input.followers ?? null,
      spotify_owner_name: input.made_by ?? null,
      is_initial_roster: input.is_initial_roster,
      match_status: matchStatus,
      attribution_method: "s4a_observed",
      attribution_reason: "Detectada automaticamente na aba Playlists do Spotify for Artists",
      streams_7d: toInt(input.plays_7d ?? input.plays ?? 0),
      streams_28d: toInt(input.plays_28d ?? 0),
      streams_total: toInt(
        input.plays_28d ?? input.plays_7d ?? input.plays ?? input.plays_24h ?? 0,
      ),
      last_paste_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();
  return ((inserted as any)?.id as string | undefined) ?? null;
}
