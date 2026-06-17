import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { SNAPSHOT_TTL_POLICIES } from "../_shared/snapshot-ttl.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Aceita CRON_SECRET (rota cron) ou x-cron-secret. Se a env não estiver setada, segue.
  const incoming = req.headers.get("x-cron-secret");
  if (CRON_SECRET && incoming && incoming !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const results: Array<{ table: string; ts_column: string; days: number | null; deleted: number | null; error?: string }> = [];

  // Gap 13: curator_deal_snapshots — TTL 90d, preserva is_initial_capture=true e o snapshot mais recente por deal
  try {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data: latestRows } = await supabase
      .from("curator_deal_snapshots")
      .select("deal_id, id, captured_at")
      .order("captured_at", { ascending: false });
    const latestIdByDeal = new Map<string, string>();
    for (const r of (latestRows ?? []) as any[]) {
      if (!latestIdByDeal.has(r.deal_id)) latestIdByDeal.set(r.deal_id, r.id);
    }
    const keepIds = Array.from(latestIdByDeal.values());
    let q = supabase
      .from("curator_deal_snapshots")
      .delete({ count: "estimated" })
      .lt("captured_at", cutoff)
      .or("is_baseline.is.null,is_baseline.eq.false");
    if (keepIds.length) q = q.not("id", "in", `(${keepIds.join(",")})`);
    const { error: delErr, count } = await q;
    if (delErr) throw delErr;
    results.push({ table: "curator_deal_snapshots", ts_column: "captured_at", days: 90, deleted: count ?? 0 });
  } catch (err) {
    results.push({ table: "curator_deal_snapshots", ts_column: "captured_at", days: 90, deleted: null, error: (err as Error).message });
  }

  for (const p of SNAPSHOT_TTL_POLICIES) {
    if (p.days == null) {
      results.push({ table: p.table, ts_column: p.ts_column, days: null, deleted: 0 });
      continue;
    }
    const cutoff = new Date(Date.now() - p.days * 24 * 60 * 60 * 1000).toISOString();
    try {
      const { data, error } = await supabase
        .from(p.table)
        .delete({ count: "estimated" })
        .lt(p.ts_column, cutoff)
        .select("*", { count: "estimated", head: true });

      if (error) throw error;
      results.push({ table: p.table, ts_column: p.ts_column, days: p.days, deleted: (data as any)?.length ?? 0 });
    } catch (err) {
      results.push({
        table: p.table,
        ts_column: p.ts_column,
        days: p.days,
        deleted: null,
        error: (err as Error).message,
      });
    }
  }

  // Retenção de playlist_diagnoses: manter o registro mais recente + 5 históricos por playlist.
  // Fase 1.2 — política única, sem TTL por data (diagnose pode ser raro e ainda válido).
  try {
    const { data: rows, error: rowsErr } = await supabase
      .from("playlist_diagnoses")
      .select("id, playlist_id, created_at")
      .order("created_at", { ascending: false });
    if (rowsErr) throw rowsErr;

    const KEEP_PER_PLAYLIST = 6; // 1 atual + 5 históricos
    const counts = new Map<string, number>();
    const idsToDelete: string[] = [];
    for (const r of (rows ?? []) as Array<{ id: string; playlist_id: string }>) {
      const k = r.playlist_id;
      const n = (counts.get(k) ?? 0) + 1;
      counts.set(k, n);
      if (n > KEEP_PER_PLAYLIST) idsToDelete.push(r.id);
    }

    let deleted = 0;
    for (let i = 0; i < idsToDelete.length; i += 500) {
      const chunk = idsToDelete.slice(i, i + 500);
      const { error: delErr } = await supabase
        .from("playlist_diagnoses")
        .delete()
        .in("id", chunk);
      if (delErr) throw delErr;
      deleted += chunk.length;
    }
    results.push({ table: "playlist_diagnoses", ts_column: "created_at", days: null, deleted });
  } catch (err) {
    results.push({
      table: "playlist_diagnoses",
      ts_column: "created_at",
      days: null,
      deleted: null,
      error: (err as Error).message,
    });
  }

  return new Response(JSON.stringify({ ok: true, ran_at: new Date().toISOString(), results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
