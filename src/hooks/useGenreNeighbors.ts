import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type GenreNeighbor = {
  genre_id: string;
  score: number;
  method: "lexicon" | "manual" | "hybrid";
  nome: string;
  slug: string;
  managed_count: number;
};

/**
 * Lê genre_affinities + nomes dos vizinhos a partir do genre_id de uma playlist
 * (managed_playlists.genre_id). Retorna vizinhos acima do threshold, com a
 * contagem de managed_playlists em cada vizinho.
 */
export function useGenreNeighborsByPlaylist(managedId?: string, threshold = 0.5) {
  return useQuery({
    queryKey: ["genre_neighbors_by_playlist", managedId, threshold],
    enabled: !!managedId,
    queryFn: async (): Promise<{ genre_id: string | null; neighbors: GenreNeighbor[] }> => {
      const { data: pl, error: plErr } = await supabase
        .from("managed_playlists")
        .select("genre_id")
        .eq("id", managedId!)
        .maybeSingle();
      if (plErr) throw plErr;
      const gid = pl?.genre_id ?? null;
      if (!gid) return { genre_id: null, neighbors: [] };

      const { data: afs, error: afErr } = await supabase
        .from("genre_affinities")
        .select("genre_a_id, genre_b_id, score, method")
        .or(`genre_a_id.eq.${gid},genre_b_id.eq.${gid}`)
        .gte("score", threshold)
        .order("score", { ascending: false });
      if (afErr) throw afErr;

      const pairs = (afs ?? []).map((a) => ({
        other: a.genre_a_id === gid ? a.genre_b_id : a.genre_a_id,
        score: Number(a.score),
        method: a.method as GenreNeighbor["method"],
      }));
      if (pairs.length === 0) return { genre_id: gid, neighbors: [] };

      const otherIds = pairs.map(p => p.other);
      const { data: gs } = await supabase
        .from("genres")
        .select("id, nome, slug")
        .in("id", otherIds);
      const nameMap = new Map((gs ?? []).map((g) => [g.id, { nome: g.nome, slug: g.slug }]));

      // contagem de managed_playlists por vizinho (ativas)
      const { data: counts } = await supabase
        .from("managed_playlists")
        .select("genre_id")
        .in("genre_id", otherIds)
        .is("archived_at", null);
      const countMap = new Map<string, number>();
      for (const c of counts ?? []) {
        countMap.set(c.genre_id, (countMap.get(c.genre_id) ?? 0) + 1);
      }

      const neighbors: GenreNeighbor[] = pairs.map(p => {
        const meta = nameMap.get(p.other) ?? { nome: "—", slug: "" };
        return {
          genre_id: p.other,
          score: p.score,
          method: p.method,
          nome: meta.nome,
          slug: meta.slug,
          managed_count: countMap.get(p.other) ?? 0,
        };
      });

      return { genre_id: gid, neighbors };
    },
  });
}
