// Recebe eventos granulares do bot da VPS (cada passo do robô).
// Autentica via header x-bot-token (segredo BOT_INGEST_TOKEN).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-bot-key, x-bot-token, x-worker-id, x-process-id, x-hostname, x-timer-id, x-bot-name, x-bot-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BOT_INGEST_TOKEN = Deno.env.get("BOT_INGEST_TOKEN") ?? "";
const BOT_API_KEY = Deno.env.get("BOT_API_KEY") ?? "";

function isAuthorizedBot(req: Request): boolean {
  const candidates = [
    req.headers.get("x-bot-token"),
    req.headers.get("x-bot-key"),
    (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""),
  ].map((v) => (v ?? "").trim()).filter(Boolean);
  const allowed = [BOT_INGEST_TOKEN, BOT_API_KEY].filter(Boolean);
  return candidates.some((c) => allowed.includes(c));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!isAuthorizedBot(req)) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const events = Array.isArray(body) ? body : [body];

    // Headers de identidade do worker — fallback se evento não trouxer no payload.
    const hWorker  = req.headers.get("x-worker-id");
    const hProcess = req.headers.get("x-process-id");
    const hHost    = req.headers.get("x-hostname");
    const hTimer   = req.headers.get("x-timer-id");
    const hBotName = req.headers.get("x-bot-name");
    const hSession = req.headers.get("x-bot-session");

    const ALLOWED_STATES = new Set([
      "FETCHED","ACCEPTED","QUEUED_LOCAL","STARTED",
      "PRINT_UPLOADED","SNAPSHOT_SENT","FINISHED","FAILED","DISCARDED"
    ]);
    const TERMINAL_NEEDS_REASON = new Set(["FAILED","DISCARDED"]);

    const rejected: any[] = [];
    const rows = events.map((e: any) => {
      const lc = e.lifecycle_state ? String(e.lifecycle_state).toUpperCase() : null;
      const validLc = lc && ALLOWED_STATES.has(lc) ? lc : null;
      const reason = e.discard_reason ?? e.reason ?? null;
      // PROIBIDO silent discard: terminal states sem reason vão para metadata.warning
      // (não rejeitamos o insert para não perder o evento, mas marcamos)
      const warn = validLc && TERMINAL_NEEDS_REASON.has(validLc) && !reason
        ? "missing_reason_for_terminal_state"
        : null;
      if (warn) rejected.push({ correlation_id: e.correlation_id, lifecycle_state: validLc, warn });
      return {
        bot_name: e.bot_name ?? hBotName ?? "spotify-artists-bot",
        session_id: e.session_id ?? hSession ?? null,
        deal_id: e.deal_id ?? null,
        song_id: e.song_id ?? null,
        step: String(e.step ?? "unknown"),
        status: e.status ?? "running",
        message: e.message ?? null,
        screenshot_url: e.screenshot_url ?? null,
        url: e.url ?? null,
        duration_ms: e.duration_ms ?? null,
        metadata: { ...(e.metadata ?? {}), ...(warn ? { warn } : {}) },
        correlation_id: e.correlation_id ?? null,
        lifecycle_state: validLc,
        discard_reason: reason,
        worker_id: e.worker_id ?? hWorker ?? null,
        process_id: e.process_id ?? hProcess ?? null,
        hostname: e.hostname ?? hHost ?? null,
        timer_id: e.timer_id ?? hTimer ?? null,
      };
    });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { error } = await supabase.from("bot_events").insert(rows);
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true, inserted: rows.length, warnings: rejected }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? "unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
