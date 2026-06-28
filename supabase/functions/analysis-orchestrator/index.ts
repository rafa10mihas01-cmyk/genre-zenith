// analysis-orchestrator — Ponto de entrada ÚNICO do pipeline Analysis Snapshot (Fase 1).
//
// Contrato:
//   POST { playlist_id, trigger_event, payload?, idempotency_key? }
//
// Responsabilidades nesta fase (esqueleto):
//   1. Valida input.
//   2. Resolve idempotency_key (se não vier, calcula a partir de trigger + payload + tracks_hash atual).
//   3. Verifica se já existe snapshot 'processing' ou 'ready' recente com a mesma chave → reusa.
//   4. Se existe snapshot 'processing' para a playlist:
//        - registra o novo evento como pending_event_id no snapshot atual (ajuste 1: sem debounce);
//        - retorna o snapshot atual + flag queued=true.
//   5. Caso contrário, cria o snapshot 'processing' fixando as versões de DNA/Brain/Mercado.
//   6. Cria as linhas de etapa em analysis_snapshot_results (status='pending', timeout/max_retry por etapa).
//   7. Registra evento snapshot_created.
//
// Esta versão NÃO enfileira ainda os jobs do pipeline em playlist_operation_queue.
// Isso será feito na Fase 2, quando os motores aprenderem a receber snapshot_id.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Trigger =
  | "auto_sync"
  | "tracks_changed"
  | "meta_changed"
  | "cover_changed"
  | "manual_reanalyze"
  | "import"
  | "reactivation"
  | "cron_catalog"
  | "observer";

const VALID_TRIGGERS: Trigger[] = [
  "auto_sync", "tracks_changed", "meta_changed", "cover_changed",
  "manual_reanalyze", "import", "reactivation", "cron_catalog", "observer",
];

// Ajuste 3 — timeouts individuais por etapa (segundos)
const STEP_TIMEOUTS: Record<string, number> = {
  sync:     120,  // 2 min
  dna:      180,  // 3 min
  diagnose: 180,  // 3 min
  brain:    300,  // 5 min
  score:    120,  // 2 min
};
const STEP_MAX_RETRY = 3; // ajuste 4

