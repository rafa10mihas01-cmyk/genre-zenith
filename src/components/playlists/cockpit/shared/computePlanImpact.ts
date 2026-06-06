// computePlanImpact — Fase 8.1
// Helper PURO (sem side effects, sem hooks) que cruza buckets × diagnóstico × brain
// e devolve deltas projetados pra render no PlanImpactCard.
//
// REGRA: NÃO inventa métrica. Só usa dados já presentes em Diagnosis e PlaylistBrain.
// Se um dado base está ausente, o delta correspondente vira `null` e a UI esconde.
import type { Diagnosis } from "../types";
import type { PlaylistBrain } from "@/hooks/usePlaylistBrain";
import { norm } from "../helpers";

export type Buckets = {
  remove: Array<{ artist_name?: string | null; track_name?: string | null; saturation_pct?: number; recurrence_in_genre?: number }>;
  demote: Array<{ artist_name?: string | null }>;
  promote: Array<{ artist_name?: string | null }>;
  add: Array<{ artista?: string | null; nome?: string | null }>;
};

export type ImpactDelta = {
  key: string;
  label: string;
  value: number | null;
  unit: "" | "pp" | "x";
  /** "positive" = bom subir, "negative" = bom descer */
  direction: "positive" | "negative";
  hint?: string;
};

export type PlanImpactResult = {
  deltas: ImpactDelta[];
  confidence: { score: number; level: "Baixa" | "Média" | "Alta" };
  hasMaterial: boolean;
  ageDays: number | null;
};

function ageDaysFromIso(iso?: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!isFinite(ms) || ms < 0) return null;
  return Math.floor(ms / 86_400_000);
}

function matchBenchmark(
  artist: string | null | undefined,
  title: string | null | undefined,
  benchmarkSet: Set<string>,
): boolean {
  const key = `${norm(artist)}::${norm(title)}`;
  return key.length > 4 && benchmarkSet.has(key);
}

function matchArtistInTop(
  artist: string | null | undefined,
  topSet: Set<string>,
): boolean {
  const k = norm(artist);
  return k.length > 0 && topSet.has(k);
}

