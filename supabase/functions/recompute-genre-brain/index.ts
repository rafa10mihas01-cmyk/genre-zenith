// recompute-genre-brain — consolida o conhecimento do sistema sobre cada
// subgênero numa linha em `genre_brain`. Lê:
//   - genres (identidade)
//   - genre_seo_lexicon (top tokens fortes/ativos)
//   - genre_visual_signature (cores, tags, agressividade)
//   - playlist_leadership + playlists (contagem de leaders ativos)
//   - playlist_genres (avg confidence; drift/trend_shift)
//   - playlist_genre_history (reclassificações 7d)
//
// Body opcional: { genre_id?: string }  → recomputa um subgênero específico.
// Sem body: recomputa todos os subgêneros ativos.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { reportCronHealth } from "../_shared/cron-health.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const LEADER_THRESHOLD = 0.55; // leadership_score >= isto = "active leader"
const TOP_TOKENS       = 12;

function jr(p: unknown, status = 200): Response {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();
  let body: { genre_id?: string } = {};
  try { body = await req.json(); } catch { /* ok */ }
  const isCron = !body.genre_id;

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // 1) buscar subgêneros-alvo
  let genresQ = sb.from("genres").select("id, slug, nome").eq("ativo", true);
  if (body.genre_id) genresQ = genresQ.eq("id", body.genre_id);
  const { data: genres, error: gErr } = await genresQ;
  if (gErr) return jr({ ok: false, error: gErr.message }, 500);
  if (!genres?.length) return jr({ ok: true, processed: 0 });

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  let processed = 0;
  const results: Array<{ genre_id: string; knowledge_score: number }> = [];

  for (const g of genres) {
    // 2) lexicon
    const { data: lex } = await sb
      .from("genre_seo_lexicon")
      .select("token, strength, status, last_seen")
      .eq("genre_id", g.id)
      .order("strength", { ascending: false });

    const lexRows = lex ?? [];
    const topTokens = lexRows.slice(0, TOP_TOKENS).map((r: any) => ({
      token: r.token, strength: Number(r.strength) || 0, status: r.status,
    }));
    const tokensTotal  = lexRows.length;
    const tokensStrong = lexRows.filter((r: any) => r.status === "forte").length;
    const lexicon_updated_at = lexRows.reduce<string | null>((acc, r: any) => {
      const t = r.last_seen as string | null;
      if (!t) return acc;
      return !acc || t > acc ? t : acc;
    }, null);

    // 3) aesthetics
    const { data: vs } = await sb
      .from("genre_visual_signature")
      .select("dominant_colors, style_tags, aggressiveness_score, has_face_pct, contrast_avg, updated_at")
      .eq("genre_id", g.id)
      .maybeSingle();

    // 4) leadership
    const { data: leadRows } = await sb
      .from("playlist_leadership")
      .select("leadership_score, calculated_at, playlist_id, playlists!inner(genre_id)")
      .eq("playlists.genre_id", g.id);

    const leadArr = (leadRows ?? []) as Array<{ leadership_score: number | null; calculated_at: string | null }>;
    const activeLeaders = leadArr.filter(r => (r.leadership_score ?? 0) >= LEADER_THRESHOLD).length;
    const avgLeadership = leadArr.length
      ? leadArr.reduce((s, r) => s + (Number(r.leadership_score) || 0), 0) / leadArr.length
      : null;
    const leadership_updated_at = leadArr.reduce<string | null>((acc, r) => {
      const t = r.calculated_at;
      if (!t) return acc;
      return !acc || t > acc ? t : acc;
    }, null);

    // 5) playlists population
    const { count: playlistsTotal } = await sb
      .from("playlists")
      .select("id", { count: "exact", head: true })
      .eq("genre_id", g.id);

    const { count: playlistsWithGenre } = await sb
      .from("playlists")
      .select("id", { count: "exact", head: true })
      .eq("genre_id", g.id)
      .not("genre_id", "is", null);

    // 6) confidence média & drifts
    const { data: pg } = await sb
      .from("playlist_genres")
      .select("confidence, drift_score, trend_shift")
      .eq("genre_id", g.id);

    const pgRows = pg ?? [];
    const avgConfidence = pgRows.length
      ? pgRows.reduce((s, r: any) => s + (Number(r.confidence) || 0), 0) / pgRows.length
      : null;
    const recentDrifts7d = pgRows.filter((r: any) => r.trend_shift === true).length;

    // 7) reclassifications nos últimos 7 dias
    const { count: reclass7d } = await sb
      .from("playlist_genre_history")
      .select("id", { count: "exact", head: true })
      .or(`previous_genre_id.eq.${g.id},new_genre_id.eq.${g.id}`)
      .gte("created_at", sevenDaysAgo);

    // 8) knowledge_score (0-1): combina maturidade dos 4 pilares
    //    lexicon (25%) + aesthetics (20%) + leadership (25%) + confidence (30%)
    const lexMaturity   = clamp01(tokensStrong / 5);                       // 5 tokens fortes = 1
    const aesMaturity   = vs ? 1 : 0;                                      // tem assinatura visual?
    const leadMaturity  = clamp01(activeLeaders / 10);                     // 10 leaders = 1
    const confMaturity  = clamp01(Number(avgConfidence ?? 0));
    const knowledgeScore =
      0.25 * lexMaturity + 0.20 * aesMaturity + 0.25 * leadMaturity + 0.30 * confMaturity;

    // 9) upsert
    const row = {
      genre_id: g.id,
      slug: g.slug,
      display_name: (g as any).nome,
      parent_genre_id: null,

      top_tokens: topTokens,
      tokens_total: tokensTotal,
      tokens_strong: tokensStrong,
      lexicon_updated_at,

      dominant_colors: vs?.dominant_colors ?? [],
      style_tags: vs?.style_tags ?? [],
      aggressiveness_score: vs?.aggressiveness_score ?? null,
      has_face_pct: vs?.has_face_pct ?? null,
      contrast_avg: vs?.contrast_avg ?? null,
      aesthetics_updated_at: vs?.updated_at ?? null,

      playlists_total: playlistsTotal ?? 0,
      playlists_with_genre: playlistsWithGenre ?? 0,
      active_leaders: activeLeaders,
      avg_leadership_score: avgLeadership,
      leadership_updated_at,

      avg_confidence: avgConfidence,
      recent_drifts_7d: recentDrifts7d,
      recent_reclassifications_7d: reclass7d ?? 0,
      knowledge_score: Number(knowledgeScore.toFixed(4)),

      metadata: {},
      last_recomputed_at: new Date().toISOString(),
    };

    const { error: upErr } = await sb
      .from("genre_brain")
      .upsert(row, { onConflict: "genre_id" });

    if (upErr) {
      console.error("upsert genre_brain failed", g.slug, upErr.message);
      continue;
    }
    processed++;
    results.push({ genre_id: g.id, knowledge_score: row.knowledge_score });
  }

  return jr({ ok: true, processed, results });
});