const STEPS = ["sync", "dna", "diagnose", "brain", "score"] as const;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ ok: false, error: "method_not_allowed" }, 405);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: any;
  try { body = await req.json(); } catch { return jr({ ok: false, error: "invalid_json" }, 400); }

  const playlistId: string | undefined = body?.playlist_id;
  const triggerEvent: Trigger | undefined = body?.trigger_event;
  const payload: Record<string, unknown> = body?.payload ?? {};
  const providedIdempotency: string | undefined = body?.idempotency_key;

  if (!playlistId || typeof playlistId !== "string") {
    return jr({ ok: false, error: "playlist_id_required" }, 400);
  }
  if (!triggerEvent || !VALID_TRIGGERS.includes(triggerEvent)) {
    return jr({ ok: false, error: "invalid_trigger_event" }, 400);
  }

  // Carrega estado mínimo da playlist (tracks_hash atual + versões de referência)
  const { data: mp, error: mpErr } = await sb
    .from("managed_playlists")
    .select("id, tracks_hash, playlist_type")
    .eq("id", playlistId)
    .maybeSingle();
  if (mpErr) return jr({ ok: false, error: `managed_playlists_lookup: ${mpErr.message}` }, 500);
  if (!mp)   return jr({ ok: false, error: "playlist_not_found" }, 404);

  const tracksHash: string | null = (mp as any).tracks_hash ?? null;

  // Versões correntes — referência (não cópia). Fase 1: leitura best-effort.
  const dnaVersion         = (payload as any).dna_version          ?? null;
  const genreBrainVersion  = (payload as any).genre_brain_version  ?? null;
  const marketVersion      = (payload as any).market_version       ?? null;
  const strategyVersion    = (payload as any).strategy_version     ?? "v1";

  // Ajuste 2 — Idempotência: se não veio chave, calcula a partir do conteúdo.
  const eventHash = await sha256Hex(JSON.stringify({ triggerEvent, payload }));
  const requestHash = await sha256Hex(JSON.stringify({ playlistId, triggerEvent, payload, tracksHash }));
  const idempotencyKey = providedIdempotency ?? requestHash;

  // 1) Tenta reusar snapshot ativo (processing/ready) com mesma chave de idempotência
  const { data: existing } = await sb
    .from("analysis_snapshots")
    .select("id, status, started_at, ready_at")
    .eq("playlist_id", playlistId)
    .eq("idempotency_key", idempotencyKey)
    .in("status", ["processing", "ready"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    return jr({
      ok: true,
      reused: true,
      snapshot_id: existing.id,
      status: existing.status,
    });
  }

  // 2) Se há um snapshot 'processing' para a playlist (mas com outra chave),
  //    NÃO cria outro — registra o evento como pendente.
  //    Lock garantido pelo unique index parcial (ajuste 8).
  const { data: inflight } = await sb
    .from("analysis_snapshots")
    .select("id")
    .eq("playlist_id", playlistId)
    .eq("status", "processing")
    .maybeSingle();

  if (inflight) {
    // Atualiza pending_event_id e loga — quando o snapshot atual finalizar,
    // o finalizer abrirá um novo snapshot com este evento mais recente.
    const pendingEventId = crypto.randomUUID();
    await sb
      .from("analysis_snapshots")
      .update({ pending_event_id: pendingEventId })
      .eq("id", inflight.id);

    await logEvent(sb, inflight.id, playlistId, "event_queued", {
      trigger_event: triggerEvent,
      event_hash: eventHash,
      pending_event_id: pendingEventId,
      payload,
    });

    return jr({
      ok: true,
      queued: true,
      snapshot_id: inflight.id,
      pending_event_id: pendingEventId,
      message: "snapshot_in_progress_event_queued",
    });
  }

  // 3) Cria novo snapshot 'processing'
  const { data: snap, error: insErr } = await sb
    .from("analysis_snapshots")
    .insert({
      playlist_id: playlistId,
      status: "processing",
      trigger_event: triggerEvent,
      trigger_payload: payload,
      request_hash: requestHash,
      event_hash: eventHash,
      idempotency_key: idempotencyKey,
      tracks_hash: tracksHash,
      dna_version: dnaVersion,
      genre_brain_version: genreBrainVersion,
      market_version: marketVersion,
      strategy_version: strategyVersion,
    })
    .select("id, started_at")
    .single();

  if (insErr) {
    // Pode ter colidido no unique index (race com outro orchestrator).
    // Tenta carregar o snapshot 'processing' vencedor.
    if (insErr.code === "23505") {
      const { data: winner } = await sb
        .from("analysis_snapshots")
        .select("id, status")
        .eq("playlist_id", playlistId)
        .eq("status", "processing")
        .maybeSingle();
      if (winner) {
        return jr({ ok: true, race_lost: true, snapshot_id: winner.id, status: winner.status });
      }
    }
    return jr({ ok: false, error: `snapshot_insert: ${insErr.message}` }, 500);
  }

  // 4) Cria as linhas de etapa (pending) com timeout e retry individuais
  const stepRows = STEPS.map((step) => ({
    snapshot_id: snap.id,
    step,
    status: "pending" as const,
    timeout_seconds: STEP_TIMEOUTS[step],
    max_retry: STEP_MAX_RETRY,
  }));
  const { error: stepsErr } = await sb.from("analysis_snapshot_results").insert(stepRows);
  if (stepsErr) {
    // Falha ao preparar etapas → marca snapshot como failed cedo.
    await sb.from("analysis_snapshots").update({
      status: "failed",
      failed_at: new Date().toISOString(),
      failure_reason: `steps_init: ${stepsErr.message}`,
    }).eq("id", snap.id);
    return jr({ ok: false, error: `steps_init: ${stepsErr.message}` }, 500);
  }

  await logEvent(sb, snap.id, playlistId, "snapshot_created", {
    trigger_event: triggerEvent,
    request_hash: requestHash,
    event_hash: eventHash,
    idempotency_key: idempotencyKey,
    tracks_hash: tracksHash,
  });

  // Fase 2: dispara a primeira etapa (sync) via snapshot-step-runner em fire-and-forget.
  const firstStep = STEPS[0];
  try {
    const runnerUrl = `${SUPABASE_URL}/functions/v1/snapshot-step-runner`;
    const p = fetch(runnerUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ snapshot_id: snap.id, step: firstStep }),
    }).catch(() => { /* best-effort */ });
    // @ts-ignore EdgeRuntime disponível no runtime Supabase.
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(p);
    }
  } catch { /* best-effort */ }

  return jr({
    ok: true,
    created: true,
    snapshot_id: snap.id,
    status: "processing",
    started_at: snap.started_at,
    steps: STEPS,
    first_step_dispatched: firstStep,
  });
});
