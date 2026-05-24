// curator-deal-followup
// Detecta deals ativos há mais de 3 dias sem novo snapshot e notifica o curador
// no portal dele. Roda diariamente às 08:00 UTC.
//
// Regras:
// - Deal "ativo": closed_at IS NULL
// - Iniciado há mais de 3 dias (started_at < now() - 3d)
// - Sem snapshot nas últimas 72h (ou nunca teve snapshot pós-baseline)
// - Dedup: não notifica se já existe notificação do mesmo type pro mesmo deal nas últimas 24h
import { createClient } from "npm:@supabase/supabase-js@2";
import { reportCronHealth } from "../_shared/cron-health.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const NOTIF_TYPE = "warning"; // notification_type enum: critical | warning | info
const NOTIF_TITLE = "Deal aguardando movimentação";
const NOTIF_MESSAGE =
  "Seu deal está aguardando movimentação — acesse o portal para verificar.";
const NOTIF_KIND = "deal_stale_no_snapshot"; // tag em metadata.kind pra dedup

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startedAt = Date.now();
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)
      .toISOString();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      .toISOString();

    // 1) Deals ativos iniciados há mais de 3 dias
    const { data: deals, error: dErr } = await sb
      .from("curator_deals")
      .select("id, curator_id, public_token, song_name, started_at")
      .is("closed_at", null)
      .not("curator_id", "is", null)
      .not("public_token", "is", null)
      .lt("started_at", threeDaysAgo);

    if (dErr) throw dErr;

    const candidates = deals ?? [];
    let notified = 0;
    let skippedRecentSnapshot = 0;
    let skippedAlreadyNotified = 0;
    let skippedNoUser = 0;
    let failed = 0;

    for (const deal of candidates) {
      // 2) Tem snapshot (não-baseline) nas últimas 72h?
      const { count: snapCount, error: sErr } = await sb
        .from("curator_deal_snapshots")
        .select("id", { count: "exact", head: true })
        .eq("deal_id", deal.id)
        .eq("is_baseline", false)
        .gte("captured_at", threeDaysAgo);

      if (sErr) {
        failed++;
        continue;
      }
      if ((snapCount ?? 0) > 0) {
        skippedRecentSnapshot++;
        continue;
      }

      // 3) Resolve user_id do curador
      const { data: curator } = await sb
        .from("curators")
        .select("user_id")
        .eq("id", deal.curator_id)
        .maybeSingle();

      if (!curator?.user_id) {
        skippedNoUser++;
        continue;
      }

      // 4) Dedup: já notificou nas últimas 24h?
      const { count: recentNotif } = await sb
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", curator.user_id)
        .gte("created_at", oneDayAgo)
        .contains("metadata", { kind: NOTIF_KIND, deal_id: deal.id });

      if ((recentNotif ?? 0) > 0) {
        skippedAlreadyNotified++;
        continue;
      }

      // 5) Insere notificação
      const { error: nErr } = await sb.from("notifications").insert({
        user_id: curator.user_id,
        type: NOTIF_TYPE,
        title: NOTIF_TITLE,
        message: NOTIF_MESSAGE,
        action_url: `/curador/${deal.public_token}`,
        read: false,
        metadata: {
          kind: NOTIF_KIND,
          deal_id: deal.id,
          song_name: deal.song_name,
          started_at: deal.started_at,
        },
      });

      if (nErr) {
        failed++;
      } else {
        notified++;
      }
    }

    const metrics = {
      candidates: candidates.length,
      notified,
      skipped_recent_snapshot: skippedRecentSnapshot,
      skipped_already_notified: skippedAlreadyNotified,
      skipped_no_user: skippedNoUser,
      failed,
    };

    await reportCronHealth(sb, {
      job_name: "curator-deal-followup",
      status: failed > 0 && notified === 0 ? "error"
        : failed > 0
        ? "partial"
        : "ok",
      startedAt,
      metrics,
      message: `candidates=${candidates.length} notified=${notified} failed=${failed}`,
    });

    return new Response(JSON.stringify({ ok: true, ...metrics }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    console.error("[curator-deal-followup] fatal:", msg);
    await reportCronHealth(sb, {
      job_name: "curator-deal-followup",
      status: "error",
      startedAt,
      message: msg,
    });
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
