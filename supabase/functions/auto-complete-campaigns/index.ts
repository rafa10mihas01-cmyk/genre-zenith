// auto-complete-campaigns — roda 1x/dia (06:00 UTC).
// Seleciona campanhas com status ativo cujo started_at + effectiveDays já passou.
// Só marca como completed se entregou >= 95% da meta; caso contrário mantém ativa
// e cria alerta deal_overdue no cockpit.
//
// effectiveDays vive em simulation_snapshot.effectiveDays (fallback: .days).
// Sem snapshot ou sem started_at → pula.

import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { reportCronHealth } from "../_shared/cron-health.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ACTIVE_STATUSES = ["active", "running", "live"];

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function effectiveDaysOf(snapshot: any): number | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const eff = Number(snapshot.effectiveDays ?? snapshot.days);
  return Number.isFinite(eff) && eff > 0 ? Math.floor(eff) : null;
}

async function notifyCampaignOverdue(sb: any, campaign: any, delivered: number, goal: number, effectiveDays: number) {
  const dedupeKey = `deal_overdue:campaign:${campaign.id}`;
  const remaining = Math.max(goal - delivered, 0);

  try {
    await sb.rpc("create_notification", {
      p_type: "warning",
      p_title: `Campanha vencida sem meta: ${campaign.track_name ?? "Faixa"}`,
      p_message: `Prazo de ${effectiveDays} dias venceu com ${delivered.toLocaleString("pt-BR")} de ${goal.toLocaleString("pt-BR")} plays. Faltam ${remaining.toLocaleString("pt-BR")} plays; campanha mantida ativa.`,
      p_action_url: `/campanhas/${campaign.id}/execucao`,
      p_metadata: {
        kind: "deal_overdue",
        domain: "campaigns",
        campaign_id: campaign.id,
        deal_id: campaign.deal_id ?? null,
        delivered,
        target: goal,
        threshold_pct: 95,
        effective_days: effectiveDays,
        dedupe_key: dedupeKey,
      },
      p_dedupe_key: dedupeKey,
      p_cooldown_minutes: 1440,
    });
  } catch (rpcErr) {
    console.log(JSON.stringify({ evt: "auto-complete.notify.rpc_error", campaign_id: campaign.id, error: (rpcErr as Error)?.message ?? String(rpcErr) }));
    await sb.from("notifications").insert({
      user_id: campaign.created_by ?? null,
      type: "warning",
      title: `Campanha vencida sem meta: ${campaign.track_name ?? "Faixa"}`,
      message: `Prazo venceu com ${delivered.toLocaleString("pt-BR")} de ${goal.toLocaleString("pt-BR")} plays. Campanha mantida ativa.`,
      action_url: `/campanhas/${campaign.id}/execucao`,
      metadata: {
        kind: "deal_overdue",
        domain: "campaigns",
        campaign_id: campaign.id,
        deal_id: campaign.deal_id ?? null,
        delivered,
        target: goal,
        threshold_pct: 95,
        effective_days: effectiveDays,
        dedupe_key: dedupeKey,
      },
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const startedAt = Date.now();
  const nowMs = Date.now();

  try {
    const { data: rows, error } = await sb
      .from("campaigns")
      .select("id, status, started_at, simulation_snapshot, track_name, created_by, deal_id, goal_plays, total_delivered")
      .in("status", ACTIVE_STATUSES)
      .is("closed_at", null)
      .not("started_at", "is", null);

    if (error) {
      await reportCronHealth(sb, {
        job_name: "auto-complete-campaigns",
        status: "error",
        startedAt,
        message: error.message,
      });
      return jr({ ok: false, error: error.message }, 500);
    }

    let considered = 0;
    let skippedNoSnapshot = 0;
    let closed = 0;
    let overdue = 0;
    let errors = 0;
    const closedIds: string[] = [];
    const overdueIds: string[] = [];

    for (const r of (rows ?? []) as any[]) {
      considered++;
      const eff = effectiveDaysOf(r.simulation_snapshot);
      if (eff == null) {
        skippedNoSnapshot++;
        continue;
      }
      const startMs = new Date(r.started_at).getTime();
      if (!Number.isFinite(startMs)) {
        skippedNoSnapshot++;
        continue;
      }
      const endMs = startMs + eff * 86400_000;
      if (endMs > nowMs) continue; // ainda dentro do prazo

      const goal = Number(r.goal_plays ?? 0) || 0;
      const delivered = Number(r.total_delivered ?? 0) || 0;
      const reachedThreshold = goal > 0 && delivered >= goal * 0.95;

      if (!reachedThreshold) {
        try {
          await notifyCampaignOverdue(sb, r, delivered, goal, eff);
          overdue++;
          overdueIds.push(r.id);
          console.log(JSON.stringify({ evt: "auto-complete.overdue", campaign_id: r.id, delivered, goal, effective_days: eff }));
        } catch (notifyErr) {
          errors++;
          console.log(JSON.stringify({ evt: "auto-complete.overdue_error", campaign_id: r.id, error: (notifyErr as Error)?.message ?? String(notifyErr) }));
        }
        continue;
      }

      const { error: updErr } = await sb
        .from("campaigns")
        .update({ status: "completed", closed_at: new Date().toISOString(), total_delivered: delivered })
        .eq("id", r.id)
        .in("status", ACTIVE_STATUSES); // guard idempotente

      if (updErr) {
        errors++;
        console.log(JSON.stringify({ evt: "auto-complete.error", campaign_id: r.id, error: updErr.message }));
      } else {
        closed++;
        closedIds.push(r.id);
        console.log(JSON.stringify({ evt: "auto-complete.closed", campaign_id: r.id, delivered, goal, effective_days: eff, started_at: r.started_at }));
      }
    }

    const metrics = {
      considered,
      closed,
      overdue,
      skipped_no_snapshot: skippedNoSnapshot,
      errors,
      closed_ids: closedIds.slice(0, 50),
      overdue_ids: overdueIds.slice(0, 50),
    };

    await reportCronHealth(sb, {
      job_name: "auto-complete-campaigns",
      status: errors > 0 ? "partial" : "ok",
      startedAt,
      metrics,
      message: `closed ${closed}/${considered}; overdue ${overdue}`,
    });

    return jr({ ok: true, ...metrics });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    await reportCronHealth(sb, {
      job_name: "auto-complete-campaigns",
      status: "error",
      startedAt,
      message: msg,
    });
    return jr({ ok: false, error: msg }, 500);
  }
});
