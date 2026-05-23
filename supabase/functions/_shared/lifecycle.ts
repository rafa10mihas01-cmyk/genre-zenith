// _shared/lifecycle.ts
// Fase editorial dinâmica de uma playlist + roadmap multi-ciclo.
// Usado por playlist-brain-calc (calcula e persiste) e diagnose-managed-playlist
// (espelha no payload do diagnóstico para o cockpit consumir imediatamente).

export type LifecyclePhase = "seed" | "growth" | "mature" | "bloated" | "decline";

export type RoadmapStep = {
  cycle: number;
  delta: number;       // +N (build) ou -N (trim)
  total: number;       // total esperado após o ciclo
  action: "build" | "trim";
  phase: LifecyclePhase;
};

export function derivePhase(
  tracksCount: number,
  benchmarkTracks: number | null,
): { phase: LifecyclePhase; ratio: number | null } {
  if (tracksCount <= 0) return { phase: "seed", ratio: null };
  if (!benchmarkTracks || benchmarkTracks <= 0) {
    if (tracksCount < 30) return { phase: "seed", ratio: null };
    if (tracksCount < 80) return { phase: "growth", ratio: null };
    return { phase: "mature", ratio: null };
  }
  const ratio = Number((tracksCount / benchmarkTracks).toFixed(3));
  if (ratio < 0.30) return { phase: "seed", ratio };
  if (ratio < 0.80) return { phase: "growth", ratio };
  if (ratio <= 1.20) return { phase: "mature", ratio };
  return { phase: "bloated", ratio };
}

export function buildRoadmap(
  current: number,
  benchmark: number,
  phase: LifecyclePhase,
): RoadmapStep[] {
  const out: RoadmapStep[] = [];
  if (!benchmark || benchmark <= 0) return out;
  let t = current, c = 1;
  while (c <= 20) {
    if (phase === "seed" || phase === "growth") {
      const gap = benchmark - t;
      if (gap <= 0) break;
      const add = phase === "seed"
        ? Math.min(gap, 80)
        : Math.min(gap, Math.ceil(benchmark * 0.25));
      if (add <= 0) break;
      out.push({ cycle: c, delta: +add, total: t + add, action: "build", phase });
      t += add;
    } else if (phase === "bloated") {
      const exc = t - benchmark;
      if (exc <= 0) break;
      const rem = Math.min(Math.ceil(exc * 0.25), 50);
      if (rem <= 0) break;
      out.push({ cycle: c, delta: -rem, total: t - rem, action: "trim", phase });
      t -= rem;
    } else {
      break; // mature/decline: nenhum roadmap construtivo
    }
    const nr = t / benchmark;
    if (nr >= 0.80 && nr <= 1.20) break;
    c++;
  }
  return out;
}

/**
 * Em modo bloated, calcula quantas faixas remover neste ciclo e por dia
 * (espalha em 5 dias para não dar pico).
 */
export function bloatedRemovalBudget(
  current: number,
  benchmark: number,
): { max_per_cycle: number; max_per_day: number } {
  const exc = Math.max(0, current - benchmark);
  if (exc === 0) return { max_per_cycle: 0, max_per_day: 0 };
  const max_per_cycle = Math.min(Math.ceil(exc * 0.25), 50);
  const max_per_day = Math.max(1, Math.ceil(max_per_cycle / 5));
  return { max_per_cycle, max_per_day };
}
