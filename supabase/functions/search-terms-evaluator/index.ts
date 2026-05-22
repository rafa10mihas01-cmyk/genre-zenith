// search-terms-evaluator — recalcula quality/trend score de cada search_term
// e marca termos saturados/mortos automaticamente (pruning).
//
// Fórmula do quality_score (0..100):
//   - playlists válidas encontradas nos últimos 30d (peso recência)
//   - follower médio dessas playlists
//   - atividade (recência da última coleta)
//   - recorrência útil das tracks (tracks da playlist que aparecem em outras playlists do mesmo gênero)
//
// trend_score (0..100): comparação 30d vs 30-60d anteriores. >50 = subindo, <50 = caindo.
//
// Status auto:
//   - quality_score >= 60 e trend_score >= 60 -> emergente
//   - quality_score >= 40              -> ativo
//   - quality_score em [20, 40)        -> saturado
//   - quality_score < 20 por 30+ dias  -> morto (vira para de ser coletado)
//
// Modos:
//   { genre_id }   -> avalia só termos de um gênero
//   { batch:true } -> avalia todos os termos ativos (default)
//   { term_id }    -> single
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";
import { recencyWeight } from "../_shared/recency.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type TermRow = {
  id: string;
  genre_id: string | null;
  termo: string;
  quality_score: number;
  trend_score: number;
  status: string;
  last_evaluated_at: string | null;
};

