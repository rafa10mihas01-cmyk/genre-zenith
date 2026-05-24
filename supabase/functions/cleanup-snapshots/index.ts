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

  return new Response(JSON.stringify({ ok: true, ran_at: new Date().toISOString(), results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
