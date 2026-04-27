// get-sistema-stats — agrega num único response todos os dados que o
// FluxoVisual precisa para montar os nós (exceto autopilot_runs, que segue
// sendo lido direto pelo client por exigir filtragem de seleção).
//
// Body:
//   {
//     genre_id?: string,   // se omitido, agrega global
//     since?:    string,   // ISO; default: agora - 24h
//     until?:    string    // ISO opcional (modo replay)
//   }

import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface Body {
  genre_id?: string;
  run_id?: string; // aceito por compat com o spec; não filtra nada server-side
  since?: string;
  until?: string;
}

function jr(p: unknown, status = 200): Response {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")    return jr({ error: "method not allowed" }, 405);

  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  let body: Body = {};
  try { body = await req.json(); } catch { /* body opcional */ }

  const genreId = body.genre_id?.trim() || null;
  const since   = body.since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const until   = body.until || null;

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── collection_logs ─────────────────────────────────────────────────
  let logsQ = sb.from("collection_logs").select("*")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(200);
  if (until)   logsQ = logsQ.lte("created_at", until);
  if (genreId) logsQ = logsQ.or(`genre_id.eq.${genreId},genre_id.is.null`);

  // ── playlist_adjustments ────────────────────────────────────────────
  let adjQ = sb.from("playlist_adjustments").select("*")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(50);
  if (until) adjQ = adjQ.lte("created_at", until);

  // ── system_flags / search_terms / genre_filters / accounts ─────────
  const flagsQ = sb.from("system_flags")
    .select("apify_blocked, apify_blocked_reason")
    .eq("singleton_key", "app")
    .maybeSingle();

  const termsQ = genreId
    ? sb.from("search_terms").select("id", { count: "exact", head: true }).eq("genre_id", genreId)
    : sb.from("search_terms").select("id", { count: "exact", head: true });

  const gfQ = genreId
    ? sb.from("genre_filters")
        .select("min_followers, max_playlists, min_daily, base_daily, max_daily, briefing_mode, blacklist")
        .eq("genre_id", genreId)
        .maybeSingle()
    : Promise.resolve({ data: null, error: null });

  const accQ = sb.from("accounts").select("status, current_playlists, max_playlists");

  // ── search_results: total, válidos (com seguidores), inválidos ─────
  const allQ = genreId
    ? sb.from("search_results").select("id", { count: "exact", head: true }).eq("genre_id", genreId)
    : sb.from("search_results").select("id", { count: "exact", head: true });

  const validQ = genreId
    ? sb.from("search_results").select("seguidores", { count: "exact" }).eq("genre_id", genreId).eq("is_valid", true)
    : sb.from("search_results").select("seguidores", { count: "exact" }).eq("is_valid", true);

  const invalidQ = genreId
    ? sb.from("search_results").select("id", { count: "exact", head: true }).eq("genre_id", genreId).eq("is_valid", false)
    : sb.from("search_results").select("id", { count: "exact", head: true }).eq("is_valid", false);

  // ── playlist_templates (tiers + publicados) ────────────────────────
  const tplQ = genreId
    ? sb.from("playlist_templates").select("id, quality_tier, spotify_playlist_id").eq("genre_id", genreId)
    : sb.from("playlist_templates").select("id, quality_tier, spotify_playlist_id");

  const [
    logsRes, adjRes, flagsRes, termsRes, gfRes, accRes,
    allRes, validRes, invalidRes, tplRes,
  ] = await Promise.all([
    logsQ, adjQ, flagsQ, termsQ, gfQ, accQ,
    allQ, validQ, invalidQ, tplQ,
  ]);

  // ── Reduções server-side ───────────────────────────────────────────
  const validRows = (validRes.data ?? []) as Array<{ seguidores: number | null }>;
  const avgFollowersValid = validRows.length > 0
    ? validRows.reduce((acc, r) => acc + (r.seguidores ?? 0), 0) / validRows.length
    : null;

  const tplRows = (tplRes.data ?? []) as Array<{ quality_tier: string | null; spotify_playlist_id: string | null }>;
  const templateStats = {
    total:       tplRows.length,
    hot:         tplRows.filter(r => r.quality_tier === "hot").length,
    medium:      tplRows.filter(r => r.quality_tier === "medium").length,
    weak:        tplRows.filter(r => r.quality_tier === "weak").length,
    published:   tplRows.filter(r => !!r.spotify_playlist_id).length,
  };

  const accRows = (accRes.data ?? []) as Array<{ status: string; current_playlists: number; max_playlists: number }>;
  const accounts = {
    total:        accRows.length,
    active:       accRows.filter(a => a.status === "active").length,
    capacityUsed: accRows.reduce((s, a) => s + (a.current_playlists ?? 0), 0),
    capacityMax:  accRows.reduce((s, a) => s + (a.max_playlists ?? 0), 0),
  };

  return jr({
    logs:         logsRes.data ?? [],
    adjustments:  adjRes.data ?? [],
    systemFlags: {
      apify_blocked:        flagsRes.data?.apify_blocked ?? false,
      apify_blocked_reason: flagsRes.data?.apify_blocked_reason ?? null,
    },
    termsCount:   termsRes.count ?? 0,
    genreFilter:  gfRes.data ?? null,
    accounts,
    searchStats: {
      total:              allRes.count ?? 0,
      valid:              validRes.count ?? 0,
      invalid:            invalidRes.count ?? 0,
      avgFollowersValid,
    },
    templateStats,
    meta: { genre_id: genreId, since, until },
  });
});
