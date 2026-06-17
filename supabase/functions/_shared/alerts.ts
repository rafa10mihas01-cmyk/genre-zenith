// FASE 4.C.1 — Fila oficial de alertas push (system_alerts).
//
// Diferenças vs `notify.ts`:
//  - notify.ts → notificações in-app (sino, dedupe via create_notification RPC).
//  - alerts.ts → alertas operacionais externos (email/webhook/slack futuro)
//    com SLA, ack e resolução. Persistidos em `public.system_alerts`.
//
// Dedupe: se houver `dedupe_key` com alerta NÃO resolvido criado dentro de
// `cooldown_minutes`, NÃO criamos um novo registro — apenas devolvemos o id
// existente. Garante zero duplicação.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type AlertSeverity = "info" | "warning" | "critical";
export type AlertChannel = "inapp" | "email" | "webhook" | "slack";

export interface AlertArgs {
  severity: AlertSeverity;
  subsystem: string;             // bot|gateway|parser|match|writer|delivery|ocr|browser|cron|smtp|spotify|supabase|db
  title: string;
  message: string;
  dedupeKey?: string;
  cooldownMinutes?: number;
  channels?: AlertChannel[];
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

export async function pushAlert(
  sb: SupabaseClient,
  args: AlertArgs,
): Promise<{ id: string | null; deduped: boolean }> {
  try {
    const cooldown = args.cooldownMinutes ?? 60;

    if (args.dedupeKey) {
      const since = new Date(Date.now() - cooldown * 60_000).toISOString();
      const { data: existing } = await sb
        .from("system_alerts")
        .select("id")
        .eq("dedupe_key", args.dedupeKey)
        .is("resolved_at", null)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing?.id) return { id: existing.id, deduped: true };
    }

    const { data, error } = await sb.from("system_alerts").insert({
      severity: args.severity,
      subsystem: args.subsystem,
      title: args.title,
      message: args.message,
      dedupe_key: args.dedupeKey ?? null,
      cooldown_minutes: cooldown,
      channels: args.channels ?? ["inapp"],
      correlation_id: args.correlationId ?? null,
      metadata: args.metadata ?? {},
    }).select("id").single();

    if (error) { console.error("[pushAlert] insert failed", error.message); return { id: null, deduped: false }; }
    return { id: data?.id ?? null, deduped: false };
  } catch (e) {
    console.error("[pushAlert] unexpected", e);
    return { id: null, deduped: false };
  }
}

export async function resolveAlertByDedupe(
  sb: SupabaseClient,
  dedupeKey: string,
  resolution: string,
): Promise<void> {
  try {
    await sb.from("system_alerts")
      .update({ resolved_at: new Date().toISOString(), resolution })
      .eq("dedupe_key", dedupeKey)
      .is("resolved_at", null);
  } catch (e) {
    console.error("[resolveAlertByDedupe]", e);
  }
}
