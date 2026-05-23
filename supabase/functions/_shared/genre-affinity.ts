// _shared/genre-affinity.ts
// Helper para consumir genre_affinities em qualquer edge function.
// Uso típico: dado um genre_id "primário", retorna os vizinhos ordenados por score
// (acima de um threshold). Útil pra expandir pool de playlists quando faltar capacidade.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

export type GenreNeighbor = {
  genre_id: string;
  score: number;
  method: "lexicon" | "manual" | "hybrid";
};

/**
 * Retorna gêneros vizinhos de `genreId` com score >= threshold,
 * ordenados do mais próximo para o mais distante.
 */
export async function getGenreNeighbors(
  sb: SupabaseClient,
  genreId: string,
  threshold = 0.5,
): Promise<GenreNeighbor[]> {
  const { data, error } = await sb
    .from("genre_affinities")
    .select("genre_a_id, genre_b_id, score, method")
    .or(`genre_a_id.eq.${genreId},genre_b_id.eq.${genreId}`)
    .gte("score", threshold)
    .order("score", { ascending: false });
  if (error) {
    console.warn("[genre-affinity] read failed:", error.message);
    return [];
  }
  return (data ?? []).map((r: any) => ({
    genre_id: r.genre_a_id === genreId ? r.genre_b_id : r.genre_a_id,
    score: Number(r.score),
    method: r.method,
  }));
}

/**
 * Expansão em camadas: primeiro o próprio gênero, depois vizinhos com score
 * decrescente. Útil pra montar pool incremental até bater capacidade alvo.
 */
export async function expandGenrePool(
  sb: SupabaseClient,
  primaryGenreId: string,
  threshold = 0.5,
): Promise<Array<{ genre_id: string; score: number; tier: "primary" | "neighbor" }>> {
  const neighbors = await getGenreNeighbors(sb, primaryGenreId, threshold);
  return [
    { genre_id: primaryGenreId, score: 1, tier: "primary" as const },
    ...neighbors.map(n => ({ genre_id: n.genre_id, score: n.score, tier: "neighbor" as const })),
  ];
}
