import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { POSITION_PCT } from "@/lib/campaignOperationalPlan";


export interface EcosystemCapacity {
  loading: boolean;
  playlistCount: number;
  coreCount: number;
  neighborCount: number;
  capacityTotal: number;     // streams totais que o eco aguenta na janela
  capacityPerDay: number;    // streams/dia
  genreResolved: boolean;    // true se conseguimos casar o gênero com a tabela genres
}

/**
 * Calcula a capacidade do ecossistema próprio filtrado por afinidade de gênero.
 * Mesma lógica de filtragem do closeOne(): núcleo (mesmo gênero) + vizinhos ≥ 0.70.
 * Capacidade ≈ followers * dias (1 play/save/dia).
 */
export function useEcosystemCapacity(genre: string, days: number): EcosystemCapacity {
  const [state, setState] = useState<EcosystemCapacity>({
    loading: false,
    playlistCount: 0,
    coreCount: 0,
    neighborCount: 0,
    capacityTotal: 0,
    capacityPerDay: 0,
    genreResolved: false,
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setState(s => ({ ...s, loading: true }));
      const { data: playlistsRaw } = await supabase
        .from("managed_playlists")
        .select("id, followers, genre_id")
        .is("archived_at", null);
      const all = (playlistsRaw ?? []).filter(p => (p.followers ?? 0) >= 100) as
        { id: string; followers: number | null; genre_id: string | null }[];

      let core = all;
      let neighbors: typeof all = [];
      let genreResolved = false;

      if (genre && genre.trim()) {
        const slug = genre.toLowerCase()
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/)[0];
        const { data: gRow } = await supabase
          .from("genres")
          .select("id")
          .or(`slug.eq.${slug},nome.ilike.${slug}%`)
          .limit(1)
          .maybeSingle();
        const gid = gRow?.id ?? null;
        if (gid) {
          genreResolved = true;
          const { data: aff } = await supabase
            .from("genre_affinities")
            .select("genre_a_id, genre_b_id, score")
            .or(`genre_a_id.eq.${gid},genre_b_id.eq.${gid}`)
            .gte("score", 0.5);
          const affMap = new Map<string, number>();
          for (const r of (aff ?? []) as { genre_a_id: string; genre_b_id: string; score: number }[]) {
            const other = r.genre_a_id === gid ? r.genre_b_id : r.genre_a_id;
            affMap.set(other, Number(r.score));
          }
          core = all.filter(p => p.genre_id === gid);
          neighbors = all.filter(p => p.genre_id && p.genre_id !== gid && (affMap.get(p.genre_id) ?? 0) >= 0.7);
          if (core.length === 0 && neighbors.length > 0) {
            core = neighbors;
            neighbors = [];
          }
        }
      }

      // Capacidade REAL pra UMA faixa: ela só ocupa 1 slot por playlist.
      // Ceiling = posição #1 = POSITION_PCT[0] (12% dos followers/dia).
      // Não usar sum(followers) puro — isso seria 100% do tráfego diário pra uma única faixa, impossível.
      const TOP_SLOT_PCT = POSITION_PCT[0] ?? 0.12;
      const sumFollowers = (list: typeof all) =>
        list.reduce((s, p) => s + Math.max(0, p.followers ?? 0), 0);
      const rawFollowersPerDay = sumFollowers(core) + sumFollowers(neighbors);
      const perDay = Math.round(rawFollowersPerDay * TOP_SLOT_PCT);

      const total = perDay * Math.max(1, days);

      if (cancelled) return;
      setState({
        loading: false,
        playlistCount: core.length + neighbors.length,
        coreCount: core.length,
        neighborCount: neighbors.length,
        capacityPerDay: perDay,
        capacityTotal: total,
        genreResolved,
      });
    })();
    return () => { cancelled = true; };
  }, [genre, days]);

  return state;
}
