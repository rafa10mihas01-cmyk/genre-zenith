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
  const procIds: string[] | null = Array.isArray(body.processing_correlation_ids)
    ? body.processing_correlation_ids.filter((x: unknown) => typeof x === "string")
    : null;
  if (procIds) meta.processing_correlation_ids = procIds;

  // Identidade do worker — header tem prioridade sobre body
  const workerId  = req.headers.get("x-worker-id")  || body.worker_id  || null;
  const processId = req.headers.get("x-process-id") || body.process_id || null;
  const hostname  = req.headers.get("x-hostname")   || body.hostname   || null;
  const timerId   = req.headers.get("x-timer-id")   || body.timer_id   || null;

  const { error } = await supabase.from("bot_heartbeats").insert({
    bot_name: body.bot_name ?? req.headers.get("x-bot-name") ?? "spotify-artists-bot",
    status: body.status ?? "online",
    spotify_session_valid: body.spotify_session_valid ?? true,
    message: body.message ?? null,
    metadata: meta,
    worker_id: workerId,
    process_id: processId,
    hostname: hostname,
    timer_id: timerId,
    processing_correlation_ids: procIds,
  });
  if (error) return jr({ error: error.message }, 500);

  // Se sessão inválida, dispara notificação + email (ambos 1x por hora)
  if (body.spotify_session_valid === false) {
    const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();

    // 1) Notificação in-app (throttle 1h)
    const { data: recent } = await supabase
      .from("notifications")
      .select("id")
      .eq("title", "Bot Spotify precisa reautenticar")
      .gte("created_at", oneHourAgo)
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

    // 2) Email para admin (throttle 1h via email_send_log)
    try {
      const { data: lastEmail } = await supabase
        .from("email_send_log")
        .select("id")
        .eq("template_name", "spotify-session-expired")
        .gte("created_at", oneHourAgo)
        .limit(1);

      if (!lastEmail?.length) {
        // Última coleta bem-sucedida (último heartbeat com last_collect_at preenchido,
        // ou o snapshot mais recente). Preferir bot_heartbeats.last_collect_at.
        const { data: lastHb } = await supabase
          .from("bot_heartbeats")
          .select("last_collect_at")
          .not("last_collect_at", "is", null)
          .order("last_collect_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const fmt = (iso: string | null | undefined) => {
          if (!iso) return null;
          try {
            return new Date(iso).toLocaleString("pt-BR", {
              timeZone: "America/Sao_Paulo",
              dateStyle: "short",
              timeStyle: "short",
            }) + " BRT";
          } catch { return iso; }
        };

        await supabase.functions.invoke("send-transactional-email", {
          body: {
            templateName: "spotify-session-expired",
            idempotencyKey: `spotify-session-expired-${Math.floor(Date.now() / 3600_000)}`,
            templateData: {
              detectedAt: fmt(new Date().toISOString()),
              lastSuccessfulCollectAt: fmt(lastHb?.last_collect_at) ?? "sem registro recente",
              panelUrl: "https://engine.nexcreatorx.com/sistema",
              botMessage: body.message ?? null,
            },
          },
        });
      }
    } catch (e) {
      console.error("Failed to enqueue spotify-session-expired email", e);
    }
  }
  return jr({ ok: true });
});
