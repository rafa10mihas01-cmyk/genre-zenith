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
        .eq("is_initial_capture", false)
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

      // 4) Insere via RPC com dedupe nativo (1 alerta por deal por 24h)
      const dedupe = `deal_stale:${deal.id}`;
      const songName = deal.song_name ?? "deal";
      const { error: nErr } = await sb.rpc("create_notification" as any, {
        p_type: NOTIF_TYPE,
        p_title: NOTIF_TITLE,
        p_message:
          `O deal "${songName}" está há mais de 3 dias sem nova entrega registrada. ` +
          `Ação: acesse o portal e atualize o progresso.`,
        p_action_url: `/curador/${deal.public_token}`,
        p_metadata: {
          domain: "curator",
          severity: "medium",
          kind: NOTIF_KIND,
          action_required: true,
          user_id: curator.user_id,
          deal_id: deal.id,
          song_name: deal.song_name,
          started_at: deal.started_at,
        },
        p_dedupe_key: dedupe,
        p_cooldown_minutes: 60 * 24,
      });

      if (nErr) {
        failed++;
      } else {
        notified++;
      }
    }

    // ============================================================
    // PASSO 2: Lembretes de prazo (D-5, D-3, D-1, vencido)
    // Para todo deal ativo com ends_at, cria notificação no sino do
    // curador em milestones de prazo. Dedup por (kind + deal_id) — uma
    // notificação por milestone, sem repetição.
    // ============================================================
    const DAY_MS = 24 * 60 * 60 * 1000;
    type DeadlineKind =
      | "deadline_d_minus_5"
      | "deadline_d_minus_3"
      | "deadline_d_minus_1"
      | "deadline_overdue";
    type DeadlineSpec = { kind: DeadlineKind; title: string; message: (song: string, ends: Date) => string; type: "info" | "warning" | "critical" };
    const SPECS: Record<DeadlineKind, DeadlineSpec> = {
      deadline_d_minus_5: {
        kind: "deadline_d_minus_5",
        title: "Lembrete de entrega",
        type: "info",
        message: (song, ends) =>
          `Faltam 5 dias para o prazo de "${song}" (até ${ends.toLocaleDateString("pt-BR")}). Mantenha o ritmo de envios.`,
      },
      deadline_d_minus_3: {
        kind: "deadline_d_minus_3",
        title: "Prazo se aproximando",
        type: "warning",
        message: (song, ends) =>
          `Faltam 3 dias para o prazo de "${song}" (até ${ends.toLocaleDateString("pt-BR")}). Acompanhe o progresso no portal.`,
      },
      deadline_d_minus_1: {
        kind: "deadline_d_minus_1",
        title: "Prazo vencido amanhã",
        type: "warning",
        message: (song, ends) =>
          `"${song}" encerra amanhã (${ends.toLocaleDateString("pt-BR")}). Última chance de subir entregas dentro do prazo.`,
      },
      deadline_overdue: {
        kind: "deadline_overdue",
        title: "Deal encerrado",
        type: "critical",
        message: (song, ends) =>
          `O prazo de "${song}" venceu em ${ends.toLocaleDateString("pt-BR")}. Acesse o portal para ver o resultado final.`,
      },
    };

    let deadlineNotified = 0;
    let deadlineSkipped = 0;

    const { data: dealsWithEnd } = await sb
      .from("curator_deals")
      .select("id, curator_id, public_token, song_name, ends_at")
      .is("closed_at", null)
      .not("curator_id", "is", null)
      .not("public_token", "is", null)
      .not("ends_at", "is", null);

    for (const deal of dealsWithEnd ?? []) {
      if (!deal.ends_at) continue;
      const ends = new Date(deal.ends_at);
      const diffDays = Math.ceil((ends.getTime() - now.getTime()) / DAY_MS);

      let spec: DeadlineSpec | null = null;
      if (diffDays < 0) spec = SPECS.deadline_overdue;
      else if (diffDays === 1) spec = SPECS.deadline_d_minus_1;
      else if (diffDays === 3) spec = SPECS.deadline_d_minus_3;
      else if (diffDays === 5) spec = SPECS.deadline_d_minus_5;
      if (!spec) continue;

      // user_id do curador
      const { data: curator } = await sb
        .from("curators")
        .select("user_id")
        .eq("id", deal.curator_id)
        .maybeSingle();
      if (!curator?.user_id) {
        deadlineSkipped++;
        continue;
      }

      // Dedup nativo: 1 alerta por (kind+deal) — RPC ignora repetições.
      const dedupe = `${spec.kind}:${deal.id}`;
      const { error: insErr } = await sb.rpc("create_notification" as any, {
        p_type: spec.type,
        p_title: spec.title,
        p_message: spec.message(deal.song_name ?? "deal", ends),
        p_action_url: `/curador/${deal.public_token}`,
        p_metadata: {
          domain: "curator",
          severity: spec.type === "critical" ? "high" : spec.type === "warning" ? "medium" : "info",
          kind: spec.kind,
          action_required: spec.type !== "info",
          user_id: curator.user_id,
          deal_id: deal.id,
          song_name: deal.song_name,
          ends_at: deal.ends_at,
          days_to_deadline: diffDays,
        },
        p_dedupe_key: dedupe,
        p_cooldown_minutes: 60 * 24 * 30,
      });
      if (insErr) failed++;
      else deadlineNotified++;
    }

    const metrics = {
      candidates: candidates.length,
      notified,
      skipped_recent_snapshot: skippedRecentSnapshot,
      skipped_already_notified: skippedAlreadyNotified,
      skipped_no_user: skippedNoUser,
      failed,
      deadline_notified: deadlineNotified,
      deadline_skipped: deadlineSkipped,
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
