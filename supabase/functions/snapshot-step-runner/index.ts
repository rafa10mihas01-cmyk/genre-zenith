// snapshot-step-runner — Fase 2 do Analysis Snapshot pipeline.
//
// Responsabilidade: executar UMA etapa de um snapshot, invocando o motor existente
// (sync-managed-playlist-tracks, compute-playlist-dna, diagnose-managed-playlist,
//  playlist-brain-calc, calculate-playlist-ecosystem-score) e gravando o resultado
// em analysis_snapshot_results. Em sucesso, encadeia a próxima etapa; após a última,
// chama snapshot-finalizer.
//
// Contrato:
//   POST { snapshot_id: uuid, step: "sync"|"dna"|"diagnose"|"brain"|"score" }
//
// Comportamento:
//   - Lock otimista: só executa se step.status in ('pending','failed','timeout') e snapshot 'processing'.
//   - Marca status='running', started_at=now() antes de chamar o motor.
//   - Aplica timeout individual via AbortController (timeout_seconds da linha).
//   - Em sucesso: status='done', duration_ms, result; dispara próxima etapa (fire-and-forget).
//   - Em falha/timeout: incrementa retry_count; se < max_retry, re-invoca self (delay curto);
//     senão marca status='failed'|'timeout' e chama snapshot-finalizer.
//
// Não conhece a lógica de negócio dos motores — apenas captura o JSON de resposta como result.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type StepName = "sync" | "dna" | "diagnose" | "brain" | "score";
const STEP_ORDER: StepName[] = ["sync", "dna", "diagnose", "brain", "score"];

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function logEvent(
  sb: any,
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

// Constrói corpo HTTP por etapa. Cada motor existente já valida internamente.
function buildEngineRequest(
  step: StepName,
  playlistRow: { id: string; spotify_playlist_id: string | null },
): { fn: string; body: Record<string, unknown> } {
  switch (step) {
    case "sync":
      return { fn: "sync-managed-playlist-tracks", body: { playlist_id: playlistRow.id } };
    case "dna":
      return { fn: "compute-playlist-dna", body: { playlist_ids: [playlistRow.id] } };
    case "diagnose":
      return { fn: "diagnose-managed-playlist", body: { playlist_id: playlistRow.id, source: "snapshot" } };
    case "brain":
      return { fn: "playlist-brain-calc", body: { playlist_id: playlistRow.id } };
    case "score":
      return {
        fn: "calculate-playlist-ecosystem-score",
        body: { mode: "single", spotify_playlist_id: playlistRow.spotify_playlist_id },
      };
  }
}

async function callEngine(
  fn: string,
  body: Record<string, unknown>,
  timeoutMs: number,
  step: StepName,
  snapshotId: string,
): Promise<{ ok: boolean; status: number; result: any; error?: string }> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
        "Content-Type": "application/json",
        // Fase 6: marca chamada como originada do pipeline Snapshot Único.
        // Motores legados usam essa flag para distinguir chamadas legítimas de chamadas diretas (deprecated).
        "x-snapshot-step": step,
        "x-snapshot-id": snapshotId,
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const txt = await resp.text();
    let parsed: any = null;
    try { parsed = JSON.parse(txt); } catch { parsed = { raw: txt.slice(0, 500) }; }
    const okBody = parsed?.ok !== false;
    return {
      ok: resp.ok && okBody,
      status: resp.status,
      result: parsed,
      error: resp.ok && okBody ? undefined : (parsed?.error ?? `http_${resp.status}`),
    };
  } catch (e) {
    const isTimeout = (e as Error).name === "AbortError";
    return {
      ok: false,
      status: 0,
      result: null,
      error: isTimeout ? "timeout" : `network: ${(e as Error).message}`,
    };
  } finally {
    clearTimeout(t);
  }
}

function fireAndForget(url: string, body: Record<string, unknown>) {
  // Não awaita — usado pra encadear próxima etapa sem segurar a request atual.
  // @ts-ignore EdgeRuntime API disponível no runtime Supabase Edge.
  const promise = fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }).catch(() => { /* best-effort */ });
  try {
    // @ts-ignore
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(promise);
    }
  } catch { /* */ }
}

function nextStep(step: StepName): StepName | null {
  const i = STEP_ORDER.indexOf(step);
  if (i < 0 || i === STEP_ORDER.length - 1) return null;
  return STEP_ORDER[i + 1];
}

