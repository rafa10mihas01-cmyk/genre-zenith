import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  planRealCapacity,
  ECO_DAILY_TOLERANCE,
  type RealCapacityAlloc,
  type RealCapacityMode,
} from "@/lib/campaignOperationalPlan";

export interface EcoRealCapacity {
  loading: boolean;
  /** Allocations escolhidas pela heurística greedy (primárias → vizinhos). */
  allocations: RealCapacityAlloc[];
  /** Soma dos cap_dia das allocations escolhidas. */
  coveredDaily: number;
  /** O que falta cobrir do dailyNeed (0 = cobriu). */
  remainingDaily: number;
  /** Necessidade diária usada no cálculo (input). */
  dailyNeed: number;
  /** Tolerância de estouro aplicada (10% padrão). */
  tolerance: number;
  /** Total de playlists encontradas no gênero (primárias + vizinhos). */
  poolSize: number;
  /** Se o gênero foi resolvido pra um id real do banco. */
  genreResolved: boolean;
  /** Quantas playlists do pool já tinham a faixa (catálogo). */
  presenceCount: number;
  /** Resumo de ações sobre as allocations escolhidas. */
  summary: { keep: number; reposition: number; insert: number };
}

const EMPTY: EcoRealCapacity = {
  loading: false,
  allocations: [],
  coveredDaily: 0,
  remainingDaily: 0,
  dailyNeed: 0,
  tolerance: ECO_DAILY_TOLERANCE,
  poolSize: 0,
  genreResolved: false,
  presenceCount: 0,
  summary: { keep: 0, reposition: 0, insert: 0 },
};

/**
 * Calcula a "capacidade real entregável" para uma campanha em planejamento:
 * - filtra managed_playlists ativas do gênero (+ vizinhos com afinidade ≥ 0.6),
 * - para cada playlist, escolhe a posição com maior cap_dia que NÃO ultrapasse
 *   `dailyNeed × (1 + tolerance)`,
 * - empilha greedy (followers desc) até cobrir o dailyNeed,
 * - devolve a lista de playlists que serão realmente usadas, com posição e
 *   cap_dia esperado.
 *
 * Quando `spotifyTrackId` é informado (música vinda do catálogo), o hook
 * lê `managed_playlist_tracks` ANTES de planejar e injeta as posições atuais
 * no planner — assim cada allocation já vem rotulada como keep / reposition /
 * insert, sem reescrever trabalho que o catálogo já fez.
 */
export function useEcoRealCapacity(
  genre: string,
  dailyNeed: number,
  multiplier = 30,
  tolerance = ECO_DAILY_TOLERANCE,
  mode: RealCapacityMode = "cascade",
  spotifyTrackId: string | null = null,
): EcoRealCapacity {
  const [state, setState] = useState<EcoRealCapacity>(EMPTY);

  useEffect(() => {
    if (!genre?.trim() || dailyNeed <= 0) {
      setState({ ...EMPTY, dailyNeed, tolerance });
      return;
    }
    let cancelled = false;
    setState(s => ({ ...s, loading: true }));
    const timer = setTimeout(() => {
      void (async () => {
        // 1) Resolve genre slug → id
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
        if (!gid) {
          if (!cancelled) setState({ ...EMPTY, dailyNeed, tolerance });
          return;
        }

        // 2) Vizinhos com afinidade ≥ 0.6
        const { data: aff } = await supabase
          .from("genre_affinities")
          .select("genre_a_id, genre_b_id, score")
          .or(`genre_a_id.eq.${gid},genre_b_id.eq.${gid}`)
          .gte("score", 0.6);
        const neighborIds = new Set<string>();
        for (const r of (aff ?? []) as { genre_a_id: string; genre_b_id: string; score: number }[]) {
          const other = r.genre_a_id === gid ? r.genre_b_id : r.genre_a_id;
          if (other && other !== gid) neighborIds.add(other);
        }

        // 3) Playlists do gênero principal + vizinhos
        const allGenreIds = [gid, ...neighborIds];
        const { data: playlists } = await supabase
          .from("managed_playlists")
          .select("id, name, followers, genre_id")
          .in("genre_id", allGenreIds)
          .eq("playlist_type", "CAMPAIGN")
          .gt("followers", 0);

        const rows = (playlists ?? []) as Array<{ id: string; name: string; followers: number; genre_id: string }>;
        const pool = rows.map(p => ({
          id: p.id,
          name: p.name,
          followers: Math.max(0, p.followers ?? 0),
          source: (p.genre_id === gid ? "primary" : "neighbor") as "primary" | "neighbor",
        }));

        // 4) Presença: se a faixa veio do catálogo, lê posições atuais no pool.
        // Esse passo é o coração da etapa "catálogo → campanha" — o planner
        // parte do estado real e só decide manter, reposicionar ou inserir.
        const currentPositionById = new Map<string, number>();
        if (spotifyTrackId && pool.length > 0) {
          const ids = pool.map(p => p.id);
          const { data: presence } = await supabase
            .from("managed_playlist_tracks")
            .select("playlist_id, position")
            .eq("spotify_track_id", spotifyTrackId)
            .in("playlist_id", ids);
          for (const t of (presence ?? []) as Array<{ playlist_id: string; position: number | null }>) {
            const pos = Number(t.position);
            if (Number.isFinite(pos) && pos > 0) currentPositionById.set(t.playlist_id, pos);
          }
        }

        // 5) Aplica algoritmo greedy idêntico ao da edge, agora com presença.
        const result = planRealCapacity(pool, dailyNeed, multiplier, tolerance, {
          mode,
          currentPositionById,
        });

        const summary = result.allocations.reduce(
          (acc, a) => {
            acc[a.action] += 1;
            return acc;
          },
          { keep: 0, reposition: 0, insert: 0 } as { keep: number; reposition: number; insert: number },
        );

        if (cancelled) return;
        setState({
          loading: false,
          allocations: result.allocations,
          coveredDaily: result.coveredDaily,
          remainingDaily: result.remaining,
          dailyNeed,
          tolerance,
          poolSize: pool.length,
          genreResolved: true,
          presenceCount: currentPositionById.size,
          summary,
        });
      })();
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [genre, dailyNeed, multiplier, tolerance, mode, spotifyTrackId]);

  return state;
}
