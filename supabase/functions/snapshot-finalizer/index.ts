// snapshot-finalizer — Promove um snapshot de 'processing' para 'ready' ou 'failed'.
//
// Pode ser chamado:
//   POST { snapshot_id }                  → finaliza um snapshot específico
//   POST { mode: "reap" }                 → varre snapshots travados e snapshots prontos para finalizar
//
// Validações obrigatórias (ajuste 5) antes de promover a 'ready':
//   - snapshot.status === 'processing'
//   - snapshot não foi superseded
//   - todas as etapas (sync, dna, diagnose, brain, score) existem
//   - todas com status='done'
//   - nenhuma com status='failed' ou 'timeout' que tenha esgotado retries
//   - todas gravaram result (jsonb não vazio)
//   - versões dna/genre_brain/market preenchidas
//   - tracks_hash do snapshot ainda bate com tracks_hash atual da playlist
//
// Após finalizar (ready ou failed), se houver pending_event_id, dispara um novo snapshot
// (ajuste 1 — sem debounce: o evento mais recente sempre gera nova análise).
//
// Esta versão é o esqueleto da Fase 1. O loop principal de invocação por etapa virá na Fase 2.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const REQUIRED_STEPS = ["sync", "dna", "diagnose", "brain", "score"] as const;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function logEvent(
  sb: ReturnType<typeof createClient>,
  snapshotId: string,
  playlistId: string,
  eventType: string,
  payload: Record<string, unknown> = {},
  step?: string,
) {
  await sb.from("analysis_snapshot_events").insert({
    snapshot_id: snapshotId,
    playlist_id: playlistId,
    event_type: eventType,
    step: step ?? null,
    payload,
  });
}

type StepRow = {
  step: string;
  status: string;
  retry_count: number;
  max_retry: number;
  result: Record<string, unknown> | null;
  duration_ms: number | null;
  error: string | null;
  timeout_seconds: number;
  started_at: string | null;
  finished_at: string | null;
};

