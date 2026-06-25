// snapshot-watchdog — Fase 6.1
//
// Roda a cada 1 min e cuida de 2 problemas operacionais:
//
// 1) PROCESSING ÓRFÃO
//    Snapshots que entram em `processing` e ficam parados (step-runner morreu
//    silenciosamente, deploy reiniciou, timeout fora do retry, etc).
//    Como o índice único `analysis_snapshots_one_processing_per_playlist` bloqueia
//    QUALQUER novo snapshot dessa playlist, um órfão congela o pipeline da playlist.
//    Regra: se `updated_at` (= último evento) > 10 min ATRÁS → marca como `failed`
//    com `failure_reason = 'watchdog_timeout'` e emite evento `snapshot_failed`.
//
// 2) REPLAY DOS `failed` RECENTES
//    Snapshots que falharam nas últimas 2h e ainda não foram superados por outro
//    `ready`/`processing` da mesma playlist + trigger são re-disparados via
//    `analysis-orchestrator`. Cap de 3 replays por snapshot original (controlado
//    via `metrics.replay_count`).
//
// Tudo idempotente: roda repetidamente sem efeito colateral acumulado.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const STALE_PROCESSING_MIN = 10;     // > 10 min sem update → órfão
const REPLAY_LOOKBACK_MIN  = 120;    // failed dentro das últimas 2h
const REPLAY_MAX           = 3;      // máx 3 retentativas por snapshot original
const REPLAY_BATCH         = 20;     // máx 20 replays por execução

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const report = { stale_failed: 0, replayed: 0, replay_skipped: 0, errors: [] as string[] };

  // ============================================================
  // 1) PROCESSING ÓRFÃO → failed
  // ============================================================
  const staleCutoff = new Date(Date.now() - STALE_PROCESSING_MIN * 60_000).toISOString();
  const { data: stuck, error: stuckErr } = await sb
    .from("analysis_snapshots")
    .select("id, playlist_id, updated_at")
    .eq("status", "processing")
    .lt("updated_at", staleCutoff);

  if (stuckErr) report.errors.push(`stuck_query: ${stuckErr.message}`);

  for (const s of stuck ?? []) {
    const nowIso = new Date().toISOString();
    const { error: upErr } = await sb
      .from("analysis_snapshots")
      .update({
        status:         "failed",
        failure_reason: "watchdog_timeout",
        failed_at:      nowIso,
        updated_at:     nowIso,
      })
      .eq("id", s.id)
      .eq("status", "processing"); // guard contra corrida com step-runner

    if (upErr) { report.errors.push(`stuck_upd ${s.id}: ${upErr.message}`); continue; }

    await sb.from("analysis_snapshot_events").insert({
      snapshot_id: s.id,
      event_type:  "snapshot_failed",
      payload:     { reason: "watchdog_timeout", stale_for_min: STALE_PROCESSING_MIN, source: "snapshot-watchdog" },
    });
    report.stale_failed += 1;
  }

  // ============================================================
  // 2) REPLAY DOS failed RECENTES
  // ============================================================
  const replayCutoff = new Date(Date.now() - REPLAY_LOOKBACK_MIN * 60_000).toISOString();

  const { data: failed, error: failErr } = await sb
    .from("analysis_snapshots")
    .select("id, playlist_id, trigger_event, trigger_payload, failure_reason, metrics, failed_at")
    .eq("status", "failed")
    .gte("failed_at", replayCutoff)
    .order("failed_at", { ascending: true })
    .limit(REPLAY_BATCH);

  if (failErr) report.errors.push(`failed_query: ${failErr.message}`);

  for (const f of failed ?? []) {
    const replayCount = Number((f.metrics as any)?.replay_count ?? 0);
    if (replayCount >= REPLAY_MAX) { report.replay_skipped += 1; continue; }

    // Já existe processing/ready/superseded mais novo dessa playlist? Então não replay.
    const { data: newer } = await sb
      .from("analysis_snapshots")
      .select("id")
      .eq("playlist_id", f.playlist_id)
      .in("status", ["processing", "ready", "superseded"])
      .gt("created_at", f.failed_at!)
      .limit(1);
    if (newer && newer.length > 0) { report.replay_skipped += 1; continue; }

    // Marca o original com replay_count++ ANTES de disparar — evita loop em caso de falha.
    await sb
      .from("analysis_snapshots")
      .update({
        metrics: { ...(f.metrics as any ?? {}), replay_count: replayCount + 1, last_replay_at: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      })
      .eq("id", f.id);

    // Dispara novo snapshot via orquestrador (fire-and-forget).
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/analysis-orchestrator`, {
        method: "POST",
        headers: {
          Authorization:  `Bearer ${SERVICE_KEY}`,
          apikey:         SERVICE_KEY,
          "Content-Type": "application/json",
          "x-snapshot-replay-of": f.id,
        },
        body: JSON.stringify({
          playlist_id:   f.playlist_id,
          trigger_event: f.trigger_event,
          payload:       { ...(f.trigger_payload as any ?? {}), replay_of: f.id, replay_attempt: replayCount + 1 },
          // idempotency_key diferente do original (timestamp) — força criar novo
          idempotency_key: `replay:${f.id}:${replayCount + 1}`,
        }),
      });
      await resp.text();
      if (!resp.ok) report.errors.push(`replay ${f.id}: http_${resp.status}`);
      else report.replayed += 1;
    } catch (e) {
      report.errors.push(`replay ${f.id}: ${(e as Error).message}`);
    }
  }

  return jr({ ok: true, ...report });
});
