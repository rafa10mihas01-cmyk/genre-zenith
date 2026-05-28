import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { GenresUsedChip, type GenreUsed } from "./GenresUsedChip";
import type { EcoAllocation } from "@/components/campaign-hub/types";

/**
 * Wrapper interno: dado um array de EcoAllocation já carregado, busca os nomes
 * dos gêneros vizinhos usados (genre_source='affinity') e renderiza o chip.
 * Esconde se nenhum vizinho foi usado.
 */
export function GenresUsedFromAllocs({ allocs, compact }: { allocs: EcoAllocation[]; compact?: boolean }) {
  const [genres, setGenres] = useState<GenreUsed[]>([]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const affAllocs = (allocs ?? []).filter(a => a.genre_source === "affinity");
      if (affAllocs.length === 0) {
        if (!cancel) setGenres([]);
        return;
      }
      const byGenre = new Map<string, number>();
      for (const a of affAllocs) {
        const gid = (a as any).managed_playlists?.genre_id as string | null | undefined;
        const score = Number(a.genre_affinity_score ?? 0);
        if (!gid || !(score > 0)) continue;
        byGenre.set(gid, Math.max(byGenre.get(gid) ?? 0, score));
      }
      const ids = [...byGenre.keys()];
      if (ids.length === 0) {
        if (!cancel) setGenres([]);
        return;
      }
      const { data } = await supabase.from("genres").select("id, nome").in("id", ids);
      const nameById = new Map((data ?? []).map((g: { id: string; nome: string }) => [g.id, g.nome]));
      const list: GenreUsed[] = ids
        .map(id => ({ name: nameById.get(id) ?? "Vizinho", score: byGenre.get(id)! }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      if (!cancel) setGenres(list);
    })();
    return () => { cancel = true; };
  }, [allocs]);

  return <GenresUsedChip genres={genres} compact={compact} />;
}
