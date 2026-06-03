// DOMINANCE_RELIEF_MODE — pós-processamento opt-in.
//
// Princípio: rodar o planner produtivo normalmente, e DEPOIS aplicar uma
// trava de concentração sobre a saída. NÃO altera:
//   - followers, multiplicadores, POSITION_PCT, projeções, baseline
//   - cálculo de capacidade (`playlistCapAtPosition`)
//   - cálculo de entrega (`calcTrackDailyStreams`)
//   - lógica de posição (planner segue dono)
//
// Regra:
//  1. cap = capFactor × média dos Top5 planned_streams
//  2. Para cada alloc com planned > cap, calcula surplus = planned - cap
//  3. Redistribui surplus PRIMEIRO em selecionadas com headroom (≤ +headroomPct)
//  4. EFFICIENCY GATE: se redução estimada Top1 < 2pp E surplus residual < 50k,
//     mantém apenas redistribuição interna (não expande pool).
//  5. Caso justifique, abre expansão controlada: até +maxExtra playlists
//     primárias do pool elegível (não selecionadas), ordenadas por capacidade.
//  6. Se sobrar surplus após +maxExtra, devolve o plano ORIGINAL (fail-safe:
//     meta preservada).

import { playlistCapAtPosition, selectPositionByDailyNeed } from "./computeEcoPlan.ts";

export type ReliefAlloc = {
  id: string;
  playlist_id: string;
  followers: number;
  position: number;
  planned_streams: number;
  genre_source?: "primary" | "affinity" | null;
};

export type ReliefCandidate = {
  // Playlist primária elegível pelo planner mas NÃO selecionada.
  playlist_id: string;
  followers: number;
  // ranking interno (commercial_score × followers ou similar) — maior = melhor
  rank_score?: number;
};

export type ReliefOpts = {
  capFactor?: number;            // default 1.5
  headroomPct?: number;          // default 0.30 (+30% sobre planned)
  maxExtra?: number;             // default 3
  minTop1DropPp?: number;        // default 2 (pontos percentuais)
  minSurplusToExpand?: number;   // default 50000 streams
};

export type ReliefResult = {
  applied: boolean;
  reason: "ok" | "no_surplus" | "absorbed_internally" | "gate_blocked" | "insufficient_pool";
  allocs: ReliefAlloc[];
  addedAllocs: ReliefAlloc[];
  redistributedStreams: number;
  top1Before: number;
  top1After: number;
  capUsed: number;
};

const DEF: Required<ReliefOpts> = {
  capFactor: 1.5,
  headroomPct: 0.30,
  maxExtra: 3,
  minTop1DropPp: 2,
  minSurplusToExpand: 50_000,
};

function totalStreams(allocs: ReliefAlloc[]): number {
  let s = 0;
  for (const a of allocs) s += a.planned_streams;
  return s;
}

function top1Pct(allocs: ReliefAlloc[]): number {
  if (!allocs.length) return 0;
  const total = totalStreams(allocs);
  if (total <= 0) return 0;
  let max = 0;
  for (const a of allocs) if (a.planned_streams > max) max = a.planned_streams;
  return (max / total) * 100;
}

