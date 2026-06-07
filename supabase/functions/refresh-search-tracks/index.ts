// refresh-search-tracks
// Modos:
//   A. SINGLE-GENRE (preferido / cron normal):
//      body: { genre_id?: uuid, genre_slug?: string, terms_per_genre?, max_results? }
//      → Processa UM gênero, reporta health como `refresh-search-tracks:<slug>`.
//      → Tempo típico: ~10s (6 termos × ~1.5s delay + chamadas Spotify).
//
//   B. FAN-OUT (compat / disparo manual sem args):
//      body: {} ou ?fanout=1
//      → Dispara N chamadas fire-and-forget (uma por gênero ativo) pra si mesmo
//        e retorna imediatamente. Cada child cai no modo A.
//      → Use o cron SQL com pg_net pra fan-out em produção (mais robusto).
//
// Pipeline single-genre:
//   1. (apenas no 1º gênero do dia) DELETE search_tracks WHERE coletado_em < NOW()-30d
//      → controlado por flag `prune` no body; default = false.
//   2. Seleciona até N termos (oldest ultima_execucao first; nunca-rodados primeiro)
//   3. Chama run-search com force=true
//   4. Valida: inserted_rows, min/max coletado_em, unique_track_ids
//   5. reportCronHealth por gênero — sempre, mesmo em erro.
//
// Não toca scoring/ranking. Só ingestão.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { reportCronHealth } from "../_shared/cron-health.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const RETENTION_DAYS = 30;
const STALE_THRESHOLD_HOURS = 72;
const MIN_INSERTED_ROWS = 100;
const HARD_LIMIT_PER_GENRE = 5000;
const DEFAULT_TERMS_PER_GENRE = 6;
const DEFAULT_MAX_RESULTS = 100;
const DELAY_BETWEEN_TERMS_MS = 1500;

async function callFn(name: string, body: unknown) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* noop */ }
  return { ok: r.ok, data };
}

