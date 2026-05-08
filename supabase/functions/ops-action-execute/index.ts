// ops-action-execute — executa ações operacionais com whitelist + log.
// Para ações que precisam do agente VPS, enfileira em ops_agent_commands.
// Para ações 100% no Cloud, executa direto.
import { requireAdmin, corsHeaders, jr } from "../_shared/admin-auth.ts";

type ActionDef = {
  scope: "system" | "bot" | "deal" | "agent";
  requiresConfirmation: boolean;
  needsAgent: boolean;
  agentKind?: "shell" | "pm2" | "restart_bot" | "system_metrics" | "custom";
  buildCommand?: (payload: any) => { command?: string; args?: any; timeout_ms?: number };
};

const ACTIONS: Record<string, ActionDef> = {
  // === Cloud-side (sem agente) ===
  clear_bot_queue: {
    scope: "bot", requiresConfirmation: true, needsAgent: false,
  },
  reconcile_deal: {
    scope: "deal", requiresConfirmation: false, needsAgent: false,
  },
  unstuck_song: {
    scope: "bot", requiresConfirmation: false, needsAgent: false,
  },

  // === Agente VPS ===
  pm2_restart: {
    scope: "agent", requiresConfirmation: true, needsAgent: true, agentKind: "pm2",
    buildCommand: (p) => ({ command: `pm2 restart ${p.process}`, args: p, timeout_ms: 30000 }),
  },
  pm2_stop: {
    scope: "agent", requiresConfirmation: true, needsAgent: true, agentKind: "pm2",
    buildCommand: (p) => ({ command: `pm2 stop ${p.process}`, args: p, timeout_ms: 30000 }),
  },
  pm2_list: {
    scope: "agent", requiresConfirmation: false, needsAgent: true, agentKind: "pm2",
    buildCommand: () => ({ command: "pm2 jlist", timeout_ms: 10000 }),
  },
  restart_spotify_bot: {
    scope: "agent", requiresConfirmation: true, needsAgent: true, agentKind: "restart_bot",
    buildCommand: () => ({ command: "pm2 restart spotify-bot", timeout_ms: 60000 }),
  },
  refresh_server_metrics: {
    scope: "agent", requiresConfirmation: false, needsAgent: true, agentKind: "system_metrics",
    buildCommand: () => ({ timeout_ms: 10000 }),
  },
  shell_exec: {
    // Apenas para comandos da terminal whitelist no payload (validar no agente também)
    scope: "agent", requiresConfirmation: true, needsAgent: true, agentKind: "shell",
    buildCommand: (p) => ({ command: p.command, timeout_ms: p.timeout_ms ?? 15000 }),
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.resp;
  const { supabase, userId } = auth;

  let body: any;
  try { body = await req.json(); } catch { return jr({ error: "invalid_json" }, 400); }

  const { action, payload = {}, target, confirmed = false } = body;
  const def = ACTIONS[action];
  if (!def) return jr({ error: "unknown_action", action }, 400);

  if (def.requiresConfirmation && !confirmed) {
    return jr({ error: "confirmation_required", action }, 412);
  }

  // Cria log
  const { data: log, error: logErr } = await supabase
    .from("ops_actions_log")
    .insert({
      user_id: userId,
      action,
      scope: def.scope,
      target: target ?? null,
      payload,
      status: "running",
      requires_confirmation: def.requiresConfirmation,
      confirmed_by: def.requiresConfirmation ? userId : null,
      confirmed_at: def.requiresConfirmation ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  if (logErr) return jr({ error: logErr.message }, 500);
  const logId = log.id;

  const t0 = Date.now();
  try {
    let result: any = {};

    if (def.needsAgent) {
      // Enfileira para o agente VPS
      const built = def.buildCommand?.(payload) ?? {};
      const { data: cmd, error: cmdErr } = await supabase
        .from("ops_agent_commands")
        .insert({
          agent_id: payload.agent_id ?? "default",
          action_log_id: logId,
          kind: def.agentKind!,
          command: built.command ?? null,
          args: built.args ?? payload,
          timeout_ms: built.timeout_ms ?? 30000,
          created_by: userId,
        })
        .select("id")
        .single();
      if (cmdErr) throw new Error(cmdErr.message);
      result = { queued_command_id: cmd.id, message: "Enfileirado para o agente VPS" };
      // Status fica running até o agente reportar
      await supabase.from("ops_actions_log")
        .update({ result, status: "running" })
        .eq("id", logId);
      return jr({ ok: true, log_id: logId, ...result }, 202);
    }

    // === Cloud-side actions ===
    if (action === "clear_bot_queue") {
      const { error } = await supabase
        .from("curator_deal_songs")
        .update({ auto_collect_status: "idle", auto_collect_error: null })
        .eq("auto_collect_status", "queued");
      if (error) throw new Error(error.message);
      result = { message: "Fila resetada" };
    } else if (action === "reconcile_deal") {
      if (!payload.deal_id) throw new Error("deal_id required");
      const { error } = await supabase.functions.invoke("cron-reconcile-curator-deals", {
        body: { deal_id: payload.deal_id, force: true },
      });
      if (error) throw new Error(error.message);
      result = { message: "Reconciliação disparada", deal_id: payload.deal_id };
    } else if (action === "unstuck_song") {
      if (!payload.song_id) throw new Error("song_id required");
      const { error } = await supabase
        .from("curator_deal_songs")
        .update({ auto_collect_status: "idle", auto_collect_error: null, queued_at: null })
        .eq("id", payload.song_id);
      if (error) throw new Error(error.message);
      result = { message: "Música destravada" };
    }

    await supabase.from("ops_actions_log")
      .update({ status: "success", result, finished_at: new Date().toISOString(), duration_ms: Date.now() - t0 })
      .eq("id", logId);

    return jr({ ok: true, log_id: logId, ...result }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase.from("ops_actions_log")
      .update({ status: "error", error: msg.slice(0, 500), finished_at: new Date().toISOString(), duration_ms: Date.now() - t0 })
      .eq("id", logId);
    return jr({ ok: false, log_id: logId, error: msg }, 500);
  }
});