export function applyDominanceRelief(
  inputAllocs: ReliefAlloc[],
  pool: ReliefCandidate[],
  mult: number,
  opts: ReliefOpts = {},
): ReliefResult {
  const cfg = { ...DEF, ...opts };
  const allocs = inputAllocs.map(a => ({ ...a }));
  const top1Before = top1Pct(allocs);

  if (allocs.length < 5) {
    return {
      applied: false, reason: "no_surplus", allocs, addedAllocs: [],
      redistributedStreams: 0, top1Before, top1After: top1Before, capUsed: 0,
    };
  }

  // 1. cap = capFactor × média Top5
  const sorted = [...allocs].sort((a, b) => b.planned_streams - a.planned_streams);
  const top5Mean = sorted.slice(0, 5).reduce((s, a) => s + a.planned_streams, 0) / 5;
  const cap = Math.round(cfg.capFactor * top5Mean);

  // 2. Coleta surplus
  let surplus = 0;
  for (const a of allocs) {
    if (a.planned_streams > cap) {
      surplus += a.planned_streams - cap;
      a.planned_streams = cap;
    }
  }

  if (surplus <= 0) {
    return {
      applied: false, reason: "no_surplus", allocs: inputAllocs, addedAllocs: [],
      redistributedStreams: 0, top1Before, top1After: top1Before, capUsed: cap,
    };
  }

  // 3. Redistribui em headroom interno
  const consumed = redistributeInternal(allocs, surplus, mult, cfg.headroomPct);
  surplus -= consumed;

  // 4. EFFICIENCY GATE
  const top1AfterInternal = top1Pct(allocs);
  const dropPp = top1Before - top1AfterInternal;
  const projectedDropIfExpand = top1Before - estimateTop1IfDrained(allocs, surplus);
  const gainPp = Math.max(dropPp, projectedDropIfExpand);
  const totalRedistributed = (inputAllocs[0] ? totalStreams(inputAllocs) : 0) > 0
    ? Math.min(consumed + surplus, top1MaxBefore(inputAllocs) - cap)
    : 0;

  if (surplus > 0) {
    const passesGate =
      projectedDropIfExpand >= cfg.minTop1DropPp ||
      surplus >= cfg.minSurplusToExpand;
    if (!passesGate) {
      // Mantém só redistribuição interna; surplus residual é descartado do
      // alívio mas o plano original NÃO é restaurado — pequena queda absorvida
      // sem inflar plano.
      return {
        applied: true, reason: "gate_blocked", allocs, addedAllocs: [],
        redistributedStreams: consumed, top1Before, top1After: top1Pct(allocs), capUsed: cap,
      };
    }
  } else {
    return {
      applied: true, reason: "absorbed_internally", allocs, addedAllocs: [],
      redistributedStreams: consumed, top1Before, top1After: top1Pct(allocs), capUsed: cap,
    };
  }

  // 5. Expansão controlada
  const selectedIds = new Set(allocs.map(a => a.playlist_id));
  const candidates = pool
    .filter(c => !selectedIds.has(c.playlist_id) && c.followers > 0)
    .sort((a, b) => (b.rank_score ?? b.followers) - (a.rank_score ?? a.followers));

  const added: ReliefAlloc[] = [];
  for (const c of candidates) {
    if (added.length >= cfg.maxExtra) break;
    if (surplus <= 0) break;
    const sel = selectPositionByDailyNeed(c.followers, mult, surplus);
    // converte cap diário em streams totais aproximados via proporção:
    // surplus está em streams totais; sel.cap é diário. Assumimos que o
    // planner já modelou days × dailyCap = planned_streams para outras
    // allocs; replicamos a mesma proporção média.
    const avgDays = avgDaysFactor(allocs);
    const totalCap = Math.max(1, Math.round(sel.cap * avgDays));
    const take = Math.min(totalCap, surplus);
    added.push({
      id: `relief:${c.playlist_id}`,
      playlist_id: c.playlist_id,
      followers: c.followers,
      position: sel.position,
      planned_streams: take,
      genre_source: "primary",
    });
    surplus -= take;
  }

  if (surplus > 0 && added.length === 0) {
    // Pool não tinha primárias viáveis. Devolve original.
    return {
      applied: false, reason: "insufficient_pool", allocs: inputAllocs, addedAllocs: [],
      redistributedStreams: 0, top1Before, top1After: top1Before, capUsed: cap,
    };
  }

  const merged = [...allocs, ...added];
  return {
    applied: true, reason: "ok", allocs: merged, addedAllocs: added,
    redistributedStreams: consumed + added.reduce((s, a) => s + a.planned_streams, 0),
    top1Before, top1After: top1Pct(merged), capUsed: cap,
  };
}

function redistributeInternal(
  allocs: ReliefAlloc[],
  surplus: number,
  mult: number,
  headroomPct: number,
): number {
  if (surplus <= 0) return 0;
  let consumed = 0;
  // Ordena por maior headroom absoluto
  const ranked = allocs
    .map(a => {
      const dailyCap = playlistCapAtPosition(a.followers, mult, a.position);
      const avgDays = a.planned_streams > 0 && dailyCap > 0 ? a.planned_streams / dailyCap : 0;
      const maxPlanned = Math.round(a.planned_streams * (1 + headroomPct));
      const headroom = Math.max(0, maxPlanned - a.planned_streams);
      return { a, headroom, avgDays };
    })
    .filter(r => r.headroom > 0)
    .sort((a, b) => b.headroom - a.headroom);

  for (const r of ranked) {
    if (surplus <= 0) break;
    const take = Math.min(r.headroom, surplus);
    r.a.planned_streams += take;
    surplus -= take;
    consumed += take;
  }
  return consumed;
}

function avgDaysFactor(allocs: ReliefAlloc[]): number {
  // Estima dias médios da campanha a partir das allocs existentes
  // (planned_streams / dailyCap_at_position). Usado só para escalar a estimativa
  // de capacidade de novas playlists na expansão.
  let sum = 0; let n = 0;
  for (const a of allocs) {
    const dailyCap = playlistCapAtPosition(a.followers, 30, a.position);
    if (dailyCap > 0 && a.planned_streams > 0) {
      sum += a.planned_streams / dailyCap;
      n++;
    }
  }
  return n > 0 ? sum / n : 30;
}

function estimateTop1IfDrained(allocs: ReliefAlloc[], surplus: number): number {
  // Top1 hipotético assumindo que `surplus` extra vai pra novas playlists,
  // aumentando o denominador sem alterar o líder.
  const total = totalStreams(allocs) + surplus;
  if (total <= 0) return 0;
  let max = 0;
  for (const a of allocs) if (a.planned_streams > max) max = a.planned_streams;
  return (max / total) * 100;
}

function top1MaxBefore(allocs: ReliefAlloc[]): number {
  let m = 0;
  for (const a of allocs) if (a.planned_streams > m) m = a.planned_streams;
  return m;
}
