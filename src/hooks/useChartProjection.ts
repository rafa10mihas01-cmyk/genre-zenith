// Estima posição no Top 200 BR a partir de plays/dia projetados,
// e busca posição atual da música no chart de hoje (se houver).
// Puramente ilustrativo — não afeta a curva nem cálculos da campanha.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ChartProjection = {
  /** Posição atual no Top 200 BR (chart_date mais recente disponível), se a música estiver lá. */
  currentPosition: number | null;
  /** Posição estimada no pico, arredondada pra faixa amigável (Top 10/15/20/30/50/100/150/200). */
  peakBand: number | null;
  /** Posição estimada exata (sem arredondar), pra tooltip. */
  peakExact: number | null;
  /** Estima a posição exata pra um valor arbitrário de plays/dia. null se fora do Top 200. */
  estimatePosition: (streamsDay: number) => number | null;
  /** Idem, mas arredondada pra faixa amigável. */
  estimateBand: (streamsDay: number) => number | null;
  loading: boolean;
};

const BANDS = [10, 15, 20, 30, 50, 75, 100, 150, 200];

function snapToBand(pos: number): number {
  for (const b of BANDS) if (pos <= b) return b;
  return 200;
}

const NOOP = () => null;

export function useChartProjection(
  spotifyTrackId: string | null | undefined,
  peakStreamsDay: number | null | undefined,
): ChartProjection {
  const [state, setState] = useState<ChartProjection>({
    currentPosition: null,
    peakBand: null,
    peakExact: null,
    estimatePosition: NOOP,
    estimateBand: NOOP,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!peakStreamsDay || peakStreamsDay <= 0) {
        if (!cancelled) setState({
          currentPosition: null, peakBand: null, peakExact: null,
          estimatePosition: NOOP, estimateBand: NOOP, loading: false,
        });
        return;
      }

      // 1) Data mais recente do chart
      const { data: latest } = await supabase
        .from("raw_chart_daily")
        .select("chart_date")
        .eq("chart_name", "top200_br")
        .order("chart_date", { ascending: false })
        .limit(1);
      const chartDate = latest?.[0]?.chart_date as string | undefined;

      // 2) Posição atual (se trackId informado)
      let currentPosition: number | null = null;
      if (spotifyTrackId && chartDate) {
        const { data: cur } = await supabase
          .from("raw_chart_daily")
          .select("position")
          .eq("chart_name", "top200_br")
          .eq("chart_date", chartDate)
          .eq("spotify_track_id", spotifyTrackId)
          .limit(1);
        if (cur?.[0]?.position) currentPosition = cur[0].position as number;
      }

      // 3) Carrega benchmark completo do dia (posição -> streams_day)
      let benchmark: Array<{ position: number; streams_day: number }> = [];
      if (chartDate) {
        const { data: bench } = await supabase
          .from("raw_chart_daily")
          .select("position, streams_day")
          .eq("chart_name", "top200_br")
          .eq("chart_date", chartDate)
          .order("position", { ascending: true });
        if (bench) {
          benchmark = bench
            .filter((r) => r.position != null && r.streams_day != null)
            .map((r) => ({ position: r.position as number, streams_day: r.streams_day as number }));
        }
      }

      const estimatePosition = (streamsDay: number): number | null => {
        if (!streamsDay || streamsDay <= 0 || benchmark.length === 0) return null;
        const last = benchmark[benchmark.length - 1];
        if (streamsDay < (last.streams_day ?? 0)) return null; // fora do Top 200
        for (const row of benchmark) {
          if ((row.streams_day ?? 0) <= streamsDay) return row.position;
        }
        return last.position;
      };
      const estimateBand = (streamsDay: number): number | null => {
        const p = estimatePosition(streamsDay);
        return p != null ? snapToBand(p) : null;
      };

      const peakExact = estimatePosition(peakStreamsDay);

      if (cancelled) return;
      setState({
        currentPosition,
        peakExact,
        peakBand: peakExact != null ? snapToBand(peakExact) : null,
        estimatePosition,
        estimateBand,
        loading: false,
      });
    })();
    return () => { cancelled = true; };
  }, [spotifyTrackId, peakStreamsDay]);

  return state;
}
