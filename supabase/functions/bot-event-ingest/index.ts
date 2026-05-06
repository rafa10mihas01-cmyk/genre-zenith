// Recebe eventos granulares do bot da VPS (cada passo do robô).
// Autentica via header x-bot-token (segredo BOT_INGEST_TOKEN).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-bot-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const expected = Deno.env.get("BOT_INGEST_TOKEN");
    const got = req.headers.get("x-bot-token");
    if (!expected || got !== expected) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const events = Array.isArray(body) ? body : [body];

    const ALLOWED_STATES = new Set([
      "FETCHED","ACCEPTED","QUEUED_LOCAL","STARTED",
      "PRINT_UPLOADED","SNAPSHOT_SENT","FINISHED","FAILED","DISCARDED"
    ]);

    const rows = events.map((e: any) => {
      const lc = e.lifecycle_state ? String(e.lifecycle_state).toUpperCase() : null;
      return {
        bot_name: e.bot_name ?? "spotify-artists-bot",
        session_id: e.session_id ?? null,
        deal_id: e.deal_id ?? null,
        song_id: e.song_id ?? null,
        step: String(e.step ?? "unknown"),
        status: e.status ?? "running",
        message: e.message ?? null,
        screenshot_url: e.screenshot_url ?? null,
        url: e.url ?? null,
        duration_ms: e.duration_ms ?? null,
        metadata: e.metadata ?? {},
        correlation_id: e.correlation_id ?? null,
        lifecycle_state: lc && ALLOWED_STATES.has(lc) ? lc : null,
        discard_reason: e.discard_reason ?? null,
      };
    });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { error } = await supabase.from("bot_events").insert(rows);
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true, inserted: rows.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? "unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
