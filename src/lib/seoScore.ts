/**
 * SEO Score 0-100 para playlists publicadas.
 * Heurística baseada em boas práticas de busca do Spotify:
 *  - Nome (25): tamanho 20-50 chars, sem excesso de emojis/símbolos, sem CAPS, contém keyword de gênero/mood
 *  - Descrição (20): presente, 50-200 chars
 *  - Capa (20): presente e idade ≤ 90 dias
 *  - Faixas (20): ≥ 30 (mínimo viável), ≥ 50 (ideal)
 *  - Frescor (15): atualização (updated_at) recente — Spotify favorece playlists ativas
 */

export type SeoInput = {
  name: string | null;
  description: string | null;
  cover_image_url: string | null;
  cover_generated_at: string | null;
  tracks_added: number | null;
  updated_at?: string | null;
};

export type SeoBreakdown = {
  name: number;
  description: number;
  cover: number;
  tracks: number;
  freshness: number;
};

export type SeoResult = {
  score: number;
  breakdown: SeoBreakdown;
  issues: string[];
};

const MAX = { name: 25, description: 20, cover: 20, tracks: 20, freshness: 15 };

// Keywords de busca comuns em playlists de sucesso (gênero, mood, contexto).
const KEYWORDS = [
  "funk","sertanejo","pagode","rap","trap","pop","rock","eletro","house","techno",
  "lofi","chill","workout","gym","treino","party","festa","road","viagem","trip",
  "love","amor","sad","triste","happy","feliz","good vibes","hits","2024","2025","2026",
  "brasil","nacional","internacional","acoustic","acústico","piano","summer","verão","inverno",
];

export function computeSeoScore(p: SeoInput): SeoResult {
  const issues: string[] = [];
  const b: SeoBreakdown = { name: 0, description: 0, cover: 0, tracks: 0, freshness: 0 };

  // --- Nome (25) ---
  const name = (p.name ?? "").trim();
  if (!name) {
    issues.push("Sem nome");
  } else {
    const len = name.length;
    if (len >= 20 && len <= 50) b.name += 13;
    else if (len >= 12 && len < 20) { b.name += 7; issues.push("Nome curto demais"); }
    else if (len > 50 && len <= 70) { b.name += 9; issues.push("Nome longo demais"); }
    else { b.name += 3; issues.push("Nome fora do tamanho ideal"); }

    const emojiCount = (name.match(/\p{Extended_Pictographic}/gu) ?? []).length;
    if (emojiCount === 0) b.name += 4;
    else if (emojiCount <= 2) b.name += 3;
    else issues.push("Excesso de emojis no nome");

    const upper = name.replace(/[^A-Za-zÀ-ÿ]/g, "");
    const allCaps = upper.length > 4 && upper === upper.toUpperCase();
    if (!allCaps) b.name += 4;
    else issues.push("Nome todo em CAIXA ALTA");

    // Keyword (4pts) — favorece descobribilidade na busca
    const lower = name.toLowerCase();
    const hasKw = KEYWORDS.some(k => lower.includes(k));
    if (hasKw) b.name += 4;
    else issues.push("Nome sem keyword de busca (gênero/mood)");
  }

  // --- Descrição (20) ---
  const desc = (p.description ?? "").trim();
  if (!desc) {
    issues.push("Sem descrição");
  } else {
    const len = desc.length;
    if (len >= 50 && len <= 200) b.description = 20;
    else if (len >= 20 && len < 50) { b.description = 11; issues.push("Descrição curta"); }
    else if (len > 200 && len <= 300) { b.description = 14; issues.push("Descrição longa"); }
    else b.description = 6;
  }

  // --- Capa (20) ---
  if (!p.cover_image_url) {
    issues.push("Sem capa");
  } else {
    b.cover = 14;
    if (p.cover_generated_at) {
      const ageDays = (Date.now() - new Date(p.cover_generated_at).getTime()) / 86_400_000;
      if (ageDays <= 90) b.cover = 20;
      else if (ageDays <= 180) { b.cover = 16; issues.push("Capa com mais de 90 dias"); }
      else { b.cover = 11; issues.push("Capa com mais de 180 dias"); }
    } else {
      issues.push("Idade da capa desconhecida");
    }
  }

  // --- Faixas (20) ---
  const tracks = p.tracks_added ?? 0;
  if (tracks >= 50) b.tracks = 20;
  else if (tracks >= 30) b.tracks = 15;
  else if (tracks >= 15) { b.tracks = 8; issues.push("Poucas faixas (<30)"); }
  else { b.tracks = 2; issues.push("Faixas insuficientes"); }

  // --- Frescor (15) — última atualização ---
  if (!p.updated_at) {
    b.freshness = 6;
  } else {
    const ageDays = (Date.now() - new Date(p.updated_at).getTime()) / 86_400_000;
    if (ageDays <= 14) b.freshness = 15;
    else if (ageDays <= 30) b.freshness = 12;
    else if (ageDays <= 60) { b.freshness = 8; issues.push("Sem atualização há mais de 30 dias"); }
    else { b.freshness = 3; issues.push("Sem atualização há mais de 60 dias"); }
  }

  const score = Math.min(100, b.name + b.description + b.cover + b.tracks + b.freshness);
  return { score, breakdown: b, issues };
}

export function scoreTone(score: number): "success" | "warning" | "destructive" {
  if (score >= 75) return "success";
  if (score >= 50) return "warning";
  return "destructive";
}

/**
 * Estima ganho de seguidores ao subir o score.
 * Heurística conservadora: cada ponto de score = +0.8% de followers projetados (cap 60%).
 * Baseado em observações de catálogos onde melhorias de SEO renderam +30-60% em 30-60 dias.
 */
export function estimateImpact(currentScore: number, targetScore: number, currentFollowers: number): number {
  if (currentFollowers <= 0) return 0;
  const delta = Math.max(0, targetScore - currentScore);
  const pct = Math.min(0.6, delta * 0.008);
  return Math.round(currentFollowers * pct);
}

/**
 * Prioridade = potencial de ganho. Playlists com mais seguidores e score baixo sobem.
 * Score de prioridade 0-100 (relativo).
 */
export function priorityScore(currentScore: number, currentFollowers: number): number {
  const headroom = 100 - currentScore;            // 0-100
  const reach = Math.log10(Math.max(1, currentFollowers)); // 0-~6
  return Math.round(headroom * (1 + reach / 3));
}

export const SEO_MAX = MAX;
