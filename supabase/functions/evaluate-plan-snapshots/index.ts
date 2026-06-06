// evaluate-plan-snapshots — Fase 8.4
// Avalia snapshots de execução do plano (status='pending', executed_at <= now()-7d),
// medindo o que realmente aconteceu na playlist e comparando com a projeção do
// PlanImpactCard salva na Fase 8.3. NÃO altera Brain, Diagnose, Spotify ou recomendações.
//
// Body (opcional): { limit?: number (default 50, max 100), playlist_id?: string (modo teste) }
// Headers: Authorization: Bearer <service_role> OU x-cron-secret OU usuário do time.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Snap = any;

// ───────────────────────────────────────────────────────────────────────────
// Fórmula de accuracy (aprovada na auditoria 8.2)
// ───────────────────────────────────────────────────────────────────────────
const SMALL_PROJECTION = 0.5; // valores absolutos abaixo disso → null (sem sinal pra avaliar)

function accuracyOf(projected: number | null, measured: number | null): number | null {
  if (projected == null || measured == null) return null;
  if (!Number.isFinite(projected) || !Number.isFinite(measured)) return null;
  const ap = Math.abs(projected);
  const am = Math.abs(measured);
  if (ap < SMALL_PROJECTION) return null;
  // Direção errada (só conta como erro se o realizado também é material)
  if (am >= SMALL_PROJECTION && Math.sign(projected) !== Math.sign(measured)) return 0;
  const denom = Math.max(ap, am);
  if (denom === 0) return 100;
  const err = Math.abs(measured - projected) / denom;
  const acc = 100 * (1 - Math.min(err, 1));
  return Math.round(acc);
}

function gradeOf(overall: number | null): string | null {
  if (overall == null || !Number.isFinite(overall)) return null;
  if (overall >= 90) return "Excelente";
  if (overall >= 75) return "Bom";
  if (overall >= 60) return "Regular";
  return "Ruim";
}

function confidenceWeight(level: string | null): number {
  switch ((level ?? "").toLowerCase()) {
    case "alta": return 1.0;
    case "média":
    case "media": return 0.7;
    case "baixa": return 0.4;
    default: return 0.7;
  }
}