async function finalizeOne(sb: ReturnType<typeof createClient>, snapshotId: string) {
  const { data: snap, error } = await sb
    .from("analysis_snapshots")
    .select("id, playlist_id, status, started_at, tracks_hash, dna_version, genre_brain_version, market_version, superseded_by, pending_event_id, trigger_payload")
    .eq("id", snapshotId)
    .maybeSingle();

  if (error) return { ok: false, reason: `lookup: ${error.message}` };
  if (!snap) return { ok: false, reason: "not_found" };
  if (snap.status !== "processing") return { ok: true, skipped: true, reason: `status_is_${snap.status}` };
  if (snap.superseded_by) return { ok: true, skipped: true, reason: "already_superseded" };

  const { data: steps } = await sb
    .from("analysis_snapshot_results")
    .select("step, status, retry_count, max_retry, result, duration_ms, error, timeout_seconds, started_at, finished_at")
    .eq("snapshot_id", snapshotId);

  const stepRows: StepRow[] = (steps as StepRow[]) ?? [];
  const byStep = new Map(stepRows.map((s) => [s.step, s]));

  // 1) Todas as etapas existem?
  const missing = REQUIRED_STEPS.filter((s) => !byStep.has(s));
  if (missing.length > 0) {
    return { ok: true, snapshot_id: snapshotId, decision: "wait", reason: `missing_steps:${missing.join(",")}` };
  }

  // 2) Alguma falhou em definitivo?
  const failed = stepRows.filter(
    (s) => (s.status === "failed" || s.status === "timeout") && s.retry_count >= s.max_retry,
  );
  if (failed.length > 0) {
    await sb.from("analysis_snapshots").update({
      status: "failed",
      failed_at: new Date().toISOString(),
      failure_reason: `steps_failed:${failed.map((f) => `${f.step}(${f.error ?? f.status})`).join("|")}`,
    }).eq("id", snapshotId);
    await logEvent(sb, snapshotId, snap.playlist_id, "snapshot_failed", { failed_steps: failed.map((f) => f.step) });
    await maybeTriggerPending(sb, snap);
    return { ok: true, snapshot_id: snapshotId, decision: "failed" };
  }

  // 3) Todas done?
  const notDone = stepRows.filter((s) => s.status !== "done");
  if (notDone.length > 0) {
    return { ok: true, snapshot_id: snapshotId, decision: "wait", reason: `pending_steps:${notDone.map((s) => s.step).join(",")}` };
  }

  // 4) Todas com result não-vazio?
  const empty = stepRows.filter((s) => !s.result || Object.keys(s.result).length === 0);
  if (empty.length > 0) {
    return { ok: true, snapshot_id: snapshotId, decision: "wait", reason: `empty_result:${empty.map((s) => s.step).join(",")}` };
  }

  // 5) Versões obrigatórias preenchidas?
  const missingVer: string[] = [];
  if (!snap.dna_version)        missingVer.push("dna_version");
  if (!snap.genre_brain_version) missingVer.push("genre_brain_version");
  if (!snap.market_version)     missingVer.push("market_version");
  if (missingVer.length > 0) {
    return { ok: true, snapshot_id: snapshotId, decision: "wait", reason: `missing_versions:${missingVer.join(",")}` };
  }

  // 6) tracks_hash ainda consistente?
  const { data: mp } = await sb
    .from("managed_playlists")
    .select("tracks_hash")
    .eq("id", snap.playlist_id)
    .maybeSingle();
  if (mp && snap.tracks_hash && (mp as any).tracks_hash && (mp as any).tracks_hash !== snap.tracks_hash) {
    // Snapshot ficou obsoleto durante o processamento → supersede
    await sb.from("analysis_snapshots").update({
      status: "superseded",
      failure_reason: "tracks_hash_changed_during_processing",
    }).eq("id", snapshotId);
    await logEvent(sb, snapshotId, snap.playlist_id, "snapshot_superseded", { reason: "tracks_hash_changed" });
    await maybeTriggerPending(sb, snap, /*forceTracksChanged*/ true);
    return { ok: true, snapshot_id: snapshotId, decision: "superseded" };
  }

  // 7) Métricas agregadas (ajuste 7)
  const metrics: Record<string, unknown> = {};
  let totalMs = 0;
  for (const s of stepRows) {
    const ms = s.duration_ms ?? 0;
    metrics[`${s.step}_ms`] = ms;
    totalMs += ms;
  }
  metrics.total_ms = totalMs;
  if (snap.started_at) {
    metrics.queue_wait_ms = Math.max(
      0,
      (stepRows.find((s) => s.step === "sync")?.started_at
        ? new Date(stepRows.find((s) => s.step === "sync")!.started_at!).getTime() -
          new Date(snap.started_at).getTime()
        : 0),
    );
  }

  await sb.from("analysis_snapshots").update({
    status: "ready",
    ready_at: new Date().toISOString(),
    metrics,
  }).eq("id", snapshotId);

  await logEvent(sb, snapshotId, snap.playlist_id, "snapshot_ready", { metrics });
  await maybeTriggerPending(sb, snap);
  return { ok: true, snapshot_id: snapshotId, decision: "ready", metrics };
}

// Ajuste 1: ao finalizar, se houver evento pendente, dispara novo snapshot imediatamente.
async function maybeTriggerPending(
  sb: ReturnType<typeof createClient>,
  snap: { id: string; playlist_id: string; pending_event_id: string | null; trigger_payload: Record<string, unknown> | null },
  forceTracksChanged = false,
) {
  if (!snap.pending_event_id && !forceTracksChanged) return;

  try {
    await fetch(`${SUPABASE_URL}/functions/v1/analysis-orchestrator`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        playlist_id: snap.playlist_id,
        trigger_event: forceTracksChanged ? "tracks_changed" : "auto_sync",
        payload: { from_pending: snap.pending_event_id, prev_snapshot: snap.id },
      }),
    });
  } catch (_e) {
    // Best-effort. O próximo cron de sync vai capturar.
  }
}

async function reap(sb: ReturnType<typeof createClient>) {
  // Snapshots 'processing' candidatos a finalização (avalia, decide e atualiza)
  const { data: candidates } = await sb
    .from("analysis_snapshots")
    .select("id")
    .eq("status", "processing")
    .order("started_at", { ascending: true })
    .limit(50);

  const results: unknown[] = [];
  for (const c of candidates ?? []) {
    results.push(await finalizeOne(sb, (c as any).id));
  }
  return results;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ ok: false, error: "method_not_allowed" }, 405);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: any = {};
  try { body = await req.json(); } catch { /* permite POST vazio para modo reap */ }

  if (body?.mode === "reap") {
    const out = await reap(sb);
    return jr({ ok: true, mode: "reap", processed: out.length, results: out });
  }

  const snapshotId: string | undefined = body?.snapshot_id;
  if (!snapshotId) return jr({ ok: false, error: "snapshot_id_required" }, 400);

  const out = await finalizeOne(sb, snapshotId);
  return jr(out);
});
