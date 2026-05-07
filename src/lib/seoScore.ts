/**
 * SEO Score 0-100 para playlists publicadas.
 * Heurística baseada em boas práticas de busca do Spotify:
 *  - Nome: tamanho 20-50 chars, sem excesso de emojis/símbolos, sem CAPS
 *  - Descrição: presente, 50-200 chars
 *  - Capa: presente e idade ≤ 90 dias
 *  - Faixas: ≥ 30 (mínimo viável), ≥ 50 (ideal)
 */

export type SeoInput = {
  name: string | null;
  description: string | null;
  cover_image_url: string | null;
  cover_generated_at: string | null;
  tracks_added: number | null;
};

export type SeoBreakdown = {
  name: number;
  description: number;
  cover: number;
  tracks: number;
};

export type SeoResult = {
  score: number;
  breakdown: SeoBreakdown;
  issues: string[];
};

const MAX = { name: 30, description: 25, cover: 25, tracks: 20 };

export function computeSeoScore(p: SeoInput): SeoResult {
  const issues: string[] = [];
  const b: SeoBreakdown = { name: 0, description: 0, cover: 0, tracks: 0 };

  // --- Nome (30) ---
  const name = (p.name ?? "").trim();
  if (!name) {
    issues.push("Sem nome");
  } else {
    const len = name.length;
    if (len >= 20 && len <= 50) b.name += 18;
    else if (len >= 12 && len < 20) { b.name += 10; issues.push("Nome curto demais"); }
    else if (len > 50 && len <= 70) { b.name += 12; issues.push("Nome longo demais"); }
    else { b.name += 4; issues.push("Nome fora do tamanho ideal"); }

    const emojiCount = (name.match(/\p{Extended_Pictographic}/gu) ?? []).length;
    if (emojiCount === 0) b.name += 6;
    else if (emojiCount <= 2) b.name += 4;
    else { b.name += 0; issues.push("Excesso de emojis no nome"); }

    const upper = name.replace(/[^A-Za-zÀ-ÿ]/g, "");
    const allCaps = upper.length > 4 && upper === upper.toUpperCase();
    if (!allCaps) b.name += 6;
    else issues.push("Nome todo em CAIXA ALTA");
  }

  // --- Descrição (25) ---
  const desc = (p.description ?? "").trim();
  if (!desc) {
    issues.push("Sem descrição");
  } else {
    const len = desc.length;
    if (len >= 50 && len <= 200) b.description = 25;
    else if (len >= 20 && len < 50) { b.description = 14; issues.push("Descrição curta"); }
    else if (len > 200 && len <= 300) { b.description = 18; issues.push("Descrição longa"); }
    else b.description = 8;
  }

  // --- Capa (25) ---
  if (!p.cover_image_url) {
    issues.push("Sem capa");
  } else {
    b.cover = 18;
    if (p.cover_generated_at) {
      const ageDays = (Date.now() - new Date(p.cover_generated_at).getTime()) / 86_400_000;
      if (ageDays <= 90) b.cover = 25;
      else if (ageDays <= 180) { b.cover = 20; issues.push("Capa com mais de 90 dias"); }
      else { b.cover = 14; issues.push("Capa com mais de 180 dias"); }
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

  const score = Math.min(100, b.name + b.description + b.cover + b.tracks);
  return { score, breakdown: b, issues };
}

export function scoreTone(score: number): "success" | "warning" | "destructive" {
  if (score >= 75) return "success";
  if (score >= 50) return "warning";
  return "destructive";
}

export const SEO_MAX = MAX;