function isValidStep(s: unknown): s is StepName {
  return typeof s === "string" && (STEP_ORDER as string[]).includes(s);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")    return jr({ ok: false, error: "method_not_allowed" }, 405);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: any;
  try { body = await req.json(); } catch { return jr({ ok: false, error: "invalid_json" }, 400); }

  const snapshotId: string | undefined = body?.snapshot_id;
  const step: unknown = body?.step;
  if (!snapshotId) return jr({ ok: false, error: "snapshot_id_required" }, 400);
  if (!isValidStep(step)) return jr({ ok: false, error: "invalid_step" }, 400);

  // Carrega snapshot + step row
  const { data: snap, error: snapErr } = await sb
    .from("analysis_snapshots")
    .select("id, playlist_id, status, superseded_by")
    .eq("id", snapshotId)
    .maybeSingle();
  if (snapErr) return jr({ ok: false, error: `snapshot_lookup: ${snapErr.message}` }, 500);
  if (!snap)   return jr({ ok: false, error: "snapshot_not_found" }, 404);
  if (snap.status !== "processing") {
    return jr({ ok: true, skipped: true, reason: `snapshot_status_${snap.status}` });
  }
  if (snap.superseded_by) {
    return jr({ ok: true, skipped: true, reason: "superseded" });
  }

  const { data: stepRow, error: stepErr } = await sb
    .from("analysis_snapshot_results")
    .select("id, status, retry_count, max_retry, timeout_seconds")
    .eq("snapshot_id", snapshotId)
    .eq("step", step)
    .maybeSingle();
  if (stepErr) return jr({ ok: false, error: `step_lookup: ${stepErr.message}` }, 500);
  if (!stepRow) return jr({ ok: false, error: "step_row_not_found" }, 404);

  if (stepRow.status === "done") {
    return jr({ ok: true, skipped: true, reason: "already_done" });
  }
  if (stepRow.status === "running") {
    return jr({ ok: true, skipped: true, reason: "already_running" });
  }

  // Resolve playlist
  const { data: pl, error: plErr } = await sb
    .from("managed_playlists")
    .select("id, spotify_playlist_id, execution_mode, operational_status")
    .eq("id", snap.playlist_id)
    .maybeSingle();
  if (plErr) return jr({ ok: false, error: `playlist_lookup: ${plErr.message}` }, 500);
  if (!pl)   return jr({ ok: false, error: "playlist_not_found" }, 404);

  // HARD STOP: Snapshot não pode acionar motores Spotify para playlist MANUAL_ONLY.
  // Elas existem no ecossistema, mas sem autorização OAuth operacional; insistir aqui
  // gera 401 repetido e pode abrir rate-limit/breaker dos apps.
  if ((pl as any).execution_mode === "MANUAL_ONLY") {
    const nowIso = new Date().toISOString();
    await sb.from("analysis_snapshot_results").update({
      status: "failed",
      finished_at: nowIso,
      error: "manual_only_no_snapshot_spotify_pipeline",
    }).eq("id", stepRow.id);
    await sb.from("analysis_snapshots").update({
      status: "failed",
      failed_at: nowIso,
      failure_reason: "manual_only_no_snapshot_spotify_pipeline",
    }).eq("id", snapshotId);
    await logEvent(sb, snapshotId, snap.playlist_id, "snapshot_skipped_manual_only", { step }, step);
    return jr({ ok: true, skipped: true, reason: "manual_only_no_snapshot_spotify_pipeline", step });
  }

  // Marca running
  const startedAt = new Date();
  await sb.from("analysis_snapshot_results").update({
    status: "running",
    started_at: startedAt.toISOString(),
    error: null,
  }).eq("id", stepRow.id);

  await logEvent(sb, snapshotId, snap.playlist_id, "step_started", { step }, step);

  // Invoca motor
  const { fn, body: engineBody } = buildEngineRequest(step, pl as any);
  const timeoutMs = (stepRow.timeout_seconds ?? 120) * 1000;
  const outcome = await callEngine(fn, engineBody, timeoutMs, step, snapshotId);
  const durationMs = Date.now() - startedAt.getTime();

  if (outcome.ok) {
    await sb.from("analysis_snapshot_results").update({
      status: "done",
      finished_at: new Date().toISOString(),
      duration_ms: durationMs,
      result: outcome.result ?? {},
      error: null,
    }).eq("id", stepRow.id);

    // Fase 3: gravar versões canônicas no snapshot conforme cada etapa conclui.
    // Os motores existentes não devolvem versão no payload — derivamos das tabelas
    // canônicas (timestamps de recomputação) para manter um carimbo determinístico.
    try {
      const patch: Record<string, unknown> = {};
      if (step === "dna") {
        const { data: dna } = await sb
          .from("playlist_dna")
          .select("computed_at, updated_at")
          .eq("playlist_id", snap.playlist_id)
          .maybeSingle();
        const ts = (dna as any)?.computed_at ?? (dna as any)?.updated_at;
        if (ts) patch.dna_version = String(ts);
      } else if (step === "brain") {
        const { data: gb } = await sb
          .from("genre_brain")
          .select("last_recomputed_at")
          .order("last_recomputed_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const gbTs = (gb as any)?.last_recomputed_at;
        if (gbTs) patch.genre_brain_version = String(gbTs);

        const { data: gcm } = await sb
          .from("genre_capacity_matrix")
          .select("updated_at")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const gcmTs = (gcm as any)?.updated_at;
        if (gcmTs) patch.market_version = String(gcmTs);
      }
      if (Object.keys(patch).length > 0) {
        await sb.from("analysis_snapshots").update(patch).eq("id", snapshotId);
        await logEvent(sb, snapshotId, snap.playlist_id, "snapshot_version_set", patch, step);
      }
    } catch (e) {
      // Não bloqueia o pipeline — finalizer dirá 'missing_versions' se faltar.
      await logEvent(sb, snapshotId, snap.playlist_id, "version_capture_error", {
        step, error: (e as Error).message,
      }, step);
    }

    await logEvent(sb, snapshotId, snap.playlist_id, "step_done", {
      step, duration_ms: durationMs, http_status: outcome.status,
    }, step);


    const nxt = nextStep(step);
    if (nxt) {
      fireAndForget(`${SUPABASE_URL}/functions/v1/snapshot-step-runner`, {
        snapshot_id: snapshotId, step: nxt,
      });
    } else {
      fireAndForget(`${SUPABASE_URL}/functions/v1/snapshot-finalizer`, {
        snapshot_id: snapshotId,
      });
    }
    return jr({ ok: true, step, status: "done", duration_ms: durationMs, next: nxt });
  }

  // Falha: classifica timeout vs erro genérico
  const isTimeout = outcome.error === "timeout";
  const nonRetryableSpotifyError =
    String(outcome.error ?? "").includes("SPOTIFY_CIRCUIT_OPEN") ||
    String(outcome.error ?? "").includes("SPOTIFY_AUTH_INVALID") ||
    String(outcome.error ?? "").includes("Valid user authentication required");
  const newRetry = nonRetryableSpotifyError
    ? (stepRow.max_retry ?? 3)
    : (stepRow.retry_count ?? 0) + 1;
  const exhausted = newRetry >= (stepRow.max_retry ?? 3);

  if (!exhausted) {
    await sb.from("analysis_snapshot_results").update({
      status: "pending", // volta a pending pra retry
      retry_count: newRetry,
      last_retry_at: new Date().toISOString(),
      error: outcome.error ?? "unknown",
      finished_at: null,
      duration_ms: durationMs,
    }).eq("id", stepRow.id);

    await logEvent(sb, snapshotId, snap.playlist_id, "step_retry", {
      step, attempt: newRetry, max: stepRow.max_retry, error: outcome.error,
    }, step);

    // Re-invoca self após backoff. Cold start de Edge Function (503
    // LOAD_FUNCTION_ERROR) leva ~10-30s pra estabilizar, então aplicamos
    // backoff exponencial maior pra erros transitórios de plataforma.
    const is503 = outcome.error === "http_503" || outcome.error === "http_502";
    const baseDelay = is503 ? 15_000 : 3_000; // 15s pra cold start, 3s genérico
    const delayMs = Math.min(45_000, baseDelay * newRetry);
    const retryPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        fireAndForget(`${SUPABASE_URL}/functions/v1/snapshot-step-runner`, {
          snapshot_id: snapshotId, step,
        });
        resolve();
      }, delayMs);
    });
    try {
      // @ts-ignore garante que o worker fique vivo até disparar o retry
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(retryPromise);
      }
    } catch { /* */ }

    return jr({ ok: false, step, retry: newRetry, error: outcome.error });
  }

  // Esgotou retries — marca etapa terminal e dispara finalizer.
  await sb.from("analysis_snapshot_results").update({
    status: isTimeout ? "timeout" : "failed",
    finished_at: new Date().toISOString(),
    duration_ms: durationMs,
    retry_count: newRetry,
    last_retry_at: new Date().toISOString(),
    error: outcome.error ?? "unknown",
  }).eq("id", stepRow.id);

  await logEvent(sb, snapshotId, snap.playlist_id, "step_exhausted", {
    step, attempts: newRetry, error: outcome.error,
  }, step);

  fireAndForget(`${SUPABASE_URL}/functions/v1/snapshot-finalizer`, {
    snapshot_id: snapshotId,
  });

  return jr({ ok: false, step, status: isTimeout ? "timeout" : "failed", error: outcome.error });
});
