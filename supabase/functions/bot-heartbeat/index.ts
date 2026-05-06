// bot-heartbeat — Recebe ping do bot a cada N min com status da sessão Spotify.
// POST { status?, spotify_session_valid?, message?, metadata? }
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-bot-key, x-worker-id, x-process-id, x-hostname, x-timer-id, x-bot-name, x-bot-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_API_KEY = Deno.env.get("BOT_API_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ error: "method_not_allowed" }, 405);
  if (req.headers.get("x-bot-key") !== BOT_API_KEY) return jr({ error: "unauthorized" }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const meta = body.metadata ?? {};
  if (Array.isArray(body.processing_correlation_ids)) {
    meta.processing_correlation_ids = body.processing_correlation_ids;
  }
  const { error } = await supabase.from("bot_heartbeats").insert({
    bot_name: body.bot_name ?? "spotify-artists-bot",
    status: body.status ?? "online",
    spotify_session_valid: body.spotify_session_valid ?? true,
    message: body.message ?? null,
    metadata: meta,
  });
  if (error) return jr({ error: error.message }, 500);

  // Se sessão inválida, dispara notificação (1x por hora — checa último alerta)
  if (body.spotify_session_valid === false) {
    const { data: recent } = await supabase
      .from("notifications")
      .select("id")
      .eq("title", "Bot Spotify precisa reautenticar")
      .gte("created_at", new Date(Date.now() - 3600_000).toISOString())
      .limit(1);
    if (!recent?.length) {
      await supabase.rpc("create_notification", {
        p_type: "warning",
        p_title: "Bot Spotify precisa reautenticar",
        p_message: body.message ?? "Sessão expirada no servidor do bot.",
        p_action_url: "/playlist-deals",
        p_metadata: body.metadata ?? {},
      });
    }
  }
  return jr({ ok: true });
});