async function evaluateOne(sb: any, term: TermRow) {
  const now = new Date();
  const ref30 = new Date(now.getTime() - 30 * 86400e3);
  const ref60 = new Date(now.getTime() - 60 * 86400e3);

  // Resultados do termo
  const { data: results } = await sb
    .from("search_results")
    .select("id, spotify_playlist_id, seguidores, is_valid, coletado_em, last_seen_at")
    .eq("term_id", term.id);

  const all = results ?? [];
  const valid = all.filter((r: any) => r.is_valid !== false);

  // Janelas temporais
  const last30 = valid.filter((r: any) => new Date(r.last_seen_at ?? r.coletado_em) >= ref30);
  const prev30 = valid.filter((r: any) => {
    const d = new Date(r.last_seen_at ?? r.coletado_em);
    return d >= ref60 && d < ref30;
  });

  // --- quality_score (0..100) ---
  // a. volume ponderado por recência
  const weightedHits = valid.reduce((acc: number, r: any) =>
    acc + recencyWeight(r.last_seen_at ?? r.coletado_em, now), 0);
  const volumeScore = Math.min(40, weightedHits * 2); // 20 hits ponderados = 40 pts

  // b. follower médio das válidas recentes
  const followers = last30.map((r: any) => r.seguidores ?? 0).filter((f: number) => f > 0);
  const avgFollowers = followers.length > 0 ? followers.reduce((a: number, b: number) => a + b, 0) / followers.length : 0;
  const followerScore = Math.min(25, Math.log10(Math.max(1, avgFollowers)) * 5); // 100k seguidores ≈ 25 pts

  // c. atividade (última coleta)
  const lastSeen = valid.length > 0
    ? Math.max(...valid.map((r: any) => new Date(r.last_seen_at ?? r.coletado_em).getTime()))
    : 0;
  const daysSinceLast = lastSeen > 0 ? (now.getTime() - lastSeen) / 86400e3 : 999;
  const activityScore = daysSinceLast <= 7 ? 20 : daysSinceLast <= 30 ? 12 : daysSinceLast <= 90 ? 5 : 0;

  // d. recorrência útil das tracks
  let recurrenceScore = 0;
  if (valid.length > 0 && term.genre_id) {
    const resultIds = valid.slice(0, 30).map((r: any) => r.id);
    const { data: tracks } = await sb
      .from("search_tracks")
      .select("spotify_track_id")
      .in("result_id", resultIds)
      .not("spotify_track_id", "is", null)
      .limit(200);
    const trackIds = Array.from(new Set((tracks ?? []).map((t: any) => t.spotify_track_id).filter(Boolean)));
    if (trackIds.length > 0) {
      const { count } = await sb
        .from("search_tracks")
        .select("id", { count: "exact", head: true })
        .eq("genre_id", term.genre_id)
        .in("spotify_track_id", trackIds);
      const ratio = (count ?? 0) / Math.max(1, trackIds.length);
      recurrenceScore = Math.min(15, ratio * 3); // 5x recorrência = 15 pts
    }
  }

  const quality_score = Math.round((volumeScore + followerScore + activityScore + recurrenceScore) * 10) / 10;

  // --- trend_score (0..100) ---
  // Comparação volume 30d vs 30-60d. 50 = neutro.
  let trend_score = 50;
  if (prev30.length > 0) {
    const ratio = last30.length / prev30.length;
    trend_score = Math.round(Math.min(100, Math.max(0, 50 + (Math.log2(ratio) * 25))));
  } else if (last30.length > 0) {
    trend_score = 80; // termo novo bombando
  } else if (valid.length > 0) {
    trend_score = 20; // tinha resultado, parou
  }

  const search_velocity = last30.length;
  const growth_rate = prev30.length > 0
    ? Math.round(((last30.length - prev30.length) / prev30.length) * 1000) / 10
    : 0;

  // --- status ---
  let status: string;
  if (quality_score >= 60 && trend_score >= 60) status = "emergente";
  else if (quality_score >= 40) status = "ativo";
  else if (quality_score >= 20) status = "saturado";
  else {
    // só vira morto se já tava ruim por mais de 30 dias
    if (term.status === "morto") status = "morto";
    else if (
      term.quality_score < 20 &&
      term.last_evaluated_at &&
      (now.getTime() - new Date(term.last_evaluated_at).getTime()) / 86400e3 >= 30
    ) {
      status = "morto";
    } else {
      status = "saturado";
    }
  }

  const { error: upErr } = await sb
    .from("search_terms")
    .update({
      quality_score,
      trend_score,
      search_velocity,
      growth_rate,
      status,
      last_evaluated_at: now.toISOString(),
    })
    .eq("id", term.id);
  if (upErr) throw new Error(`update term: ${upErr.message}`);

  return {
    term_id: term.id, termo: term.termo, genre_id: term.genre_id,
    quality_score, trend_score, search_velocity, growth_rate, status,
    valid_results: valid.length, last30: last30.length, prev30: prev30.length,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  try {
    const body = await req.json().catch(() => ({}));
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    // Single
    if (body?.term_id) {
      const { data: term } = await sb
        .from("search_terms")
        .select("id, genre_id, termo, quality_score, trend_score, status, last_evaluated_at")
        .eq("id", body.term_id)
        .maybeSingle();
      if (!term) return jr({ ok: false, error: "term not found" }, 404);
      const result = await evaluateOne(sb, term as TermRow);
      return jr({ ok: true, mode: "single", result });
    }

    // Batch (por gênero ou geral)
    const limit = Math.min(body?.limit ?? 100, 500);
    let q = sb
      .from("search_terms")
      .select("id, genre_id, termo, quality_score, trend_score, status, last_evaluated_at")
      .neq("status", "morto")
      .order("last_evaluated_at", { ascending: true, nullsFirst: true })
      .limit(limit);
    if (body?.genre_id) q = q.eq("genre_id", body.genre_id);

    const { data: terms, error: tErr } = await q;
    if (tErr) throw new Error(tErr.message);

    const results: any[] = [];
    const errors: any[] = [];
    const CONCURRENCY = 4;
    const subset = terms ?? [];
    for (let i = 0; i < subset.length; i += CONCURRENCY) {
      const chunk = subset.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(chunk.map((t: any) => evaluateOne(sb, t as TermRow)));
      settled.forEach((s, idx) => {
        if (s.status === "fulfilled") results.push(s.value);
        else errors.push({ term_id: chunk[idx].id, error: s.reason?.message ?? String(s.reason) });
      });
    }

    // Contadores por status
    const byStatus = results.reduce((acc: Record<string, number>, r: any) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {});

    return jr({
      ok: true, mode: "batch",
      processed: results.length, errors_count: errors.length,
      by_status: byStatus,
      top_quality: results.slice().sort((a, b) => b.quality_score - a.quality_score).slice(0, 5),
      top_trend: results.slice().sort((a, b) => b.trend_score - a.trend_score).slice(0, 5),
      pruned: results.filter(r => r.status === "morto").length,
      errors: errors.slice(0, 5),
    });
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
