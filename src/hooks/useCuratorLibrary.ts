import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface CuratorLibraryPlaylist {
  id: string;
  curator_id: string;
  user_id: string;
  spotify_playlist_id: string | null;
  spotify_url: string;
  playlist_name: string;
  followers: number | null;
  image_url: string | null;
  spotify_owner_id: string | null;
  spotify_owner_name: string | null;
  status: "active" | "inactive" | "burned";
  notes: string | null;
  times_used: number;
  last_used_at: string | null;
  first_seen_at: string;
  created_at: string;
  updated_at: string;
}

export interface CuratorLibraryStats {
  library_id: string;
  curator_id: string;
  user_id: string;
  spotify_url: string;
  playlist_name: string;
  followers: number | null;
  image_url: string | null;
  status: string;
  last_used_at: string | null;
  deals_count: number;
  total_streams_7d: number;
  total_streams_lifetime: number;
  avg_streams_per_deal: number;
}

export function useCuratorLibrary(curatorId: string | null) {
  const [items, setItems] = useState<CuratorLibraryPlaylist[]>([]);
  const [stats, setStats] = useState<CuratorLibraryStats[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!curatorId) {
      setItems([]);
      setStats([]);
      return;
    }
    setLoading(true);
    try {
      const [libRes, statsRes] = await Promise.all([
        supabase
          .from("curator_playlist_library")
          .select("*")
          .eq("curator_id", curatorId)
          .order("last_used_at", { ascending: false, nullsFirst: false }),
        supabase
          .from("curator_playlist_library_stats" as never)
          .select("*")
          .eq("curator_id", curatorId),
      ]);
      if (libRes.error) throw libRes.error;
      setItems((libRes.data ?? []) as CuratorLibraryPlaylist[]);
      setStats((statsRes.data ?? []) as CuratorLibraryStats[]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Erro ao carregar biblioteca", { description: msg });
    } finally {
      setLoading(false);
    }
  }, [curatorId]);

  useEffect(() => {
    load();
  }, [load]);

  const addManual = useCallback(
    async (input: {
      curator_id: string;
      playlist_name: string;
      spotify_url: string;
      followers?: number | null;
      notes?: string | null;
    }) => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) throw new Error("não autenticado");
      const spotifyId = input.spotify_url.match(/playlist[/:]([a-zA-Z0-9]{16,})/)?.[1] ?? null;
      const { error } = await supabase.from("curator_playlist_library").insert({
        curator_id: input.curator_id,
        user_id: userData.user.id,
        playlist_name: input.playlist_name,
        spotify_url: input.spotify_url,
        spotify_playlist_id: spotifyId,
        followers: input.followers ?? null,
        notes: input.notes ?? null,
      });
      if (error) throw error;
      await load();
    },
    [load],
  );

  const updateStatus = useCallback(
    async (id: string, status: CuratorLibraryPlaylist["status"]) => {
      const { error } = await supabase
        .from("curator_playlist_library")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
      await load();
    },
    [load],
  );

  const remove = useCallback(
    async (id: string) => {
      const { error } = await supabase
        .from("curator_playlist_library")
        .delete()
        .eq("id", id);
      if (error) throw error;
      await load();
    },
    [load],
  );

  return { items, stats, loading, reload: load, addManual, updateStatus, remove };
}
