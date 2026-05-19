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

export type PerformanceClass =
  | "excelente" | "boa" | "media" | "fraca"
  | "suspeita" | "novo" | "sem_historico";

export interface CuratorLibraryPerformance {
  library_id: string;
  curator_id: string;
  user_id: string;
  deals_count: number;
  total_streams_7d: number;
  total_streams_lifetime: number;
  avg_streams_7d: number;
  best_streams_7d: number;
  worst_streams_7d: number;
  variation_coef: number;
  drop_ratio: number;
  performance_class: PerformanceClass;
}

/** Map de library_id (ou spotify_playlist_id) → conjunto de gêneros dos clientes que já passaram por ela. */
export type PlaylistGenresMap = Map<string, Set<string>>;

export function useCuratorLibrary(curatorId: string | null) {
  const [items, setItems] = useState<CuratorLibraryPlaylist[]>([]);
  const [stats, setStats] = useState<CuratorLibraryStats[]>([]);
  const [performance, setPerformance] = useState<CuratorLibraryPerformance[]>([]);
  const [genresByLibrary, setGenresByLibrary] = useState<PlaylistGenresMap>(new Map());
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!curatorId) {
      setItems([]);
      setStats([]);
      setPerformance([]);
      setGenresByLibrary(new Map());
      return;
    }
    setLoading(true);
    try {
      const [libRes, statsRes, perfRes] = await Promise.all([
        supabase
          .from("curator_playlist_library")
          .select("*")
          .eq("curator_id", curatorId)
          .order("last_used_at", { ascending: false, nullsFirst: false }),
        supabase
          .from("curator_playlist_library_stats" as never)
          .select("*")
          .eq("curator_id", curatorId),
        supabase
          .from("curator_playlist_performance" as never)
          .select("*")
          .eq("curator_id", curatorId),
      ]);
      if (libRes.error) throw libRes.error;
      const libItems = (libRes.data ?? []) as CuratorLibraryPlaylist[];
      setItems(libItems);
      setStats((statsRes.data ?? []) as CuratorLibraryStats[]);
      setPerformance((perfRes.data ?? []) as CuratorLibraryPerformance[]);

      // Gêneros por playlist: curator_playlists (deal_id, spotify_playlist_id|spotify_url)
      // → curator_deals.client_id → clients.primary_genre.
      try {
        const { data: dealsForCurator } = await supabase
          .from("curator_deals")
          .select("id, client_id")
          .eq("curator_id", curatorId)
          .not("client_id", "is", null);
        const dealIds = (dealsForCurator ?? []).map((d) => d.id);
        const clientIds = Array.from(
          new Set((dealsForCurator ?? []).map((d) => d.client_id).filter(Boolean) as string[]),
        );
        if (dealIds.length && clientIds.length) {
          const [{ data: cps }, { data: clientsRows }] = await Promise.all([
            supabase
              .from("curator_playlists")
              .select("deal_id, spotify_playlist_id, spotify_url")
              .in("deal_id", dealIds),
            supabase.from("clients").select("id, primary_genre").in("id", clientIds),
          ]);
          const dealToClient = new Map<string, string | null>(
            (dealsForCurator ?? []).map((d) => [d.id, d.client_id ?? null]),
          );
          const clientToGenre = new Map<string, string | null>(
            (clientsRows ?? []).map((c) => [c.id, c.primary_genre ?? null]),
          );
          // Index by spotify_playlist_id e por spotify_url (fallback).
          const map: PlaylistGenresMap = new Map();
          for (const cp of cps ?? []) {
            const clientId = cp.deal_id ? dealToClient.get(cp.deal_id) : null;
            const genre = clientId ? clientToGenre.get(clientId) : null;
            if (!genre) continue;
            const key1 = cp.spotify_playlist_id ?? null;
            const key2 = cp.spotify_url ?? null;
            for (const k of [key1, key2]) {
              if (!k) continue;
              if (!map.has(k)) map.set(k, new Set());
              map.get(k)!.add(genre);
            }
          }
          // Reindex por library item id usando os mesmos keys.
          const byLib: PlaylistGenresMap = new Map();
          for (const it of libItems) {
            const set = new Set<string>();
            if (it.spotify_playlist_id && map.has(it.spotify_playlist_id)) {
              for (const g of map.get(it.spotify_playlist_id)!) set.add(g);
            }
            if (it.spotify_url && map.has(it.spotify_url)) {
              for (const g of map.get(it.spotify_url)!) set.add(g);
            }
            if (set.size) byLib.set(it.id, set);
          }
          setGenresByLibrary(byLib);
        } else {
          setGenresByLibrary(new Map());
        }
      } catch (e) {
        // Não-crítico: gêneros são metadata, não bloqueia a biblioteca.
        console.warn("[curator-library] falha ao carregar gêneros", e);
        setGenresByLibrary(new Map());
      }
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

  return { items, stats, performance, loading, reload: load, addManual, updateStatus, remove };
}
