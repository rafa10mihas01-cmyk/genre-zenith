// suggest-campaign-playlists — dado um genre_id (primário) e capacity_target opcional,
// devolve managed_playlists priorizando o gênero primário e expandindo automaticamente
// para gêneros vizinhos (via genre_affinities) até atingir a capacidade.
//
// Body: {
//   genre_id: string,                  // obrigatório
//   capacity_target?: number,          // soma de followers desejada; opcional
//   exclude_playlist_ids?: string[],   // managed_playlists.id a ignorar
//   affinity_threshold?: number,       // default 0.5
//   max_results?: number,              // default 50
// }
//
// Retorno: { ok, primary, neighbors, playlists: [{ id, name, followers, genre_id, tier, genre_score, affinity_method }] }

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { expandGenrePool } from "../_shared/genre-affinity.ts";
import { MIN_PLAYLIST_SAVES_FOR_CAMPAIGN } from "../_shared/eco-constants.ts";
import {
  getOccupiedPlaylistIds,
  partitionByOccupancy,
  PLANNER_FREE_FIRST_ENABLED,
} from "../_shared/eco-budget.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const genreId: string = String(body?.genre_id ?? "").trim();
    if (!genreId) return jr({ ok: false, error: "genre_id obrigatório" }, 400);

    const capacityTarget = Number.isFinite(Number(body?.capacity_target))
      ? Math.max(0, Number(body.capacity_target)) : null;
    const exclude: string[] = Array.isArray(body?.exclude_playlist_ids) ? body.exclude_playlist_ids : [];
    const threshold = Number.isFinite(Number(body?.affinity_threshold))
      ? Math.max(0, Math.min(1, Number(body.affinity_threshold))) : 0.5;
    const maxResults = Number.isFinite(Number(body?.max_results))
      ? Math.max(1, Math.min(200, Number(body.max_results))) : 50;

    const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // 1) pool de gêneros (primário + vizinhos)
    const tiers = await expandGenrePool(sb, genreId, threshold);
    const genreScore = new Map<string, { score: number; tier: "primary" | "neighbor"; method?: string }>();
    for (const t of tiers) genreScore.set(t.genre_id, { score: t.score, tier: t.tier });

    // método das afinidades (pra exibir "incluída via lexicon" etc.)
    if (tiers.length > 1) {
      const { data: afs } = await sb
        .from("genre_affinities")
        .select("genre_a_id, genre_b_id, method")
        .or(`genre_a_id.eq.${genreId},genre_b_id.eq.${genreId}`);
      for (const a of afs ?? []) {
        const other = a.genre_a_id === genreId ? a.genre_b_id : a.genre_a_id;
        const ex = genreScore.get(other);
        if (ex) ex.method = a.method;
      }
    }

    const allGenreIds = [...genreScore.keys()];

    // 2) buscar managed_playlists desses gêneros, não arquivadas
    let q = sb
      .from("managed_playlists")
      .select("id, name, followers, genre_id, cover_url, spotify_url, spotify_playlist_id, curatorial_state, lifecycle_stage")
      .in("genre_id", allGenreIds)
      .is("archived_at", null)
      .gte("followers", MIN_PLAYLIST_SAVES_FOR_CAMPAIGN)
      .order("followers", { ascending: false })
      .limit(500);
    if (exclude.length > 0) q = q.not("id", "in", `(${exclude.join(",")})`);

    const { data: pls, error: plErr } = await q;
    if (plErr) throw plErr;

    // 3) ordenar: primário primeiro (por followers), depois vizinhos por score x followers
    const ranked = (pls ?? []).map((p) => {
      const meta = genreScore.get(p.genre_id) ?? { score: 0, tier: "neighbor" as const };
      // score composto: tier primary recebe boost; neighbor pondera affinity * log(followers)
      const followers = Number(p.followers ?? 0);
      const fScore = followers > 0 ? Math.log10(followers + 10) / 7 : 0; // ~0..1
      const composite = meta.tier === "primary"
        ? 1 + fScore
        : meta.score * (0.4 + 0.6 * fScore);
      return {
        id: p.id,
        name: p.name,
        followers,
        genre_id: p.genre_id,
        cover_url: p.cover_url,
        spotify_url: p.spotify_url,
        spotify_playlist_id: p.spotify_playlist_id,
        curatorial_state: p.curatorial_state,
        lifecycle_stage: p.lifecycle_stage,
        tier: meta.tier,
        genre_score: meta.score,
        affinity_method: meta.method ?? null,
        _composite: composite,
      };
    }).sort((a, b) => b._composite - a._composite);

    // 4) corte por capacity_target (se vier), respeitando maxResults
    const out: typeof ranked = [];
    let acc = 0;
    for (const r of ranked) {
      if (out.length >= maxResults) break;
      out.push(r);
      acc += r.followers;
      if (capacityTarget && acc >= capacityTarget && out.some(x => x.tier === "neighbor") === false) {
        // se ainda não incluiu nenhum vizinho mas já bateu capacity, ok parar
        break;
      }
      if (capacityTarget && acc >= capacityTarget * 1.5) break;
    }

    const neighbors = tiers.filter(t => t.tier === "neighbor").map(t => ({
      genre_id: t.genre_id,
      score: t.score,
    }));

    return jr({
      ok: true,
      primary: { genre_id: genreId },
      neighbors,
      capacity_total: acc,
      capacity_target: capacityTarget,
      playlists: out.map(({ _composite, ...rest }) => rest),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("suggest-campaign-playlists error", msg);
    return jr({ ok: false, error: msg }, 500);
  }
});
