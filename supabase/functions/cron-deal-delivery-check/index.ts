// cron-deal-delivery-check — roda 1x/dia. Compara entrega real vs planejada
// de cada curator_deal ativo e grava status em curator_deal_delivery_status.
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { reportCronHealth } from "../_shared/cron-health.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function dayIndex(startedAt: string): number {
  const start = new Date(startedAt).getTime();
  const now = Date.now();
  if (!Number.isFinite(start) || now < start) return 0;
  return Math.floor((now - start) / 86400000) + 1; // dia 1 = primeiro dia
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const t0 = Date.now();

  try {
    const { data: deals, error: dealsErr } = await admin
      .from("curator_deals")
      .select("id, started_at, baseline_plays, reconciled_total_plays, target_plays, state")
      .eq("state", "active");
    if (dealsErr) return jr({ ok: false, error: dealsErr.message }, 500);

    const results: any[] = [];

    for (const deal of deals ?? []) {
      if (!deal.started_at) continue;
      const dIdx = dayIndex(deal.started_at);
      if (dIdx <= 0) continue;

      // Plano
      const { data: planRows } = await admin
        .from("curator_deal_plan")
        .select("curator_playlist_id, playlist_name, cap_dia, daily")
        .eq("deal_id", deal.id);

      if (!planRows || planRows.length === 0) {
        results.push({ deal_id: deal.id, skipped: "sem_plano" });
        continue;
      }

      // Esperado até hoje (soma daily[0..dIdx-1] de todas playlists)
      let expected = 0;
      for (const r of planRows) {
        const daily = Array.isArray(r.daily) ? r.daily as number[] : [];
        for (let i = 0; i < Math.min(dIdx, daily.length); i++) {
          expected += Number(daily[i] ?? 0);
        }
      }

      // Real até hoje (do deal reconciliado)
      const baseline = Number(deal.baseline_plays ?? 0);
      const total = Number(deal.reconciled_total_plays ?? 0);
      const actual = Math.max(0, total - baseline);

      const deltaPct = expected > 0 ? (actual / expected) - 1 : 0;

      // Anti-spam: playlists com streams_7d > 2× cap_dia × 7 no último paste
      const { data: curatorPls } = await admin
        // Separação operacional × observacional: cron usa apenas curadoria entregue
        .from("v_curator_playlists_operational")
        .select("id, playlist_name, streams_7d")
        .eq("deal_id", deal.id);

      const capMap = new Map(planRows.map((r) => [r.curator_playlist_id, Number(r.cap_dia ?? 0)]));
      const spikes: Array<{ id: string; name: string; streams_7d: number; cap_dia: number }> = [];
      for (const cp of curatorPls ?? []) {
        const cap = capMap.get(cp.id) ?? 0;
        const s7 = Number(cp.streams_7d ?? 0);
        if (cap > 0 && s7 > cap * 7 * 2) {
          spikes.push({ id: cp.id, name: cp.playlist_name, streams_7d: s7, cap_dia: cap });
        }
      }

      let status = "on_track";
      let reason: string | null = null;
      if (spikes.length >= 3) {
        status = "spiking";
        reason = `${spikes.length} playlists acima de 2× do cap (possível anti-spam)`;
      } else if (deltaPct < -0.25) {
        status = "lagging";
        reason = `${Math.round(deltaPct * 100)}% abaixo do planejado`;
      } else if (deltaPct > 0.5) {
        status = "spiking";
        reason = `${Math.round(deltaPct * 100)}% acima do planejado`;
      }

      await admin.from("curator_deal_delivery_status").upsert({
        deal_id: deal.id,
        last_checked_at: new Date().toISOString(),
        expected_to_date: Math.round(expected),
        actual_to_date: actual,
        delta_pct: Number(deltaPct.toFixed(4)),
        status,
        reason,
        spike_playlist_ids: spikes,
        updated_at: new Date().toISOString(),
      });

      results.push({ deal_id: deal.id, status, expected, actual, delta_pct: deltaPct, spikes: spikes.length });
    }

    await reportCronHealth(admin, {
      job_name: "cron-deal-delivery-check",
      status: "ok",
      startedAt: t0,
      metrics: { processed: results.length },
      message: `processed=${results.length}`,
    });
    return jr({
      ok: true,
      processed: results.length,
      duration_ms: Date.now() - t0,
      results,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await reportCronHealth(admin, {
      job_name: "cron-deal-delivery-check",
      status: "error",
      startedAt: t0,
      message: msg,
    });
    return jr({ ok: false, error: msg }, 500);
  }
});
