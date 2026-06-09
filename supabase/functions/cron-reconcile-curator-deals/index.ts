// Cron: reconcilia deals ativos usando a RPC `get_curator_deal_progress`
// como ÚNICA fonte de verdade. Não recalcula nada manualmente — apenas
// persiste o resultado oficial em curator_deals e dispara milestones.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { reportCronHealth } from "../_shared/cron-health.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

type DealProgress = {
  delivered_curator?: number | null;
  delivered_total?: number | null;
  progress_pct?: number | null;
  eta_days?: number | null;
  last_capture_at?: string | null;
};

async function reconcileDeal(supabase: any, deal: any) {
  // ÚNICA fonte de verdade: a mesma RPC que painel/CuratorPage consomem.
  const { data: progress, error: rpcErr } = await supabase.rpc(
    "get_curator_deal_progress",
    { p_deal_id: deal.id },
  );
  if (rpcErr) throw rpcErr;

  const p = (progress ?? {}) as DealProgress;
  const delivered = Number(p.delivered_curator ?? 0);
  const deliveredTotal = Number(p.delivered_total ?? 0);
  const progressPct = p.progress_pct != null ? Number(p.progress_pct) : null;
  const etaDays = p.eta_days != null ? Number(p.eta_days) : null;
  const latestCapturedAt = p.last_capture_at ?? null;

  // Atualiza somente os campos espelho. Sem cálculos próprios.
  const updatePayload: Record<string, unknown> = {
    reconciled_total_plays: delivered,
    last_reconciled_at: new Date().toISOString(),
  };
  // Campos opcionais — só seta se existirem na tabela. Postgres ignora colunas
  // inexistentes via PostgREST? Não — precisaríamos saber. Mantemos apenas
  // reconciled_total_plays/last_reconciled_at, que sabemos existir. Os demais
  // (progress_pct/eta_days/delivered_total) são derivados dinamicamente da RPC
  // e não precisam ser materializados.

  await supabase.from("curator_deals").update(updatePayload).eq("id", deal.id);

  // ===== FIX C: detecta baseline ausente e notifica =====
  {
    const { count } = await supabase
      .from("curator_deal_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", deal.id)
      .eq("is_baseline", true);
    if (!count || count === 0) {
      await supabase.rpc("notify_baseline_missing", { p_deal_id: deal.id });
    }
  }

  const milestone = await checkDealMilestones(supabase, deal, delivered);

  return {
    deal_id: deal.id,
    delivered,
    delivered_total: deliveredTotal,
    progress_pct: progressPct,
    eta_days: etaDays,
    latest_capture_at: latestCapturedAt,
    milestone,
  };
}

async function checkDealMilestones(
  supabase: any,
  deal: { id: string; song_name: string; curator_name: string; target_plays?: number; ends_at?: string | null },
  delivered: number,
): Promise<{ goal: boolean; overdue: boolean }> {
  const result = { goal: false, overdue: false };
  const target = Number(deal.target_plays ?? 0) || 0;

  if (target > 0 && delivered >= target) {
    const dedupe = `goal_reached:${deal.id}`;
    const { error } = await supabase.rpc("create_notification" as any, {
      p_type: "info",
      p_title: `Meta atingida — ${deal.song_name}`,
      p_message:
        `O curador ${deal.curator_name} completou a entrega: ` +
        `${delivered.toLocaleString("pt-BR")} de ${target.toLocaleString("pt-BR")} plays. ` +
        `Ação: nenhuma.`,
      p_action_url: `/playlist-deals?deal=${deal.id}`,
      p_metadata: {
        domain: "curator",
        severity: "info",
        kind: "goal_reached",
        deal_id: deal.id,
        delivered,
        target,
      },
      p_dedupe_key: dedupe,
      p_cooldown_minutes: 60 * 24 * 30, // 30 dias — meta só dispara 1x
    });
    if (!error) result.goal = true;
  }

  if (deal.ends_at) {
    const ends = new Date(deal.ends_at);
    if (ends < new Date() && delivered < target) {
      const remaining = Math.max(target - delivered, 0);
      const { error } = await supabase.rpc("create_notification" as any, {
        p_type: "warning",
        p_title: `Prazo vencido — ${deal.song_name}`,
        p_message:
          `O deal encerrou em ${ends.toLocaleDateString("pt-BR")} com ` +
          `${remaining.toLocaleString("pt-BR")} plays pendentes para a meta. ` +
          `Ação: revise o resultado no portal.`,
        p_action_url: `/playlist-deals?deal=${deal.id}`,
        p_metadata: {
          domain: "curator",
          severity: "medium",
          kind: "deal_overdue",
          deal_id: deal.id,
          delivered,
          target,
          ends_at: deal.ends_at,
        },
        p_dedupe_key: `deal_overdue:${deal.id}`,
        p_cooldown_minutes: 60 * 24 * 7,
      });
      if (!error) result.overdue = true;
    }
  }

  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startedAt = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  try {

    // Auth: aceita o CRON_SECRET vindo de DUAS fontes (env da função OU
    // vault.get_cron_secret() usado pelo pg_cron). Elas drifaram em produção
    // e o cron de 6h passou semanas batendo 401 — deals nunca eram
    // reconciliados. Validar contra as duas fontes elimina esse risco.
    const provided = req.headers.get("x-cron-secret");
    const envSecret = Deno.env.get("CRON_SECRET");
    let vaultSecret: string | null = null;
    try {
      const { data } = await supabase.rpc("get_cron_secret" as never);
      if (typeof data === "string") vaultSecret = data;
    } catch (_) { /* ignore — env fallback abaixo */ }
    const ok = !!provided && (
      (!!envSecret && provided === envSecret) ||
      (!!vaultSecret && provided === vaultSecret)
    );
    if (!ok) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", env_set: !!envSecret, vault_set: !!vaultSecret }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
    // Apenas deals ATIVOS (não encerrados). Campanhas com closed_at != null
    // ficam congeladas — o cron não toca mais nelas.
    const { data: deals, error } = await supabase
      .from("curator_deals")
      .select("id, user_id, song_name, curator_name, started_at, ends_at, target_plays, closed_at")
      .is("closed_at", null)
      .or(`ends_at.is.null,ends_at.gte.${cutoff}`);

    if (error) throw error;

    const results = [];
    for (const d of deals ?? []) {
      try {
        results.push(await reconcileDeal(supabase, d));
      } catch (err) {
        console.error("reconcile error", d.id, err);
        results.push({ deal_id: d.id, error: String(err) });
      }
    }

    console.log(`[cron-reconcile] ${results.length} deals processados via RPC get_curator_deal_progress`);

    const errCount = results.filter((r: any) => r.error).length;
    await reportCronHealth(supabase, {
      job_name: "cron-reconcile-curator-deals",
      status: errCount === 0 ? "ok" : (errCount === results.length ? "error" : "partial"),
      startedAt,
      metrics: { deals_processed: results.length, errors: errCount },
    });

    return new Response(
      JSON.stringify({ deals_processed: results.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("cron-reconcile error", err);
    await reportCronHealth(supabase, {
      job_name: "cron-reconcile-curator-deals",
      status: "error",
      startedAt,
      message: String(err),
    });
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
