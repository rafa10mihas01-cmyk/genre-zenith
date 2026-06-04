// Helpers puros do painel "Capacidade do Ecossistema".
// Usam EXATAMENTE a mesma fórmula do planner:
//   cap_dia = saves × (mult/30) × POSITION_PCT[pos]
// Nada de cálculo paralelo. Tudo derivado de POSITION_PCT.

import { POSITION_PCT, calculateTrackDailyStreams } from "@/lib/campaignOperationalPlan";

export const SCENARIOS = {
  conservative: { label: "Conservador", position: 5, pct: POSITION_PCT[4] }, // 6%
  moderate:     { label: "Médio",       position: 3, pct: POSITION_PCT[2] }, // 8%
  aggressive:   { label: "Agressivo",   position: 1, pct: POSITION_PCT[0] }, // 12%
} as const;

export type ScenarioKey = keyof typeof SCENARIOS;

export type EcoPlaylist = {
  id: string;
  name: string;
  followers: number;
  genre_id: string | null;
};

export type ScenarioCapacity = {
  daily: number;
  monthly: number;
};

export function capacityOf(saves: number, scenario: ScenarioKey, mult = 35): ScenarioCapacity {
  const pos = SCENARIOS[scenario].position;
  const daily = calculateTrackDailyStreams(saves, mult, pos);
  return { daily: Math.round(daily), monthly: Math.round(daily * 30) };
}

export function aggregateCapacity(playlists: EcoPlaylist[], mult = 35) {
  const savesTotal = playlists.reduce((s, p) => s + (p.followers || 0), 0);
  return {
    playlistCount: playlists.length,
    savesTotal,
    conservative: capacityOf(savesTotal, "conservative", mult),
    moderate:     capacityOf(savesTotal, "moderate", mult),
    aggressive:   capacityOf(savesTotal, "aggressive", mult),
  };
}

export const SAVE_BANDS: Array<{ key: string; label: string; min: number; max: number }> = [
  { key: "b1", label: "0–99",       min: 0,    max: 99 },
  { key: "b2", label: "100–499",    min: 100,  max: 499 },
  { key: "b3", label: "500–999",    min: 500,  max: 999 },
  { key: "b4", label: "1k–4.999",   min: 1000, max: 4999 },
  { key: "b5", label: "5k+",        min: 5000, max: Infinity },
];

export function bandOf(saves: number): string {
  for (const b of SAVE_BANDS) {
    if (saves >= b.min && saves <= b.max) return b.key;
  }
  return "b1";
}

export function concentrationTop(playlists: EcoPlaylist[], pct: number, mult = 35) {
  const sorted = [...playlists].sort((a, b) => b.followers - a.followers);
  const n = Math.max(1, Math.ceil(sorted.length * pct));
  const top = sorted.slice(0, n);
  const totalSaves = sorted.reduce((s, p) => s + p.followers, 0) || 1;
  const topSaves = top.reduce((s, p) => s + p.followers, 0);
  return {
    countTop: n,
    savesTop: topSaves,
    sharePct: (topSaves / totalSaves) * 100,
    daily: capacityOf(topSaves, "moderate", mult).daily,
  };
}
