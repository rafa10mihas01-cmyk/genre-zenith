import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { calculateTrackDailyStreams, chartTierFromTopPosition, type ChartTier, classifyPlaylistSize } from "@/lib/campaignOperationalPlan";


export interface EcosystemCapacity {
  loading: boolean;
  playlistCount: number;
  coreCount: number;
  neighborCount: number;
  savesTotal: number;
  slotPositions: number[];
  capacityTotal: number;
  capacityPerDay: number;
  genreResolved: boolean;
  /** Quantas playlists do pool serão realmente usadas pra cobrir streamsEco.
   *  null quando streamsEcoNeeded não foi informado. Espelha a heurística de
   *  seleção do planEcoAllocations (followers desc + sizingCap em pos #3). */
  playlistsSelected: number | null;
}

// Mirror das constantes de planEcoAllocations (campaignSnapshot.ts).
const PLAYS_PER_SAVE_MONTH = 30;
const DEFAULT_CAMPAIGN_SLOT_PCT = 0.08; // proxy posição #3

const PRIMARY_RANGES_BY_CHART: Record<ChartTier, Record<"large" | "medium" | "small", [number, number]>> = {
  top50:   { large: [1, 1], medium: [1, 1], small: [1, 1] },
  top100:  { large: [1, 2], medium: [2, 4], small: [3, 5] },
  outside: { large: [1, 1], medium: [1, 1], small: [1, 1] },
};
const NEIGHBOR_RANGE_BY_CHART: Record<ChartTier, [number, number]> = {
  top50:   [4, 5],
  top100:  [5, 7],
  outside: [7, 10],
};

function assignPositions(
  list: { id: string; followers: number }[],
  group: "primary" | "neighbor",
  chartTier: ChartTier,
): number[] {
  const sorted = [...list].sort((a, b) => b.followers - a.followers);
  const out: number[] = new Array(sorted.length).fill(1);

  if (group === "neighbor") {
    const [lo, hi] = NEIGHBOR_RANGE_BY_CHART[chartTier];
    sorted.forEach((_, idx) => {
      const pct = sorted.length <= 1 ? 0 : idx / (sorted.length - 1);
      out[idx] = lo + Math.round(pct * (hi - lo));
    });
  } else if (chartTier === "outside") {
    const N = Math.max(1, sorted.length);
    sorted.forEach((_, i) => {
      out[i] = Math.max(1, Math.min(20, Math.round(((i + 1) / N) * 20)));
    });
  } else {
    const byTier: Record<"large" | "medium" | "small", number[]> = { large: [], medium: [], small: [] };
    sorted.forEach((p, idx) => byTier[classifyPlaylistSize(p.followers)].push(idx));
    (Object.keys(byTier) as Array<"large" | "medium" | "small">).forEach(t => {
      const idxs = byTier[t];
      const [lo, hi] = PRIMARY_RANGES_BY_CHART[chartTier][t];
      idxs.forEach((origIdx, i) => {
        const pct = idxs.length <= 1 ? 0 : i / (idxs.length - 1);
        out[origIdx] = lo + Math.round(pct * (hi - lo));
      });
    });
  }
  // Return positions aligned with the SORTED order; caller iterates the same sorted list.
  return out;
}

/**
 * Capacidade do ecossistema próprio filtrado por afinidade de gênero.
 * Quando `topPosition` está disponível, usa a MESMA lógica determinística
 * de `distributeEcoPositions(chartTier)` — assim card e distribuição batem.
 * Fallback (sem topPosition): cicla `slotPositions` (compat legada).
 */
export function useEcosystemCapacity(
  genre: string,
  days: number,
  engagementMultiplier = 30,
  slotPositions: number[] = [3],
  topPosition: number | null = null,
): EcosystemCapacity {
  const slotKey = slotPositions.join(",");
  const [state, setState] = useState<EcosystemCapacity>({
    loading: false,
    playlistCount: 0,
    coreCount: 0,
    neighborCount: 0,
    savesTotal: 0,
    slotPositions: [3],
    capacityTotal: 0,
    capacityPerDay: 0,
    genreResolved: false,
  });

  useEffect(() => {
    let cancelled = false;
    // Flip loading imediatamente pra trocar números pelo skeleton no card.
    setState(s => ({ ...s, loading: true }));
    // Debounce 300ms: evita disparar query a cada tick do slider.
    const timer = setTimeout(() => {
      void (async () => {
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
          neighbors = all.filter(p => p.genre_id && p.genre_id !== gid && (affMap.get(p.genre_id) ?? 0) >= 0.6);
          if (core.length === 0 && neighbors.length > 0) {
            core = neighbors;
            neighbors = [];
          }
        }
      }

      const chartTier = chartTierFromTopPosition(topPosition);
      const useChartLogic = topPosition !== null && topPosition !== undefined;
      const safeSlots = slotPositions.length > 0 ? slotPositions : [3];

      const perDayOf = (list: typeof all, group: "primary" | "neighbor") => {
        const sorted = [...list].sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0));
        const positions = useChartLogic
          ? assignPositions(sorted.map(p => ({ id: p.id, followers: p.followers ?? 0 })), group, chartTier)
          : sorted.map((_, i) => safeSlots[i % safeSlots.length] ?? 3);
        return Math.round(
          sorted.reduce((sum, playlist, index) => {
            const slot = positions[index] ?? 3;
            return sum + calculateTrackDailyStreams(playlist.followers ?? 0, engagementMultiplier, slot);
          }, 0),
        );
      };

      const corePerDay = perDayOf(core, "primary");
      const neighborPerDayRaw = perDayOf(neighbors, "neighbor");
      // Teto de 40% do total para vizinhos (mesma regra das allocations).
      const neighborCap = Math.floor((2 / 3) * corePerDay);
      const neighborPerDay = Math.min(neighborPerDayRaw, neighborCap);
      const perDay = corePerDay + neighborPerDay;
      const saves =
        core.reduce((s, p) => s + Math.max(0, p.followers ?? 0), 0) +
        neighbors.reduce((s, p) => s + Math.max(0, p.followers ?? 0), 0);

      const total = perDay * Math.max(1, days);

      if (cancelled) return;
      setState({
        loading: false,
        playlistCount: core.length + neighbors.length,
        coreCount: core.length,
        neighborCount: neighbors.length,
        savesTotal: saves,
        slotPositions: safeSlots,
        capacityPerDay: perDay,
        capacityTotal: total,
        genreResolved,
      });

      })();
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };

  }, [genre, days, engagementMultiplier, slotKey, topPosition]);

  return state;
}
