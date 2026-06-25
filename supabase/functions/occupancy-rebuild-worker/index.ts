// FASE 4 — Worker do Playlist Occupancy Engine (SHADOW)
// Drena a fila `occupancy_rebuild_queue` chamando fn_process_occupancy_rebuild_queue.
// Nenhuma alteração é enviada ao Spotify. Apenas gera planos SHADOW.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let limit = 25;
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    if (typeof body?.limit === "number") limit = Math.max(1, Math.min(200, body.limit));
  } catch (_) { /* noop */ }

  const t0 = Date.now();
  const { data, error } = await supabase.rpc("fn_process_occupancy_rebuild_queue", { p_limit: limit });

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rows = Array.isArray(data) ? data : [];
  const summary = {
    processed: rows.length,
    done: rows.filter((r: any) => r.status === "done").length,
    no_change: rows.filter((r: any) => r.status === "no_change").length,
    blocked: rows.filter((r: any) => r.status === "skipped_lock").length,
    errors: rows.filter((r: any) => r.status === "error").length,
    duration_ms: Date.now() - t0,
    mode: "SHADOW",
  };

  return new Response(JSON.stringify({ ok: true, ...summary, items: rows }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
