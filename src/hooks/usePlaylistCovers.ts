import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type PlaylistMeta = {
  spotify_playlist_id: string;
  name: string | null;
  cover_url: string | null;
  followers: number | null;
};

const EMPTY_PLAYLIST_LABELS = new Set(["", "(vazio)", "vazio", "(empty)", "empty", "null", "undefined"]);

function cleanPlaylistName(name: string | null | undefined): string | null {
  const v = String(name ?? "").trim();
  return EMPTY_PLAYLIST_LABELS.has(v.toLowerCase()) ? null : v;
}

export function usePlaylistCovers(playlistIds: string[]) {
  const [map, setMap] = useState<Record<string, PlaylistMeta>>({});
  const key = playlistIds.slice().sort().join(",");

  useEffect(() => {
    if (playlistIds.length === 0) {
      setMap({});
      return;
    }
    (async () => {
      // Busca em paralelo nas duas fontes: playlists (gerenciadas) e
      // curator_playlists (importadas via planilha / vindas de curadores).
      const [{ data: managed }, { data: curated }] = await Promise.all([
        supabase
          .from("playlists")
          .select("spotify_playlist_id, name, cover_url, followers")
          .in("spotify_playlist_id", playlistIds),
        supabase
          // Separação operacional × observacional
          .from("v_curator_playlists_operational")
          .select("spotify_playlist_id, playlist_name, image_url, followers")
          .in("spotify_playlist_id", playlistIds),
      ]);
      const next: Record<string, PlaylistMeta> = {};
      // curator_playlists primeiro (fallback)
      for (const r of (curated ?? []) as any[]) {
        const id = r.spotify_playlist_id as string;
        if (!id) continue;
        next[id] = {
          spotify_playlist_id: id,
          name: cleanPlaylistName(r.playlist_name),
          cover_url: r.image_url ?? null,
          followers: r.followers ?? null,
        };
      }
      // playlists gerenciadas têm prioridade (sobrescrevem)
      for (const r of (managed ?? []) as PlaylistMeta[]) {
        const id = r.spotify_playlist_id;
        const prev = next[id];
        next[id] = {
          spotify_playlist_id: id,
          name: cleanPlaylistName(r.name) ?? prev?.name ?? null,
          cover_url: r.cover_url ?? prev?.cover_url ?? null,
          followers: r.followers ?? prev?.followers ?? null,
        };
      }
      setMap(next);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return map;
}
