// bot-heartbeat — Recebe ping do bot a cada N min com status da sessão Spotify.
// POST { status?, spotify_session_valid?, message?, metadata?, dom_snapshots?: DomItem[] }
//
// Fase 3.A.1 — heartbeat NÃO grava mais coleta. Responsabilidade exclusiva:
//   "o bot está vivo?". Pode atualizar `bot_heartbeats`, `vps_nodes` e
//   `collection_logs` (registro operacional). Se `dom_snapshots[]` vier no
//   payload, é DELEGADO ao Gateway Oficial (`bot-ingest-dom`) via HTTP
//   interno, preservando o piggyback documentado em
//   `docs/BOT_VPS_HEARTBEAT_DOM_PIGGYBACK.md` sem violar a regra de gateway
//   único.
import { createClient } from "npm:@supabase/supabase-js@2";
import { reportCronHealth } from "../_shared/cron-health.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-bot-key, x-worker-id, x-process-id, x-hostname, x-timer-id, x-bot-name, x-bot-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_API_KEY = Deno.env.get("BOT_API_KEY")!;
const BOT_INGEST_TOKEN = Deno.env.get("BOT_INGEST_TOKEN") ?? "";

function isAuthorizedBotKey(value: string | null) {
  const normalize = (v: string | null | undefined) => (v ?? "").trim().replace(/^Bearer\s+/i, "").replace(/^['\"]|['\"]$/g, "");
  const got = normalize(value);
  return Boolean(got) && (got === normalize(BOT_API_KEY) || got === normalize(BOT_INGEST_TOKEN));
}

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();
  if (req.method !== "POST") return jr({ error: "method_not_allowed" }, 405);
  const authKey = req.headers.get("x-bot-key") ?? req.headers.get("x-bot-token") ?? req.headers.get("authorization");
  if (!isAuthorizedBotKey(authKey)) return jr({ error: "unauthorized" }, 401);

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

  // Atualiza vps_nodes.last_heartbeat_at quando o hostname é conhecido
  if (hostname) {
    const { error: vpsErr } = await supabase
      .from("vps_nodes")
      .update({ last_heartbeat_at: new Date().toISOString(), status: "active" })
      .eq("hostname", hostname);
    if (vpsErr) console.error("vps_nodes update failed:", vpsErr);
  }

  // Piggyback: snapshots DOM enviados junto com o heartbeat são DELEGADOS
  // ao Gateway Oficial (`bot-ingest-dom`). O heartbeat não processa nem grava
  // coleta — apenas encaminha o lote, preservando autenticação, raw_ingest e
  // observabilidade centralizados no gateway (Fase 3.A.1).
  let domResults: any[] | undefined;
  const domSnapshots = Array.isArray(body.dom_snapshots) ? body.dom_snapshots : null;
  if (domSnapshots && domSnapshots.length > 0) {
    const correlationHeader = req.headers.get("x-correlation-id");
    const gatewayUrl = `${SUPABASE_URL}/functions/v1/bot-ingest-dom`;
    const gatewayKey = (BOT_API_KEY || BOT_INGEST_TOKEN || "").trim();
    try {
      const gwRes = await fetch(gatewayUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-bot-key": gatewayKey,
          ...(correlationHeader ? { "x-correlation-id": correlationHeader } : {}),
          ...(workerId ? { "x-worker-id": workerId } : {}),
          ...(hostname ? { "x-hostname": hostname } : {}),
        },
        body: JSON.stringify({ items: domSnapshots }),
      });
      const gwJson = await gwRes.json().catch(() => ({}));
      domResults = Array.isArray((gwJson as any)?.results) ? (gwJson as any).results : [];
      const inserted = Number((gwJson as any)?.inserted ?? 0);
      const skipped = Number((gwJson as any)?.skipped ?? 0);
      const errors = domResults.filter((r) => r && r.ok === false).length;
      await supabase.from("collection_logs").insert({
        acao: "bot_ingest_dom_delegated",
        status: errors > 0 || !gwRes.ok ? "parcial" : "ok",
        mensagem: `[via heartbeat→gateway] items=${domSnapshots.length} inserted=${inserted} skipped=${skipped} errors=${errors} http=${gwRes.status}`,
      });
    } catch (e) {
      domResults = [{ ok: false, error: (e as Error).message }];
      await supabase.from("collection_logs").insert({
        acao: "bot_ingest_dom_delegated",
        status: "erro",
        mensagem: `[via heartbeat→gateway] delegation failed: ${(e as Error).message}`,
      });
    }
  }

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
  // Health: amostragem temporal — registra no máximo 1x por 5 min por bot
  // pra evitar inundar (heartbeat chega a cada ~30s).
  // Sempre loga quando sessão inválida (importante pra timeline de incidentes).
  const sessionInvalid = body.spotify_session_valid === false;
  const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
  const botName = body.bot_name ?? req.headers.get("x-bot-name") ?? "spotify-artists-bot";
  let shouldLog = sessionInvalid || (domSnapshots && domSnapshots.length > 0);
  if (!shouldLog) {
    const { count } = await supabase
      .from("cron_health")
      .select("id", { count: "exact", head: true })
      .eq("job_name", "bot-heartbeat")
      .gte("ran_at", fiveMinAgo);
    shouldLog = (count ?? 0) === 0;
  }
  if (shouldLog) {
    await reportCronHealth(supabase, {
      job_name: "bot-heartbeat",
      status: sessionInvalid ? "error" : "ok",
      startedAt,
      metrics: {
        bot_name: botName,
        spotify_session_valid: body.spotify_session_valid ?? true,
        dom_snapshots: domSnapshots?.length ?? 0,
        hostname,
      },
      message: sessionInvalid
        ? `session_invalid · ${body.message ?? ""}`.slice(0, 200)
        : `online · dom=${domSnapshots?.length ?? 0}`,
    });
  }

  return jr({ ok: true, dom_results: domResults });
});
