// FASE 4.C.2 — Worker de entrega de alertas (email/webhook/slack).
// Cron: a cada 1 minuto. Consome system_alerts com delivered_at IS NULL.
//
// Regras:
//  - severity 'critical' = entrega imediata; warning = entrega imediata; info = só persiste.
//  - cooldown já é respeitado no momento do pushAlert (dedupe).
//  - canal "email" usa a infra interna (process-email-queue → enqueue_email).
//  - canal "webhook" faz POST simples para SYSTEM_ALERT_WEBHOOK_URL (se setado).
//  - canal "slack" usa SLACK_WEBHOOK_URL (estrutura pronta; opcional).
//  - retry: máx 5 tentativas via metadata.retry_count.
//
// NÃO altera o contrato de nenhuma edge function existente.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serveCron } from "../_shared/cron-lock.ts";
import { reportCronHealth } from "../_shared/cron-health.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_RETRY = 5;
const BATCH = 50;

serveCron({ job_name: "deliver-system-alerts-cron", max_retries: 1, timeout_ms: 240_000 }, async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const t0 = Date.now();
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const webhookUrl = Deno.env.get("SYSTEM_ALERT_WEBHOOK_URL") ?? "";
  const slackUrl = Deno.env.get("SLACK_WEBHOOK_URL") ?? "";
  const opsEmail = Deno.env.get("OPS_ALERT_EMAIL") ?? "";

  let delivered = 0, failed = 0, skipped = 0;

  try {
    const { data: rows, error } = await sb
      .from("system_alerts")
      .select("id, severity, subsystem, title, message, channels, correlation_id, metadata, dedupe_key")
      .is("delivered_at", null)
      .is("resolved_at", null)
      .in("severity", ["critical", "warning"])
      .order("created_at", { ascending: true })
      .limit(BATCH);
    if (error) throw error;

    for (const a of rows ?? []) {
      const retryCount = Number((a.metadata as any)?.retry_count ?? 0);
      if (retryCount >= MAX_RETRY) {
        await sb.from("system_alerts").update({
          delivered_at: new Date().toISOString(),
          metadata: { ...(a.metadata as any), dlq: true },
        }).eq("id", a.id);
        skipped++; continue;
      }

      const channels: string[] = a.channels ?? ["inapp"];
      const errors: string[] = [];

      // ── Email ──────────────────────────────────────────────────────────
      if (channels.includes("email") && opsEmail) {
        try {
          const { error: enqErr } = await sb.rpc("enqueue_email" as any, {
            p_queue: "transactional_emails",
            p_payload: {
              templateName: "system-alert",
              recipientEmail: opsEmail,
              idempotencyKey: `alert-${a.id}`,
              templateData: {
                severity: a.severity, subsystem: a.subsystem,
                title: a.title, message: a.message,
                correlation_id: a.correlation_id,
              },
            },
          });
          if (enqErr) errors.push("email:" + enqErr.message);
        } catch (e) { errors.push("email:" + String(e)); }
      }

      // ── Webhook genérico ───────────────────────────────────────────────
      if (channels.includes("webhook") && webhookUrl) {
        try {
          const r = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-correlation-id": a.correlation_id ?? "" },
            body: JSON.stringify({
              id: a.id, severity: a.severity, subsystem: a.subsystem,
              title: a.title, message: a.message,
              dedupe_key: a.dedupe_key, correlation_id: a.correlation_id,
              metadata: a.metadata,
            }),
          });
          if (!r.ok) errors.push("webhook:" + r.status);
        } catch (e) { errors.push("webhook:" + String(e)); }
      }

      // ── Slack (estrutura pronta) ───────────────────────────────────────
      if (channels.includes("slack") && slackUrl) {
        try {
          const color = a.severity === "critical" ? "#ef4444" : "#f59e0b";
          const r = await fetch(slackUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              attachments: [{
                color,
                title: `[${a.severity.toUpperCase()}] ${a.title}`,
                text: a.message,
                footer: `subsystem=${a.subsystem} · corr=${a.correlation_id ?? "—"}`,
              }],
            }),
          });
          if (!r.ok) errors.push("slack:" + r.status);
        } catch (e) { errors.push("slack:" + String(e)); }
      }

      if (errors.length === 0) {
        await sb.from("system_alerts").update({
          delivered_at: new Date().toISOString(),
        }).eq("id", a.id);
        delivered++;
      } else {
        await sb.from("system_alerts").update({
          metadata: { ...(a.metadata as any), retry_count: retryCount + 1, last_delivery_errors: errors },
        }).eq("id", a.id);
        failed++;
      }
    }

    await reportCronHealth(sb, {
      job_name: "deliver-system-alerts-cron",
      status: failed > 0 ? "partial" : "ok",
      startedAt: t0,
      metrics: { delivered, failed, skipped, considered: rows?.length ?? 0 },
    });

    return new Response(JSON.stringify({ ok: true, delivered, failed, skipped }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("deliver-system-alerts-cron error", e);
    await reportCronHealth(sb, {
      job_name: "deliver-system-alerts-cron", status: "error", startedAt: t0, message: String(e),
    });
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