export function computePlanImpact(
  diag: Diagnosis | null,
  buckets: Buckets,
  brain: PlaylistBrain | null | undefined,
  liveTracksCount: number,
): PlanImpactResult {
  const market = diag?.raw?.market_insights ?? {};
  const benchmarkSet = new Set(
    (market.top_recurring_tracks ?? [])
      .map((t) => `${norm(t.artist)}::${norm(t.title)}`)
      .filter((k) => k.length > 4),
  );
  const topArtistsSet = new Set(
    (market.top_artists ?? []).map((a) => norm(a.name)).filter(Boolean),
  );
  const idealRange = market.ideal_track_count_range ?? null;

  // ---- Δ faixas benchmark
  const addedBenchmark = buckets.add.filter((b) =>
    matchBenchmark(b.artista, b.nome, benchmarkSet),
  ).length;
  const removedBenchmark = buckets.remove.filter((b) =>
    matchBenchmark(b.artist_name, b.track_name, benchmarkSet),
  ).length;
  const dBenchmark = benchmarkSet.size > 0 ? addedBenchmark - removedBenchmark : null;

  // ---- Δ artistas dominantes (únicos no plano)
  const addedDomArtists = new Set(
    buckets.add
      .filter((b) => matchArtistInTop(b.artista, topArtistsSet))
      .map((b) => norm(b.artista)),
  );
  const removedDomArtists = new Set(
    buckets.remove
      .filter((b) => matchArtistInTop(b.artist_name, topArtistsSet))
      .map((b) => norm(b.artist_name)),
  );
  const dDomArtists = topArtistsSet.size > 0
    ? addedDomArtists.size - removedDomArtists.size
    : null;

  // ---- Δ cobertura do nicho (pp)
  // Usa benchmark_tracks do brain como denominador (quantas faixas benchmark a playlist
  // deveria ter). Antes = quantas benchmark a playlist tem hoje (não temos exato, mas
  // proxy = benchmark_tracks_atual). Conservador: só projeta o delta sobre o alvo.
  const benchTarget = brain?.benchmark_tracks ?? null;
  const dCoverage = benchTarget && benchTarget > 0 && dBenchmark != null
    ? (dBenchmark / benchTarget) * 100
    : null;

  // ---- Δ saturação média (pp) — média das que têm o campo
  const remSat = buckets.remove
    .map((b) => b.saturation_pct)
    .filter((v): v is number => typeof v === "number");
  const avgRemSat = remSat.length > 0 ? remSat.reduce((a, b) => a + b, 0) / remSat.length : null;
  const marketAvgSat = market.avg_saturation_pct ?? null;
  // Proxy: faixas adicionadas vindas de top_recurring são alta saturação no nicho;
  // remoções abaixam. Só projeta se temos alguma evidência.
  let dSaturation: number | null = null;
  if (avgRemSat != null && marketAvgSat != null && remSat.length > 0) {
    // Remoção move a média da playlist na direção (média_atual - faixa_removida) / N.
    // Como não temos média atual, expressamos como "pressão de saturação saindo".
    const pressureOut = (avgRemSat - marketAvgSat);
    const weight = Math.min(remSat.length / Math.max(liveTracksCount, 1), 0.5);
    dSaturation = -pressureOut * weight;
  }

  // ---- Δ concentração por artista (top-3 share, pp)
  // Conta artistas removidos vs. adicionados; redução do mesmo artista repetido baixa concentração.
  const removeByArtist = new Map<string, number>();
  for (const b of buckets.remove) {
    const k = norm(b.artist_name);
    if (k) removeByArtist.set(k, (removeByArtist.get(k) ?? 0) + 1);
  }
  const addByArtist = new Map<string, number>();
  for (const b of buckets.add) {
    const k = norm(b.artista);
    if (k) addByArtist.set(k, (addByArtist.get(k) ?? 0) + 1);
  }
  const repeatedRemoves = [...removeByArtist.values()].filter((v) => v >= 2).reduce((a, b) => a + b, 0);
  const repeatedAdds = [...addByArtist.values()].filter((v) => v >= 2).reduce((a, b) => a + b, 0);
  const dConcentration = liveTracksCount > 0
    ? ((repeatedAdds - repeatedRemoves) / liveTracksCount) * 100
    : null;

  // ---- Δ tamanho da playlist (faixas)
  const dSize = buckets.add.length - buckets.remove.length;
  const sizeAfter = liveTracksCount + dSize;
  const sizeOk = idealRange ? sizeAfter >= idealRange[0] && sizeAfter <= idealRange[1] : null;

  // ---- Δ headroom (pp) — só se temos capacity_total
  const capTotal = brain?.capacity_total ?? null;
  const headroomNow = brain?.headroom_pct ?? null;
  const dHeadroom = capTotal && capTotal > 0 && headroomNow != null
    ? -(dSize / capTotal) * 100
    : null;

  const deltas: ImpactDelta[] = [
    {
      key: "benchmark",
      label: "faixas benchmark",
      value: dBenchmark,
      unit: "",
      direction: "positive",
      hint: benchmarkSet.size > 0 ? `${benchmarkSet.size} benchmarks do nicho` : "sem benchmark mapeado",
    },
    {
      key: "dom_artists",
      label: "artistas dominantes",
      value: dDomArtists,
      unit: "",
      direction: "positive",
      hint: topArtistsSet.size > 0 ? `top ${topArtistsSet.size} do nicho` : undefined,
    },
    {
      key: "coverage",
      label: "cobertura do nicho",
      value: dCoverage,
      unit: "pp",
      direction: "positive",
      hint: benchTarget ? `alvo ${benchTarget} faixas` : undefined,
    },
    {
      key: "saturation",
      label: "saturação",
      value: dSaturation,
      unit: "pp",
      direction: "negative",
      hint: marketAvgSat != null ? `média nicho ${Math.round(marketAvgSat)}%` : undefined,
    },
    {
      key: "concentration",
      label: "concentração",
      value: dConcentration,
      unit: "pp",
      direction: "negative",
      hint: "repetição por artista",
    },
    {
      key: "size",
      label: "tamanho final",
      value: dSize,
      unit: "",
      direction: "positive",
      hint: idealRange
        ? `${sizeAfter} faixas ${sizeOk ? "· dentro do ideal" : "· fora do ideal"}`
        : `${sizeAfter} faixas`,
    },
    {
      key: "headroom",
      label: "headroom",
      value: dHeadroom,
      unit: "pp",
      direction: "negative",
      hint: capTotal ? `cap ${capTotal}` : undefined,
    },
  ];

  // ---- Confiança
  const ageDays = ageDaysFromIso(diag?.created_at);
  let score = 0;
  score += (brain?.confidence_score ?? 0) * 0.5;
  score += ageDays == null ? 0 : ageDays <= 2 ? 25 : ageDays <= 7 ? 10 : 0;
  const matchesBenchmark = addedBenchmark + removedBenchmark;
  score += matchesBenchmark >= 3 ? 15 : matchesBenchmark > 0 ? 5 : 0;
  score += capTotal != null ? 10 : 0;
  score = Math.max(0, Math.min(100, Math.round(score)));
  const level: "Baixa" | "Média" | "Alta" = score >= 70 ? "Alta" : score >= 40 ? "Média" : "Baixa";

  const hasMaterial = deltas.some(
    (d) => d.value != null && Math.abs(d.value) >= 1,
  );

  return { deltas, confidence: { score, level }, hasMaterial, ageDays };
}
