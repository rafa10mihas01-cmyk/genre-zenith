import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ActiveCooldown = {
  playlist_id: string;
  action_type: string;
  cooldown_until: string;
  days_remaining: number;
  reason: string | null;
};

/**
 * Carrega todos os cooldowns ATIVOS (cooldown_until > now)
 * para um conjunto de playlists gerenciadas, em uma única query.
 */
export function useActiveCooldowns(playlistIds: string[]) {
  const [byPlaylist, setByPlaylist] = useState<Record<string, ActiveCooldown[]>>({});
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!playlistIds.length) {
      setByPlaylist({});
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("playlist_cooldowns")
      .select("playlist_id, action_type, cooldown_until, reason")
      .in("playlist_id", playlistIds)
      .gt("cooldown_until", new Date().toISOString())
      .order("cooldown_until", { ascending: false });

    if (error) {
      setLoading(false);
      return;
    }

    // Deduplica por (playlist_id, action_type) mantendo o mais distante
    const seen = new Set<string>();
    const map: Record<string, ActiveCooldown[]> = {};
    const now = Date.now();
    for (const row of (data ?? []) as any[]) {
      const key = `${row.playlist_id}:${row.action_type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const days = (new Date(row.cooldown_until).getTime() - now) / 86400000;
      const item: ActiveCooldown = {
        playlist_id: row.playlist_id,
        action_type: row.action_type,
        cooldown_until: row.cooldown_until,
        days_remaining: days,
        reason: row.reason,
      };
      (map[row.playlist_id] ??= []).push(item);
    }
    setByPlaylist(map);
    setLoading(false);
  }, [playlistIds.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  return { byPlaylist, loading, reload: load };
}
