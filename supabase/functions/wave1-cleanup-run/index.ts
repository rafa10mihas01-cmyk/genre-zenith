// wave1-cleanup-run — Orquestrador da Onda 1
// 1. Enrich em massa retroativo de tudo pendente (chama enrich-playlists em ondas)
// 2. Dedupe (chama dedupe-search-results)
// 3. Reset benchmarks contaminados + recalc
// 4. Re-roda analyze-genre por gênero
// 5. Grava relatório por gênero em discovery_wave1_reports
//
// POST {}  → roda em todos os gêneros com playlists
// POST { genre_id: "..." } → roda só naquele gênero
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function callFn(name: string, body: any, authHeader: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": authHeader,
      "apikey": ANON_KEY,
    },
    body: JSON.stringify(body ?? {}),
  });
  const t = await r.text();
  try { return { ok: r.ok, json: JSON.parse(t) }; } catch { return { ok: r.ok, json: { raw: t } }; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  const authHeader = req.headers.get("Authorization") ?? `Bearer ${SERVICE_KEY}`;
  const body = await req.json().catch(() => ({}));
  const onlyGenreId: string | undefined = body?.genre_id;
  const skipEnrich = body?.skip_enrich === true;

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const runId = crypto.randomUUID();
  const startedAt = Date.now();

  const stages: any = { run_id: runId };

  // ============ STAGE 1: enrich pendentes em ondas (até 5 iterações × 200) ============
  if (!skipEnrich) {
    stages.enrich = [];
    for (let i = 0; i < 5; i++) {
      const r = await callFn("enrich-playlists", {
        ...(onlyGenreId ? { genre_id: onlyGenreId } : {}),
        limit: 200,
      }, authHeader);
      stages.enrich.push(r.json);
      const enriched = r.json?.enriched ?? 0;
      if (!enriched) break;
    }
  }

  // ============ STAGE 2: dedupe ============
  stages.dedupe = (await callFn("dedupe-search-results",
    onlyGenreId ? { genre_id: onlyGenreId } : {}, authHeader)).json;

  // ============ STAGE 3: reset benchmarks + recalc ============
  // Apaga benchmarks dos gêneros impactados
  if (onlyGenreId) {
    await supabase.from("genre_benchmarks").delete().eq("genre_id", onlyGenreId);
  } else {
    await supabase.from("genre_benchmarks").delete().not("genre_id", "is", null);
  }

  // Lista de gêneros a recomputar
  let genreList: string[] = [];
  if (onlyGenreId) {
    genreList = [onlyGenreId];
  } else {
    const { data } = await supabase
      .from("search_results")
      .select("genre_id")
      .not("genre_id", "is", null)
      .eq("is_valid", true)
      .not("enriched_at", "is", null)
      .is("duplicate_of", null)
      .limit(20000);
    genreList = Array.from(new Set((data ?? []).map((r: any) => r.genre_id))).filter(Boolean) as string[];
  }

  // ============ STAGE 4: analyze + benchmark + relatório por gênero ============
  stages.genres = [];
  for (const gid of genreList) {
    const [analyze, bench] = await Promise.all([
      callFn("analyze-genre", { genre_id: gid }, authHeader),
      callFn("genre-benchmarks-calc", { genre_id: gid }, authHeader),
    ]);

    // Telemetria por gênero (lendo direto do DB)
    const [{ count: discovered }, { count: invalid }, { count: duplicates }, { count: approved }] = await Promise.all([
      supabase.from("search_results").select("id", { count: "exact", head: true }).eq("genre_id", gid),
      supabase.from("search_results").select("id", { count: "exact", head: true }).eq("genre_id", gid).eq("is_valid", false).is("duplicate_of", null),
      supabase.from("search_results").select("id", { count: "exact", head: true }).eq("genre_id", gid).not("duplicate_of", "is", null),
      supabase.from("search_results").select("id", { count: "exact", head: true })
        .eq("genre_id", gid).eq("is_valid", true).not("enriched_at", "is", null)
        .is("duplicate_of", null).gte("quality_score", 40),
    ]);

    const { data: benchRow } = await supabase
      .from("genre_benchmarks").select("sample_size").eq("genre_id", gid).maybeSingle();

    // Top problemas: piores quality_scores
    const { data: trash } = await supabase
      .from("search_results")
      .select("nome_playlist,quality_score,seguidores,owner_id")
      .eq("genre_id", gid)
      .eq("is_valid", false)
      .order("seguidores", { ascending: false, nullsFirst: false })
      .limit(5);

    const report = {
      genre_id: gid,
      run_id: runId,
      discovered: discovered ?? 0,
      removed: 0,
      invalid: invalid ?? 0,
      duplicates: duplicates ?? 0,
      approved: approved ?? 0,
      benchmark_size: benchRow?.sample_size ?? 0,
      top_problems: trash ?? [],
    };
    await supabase.from("discovery_wave1_reports").insert(report);

    stages.genres.push({
      genre_id: gid,
      analyze_ok: analyze.json?.ok ?? analyze.ok,
      bench_ok: bench.json?.ok ?? bench.ok,
      ...report,
    });
  }

  const elapsedMs = Date.now() - startedAt;
  return jr({ ok: true, run_id: runId, elapsed_ms: elapsedMs, stages, genres_processed: genreList.length });
});
