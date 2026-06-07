// refresh-search-tracks — Cron 48h.
// Mantém janela rolante de 30 dias em `search_tracks` e força ingestão fresca
// por gênero ativo (chama run-search nos termos mais antigos).
//
// Pipeline por execução:
//   1. DELETE em search_tracks onde coletado_em < NOW() - 30d (retenção)
//   2. Para cada gênero ativo:
//        a. Seleciona até N termos (oldest ultima_execucao first; nunca-rodados primeiro)
//        b. Chama run-search com force=true (ignora cooldown)
//        c. Acumula contadores
//   3. Validação por gênero:
//        - inserted_rows, min/max coletado_em, unique_track_ids
//        - Alerta se inserted_rows < 100 OU max(coletado_em) > 72h
//   4. Loga sumário em collection_logs
//
// Não toca em scoring/ranking. Só ingestão.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const startedAt = Date.now();
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const termsPerGenre: number = Math.max(1, Math.min(Number(body.terms_per_genre ?? DEFAULT_TERMS_PER_GENRE), 15));
  const maxResults: number = Math.max(50, Math.min(Number(body.max_results ?? DEFAULT_MAX_RESULTS), 200));

  const summary = {
    ok: true,
    duration_ms: 0,
    retention_days: RETENTION_DAYS,
    deleted_old_rows: 0,
    genres_processed: 0,
    terms_run: 0,
    rows_inserted_total: 0,
    alerts: [] as Array<{ genre_id: string; nome: string; reason: string; detail: any }>,
    per_genre: [] as Array<{
      genre_id: string;
      nome: string;
      terms_run: number;
      rows_inserted: number;
      unique_track_ids: number;
      min_coletado_em: string | null;
      max_coletado_em: string | null;
      stale: boolean;
    }>,
  };

  try {
    // 1. Retenção: apaga rows > 30d
    const cutoffISO = new Date(Date.now() - RETENTION_DAYS * 86400_000).toISOString();
    const { count: deletedCount } = await sb
      .from("search_tracks")
      .delete({ count: "exact" })
      .lt("coletado_em", cutoffISO);
    summary.deleted_old_rows = deletedCount ?? 0;

    // 2. Gêneros ativos
    const { data: genres, error: gErr } = await sb
      .from("genres")
      .select("id, nome")
      .eq("ativo", true);
    if (gErr) throw gErr;

    for (const g of genres ?? []) {
      const beforeISO = new Date().toISOString();
      let termsRun = 0;

      // Termos: oldest ultima_execucao first; nunca-rodados primeiro
      const { data: terms } = await sb
        .from("search_terms")
        .select("id, termo")
        .eq("genre_id", g.id)
        .order("ultima_execucao", { ascending: true, nullsFirst: true })
        .order("total_resultados", { ascending: true, nullsFirst: true })
        .limit(termsPerGenre);

      for (let i = 0; i < (terms ?? []).length; i++) {
        const t = terms![i];
        const r = await callFn("run-search", {
          genre_id: g.id,
          term_id: t.id,
          search_term: t.termo,
          max_results: maxResults,
          force: true,
        });
        if (r.ok && r.data?.ok) termsRun++;
        if (i < terms!.length - 1) await new Promise((res) => setTimeout(res, DELAY_BETWEEN_TERMS_MS));
      }

      // 3. Validação: stats dos rows recém-inseridos (coletado_em >= beforeISO)
      //    Hard LIMIT 5000 por gênero por run (defensive read).
      const { data: fresh } = await sb
        .from("search_tracks")
        .select("spotify_track_id, coletado_em")
        .eq("genre_id", g.id)
        .gte("coletado_em", beforeISO)
        .order("coletado_em", { ascending: false })
        .limit(HARD_LIMIT_PER_GENRE);

      const rowsInserted = fresh?.length ?? 0;
      const unique = new Set((fresh ?? []).map((r: any) => r.spotify_track_id).filter(Boolean));
      let minC: string | null = null;
      let maxC: string | null = null;
      for (const r of fresh ?? []) {
        if (!minC || r.coletado_em < minC) minC = r.coletado_em;
        if (!maxC || r.coletado_em > maxC) maxC = r.coletado_em;
      }
      const ageHours = maxC ? (Date.now() - new Date(maxC).getTime()) / 3_600_000 : Infinity;
      const stale = ageHours > STALE_THRESHOLD_HOURS;

      summary.terms_run += termsRun;
      summary.rows_inserted_total += rowsInserted;
      summary.genres_processed++;
      summary.per_genre.push({
        genre_id: g.id,
        nome: g.nome,
        terms_run: termsRun,
        rows_inserted: rowsInserted,
        unique_track_ids: unique.size,
        min_coletado_em: minC,
        max_coletado_em: maxC,
        stale,
      });

      if (rowsInserted < MIN_INSERTED_ROWS) {
        summary.alerts.push({
          genre_id: g.id, nome: g.nome,
          reason: "low_ingest",
          detail: { rows_inserted: rowsInserted, threshold: MIN_INSERTED_ROWS },
        });
      }
      if (stale) {
        summary.alerts.push({
          genre_id: g.id, nome: g.nome,
          reason: "stale_data",
          detail: { max_coletado_em: maxC, age_hours: Math.round(ageHours) },
        });
      }
    }

    summary.duration_ms = Date.now() - startedAt;

    await sb.from("collection_logs").insert({
      acao: "refresh-search-tracks",
      status: summary.alerts.length > 0 ? "alerta" : "sucesso",
      mensagem: `cron 48h: ${summary.genres_processed} gêneros, ${summary.terms_run} termos, +${summary.rows_inserted_total} rows, -${summary.deleted_old_rows} antigas, ${summary.alerts.length} alertas`,
      duracao_ms: summary.duration_ms,
    });

    // Status:
    //  - error   → nada foi inserido apesar de haver gêneros pra processar
    //  - partial → inseriu algo mas com alertas
    //  - ok      → sem alertas
    const refreshStatus: "ok" | "partial" | "error" =
      summary.genres_processed > 0 && summary.rows_inserted_total === 0
        ? "error"
        : summary.alerts.length > 0
          ? "partial"
          : "ok";

    await reportCronHealth(sb, {
      job_name: "refresh-search-tracks",
      status: refreshStatus,
      startedAt,
      metrics: {
        genres: summary.genres_processed,
        terms_run: summary.terms_run,
        rows_inserted: summary.rows_inserted_total,
        deleted_old: summary.deleted_old_rows,
        alerts: summary.alerts.length,
      },
    });

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = (e as Error).message;
    await sb.from("collection_logs").insert({
      acao: "refresh-search-tracks",
      status: "erro",
      mensagem: `cron falhou: ${msg}`.slice(0, 500),
      duracao_ms: Date.now() - startedAt,
    });
    await reportCronHealth(sb, {
      job_name: "refresh-search-tracks",
      status: "error",
      startedAt,
      message: msg,
    });
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