/** Processa UM gênero. Sempre reporta health (ok|partial|error), mesmo se quebrar no meio. */
async function processGenre(
  sb: ReturnType<typeof createClient>,
  g: { id: string; nome: string; slug: string },
  opts: { termsPerGenre: number; maxResults: number; prune: boolean },
) {
  const startedAt = Date.now();
  const jobName = `refresh-search-tracks:${g.slug ?? g.id}`;
  let deletedOld = 0;
  let termsRun = 0;
  let rowsInserted = 0;
  let uniqueTracks = 0;
  let minC: string | null = null;
  let maxC: string | null = null;
  let stale = false;
  const alerts: Array<{ reason: string; detail: any }> = [];

  // Log início (independente do desfecho)
  await sb.from("collection_logs").insert({
    acao: jobName,
    status: "iniciado",
    mensagem: `start: terms=${opts.termsPerGenre} max=${opts.maxResults} prune=${opts.prune}`,
  });

  try {
    // Retenção (opcional — só rode na 1ª janela do dia pra não duplicar)
    if (opts.prune) {
      const cutoffISO = new Date(Date.now() - RETENTION_DAYS * 86400_000).toISOString();
      const { count } = await sb
        .from("search_tracks")
        .delete({ count: "exact" })
        .lt("coletado_em", cutoffISO);
      deletedOld = count ?? 0;
    }

    const beforeISO = new Date().toISOString();

    const { data: terms, error: tErr } = await sb
      .from("search_terms")
      .select("id, termo")
      .eq("genre_id", g.id)
      .order("ultima_execucao", { ascending: true, nullsFirst: true })
      .order("total_resultados", { ascending: true, nullsFirst: true })
      .limit(opts.termsPerGenre);
    if (tErr) throw tErr;

    for (let i = 0; i < (terms ?? []).length; i++) {
      const t = terms![i];
      try {
        const r = await callFn("run-search", {
          genre_id: g.id,
          term_id: t.id,
          search_term: t.termo,
          max_results: opts.maxResults,
          force: true,
        });
        if (r.ok && r.data?.ok) termsRun++;
      } catch (termErr) {
        // não interrompe o gênero por causa de um termo
        console.warn(`[${jobName}] term ${t.id} falhou: ${(termErr as Error).message}`);
      }
      if (i < terms!.length - 1) await new Promise((res) => setTimeout(res, DELAY_BETWEEN_TERMS_MS));
    }

    const { data: fresh } = await sb
      .from("search_tracks")
      .select("spotify_track_id, coletado_em")
      .eq("genre_id", g.id)
      .gte("coletado_em", beforeISO)
      .order("coletado_em", { ascending: false })
      .limit(HARD_LIMIT_PER_GENRE);

    rowsInserted = fresh?.length ?? 0;
    const uniqueSet = new Set((fresh ?? []).map((r: any) => r.spotify_track_id).filter(Boolean));
    uniqueTracks = uniqueSet.size;
    for (const r of fresh ?? []) {
      if (!minC || r.coletado_em < minC) minC = r.coletado_em;
      if (!maxC || r.coletado_em > maxC) maxC = r.coletado_em;
    }
    const ageHours = maxC ? (Date.now() - new Date(maxC).getTime()) / 3_600_000 : Infinity;
    stale = ageHours > STALE_THRESHOLD_HOURS;

    if (rowsInserted < MIN_INSERTED_ROWS) {
      alerts.push({ reason: "low_ingest", detail: { rows_inserted: rowsInserted, threshold: MIN_INSERTED_ROWS } });
    }
    if (stale) {
      alerts.push({ reason: "stale_data", detail: { max_coletado_em: maxC, age_hours: Math.round(ageHours) } });
    }

    const duration = Date.now() - startedAt;
    // Status: error se zerou ingestão; partial se rodou termos mas tem alertas; ok caso contrário.
    const status: "ok" | "partial" | "error" =
      termsRun > 0 && rowsInserted === 0
        ? "error"
        : alerts.length > 0
          ? "partial"
          : "ok";

    await sb.from("collection_logs").insert({
      acao: jobName,
      status: status === "error" ? "erro" : status === "partial" ? "alerta" : "sucesso",
      mensagem: `end: terms_run=${termsRun} rows=${rowsInserted} unique=${uniqueTracks} stale=${stale} deleted_old=${deletedOld}`,
      duracao_ms: duration,
    });

    await reportCronHealth(sb, {
      job_name: jobName,
      status,
      startedAt,
      metrics: {
        terms_run: termsRun,
        rows_inserted: rowsInserted,
        unique_tracks: uniqueTracks,
        deleted_old: deletedOld,
        alerts: alerts.length,
        stale,
      },
      message: alerts.length
        ? alerts.map((a) => `${a.reason}:${JSON.stringify(a.detail)}`).join(" · ").slice(0, 400)
        : `terms_run=${termsRun} rows=${rowsInserted}`,
    });

    return {
      ok: true, genre_id: g.id, slug: g.slug, status,
      duration_ms: duration, terms_run: termsRun, rows_inserted: rowsInserted,
      unique_tracks: uniqueTracks, min_coletado_em: minC, max_coletado_em: maxC,
      stale, deleted_old: deletedOld, alerts,
    };
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    const duration = Date.now() - startedAt;

    await sb.from("collection_logs").insert({
      acao: jobName,
      status: "erro",
      mensagem: `crash: ${msg}`.slice(0, 500),
      duracao_ms: duration,
    });

    await reportCronHealth(sb, {
      job_name: jobName,
      status: "error",
      startedAt,
      metrics: { terms_run: termsRun, rows_inserted: rowsInserted },
      message: msg.slice(0, 400),
    });

    return {
      ok: false, genre_id: g.id, slug: g.slug, status: "error" as const,
      error: msg, duration_ms: duration, terms_run: termsRun, rows_inserted: rowsInserted,
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const url = new URL(req.url);
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const termsPerGenre = Math.max(1, Math.min(Number(body.terms_per_genre ?? DEFAULT_TERMS_PER_GENRE), 15));
  const maxResults = Math.max(50, Math.min(Number(body.max_results ?? DEFAULT_MAX_RESULTS), 200));
  const prune: boolean = body.prune === true;

  const genreId: string | null = body.genre_id ?? null;
  const genreSlug: string | null = body.genre_slug ?? null;
  const fanout: boolean = body.fanout === true || url.searchParams.get("fanout") === "1";

  try {
    // ─── MODO A: single genre ───────────────────────────────────────────────
    if (genreId || genreSlug) {
      const q = sb.from("genres").select("id, nome, slug").eq("ativo", true).limit(1);
      const { data: g, error } = genreId
        ? await q.eq("id", genreId).maybeSingle()
        : await q.eq("slug", genreSlug!).maybeSingle();
      if (error) throw error;
      if (!g) {
        return new Response(JSON.stringify({ ok: false, error: "genre_not_found_or_inactive" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const result = await processGenre(sb, g as any, { termsPerGenre, maxResults, prune });
      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── MODO B: fan-out (sem genre_id) ─────────────────────────────────────
    // Dispara N chamadas fire-and-forget pra si mesmo, retorna imediatamente.
    const { data: genres, error: gErr } = await sb
      .from("genres").select("id, nome, slug").eq("ativo", true).order("nome");
    if (gErr) throw gErr;

    const dispatched: string[] = [];
    for (let i = 0; i < (genres ?? []).length; i++) {
      const g = genres![i];
      // fire-and-forget — não await
      fetch(`${SUPABASE_URL}/functions/v1/refresh-search-tracks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({
          genre_id: g.id,
          terms_per_genre: termsPerGenre,
          max_results: maxResults,
          // só o 1º limpa registros antigos pra evitar contenção
          prune: prune && i === 0,
        }),
      }).catch((e) => console.warn(`[fanout] ${g.slug} dispatch failed: ${e.message}`));
      dispatched.push(g.slug);
    }

    return new Response(JSON.stringify({
      ok: true, mode: "fanout", dispatched_count: dispatched.length, dispatched,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
