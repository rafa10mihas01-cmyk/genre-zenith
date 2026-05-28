// _shared/track-matching.ts
// =====================================================================
// Identidade robusta de tracks em snapshots de playlists.
//
// Camadas (em ordem de confiança):
//   1. spotify_track_id igual                  → match exato
//   2. ISRC igual (ambos têm)                  → mesma gravação (re-upload)
//   3. fuzzy(name+artist) >= NAME_THRESHOLD
//      AND |duration_db - duration_sp| <= DURATION_TOLERANCE_MS
//                                              → mesma faixa, ID novo
//
// Defesa em profundidade: match por ISRC ainda exige fuzzy(name) >= ISRC_NAME_GUARD
// pra evitar colisão rara de ISRC reutilizado em re-releases.
//
// Sem dependências externas — usa similaridade Dice-coefficient sobre bigramas
// normalizados. Custo O(n*m) onde n=residuos no DB e m=residuos no Spotify,
// tipicamente ≤ 10 cada após camadas 1-2.
// =====================================================================

export const NAME_THRESHOLD = 0.85;        // fuzzy name+artist mínimo pra match
export const ISRC_NAME_GUARD = 0.70;       // confirmação leve no path ISRC
export const DURATION_TOLERANCE_MS = 3000; // ±3s pra distinguir live vs studio

export type TrackIdentity = {
  spotify_track_id: string | null;
  isrc: string | null;
  name: string | null;
  artist: string | null;
  duration_ms: number | null;
};

export function normalizeText(s: string | null | undefined): string {
  if (!s) return "";
  return s.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\(.*?\)|\[.*?\]/g, " ")            // remove "(feat. X)", "(remix)" etc
    .replace(/\b(feat|ft|featuring|prod|remix|version|original|radio edit)\b\.?/gi, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  if (s.length < 2) {
    if (s.length === 1) m.set(s, 1);
    return m;
  }
  for (let i = 0; i < s.length - 1; i++) {
    const bg = s.slice(i, i + 2);
    m.set(bg, (m.get(bg) ?? 0) + 1);
  }
  return m;
}

/** Dice coefficient — 0 a 1, simétrico, robusto a typos curtos. */
export function similarity(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ba = bigrams(na);
  const bb = bigrams(nb);
  let inter = 0;
  let totalA = 0, totalB = 0;
  for (const v of ba.values()) totalA += v;
  for (const v of bb.values()) totalB += v;
  for (const [bg, va] of ba) {
    const vb = bb.get(bg);
    if (vb) inter += Math.min(va, vb);
  }
  if (totalA + totalB === 0) return 0;
  return (2 * inter) / (totalA + totalB);
}

function joinedSig(t: TrackIdentity): string {
  return `${t.name ?? ""} ${t.artist ?? ""}`.trim();
}

function durationOk(a: TrackIdentity, b: TrackIdentity): boolean {
  if (a.duration_ms == null || b.duration_ms == null) return true; // sem dado, não bloqueia
  return Math.abs(a.duration_ms - b.duration_ms) <= DURATION_TOLERANCE_MS;
}

export type MatchPair = {
  dbIndex: number;
  spotifyIndex: number;
  via: "spotify_id" | "isrc" | "fuzzy";
  score: number;
};

/**
 * Resolve identidade entre snapshot do DB e snapshot fresco do Spotify.
 * Retorna pares casados + os índices não casados de cada lado.
 *
 * INPUTS: arrays já alinhados aos índices (não muta).
 */