const num = (v: any) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// ───────────────────────────────────────────────────────────────────────────
// Reuso de diagnose: se houver diagnose < 24h, não roda outro
// ───────────────────────────────────────────────────────────────────────────
async function ensureFreshDiagnose(supabase: any, managedId: string): Promise<{ reused: boolean; error?: string }> {
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: recent } = await supabase
    .from("playlist_diagnoses")
    .select("id, created_at")
    .eq("playlist_id", managedId)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recent) return { reused: true };

  // Roda diagnose batch (sem AI — só refresca estado Spotify)
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/diagnose-managed-playlist`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
      },
      body: JSON.stringify({ playlist_id: managedId, source: "cron", skip_ai: true }),
    });
    const txt = await r.text();
    if (!r.ok) return { reused: false, error: `diagnose ${r.status}: ${txt.slice(0, 200)}` };
    // Após diagnose, recalcula brain pra refletir o novo snapshot
    await fetch(`${SUPABASE_URL}/functions/v1/playlist-brain-calc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
      },
      body: JSON.stringify({ playlist_id: managedId }),
    }).catch(() => { /* best-effort */ });
    return { reused: false };
  } catch (e) {
    return { reused: false, error: (e as Error).message };
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Avalia um snapshot
// ───────────────────────────────────────────────────────────────────────────
async function evaluateOne(supabase: any, snap: Snap): Promise<{ ok: boolean; reused?: boolean; error?: string }> {
  // 1) managed playlist + canonical id
  const { data: pl, error: plErr } = await supabase
    .from("managed_playlists")
    .select("id, canonical_playlist_id, tracks_count")
    .eq("id", snap.playlist_id)
    .maybeSingle();
  if (plErr || !pl) {
    return await markFailed(supabase, snap.id, `managed_playlist ausente: ${plErr?.message ?? "not found"}`);
  }

  // 2) garante diagnose fresco (reuso de 24h)
  const diag = await ensureFreshDiagnose(supabase, snap.playlist_id);
  if (diag.error) {
    return await markFailed(supabase, snap.id, diag.error);
  }

  // 3) lê brain atual (mesma fonte usada como baseline)
  let brain: any = null;
  if (pl.canonical_playlist_id) {
    const { data: b } = await supabase
      .from("playlist_brain")
      .select("benchmark_tracks, ratio_to_benchmark, headroom_pct, confidence_score, last_calculated_at")
      .eq("playlist_id", pl.canonical_playlist_id)
      .maybeSingle();
    brain = b ?? null;
  }

  // 4) métricas medidas (current - baseline)
  const currentSize = num(pl.tracks_count);
  const measured_size_delta = currentSize != null && snap.baseline_size != null
    ? currentSize - Number(snap.baseline_size)
    : null;

  const currentHeadroom = num(brain?.headroom_pct);
  const measured_headroom_delta_pp = currentHeadroom != null && snap.baseline_headroom_pct != null
    ? currentHeadroom - Number(snap.baseline_headroom_pct)
    : null;

  const currentRatio = num(brain?.ratio_to_benchmark);
  const baselineRatio = num(snap.baseline_ratio_to_benchmark);
  const measured_coverage_delta_pp = currentRatio != null && baselineRatio != null
    ? (currentRatio - baselineRatio) * 100
    : null;

  // benchmark count derivado de ratio × target (proxy aprovado na auditoria)
  const currentBenchTarget = num(brain?.benchmark_tracks);
  const baselineBenchTarget = num(snap.baseline_benchmark_tracks);
  const currentBenchCount = currentRatio != null && currentBenchTarget != null
    ? Math.round(currentRatio * currentBenchTarget) : null;
  const baselineBenchCount = baselineRatio != null && baselineBenchTarget != null
    ? Math.round(baselineRatio * baselineBenchTarget) : null;
  const measured_benchmark_delta = currentBenchCount != null && baselineBenchCount != null
    ? currentBenchCount - baselineBenchCount
    : null;

  // Métricas SEM medição direta disponível (baseline foi proxy de nicho ou não foi capturado):
  //  - artistas dominantes: baseline_dominant_artists não é persistido (sempre null)
  //  - saturação: baseline_saturation_avg é média do NICHO, não da playlist
  //  - concentração: não temos contagem prévia por artista
  // Esses ficam null em measured_* e não pontuam em accuracy.
  const measured_artist_delta = null;
  const measured_saturation_delta_pp = null;
  const measured_concentration_delta_pp = null;

  // 5) accuracy por métrica
  const accuracy_by_metric: Record<string, number | null> = {
    benchmark:    accuracyOf(num(snap.projected_benchmark_delta), measured_benchmark_delta),
    artist:       accuracyOf(num(snap.projected_artist_delta), measured_artist_delta),
    coverage:     accuracyOf(num(snap.projected_coverage_delta_pp), measured_coverage_delta_pp),
    saturation:   accuracyOf(num(snap.projected_saturation_delta_pp), measured_saturation_delta_pp),
    concentration: accuracyOf(num(snap.projected_concentration_delta_pp), measured_concentration_delta_pp),
    size:         accuracyOf(num(snap.projected_size_delta), measured_size_delta),
    headroom:     accuracyOf(num(snap.projected_headroom_delta_pp), measured_headroom_delta_pp),
  };

  // 6) accuracy_overall — média simples das métricas avaliáveis (não-nulas).
  //    Multiplicada pelo peso da confiança projetada (Alta=1.0, Média=0.7, Baixa=0.4) pra
  //    refletir que projeções de baixa confiança contribuem menos pro score final.
  const valid = Object.values(accuracy_by_metric).filter((v): v is number => v != null);
  let accuracy_overall: number | null = null;
  if (valid.length > 0) {
    const avg = valid.reduce((a, b) => a + b, 0) / valid.length;
    const w = confidenceWeight(snap.projected_confidence);
    accuracy_overall = Math.round(avg * w);
  }
  const accuracy_grade = gradeOf(accuracy_overall);

  // 7) persiste
  const { error: upErr } = await supabase
    .from("plan_execution_snapshots")
    .update({
      status: "evaluated",
      evaluated_at: new Date().toISOString(),
      measured_benchmark_delta,
      measured_artist_delta,
      measured_coverage_delta_pp,
      measured_saturation_delta_pp,
      measured_concentration_delta_pp,
      measured_size_delta,
      measured_headroom_delta_pp,
      accuracy_by_metric,
      accuracy_overall,
      accuracy_grade,
      evaluation_notes: valid.length === 0
        ? "Nenhuma métrica com projeção material suficiente para avaliar"
        : `Avaliado com ${valid.length} métrica(s) — confiança ${snap.projected_confidence ?? "n/d"}`,
    })
    .eq("id", snap.id)
    .eq("status", "pending"); // não sobrescreve se virou superseded entre busca e update

  if (upErr) return { ok: false, reused: diag.reused, error: upErr.message };
  return { ok: true, reused: diag.reused };
}

async function markFailed(supabase: any, snapId: string, reason: string): Promise<{ ok: false; error: string }> {
  await supabase
    .from("plan_execution_snapshots")
    .update({
      status: "evaluated",
      evaluated_at: new Date().toISOString(),
      evaluation_notes: `Falha na avaliação: ${reason}`,
    })
    .eq("id", snapId)
    .eq("status", "pending");
  return { ok: false, error: reason };
}

// ───────────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  let body: any = {};
  try { body = req.method === "POST" ? await req.json() : {}; } catch { /* */ }
  const limit = Math.max(1, Math.min(Number(body?.limit ?? 50), 100));
  const targetPlaylistId: string | null = body?.playlist_id ?? null;

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Busca snapshots elegíveis
  const cutoff = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
  let q = supabase
    .from("plan_execution_snapshots")
    .select("*")
    .eq("status", "pending")
    .lte("executed_at", cutoff)
    .order("executed_at", { ascending: true })
    .limit(limit);
  if (targetPlaylistId) q = q.eq("playlist_id", targetPlaylistId);

  const { data: snaps, error } = await q;
  if (error) return jr({ ok: false, error: error.message }, 500);

  const results: any[] = [];
  let evaluated = 0, failed = 0, reused = 0;
  for (const snap of (snaps ?? [])) {
    try {
      const r = await evaluateOne(supabase, snap);
      if (r.ok) evaluated++; else failed++;
      if (r.reused) reused++;
      results.push({ id: snap.id, playlist_id: snap.playlist_id, ...r });
    } catch (e) {
      failed++;
      results.push({ id: snap.id, ok: false, error: (e as Error).message });
    }
  }

  await supabase.from("collection_logs").insert({
    acao: "evaluate-plan-snapshots",
    status: failed === 0 ? "sucesso" : "parcial",
    mensagem: `eval=${evaluated} fail=${failed} reused_diag=${reused} total=${snaps?.length ?? 0}`,
  });

  return jr({ ok: true, total: snaps?.length ?? 0, evaluated, failed, diagnose_reused: reused, results });
});
