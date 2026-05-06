// Helper compartilhado para criar notificações operacionais.
// Uso:
//   import { notify } from "../_shared/notify.ts";
//   await notify(supabase, {
//     domain: "bot", severity: "critical",
//     title: "Bot offline", message: "...",
//     dedupeKey: "bot_offline", cooldownMin: 30,
//   });
//
// Não substitui o RPC — apenas padroniza metadata e severity.
// O dedupe global já é feito pelo RPC create_notification (FASE 2A).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type NotifDomain =
  | "bot"
  | "ocr"
  | "queue"
  | "curator"
  | "system"
  | "financeiro"
  | "security"
  | "ai";

export type NotifSeverity = "critical" | "high" | "medium" | "low" | "info";

export interface NotifyArgs {
  domain: NotifDomain;
  severity: NotifSeverity;
  title: string;
  message: string;
  dedupeKey?: string;
  cooldownMin?: number;
  actionUrl?: string;
  actionRequired?: boolean;
  silent?: boolean; // suprime toast no front
  meta?: Record<string, unknown>;
}

function severityToType(sev: NotifSeverity): "critical" | "warning" | "info" {
  if (sev === "critical" || sev === "high") return "critical";
  if (sev === "medium") return "warning";
  return "info";
}

export async function notify(
  supabase: SupabaseClient,
  args: NotifyArgs,
): Promise<string | null> {
  const type = severityToType(args.severity);
  const metadata = {
    domain: args.domain,
    severity: args.severity,
    action_required: args.actionRequired ?? args.severity === "critical",
    silent: args.silent ?? false,
    source: "edge-function",
    ...(args.meta ?? {}),
    ...(args.dedupeKey ? { dedupe_key: args.dedupeKey } : {}),
  };

  try {
    const { data, error } = await supabase.rpc("create_notification" as any, {
      p_type: type,
      p_title: args.title,
      p_message: args.message,
      p_action_url: args.actionUrl ?? null,
      p_metadata: metadata,
      p_dedupe_key: args.dedupeKey ?? null,
      p_cooldown_minutes: args.cooldownMin ?? 60,
    });
    if (error) {
      console.error("[notify] rpc error", error.message);
      return null;
    }
    return (data as string) ?? null;
  } catch (e) {
    console.error("[notify] unexpected", e);
    return null;
  }
}
