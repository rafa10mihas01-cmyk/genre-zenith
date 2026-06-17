// FASE 4.C.1 — Evento explícito de crash.
// Persistido em `bot_events` com step='crash' status='error' — preserva o
// contrato e aparece automaticamente no AoVivoFeed e AlertasHistorico.
//
// Também dispara um system_alert CRITICAL com dedupe por worker_id.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { pushAlert } from "./alerts.ts";

export interface CrashEventArgs {
  worker_id?: string | null;
  hostname?: string | null;
  pid?: number | null;
  stack?: string | null;
  last_action?: string | null;
  correlation_id?: string | null;
  uptime_ms?: number | null;
  reason: string;
  restart?: boolean;
  retry?: number;
  bot_name?: string | null;
}

export async function recordCrashEvent(sb: SupabaseClient, args: CrashEventArgs): Promise<void> {
  const metadata = {
    pid: args.pid ?? null,
    stack: args.stack ?? null,
    last_action: args.last_action ?? null,
    uptime_ms: args.uptime_ms ?? null,
    reason: args.reason,
    restart: args.restart ?? false,
    retry: args.retry ?? 0,
    bot_name: args.bot_name ?? null,
  };

  try {
    await sb.from("bot_events").insert({
      step: "crash",
      status: "error",
      worker_id: args.worker_id ?? null,
      hostname: args.hostname ?? null,
      correlation_id: args.correlation_id ?? null,
      duration_ms: 0,
      metadata,
    });
  } catch (e) {
    console.error("[recordCrashEvent] insert bot_events failed", e);
  }

  await pushAlert(sb, {
    severity: "critical",
    subsystem: "bot",
    title: `Crash detectado em ${args.bot_name ?? args.hostname ?? "worker"}`,
    message: `Motivo: ${args.reason}${args.restart ? " · reinício automático em curso" : ""}.`,
    dedupeKey: `crash:${args.worker_id ?? args.hostname ?? "unknown"}`,
    cooldownMinutes: 15,
    correlationId: args.correlation_id ?? undefined,
    metadata,
  });
}
