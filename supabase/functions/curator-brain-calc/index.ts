// curator-brain-calc — perfil vivo de cada curador.
// Lê curators, curator_deals, curator_purchases, curator_playlists,
// curator_deal_snapshots, curator_fraud_alerts → materializa em curator_brain.
//
// Modos:
//  - { curator_id: "uuid" } → calcula 1
//  - { batch: true }        → calcula TODOS curadores (não arquivados)
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTeamAccess } from "../_shared/auth.ts";
import { reportCronHealth } from "../_shared/cron-health.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CALC_VERSION = 1;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Signal = { code: string; severity: "low" | "medium" | "high"; message: string; detected_at: string };
type Recommendation = { priority: number; action: string; reason: string };

function p90(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.floor(s.length * 0.9);
  return s[Math.min(idx, s.length - 1)];
}

async function calcOne(supabase: any, curatorId: string) {
  const { data: cur, error: cErr } = await supabase
    .from("curators")
    .select("id, name, deal_type, monthly_amount, default_plays, default_amount, purchased_plays, total_cost, archived_at, paused_at, created_at, spotify_owner_id, spotify_owner_url")
    .eq("id", curatorId)
    .maybeSingle();
  if (cErr || !cur) throw new Error(`curator ${curatorId} não encontrado`);

  const [{ data: deals }, { data: purchases }, { data: alerts }, { data: cps }] = await Promise.all([
    supabase
      .from("curator_deals")
      .select("id, target_plays, baseline_plays, reconciled_total_plays, ramp_up_days, started_at, ends_at, closed_at, closed_status, state, cost, billing_model, monthly_amount")
      .eq("curator_id", curatorId)
      .order("started_at", { ascending: false }),
    supabase
      .from("curator_purchases")
      .select("plays_purchased, amount, cpp, purchased_at")
      .eq("curator_id", curatorId)
      .order("purchased_at", { ascending: false }),
    supabase
      .from("curator_fraud_alerts")
      .select("id, severity, status, alert_type, created_at")
      .in("deal_id",
        ((await supabase.from("curator_deals").select("id").eq("curator_id", curatorId)).data ?? []).map((d: any) => d.id),
      ),
    supabase
      .from("v_curator_playlists_operational")
      .select("spotify_playlist_id, followers")
      .in("deal_id",
        ((await supabase.from("curator_deals").select("id").eq("curator_id", curatorId)).data ?? []).map((d: any) => d.id),
      ),
  ]);

  const dealsArr = deals ?? [];
  const purchasesArr = purchases ?? [];
  const alertsArr = alerts ?? [];
  const cpsArr = cps ?? [];

  const now = Date.now();

  // ===== identity =====
  const uniquePlaylists = new Set(cpsArr.map((c: any) => c.spotify_playlist_id).filter(Boolean));
  const totalFollowers = Array.from(
    cpsArr.reduce((m: Map<string, number>, c: any) => {
      if (c.spotify_playlist_id && !m.has(c.spotify_playlist_id)) m.set(c.spotify_playlist_id, Number(c.followers ?? 0));
      return m;
    }, new Map()).values(),
  ).reduce((a, b) => a + b, 0);

  const identity = {
    nome: cur.name,
    deal_type: cur.deal_type,
    spotify_owner_id: cur.spotify_owner_id,
    playlists_count: uniquePlaylists.size,
    total_followers_alcance: totalFollowers,
    age_days: Math.floor((now - new Date(cur.created_at).getTime()) / (1000 * 60 * 60 * 24)),
  };

  // ===== reliability =====
  const closedDeals = dealsArr.filter((d: any) => d.closed_at);
  const successfulDeals = closedDeals.filter((d: any) => d.closed_status === "completed" || d.closed_status === "success");
  const failedDeals = closedDeals.filter((d: any) => d.closed_status === "failed" || d.closed_status === "canceled");

  const deliveryRates: number[] = [];
  const onTimeFlags: boolean[] = [];
  const playsPerDeal: number[] = [];

  for (const d of dealsArr) {
    const target = Number(d.target_plays ?? 0);
    const baseline = Number(d.baseline_plays ?? 0);
    const reconciled = Number(d.reconciled_total_plays ?? 0);
    const delivered = Math.max(0, reconciled - baseline);
    if (target > 0) {
      deliveryRates.push((delivered / target) * 100);
      playsPerDeal.push(delivered);
    }
    if (d.closed_at && d.ends_at) {
      onTimeFlags.push(new Date(d.closed_at).getTime() <= new Date(d.ends_at).getTime() + 24 * 60 * 60 * 1000);
    }
  }

  const avgDelivery = deliveryRates.length
    ? Math.round(deliveryRates.reduce((a, b) => a + b, 0) / deliveryRates.length)
    : null;
  const onTimeRate = onTimeFlags.length
    ? Math.round((onTimeFlags.filter(Boolean).length / onTimeFlags.length) * 100)
    : null;

  const reliability = {
    total_deals: dealsArr.length,
    closed_deals: closedDeals.length,
    successful: successfulDeals.length,
    failed: failedDeals.length,
    avg_delivery_pct: avgDelivery,
    on_time_pct: onTimeRate,
    open_deals: dealsArr.filter((d: any) => !d.closed_at).length,
  };

  // ===== economics =====
  const totalInvested = purchasesArr.reduce((a: number, p: any) => a + Number(p.amount ?? 0), 0);
  const totalPaidPlays = purchasesArr.reduce((a: number, p: any) => a + Number(p.plays_purchased ?? 0), 0);
  const totalDelivered = playsPerDeal.reduce((a, b) => a + b, 0);
  const avgCPP = totalDelivered > 0 ? totalInvested / totalDelivered : null;
  const roiScore = avgCPP !== null && avgCPP > 0
    ? Math.max(0, Math.min(100, Math.round(100 - Math.min(100, avgCPP * 100))))
    : null;

  const economics = {
    total_invested: Math.round(totalInvested * 100) / 100,
    total_paid_plays: totalPaidPlays,
    total_delivered_plays: totalDelivered,
    avg_cpp: avgCPP !== null ? Math.round(avgCPP * 10000) / 10000 : null,
    last_purchase_at: purchasesArr[0]?.purchased_at ?? null,
  };

  // ===== risk =====
  const openAlerts = alertsArr.filter((a: any) => a.status === "open");
  const highAlerts = openAlerts.filter((a: any) => a.severity === "high" || a.severity === "critical");
  const risk = {
    open_alerts: openAlerts.length,
    high_alerts: highAlerts.length,
    last_alert_at: alertsArr[0]?.created_at ?? null,
  };

  // ===== capacity =====
  const capacityAvg = playsPerDeal.length
    ? Math.round(playsPerDeal.reduce((a, b) => a + b, 0) / playsPerDeal.length)
    : null;
  const capacityP90 = p90(playsPerDeal);

  // ===== trust_score (0-100) =====
  let trust = 50;
  if (avgDelivery !== null) trust += Math.round((avgDelivery - 100) * 0.2);
  if (onTimeRate !== null) trust += Math.round((onTimeRate - 50) * 0.3);
  if (highAlerts.length > 0) trust -= 25 * highAlerts.length;
  if (openAlerts.length > 0) trust -= 5 * openAlerts.length;
  if (closedDeals.length === 0) trust = Math.min(trust, 40);
  if (failedDeals.length > 0) trust -= 10 * failedDeals.length;
  trust = Math.max(0, Math.min(100, trust));

  // ===== signals =====
  const sigDate = new Date().toISOString();
  const signals: Signal[] = [];

  if (dealsArr.length === 0) {
    signals.push({ code: "sem_historico", severity: "high", message: "Curador nunca rodou um deal", detected_at: sigDate });
  } else if (closedDeals.length === 0) {
    signals.push({ code: "sem_deal_fechado", severity: "medium", message: "Sem deal fechado — confiabilidade indeterminada", detected_at: sigDate });
  }
  if (avgDelivery !== null && avgDelivery < 70) {
    signals.push({ code: "entrega_baixa", severity: "high", message: `Entrega média ${avgDelivery}% do alvo`, detected_at: sigDate });
  } else if (avgDelivery !== null && avgDelivery >= 110) {
    signals.push({ code: "supera_meta", severity: "low", message: `Entrega média ${avgDelivery}% do alvo`, detected_at: sigDate });
  }
  if (onTimeRate !== null && onTimeRate < 60) {
    signals.push({ code: "atrasa_muito", severity: "medium", message: `Só ${onTimeRate}% dos deals fecharam no prazo`, detected_at: sigDate });
  }
  if (highAlerts.length > 0) {
    signals.push({ code: "fraude_alta", severity: "high", message: `${highAlerts.length} alerta(s) de fraude grave em aberto`, detected_at: sigDate });
  }
  if (failedDeals.length > 0 && failedDeals.length / Math.max(closedDeals.length, 1) > 0.3) {
    signals.push({ code: "muitos_falhos", severity: "high", message: `${failedDeals.length} de ${closedDeals.length} deals falharam`, detected_at: sigDate });
  }
  if (avgCPP !== null && avgCPP > 0.05) {
    signals.push({ code: "cpp_alto", severity: "medium", message: `CPP ${avgCPP.toFixed(4)} acima de R$ 0,05`, detected_at: sigDate });
  }
  if (uniquePlaylists.size === 0) {
    signals.push({ code: "sem_playlists_mapeadas", severity: "medium", message: "Nenhuma playlist registrada nos deals", detected_at: sigDate });
  }
  if (cur.paused_at) {
    signals.push({ code: "pausado", severity: "low", message: "Curador atualmente pausado", detected_at: sigDate });
  }

  // ===== recommendations =====
  const recommendations: Recommendation[] = [];
  if (signals.find(s => s.code === "fraude_alta")) {
    recommendations.push({ priority: 1, action: "Revisar alertas de fraude antes de novo deal", reason: "Risco operacional alto" });
  }
  if (signals.find(s => s.code === "entrega_baixa")) {
    recommendations.push({ priority: 1, action: "Renegociar target ou pausar curador", reason: "Entrega histórica abaixo de 70%" });
  }
  if (signals.find(s => s.code === "muitos_falhos")) {
    recommendations.push({ priority: 1, action: "Suspender curador para auditoria", reason: "Taxa de falha acima de 30%" });
  }
  if (signals.find(s => s.code === "atrasa_muito")) {
    recommendations.push({ priority: 2, action: "Adicionar buffer de prazo nos próximos deals", reason: "Histórico de atraso recorrente" });
  }
  if (signals.find(s => s.code === "cpp_alto")) {
    recommendations.push({ priority: 2, action: "Negociar custo por play menor", reason: "CPP acima da média de mercado" });
  }
  if (signals.find(s => s.code === "supera_meta")) {
    recommendations.push({ priority: 3, action: "Aumentar target nos próximos deals", reason: "Curador entrega consistentemente acima do alvo" });
  }
  if (signals.find(s => s.code === "sem_deal_fechado")) {
    recommendations.push({ priority: 3, action: "Acompanhar deals abertos para fechar ciclo", reason: "Sem dado de entrega final ainda" });
  }
  if (signals.find(s => s.code === "sem_playlists_mapeadas")) {
    recommendations.push({ priority: 3, action: "Pedir lista de playlists ao curador no próximo deal", reason: "Sem mapeamento de alcance real" });
  }
  recommendations.sort((a, b) => a.priority - b.priority);

  // ===== confidence =====
  let confidence = 0;
  if (dealsArr.length > 0) confidence += 20;
  if (closedDeals.length >= 1) confidence += 20;
  if (closedDeals.length >= 3) confidence += 10;
  if (avgDelivery !== null) confidence += 15;
  if (onTimeRate !== null) confidence += 10;
  if (purchasesArr.length > 0) confidence += 10;
  if (uniquePlaylists.size > 0) confidence += 10;
  if (alertsArr.length === 0 && dealsArr.length > 0) confidence += 5;
  confidence = Math.min(100, confidence);

  // ===== upsert =====
  const payload = {
    curator_id: cur.id,
    identity,
    reliability,
    economics,
    risk,
    capacity_avg_per_deal: capacityAvg,
    capacity_p90: capacityP90,
    delivery_rate_pct: avgDelivery,
    on_time_rate_pct: onTimeRate,
    avg_cpp: avgCPP,
    roi_score: roiScore,
    trust_score: trust,
    signals,
    recommendations,
    confidence_score: confidence,
    last_calculated_at: new Date().toISOString(),
    calculation_version: CALC_VERSION,
    metadata: {
      computed_from_deals: dealsArr.length,
      computed_from_purchases: purchasesArr.length,
      computed_from_alerts: alertsArr.length,
    },
  };

  const { error: upErr } = await supabase
    .from("curator_brain")
    .upsert(payload, { onConflict: "curator_id" });
  if (upErr) throw new Error(`upsert curator_brain: ${upErr.message}`);

  await supabase.from("curator_brain_history").insert({
    curator_id: cur.id,
    trust_score: trust,
    delivery_rate_pct: avgDelivery,
    on_time_rate_pct: onTimeRate,
    avg_cpp: avgCPP,
    capacity_avg_per_deal: capacityAvg,
    signals_count: signals.length,
    confidence_score: confidence,
  });

  return {
    curator_id: cur.id,
    name: cur.name,
    trust_score: trust,
    confidence_score: confidence,
    signals_count: signals.length,
    recommendations_count: recommendations.length,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const guard = await requireTeamAccess(req);
  if (!guard.ok) return guard.resp;

  try {
    const body = await req.json().catch(() => ({}));
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    if (body?.curator_id) {
      const result = await calcOne(supabase, body.curator_id);
      return jr({ ok: true, mode: "single", result });
    }

    if (body?.batch === true) {
      const startedAt = Date.now();
      const { data: list, error } = await supabase
        .from("curators")
        .select("id")
        .is("archived_at", null);
      if (error) throw new Error(error.message);
      const subset = (list ?? []).slice(0, body?.limit ?? 200);

      const results: any[] = [];
      const errors: any[] = [];
      const CONCURRENCY = 6;
      for (let i = 0; i < subset.length; i += CONCURRENCY) {
        const chunk = subset.slice(i, i + CONCURRENCY);
        const settled = await Promise.allSettled(chunk.map((c) => calcOne(supabase, c.id)));
        settled.forEach((s, idx) => {
          if (s.status === "fulfilled") results.push(s.value);
          else errors.push({ curator_id: chunk[idx].id, error: s.reason?.message ?? String(s.reason) });
        });
      }
      await reportCronHealth(supabase, {
        job_name: "curator-brain-calc",
        status: errors.length === 0 ? "ok" : (results.length === 0 ? "error" : "partial"),
        startedAt,
        metrics: { processed: results.length, errors: errors.length, total: subset.length },
      });
      return jr({
        ok: true, mode: "batch", processed: results.length,
        errors_count: errors.length, errors: errors.slice(0, 10),
      });
    }

    return jr({ ok: false, error: "informe curator_id ou batch:true" }, 400);
  } catch (e) {
    return jr({ ok: false, error: (e as Error).message }, 500);
  }
});
