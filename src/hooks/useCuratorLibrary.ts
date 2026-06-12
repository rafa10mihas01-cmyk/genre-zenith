import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface CuratorLibraryPlaylist {
  /** Pode ser id real de curator_playlist_library OU sintético `${curator_id}:${spotify_playlist_id}` quando vier só da view. */
  id: string;
  curator_id: string;
  user_id: string | null;
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
  first_seen_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  /** True se a playlist está no ecossistema (managed_playlists ativa). Vem direto da view. */
  is_ecosystem?: boolean;
  /** True se a row é só reflexo da view (sem registro físico em curator_playlist_library). */
  is_synthetic?: boolean;
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
      const [libRes, statsRes, perfRes, ecoRes] = await Promise.all([
        supabase
          .from("curator_playlist_library")
          .select("*")
          .eq("curator_id", curatorId)
          .order("last_used_at", { ascending: false, nullsFirst: false })
          .limit(2000),
        supabase
          .from("curator_playlist_library_stats" as never)
          .select("*")
          .eq("curator_id", curatorId)
          .limit(2000),
        supabase
          .from("curator_playlist_performance" as never)
          .select("*")
          .eq("curator_id", curatorId)
          .limit(2000),
        // Onda 2 sombra: cruza com v_curator_library pra marcar playlists do ecossistema
        supabase
          .from("v_curator_library" as never)
          .select("spotify_playlist_id, is_ecosystem")
          .eq("curator_id", curatorId)
          .eq("is_ecosystem", true)
          .limit(5000),
      ]);
      if (libRes.error) throw libRes.error;
      const ecoIds = new Set(
        (((ecoRes.data ?? []) as { spotify_playlist_id: string | null }[])
          .map((r) => r.spotify_playlist_id)
          .filter(Boolean)) as string[],
      );
      const libItems = ((libRes.data ?? []) as CuratorLibraryPlaylist[]).map((it) => ({
        ...it,
        is_ecosystem: it.spotify_playlist_id ? ecoIds.has(it.spotify_playlist_id) : false,
      }));
      setItems(libItems);
      setStats((statsRes.data ?? []) as CuratorLibraryStats[]);
      setPerformance((perfRes.data ?? []) as CuratorLibraryPerformance[]);

      // Gêneros por playlist: curator_playlists (deal_id, spotify_playlist_id|spotify_url)
      // → curator_deal_songs.client_id → clients.primary_genre.
      try {
        const { data: dealsForCurator } = await supabase
          .from("curator_deals")
          .select("id")
          .eq("curator_id", curatorId)
          .limit(2000);
        const dealIds = ((dealsForCurator ?? []) as { id: string }[]).map((d) => d.id);
        if (dealIds.length) {
          const { data: songs } = await supabase
            .from("curator_deal_songs")
            .select("deal_id, client_id")
            .in("deal_id", dealIds)
            .not("client_id", "is", null)
            .limit(5000);
          const clientIds = Array.from(
            new Set(((songs ?? []) as { client_id: string | null }[]).map((s) => s.client_id).filter(Boolean) as string[]),
          );
          if (clientIds.length) {
            const [{ data: cps }, { data: clientsRows }] = await Promise.all([
              supabase
                // Separação operacional × observacional
                .from("v_curator_playlists_operational")
                .select("deal_id, spotify_playlist_id, spotify_url")
                .in("deal_id", dealIds)
                .limit(5000),
              supabase.from("clients").select("id, primary_genre").in("id", clientIds).limit(2000),
            ]);

            // Mapa deal_id → conjunto de genres (pode ter várias músicas/clientes por deal).
            const dealToGenres = new Map<string, Set<string>>();
            const clientToGenre = new Map<string, string | null>(
              ((clientsRows ?? []) as { id: string; primary_genre: string | null }[]).map((c) => [c.id, c.primary_genre ?? null]),
            );
            for (const s of (songs ?? []) as { deal_id: string; client_id: string | null }[]) {
              const g = s.client_id ? clientToGenre.get(s.client_id) : null;
              if (!g) continue;
              if (!dealToGenres.has(s.deal_id)) dealToGenres.set(s.deal_id, new Set());
              dealToGenres.get(s.deal_id)!.add(g);
            }
            // Index por spotify_playlist_id e por spotify_url (fallback).
            const map: PlaylistGenresMap = new Map();
            for (const cp of (cps ?? []) as { deal_id: string; spotify_playlist_id: string | null; spotify_url: string | null }[]) {
              const genres = dealToGenres.get(cp.deal_id);
              if (!genres || !genres.size) continue;
              for (const k of [cp.spotify_playlist_id, cp.spotify_url]) {
                if (!k) continue;
                if (!map.has(k)) map.set(k, new Set());
                for (const g of genres) map.get(k)!.add(g);
              }
            }
            // Reindex por library item id.
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

  return { items, stats, performance, genresByLibrary, loading, reload: load, addManual, updateStatus, remove };
}
