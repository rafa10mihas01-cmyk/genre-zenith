// learning-loop — orquestrador do ciclo COMPLETO de aprendizado.
//
// Executa em sequência:
//   1) track-playlist-metrics    → coleta seguidores atualizados das playlists publicadas
//   2) analyze-performance       → Claude classifica alta/média/baixa + insights
//      └─ (auto-dispara extract-replication-rules dentro dele)
//   3) auto-replicate-playlists  → escala vencedores → gera blueprints novos
//   4) auto-adjust-playlists     → corrige playlists baixa performance
//
// Salva tudo em learning_loop_runs com snapshot de cada etapa.
//
// POST { skip?: string[], dry_run?: boolean } → { ok, run_id, status, steps }
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type StepResult = {
  ok: boolean;
  status: number;
  duration_ms: number;
  data?: any;
  error?: string;
  skipped?: boolean;
};

async function callFn(name: string, body: unknown, timeoutMs = 120_000): Promise<StepResult> {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify(body ?? {}),
      signal: ctrl.signal,
    });
    clearTimeout(to);
    const txt = await r.text();
    let data: any = null;
    try { data = JSON.parse(txt); } catch { data = { raw: txt.slice(0, 500) }; }
    return { ok: r.ok, status: r.status, duration_ms: Date.now() - t0, data, error: r.ok ? undefined : (data?.error ?? `HTTP ${r.status}`) };
  } catch (e) {
    clearTimeout(to);
    return { ok: false, status: 0, duration_ms: Date.now() - t0, error: (e as Error).message };
  }
}

function summarizeStep(name: string, r: StepResult): string {
  if (r.skipped) return `${name}: SKIPPED`;
  if (!r.ok) return `${name}: ❌ ${r.error}`;
  const d = r.data ?? {};
  switch (name) {
    case "track-playlist-metrics":
      return `${name}: ✅ ${d.collected ?? d.processed ?? 0} snapshots`;
    case "analyze-performance": {
      if (d.empty) return `${name}: ⚪ sem dados (${d.message ?? ""})`;
      const ana = d.analisadas ?? 0;
      const rules = d.rules?.inserted ?? 0;
      return `${name}: ✅ ${ana} playlists analisadas, ${rules} regras geradas`;
    }
    case "auto-replicate-playlists":
      return `${name}: ✅ ${d.processed ?? 0} gêneros processados, ${d.skipped ?? 0} skip`;
    case "auto-adjust-playlists":
      return `${name}: ✅ ${d.processed ?? 0} playlists ajustadas`;
    default: return `${name}: ok`;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (req.method !== "OPTIONS") {
    const guard = await requireTeamAccess(req);
    if (!guard.ok) return guard.resp;
  }
  let body: { skip?: string[]; dry_run?: boolean; triggered_by?: string } = {};
  try { if (req.method === "POST") body = await req.json(); } catch {}
  const skip = new Set(body.skip ?? []);
  const dryRun = body.dry_run ?? false;
  const triggeredBy = body.triggered_by ?? "manual";

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const t0 = Date.now();

  // 1) Cria registro de run
  const { data: run, error: runErr } = await supabase
    .from("learning_loop_runs")
    .insert({ triggered_by: triggeredBy, status: "running", steps: {} })
    .select("id").single();
  if (runErr || !run) return jr({ ok: false, error: runErr?.message ?? "run not created" }, 500);
  const runId = run.id;

  const steps: Record<string, StepResult> = {};
  const skipResult = (n: string) => ({ ok: true, status: 0, duration_ms: 0, skipped: true } as StepResult);

  // ─────── STEP 1: TRACK METRICS ───────
  steps["track-playlist-metrics"] = skip.has("track") || dryRun
    ? skipResult("track-playlist-metrics")
    : await callFn("track-playlist-metrics", { limit: 200 });

  // Persiste após cada step (resiliente a timeouts)
  await supabase.from("learning_loop_runs")
    .update({ steps }).eq("id", runId);

  // ─────── STEP 2: ANALYZE PERFORMANCE (já dispara extract-replication-rules) ───────
  steps["analyze-performance"] = skip.has("analyze") || dryRun
    ? skipResult("analyze-performance")
    : await callFn("analyze-performance", { min_age_hours: 24 }, 180_000);

  // 🚨 Audit #11: marcar como skipped quando analyze retorna empty (sem dados),
  // para que NÃO conte como sucesso falso no status final.
  {
    const ap = steps["analyze-performance"];
    if (ap.ok && ap.data?.empty === true) {
      ap.skipped = true;
    }
  }

  await supabase.from("learning_loop_runs").update({ steps }).eq("id", runId);

  // ─────── STEP 3: AUTO-REPLICATE (escala vencedores) ───────
  // Só vale rodar se houve análise; se analyze foi vazio, ainda assim tenta (pode haver alta de runs anteriores)
  steps["auto-replicate-playlists"] = skip.has("replicate") || dryRun
    ? skipResult("auto-replicate-playlists")
    : await callFn("auto-replicate-playlists", {}, 180_000);

  await supabase.from("learning_loop_runs").update({ steps }).eq("id", runId);

  // ─────── STEP 4: AUTO-ADJUST (corrige perdedoras) ───────
  steps["auto-adjust-playlists"] = skip.has("adjust") || dryRun
    ? skipResult("auto-adjust-playlists")
    : await callFn("auto-adjust-playlists", { limit: 5 }, 180_000);

  // ─────── STATUS FINAL ───────
  const ranSteps = Object.entries(steps).filter(([_, r]) => !r.skipped);
  const failed = ranSteps.filter(([_, r]) => !r.ok);
  let status: "success" | "partial" | "failed";
  if (failed.length === 0) status = "success";
  else if (failed.length === ranSteps.length) status = "failed";
  else status = "partial";

  const summary = Object.entries(steps).map(([n, r]) => summarizeStep(n, r)).join(" | ");
  const duracaoMs = Date.now() - t0;

  await supabase.from("learning_loop_runs").update({
    status,
    steps,
    summary,
    duracao_ms: duracaoMs,
    finished_at: new Date().toISOString(),
  }).eq("id", runId);

  await supabase.from("collection_logs").insert({
    acao: "learning-loop",
    status: status === "success" ? "sucesso" : status === "partial" ? "parcial" : "erro",
    mensagem: summary.slice(0, 500),
    duracao_ms: duracaoMs,
  }).then(() => {}, () => {});

  return jr({
    ok: status !== "failed",
    run_id: runId,
    status,
    duration_ms: duracaoMs,
    summary,
    steps,
  });
});