export function matchTracks(
  dbTracks: TrackIdentity[],
  spotifyTracks: TrackIdentity[],
): { matched: MatchPair[]; unmatchedDb: number[]; unmatchedSp: number[] } {
  const matched: MatchPair[] = [];
  const usedDb = new Set<number>();
  const usedSp = new Set<number>();

  // Camada 1: spotify_track_id
  const dbById = new Map<string, number>();
  dbTracks.forEach((t, i) => {
    if (t.spotify_track_id) dbById.set(t.spotify_track_id, i);
  });
  spotifyTracks.forEach((sp, j) => {
    if (!sp.spotify_track_id) return;
    const i = dbById.get(sp.spotify_track_id);
    if (i != null && !usedDb.has(i)) {
      matched.push({ dbIndex: i, spotifyIndex: j, via: "spotify_id", score: 1 });
      usedDb.add(i); usedSp.add(j);
    }
  });

  // Camada 2: ISRC (com guard leve de nome pra evitar colisão de re-release)
  const dbByIsrc = new Map<string, number[]>();
  dbTracks.forEach((t, i) => {
    if (usedDb.has(i) || !t.isrc) return;
    const arr = dbByIsrc.get(t.isrc) ?? [];
    arr.push(i);
    dbByIsrc.set(t.isrc, arr);
  });
  spotifyTracks.forEach((sp, j) => {
    if (usedSp.has(j) || !sp.isrc) return;
    const candidates = dbByIsrc.get(sp.isrc);
    if (!candidates) return;
    // escolhe o melhor entre os candidatos disponíveis com guard de nome
    let best: { idx: number; score: number } | null = null;
    for (const i of candidates) {
      if (usedDb.has(i)) continue;
      const score = similarity(joinedSig(dbTracks[i]), joinedSig(sp));
      if (score >= ISRC_NAME_GUARD && (!best || score > best.score)) {
        best = { idx: i, score };
      }
    }
    if (best) {
      matched.push({ dbIndex: best.idx, spotifyIndex: j, via: "isrc", score: best.score });
      usedDb.add(best.idx); usedSp.add(j);
    }
  });

  // Camada 3: fuzzy name+artist + duração
  const dbResid: number[] = [];
  const spResid: number[] = [];
  dbTracks.forEach((_, i) => { if (!usedDb.has(i)) dbResid.push(i); });
  spotifyTracks.forEach((_, j) => { if (!usedSp.has(j)) spResid.push(j); });

  // Calcula matriz e pega greedy por maior score (limita custo: skip se ambos lados grandes)
  if (dbResid.length > 0 && spResid.length > 0 && dbResid.length * spResid.length <= 50_000) {
    const pairs: { i: number; j: number; score: number }[] = [];
    for (const i of dbResid) {
      const sigA = joinedSig(dbTracks[i]);
      for (const j of spResid) {
        if (!durationOk(dbTracks[i], spotifyTracks[j])) continue;
        const score = similarity(sigA, joinedSig(spotifyTracks[j]));
        if (score >= NAME_THRESHOLD) pairs.push({ i, j, score });
      }
    }
    pairs.sort((a, b) => b.score - a.score);
    for (const p of pairs) {
      if (usedDb.has(p.i) || usedSp.has(p.j)) continue;
      matched.push({ dbIndex: p.i, spotifyIndex: p.j, via: "fuzzy", score: p.score });
      usedDb.add(p.i); usedSp.add(p.j);
    }
  }

  const unmatchedDb = dbTracks.map((_, i) => i).filter((i) => !usedDb.has(i));
  const unmatchedSp = spotifyTracks.map((_, j) => j).filter((j) => !usedSp.has(j));
  return { matched, unmatchedDb, unmatchedSp };
}

/**
 * Computa hash determinístico da playlist priorizando ISRC quando disponível,
 * com fallback pro spotify_track_id. Estável entre re-uploads.
 */
export async function computeIdentityHash(
  tracks: { isrc: string | null; spotify_track_id: string | null }[],
): Promise<string> {
  const ids = tracks.map((t) => (t.isrc ? `i:${t.isrc}` : t.spotify_track_id ? `s:${t.spotify_track_id}` : ""));
  const enc = new TextEncoder().encode(ids.join("|"));
  const buf = await crypto.subtle.digest("SHA-1", enc);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
