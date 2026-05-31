import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type PlaylistMeta = {
  spotify_playlist_id: string;
  name: string | null;
  cover_url: string | null;
  followers: number | null;
};

export function usePlaylistCovers(playlistIds: string[]) {
  const [map, setMap] = useState<Record<string, PlaylistMeta>>({});
  const key = playlistIds.slice().sort().join(",");

  useEffect(() => {
    if (playlistIds.length === 0) {
      setMap({});
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("playlists")
        .select("spotify_playlist_id, name, cover_url, followers")
        .in("spotify_playlist_id", playlistIds);
      const next: Record<string, PlaylistMeta> = {};
      for (const r of (data ?? []) as PlaylistMeta[]) next[r.spotify_playlist_id] = r;
      setMap(next);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return map;
}
