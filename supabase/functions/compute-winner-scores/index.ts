// compute-winner-scores — Calcula Winner Score v2 em batch.
// Pode ser chamada:
//   - manualmente: POST { genre_id?, limit?, force? }
//   - via cron com header x-cron-secret
//
// Estratégia:
//   1) Carrega contexto do gênero (model_artists, keywords, br_boost)
//   2) Seleciona search_results enriquecidos sem winner_score (ou com versão antiga)
//   3) Calcula e atualiza em lote

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  computeWinnerScore,
  WINNER_SCORE_VERSION,
  type WinnerContext,
} from "../_shared/winner-score.ts";
import { BR_BOOST_BY_GENRE } from "../_shared/discovery-scoring.ts";
import { reportCronHealth } from "../_shared/cron-health.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

interface GenreCtx extends WinnerContext {
  slug: string;
}

async function loadGenreContext(supabase: any, genreId: string): Promise<GenreCtx> {
  const [{ data: genre }, { data: model }] = await Promise.all([
    supabase.from("genres").select("slug").eq("id", genreId).maybeSingle(),
    supabase.from("genre_models").select("palavras_chave,musicas_recorrentes").eq("genre_id", genreId).maybeSingle(),
  ]);
  const slug = (genre?.slug ?? "").toLowerCase();
  const model_keywords: string[] = (() => {
    const arr = model?.palavras_chave as any[] | undefined;
    if (!Array.isArray(arr)) return [];
    return arr
      .map((x: any) => (typeof x === "string" ? x : x?.value ?? x?.keyword ?? ""))
      .filter(Boolean)
      .map((s: string) => String(s).toLowerCase());
  })();
  const model_artists: string[] = (() => {
    const tracks = model?.musicas_recorrentes as any[] | undefined;
    if (!Array.isArray(tracks)) return [];
    const set = new Set<string>();
    for (const t of tracks) {
      const a = typeof t === "string" ? "" : (t?.artista ?? t?.artist ?? "");
      if (a) {
        String(a).split(/[,&]/).forEach((x) => {
          const v = x.trim().toLowerCase();
          if (v.length > 2) set.add(v);
        });
      }
    }
    return [...set];
  })();
  return {
    slug,
    model_artists,
    model_keywords,
    br_boost_terms: BR_BOOST_BY_GENRE[slug] ?? [],
  };
}

export async function recomputeForGenre(
  supabase: any,
  genreId: string,
  limit: number,
  force: boolean,
): Promise<{ processed: number; avg: number }> {
  const ctx = await loadGenreContext(supabase, genreId);

  let query = supabase
    .from("search_results")
    .select("id, nome_playlist, descricao, imagem_url, seguidores, total_musicas, enriched_at, last_seen_at, times_seen, score, is_valid")
    .eq("genre_id", genreId)
    .is("duplicate_of", null)
    .not("enriched_at", "is", null)
    .limit(limit);

  if (!force) {
    query = query.or(`winner_score.is.null,winner_score_version.lt.${WINNER_SCORE_VERSION}`);
  }

  const { data: rows, error } = await query;
  if (error) throw error;
  if (!rows || rows.length === 0) return { processed: 0, avg: 0 };

  let sumTotal = 0;
  const updates: Promise<any>[] = [];

  for (const r of rows) {
    const breakdown = computeWinnerScore(
      {
        followers: r.seguidores,
        total_tracks: r.total_musicas,
        descricao: r.descricao,
        imagem: r.imagem_url,
        nome_playlist: r.nome_playlist,
        enriched_at: r.enriched_at,
        last_seen_at: r.last_seen_at,
        times_seen: r.times_seen,
        gate_score: r.score == null ? null : Number(r.score),
        is_valid: r.is_valid,
      },
      ctx,
    );
    sumTotal += breakdown.total;
    updates.push(
      supabase
        .from("search_results")
        .update({
          winner_score: breakdown.total,
          winner_score_version: WINNER_SCORE_VERSION,
          winner_breakdown: breakdown,
          winner_score_at: new Date().toISOString(),
        })
        .eq("id", r.id),
    );
  }

  // Roda em paralelo controlado
  const CHUNK = 25;
  for (let i = 0; i < updates.length; i += CHUNK) {
    await Promise.all(updates.slice(i, i + CHUNK));
  }

  return {
    processed: rows.length,
    avg: Math.round(sumTotal / rows.length),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const cronHeader = req.headers.get("x-cron-secret");
  const isCron = CRON_SECRET && cronHeader === CRON_SECRET;

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const startedAt = Date.now();

  try {
    let payload: { genre_id?: string; limit?: number; force?: boolean } = {};
    if (req.method === "POST") {
      try { payload = await req.json(); } catch { /* allow empty */ }
    }
    const limit = Math.min(payload.limit ?? 300, 1000);
    const force = !!payload.force;

    let genreIds: string[] = [];
    if (payload.genre_id) {
      genreIds = [payload.genre_id];
    } else {
      const { data, error } = await supabase
        .from("genres")
        .select("id")
        .eq("ativo", true);
      if (error) throw error;
      genreIds = (data ?? []).map((g: any) => g.id);
    }

    const results: any[] = [];
    let totalProcessed = 0;
    for (const gid of genreIds) {
      const r = await recomputeForGenre(supabase, gid, limit, force);
      results.push({ genre_id: gid, ...r });
      totalProcessed += r.processed;
      if (isCron && totalProcessed >= limit) break; // cron-bounded
    }

    if (isCron || !payload.genre_id) {
      await reportCronHealth(supabase, {
        job_name: "compute-winner-scores",
        status: "ok",
        startedAt,
        metrics: { total_processed: totalProcessed, genres: genreIds.length },
      });
    }

    return new Response(
      JSON.stringify({ ok: true, total_processed: totalProcessed, by_genre: results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("compute-winner-scores error", e);
    await reportCronHealth(supabase, {
      job_name: "compute-winner-scores",
      status: "error",
      startedAt,
      message: String((e as any)?.message ?? e),
    });
    return new Response(
      JSON.stringify({ ok: false, error: String(e?.message ?? e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
