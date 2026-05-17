// _shared/winner-score.ts — Winner Score v2 (Onda 2)
//
// Score composto 0-100 para classificar a "qualidade competitiva" de uma playlist
// dentro do seu gênero. Substitui o ranking puramente por followers.
//
// Pesos:
//   30% Authority   (followers + crescimento)
//   25% Health      (total_musicas + freshness/imagem/descrição)
//   30% Niche Adherence (artistas/keywords recorrentes do gênero)
//   15% Operational Signal (times_seen, gate score, valid)

export const WINNER_SCORE_VERSION = 2;

export interface WinnerInput {
  followers: number | null;
  total_tracks: number | null;
  descricao: string | null;
  imagem: string | null;
  nome_playlist: string | null;
  enriched_at: string | null;
  last_seen_at: string | null;
  times_seen: number | null;
  gate_score: number | null;          // search_results.score
  is_valid: boolean | null;
  growth_pct_30d?: number | null;     // opcional, se houver telemetria
}

export interface WinnerContext {
  model_artists: string[];   // lower-case
  model_keywords: string[];  // lower-case
  br_boost_terms?: string[]; // lower-case
}

export interface WinnerBreakdown {
  authority: number;
  health: number;
  niche: number;
  operational: number;
  total: number;
  version: number;
  notes: string[];
}

function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

function authorityScore(input: WinnerInput): { score: number; notes: string[] } {
  const f = input.followers ?? 0;
  let s = 0;
  const notes: string[] = [];
  // Curva log-like 0..100 baseada em followers.
  if (f >= 500_000) { s = 100; notes.push("authority:>=500k"); }
  else if (f >= 100_000) { s = 90; notes.push("authority:>=100k"); }
  else if (f >= 25_000) { s = 75; notes.push("authority:>=25k"); }
  else if (f >= 5_000) { s = 55; notes.push("authority:>=5k"); }
  else if (f >= 1_000) { s = 35; notes.push("authority:>=1k"); }
  else if (f >= 250) { s = 20; notes.push("authority:>=250"); }
  else if (f > 0) { s = 8; notes.push("authority:<250"); }

  // Bônus de crescimento (se disponível)
  const g = input.growth_pct_30d;
  if (typeof g === "number" && isFinite(g)) {
    if (g >= 20) { s = Math.min(100, s + 10); notes.push("+10 growth>=20%"); }
    else if (g >= 5) { s = Math.min(100, s + 5); notes.push("+5 growth>=5%"); }
    else if (g <= -10) { s = Math.max(0, s - 10); notes.push("-10 growth<=-10%"); }
  }
  return { score: clamp(s), notes };
}

function healthScore(input: WinnerInput): { score: number; notes: string[] } {
  const t = input.total_tracks ?? 0;
  const notes: string[] = [];
  let s = 0;
  // Track count (curva ideal ~50-200)
  if (t >= 50 && t <= 250) { s += 60; notes.push("health:tracks-ideal"); }
  else if (t >= 30) { s += 45; notes.push("health:tracks-ok"); }
  else if (t >= 15) { s += 25; notes.push("health:tracks-low"); }
  else if (t > 250) { s += 35; notes.push("health:tracks-bloat"); }
  else if (t > 0) { s += 10; notes.push("health:tracks-poor"); }

  // Metadata completude
  if (input.imagem && input.imagem.length > 10) { s += 15; notes.push("+15 img"); }
  if (input.descricao && input.descricao.trim().length >= 30) { s += 10; notes.push("+10 desc"); }

  // Freshness (last_seen_at)
  const last = input.last_seen_at ? new Date(input.last_seen_at).getTime() : 0;
  if (last > 0) {
    const days = (Date.now() - last) / 86400000;
    if (days <= 7) { s += 15; notes.push("+15 fresh<=7d"); }
    else if (days <= 30) { s += 8; notes.push("+8 fresh<=30d"); }
    else if (days > 90) { s -= 10; notes.push("-10 stale>90d"); }
  }

  return { score: clamp(s), notes };
}

function nicheAdherence(input: WinnerInput, ctx: WinnerContext): { score: number; notes: string[] } {
  const hay = `${(input.nome_playlist ?? "").toLowerCase()} ${(input.descricao ?? "").toLowerCase()}`;
  const notes: string[] = [];
  let s = 0;

  const artistHits = ctx.model_artists.filter(a => a && hay.includes(a));
  if (artistHits.length >= 3) { s += 50; notes.push(`+50 artists(${artistHits.length})`); }
  else if (artistHits.length === 2) { s += 35; notes.push("+35 artists(2)"); }
  else if (artistHits.length === 1) { s += 20; notes.push("+20 artists(1)"); }

  const kwHits = ctx.model_keywords.filter(k => k && hay.includes(k));
  if (kwHits.length >= 3) { s += 35; notes.push(`+35 kw(${kwHits.length})`); }
  else if (kwHits.length === 2) { s += 22; notes.push("+22 kw(2)"); }
  else if (kwHits.length === 1) { s += 12; notes.push("+12 kw(1)"); }

  const brHits = (ctx.br_boost_terms ?? []).filter(t => t && hay.includes(t));
  if (brHits.length > 0) { s += 15; notes.push(`+15 br(${brHits.length})`); }

  return { score: clamp(s), notes };
}

function operationalScore(input: WinnerInput): { score: number; notes: string[] } {
  const notes: string[] = [];
  let s = 0;

  // times_seen: quanto mais aparece em descobertas independentes, mais "real" é
  const ts = input.times_seen ?? 0;
  if (ts >= 5) { s += 50; notes.push("+50 seen>=5"); }
  else if (ts >= 3) { s += 35; notes.push("+35 seen>=3"); }
  else if (ts >= 2) { s += 20; notes.push("+20 seen>=2"); }
  else if (ts >= 1) { s += 8; notes.push("+8 seen=1"); }

  // gate score (0..~100 do scoreAndGate textual)
  const gs = input.gate_score ?? 0;
  if (gs >= 60) { s += 35; notes.push("+35 gate>=60"); }
  else if (gs >= 40) { s += 22; notes.push("+22 gate>=40"); }
  else if (gs >= 20) { s += 10; notes.push("+10 gate>=20"); }
  else if (gs < 0)   { s -= 20; notes.push("-20 gate<0"); }

  if (input.is_valid === true) { s += 15; notes.push("+15 valid"); }
  if (input.is_valid === false) { s -= 20; notes.push("-20 invalid"); }

  return { score: clamp(s), notes };
}

export function computeWinnerScore(
  input: WinnerInput,
  ctx: WinnerContext,
): WinnerBreakdown {
  const a = authorityScore(input);
  const h = healthScore(input);
  const n = nicheAdherence(input, ctx);
  const o = operationalScore(input);

  // Ponderação 30/25/30/15
  const total = Math.round(
    a.score * 0.30 +
    h.score * 0.25 +
    n.score * 0.30 +
    o.score * 0.15,
  );

  return {
    authority: Math.round(a.score),
    health: Math.round(h.score),
    niche: Math.round(n.score),
    operational: Math.round(o.score),
    total: clamp(total),
    version: WINNER_SCORE_VERSION,
    notes: [...a.notes, ...h.notes, ...n.notes, ...o.notes],
  };
}
