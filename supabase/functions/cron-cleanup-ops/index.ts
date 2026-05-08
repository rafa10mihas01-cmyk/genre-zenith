// cron-cleanup-ops — TTLs em tabelas operacionais. Roda 1x/dia.
// Mantém: bot_heartbeats=30d, bot_events=14d, collection_logs=60d.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function cutoff(days: number) {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const results: Record<string, number | string> = {};

  const targets: Array<{ table: string; days: number }> = [
    { table: "bot_heartbeats", days: 30 },
    { table: "bot_events", days: 14 },
    { table: "collection_logs", days: 60 },
  ];

  for (const t of targets) {
    const { error, count } = await supabase
      .from(t.table)
      .delete({ count: "exact" })
      .lt("created_at", cutoff(t.days));
    results[t.table] = error ? `error: ${error.message}` : (count ?? 0);
  }

  await supabase.from("collection_logs").insert({
    acao: "cleanup_ops",
    status: "ok",
    mensagem: JSON.stringify(results),
  });

  return new Response(
    JSON.stringify({ ok: true, results, at: new Date().toISOString() }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
  );
});
