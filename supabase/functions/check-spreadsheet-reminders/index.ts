// check-spreadsheet-reminders
// Rodado por cron diário. Pra cada deal ativo SEM Spotify conectado e SEM
// upload de planilha nas últimas 48h, dispara email lembrete pro cliente
// + cria notificação interna pra equipe. Idempotente por dia.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { reportCronHealth } from "../_shared/cron-health.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const PORTAL_BASE = "https://engine.nexcreatorx.com/campanha";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    const today = new Date().toISOString().slice(0, 10);
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    // Deals ativos sem spotify
    const { data: deals, error } = await admin
      .from("curator_deals")
      .select("id, song_name, song_artist, client_token, started_at, closed_at, spotify_owner_id")
      .is("closed_at", null)
      .is("spotify_owner_id", null);
    if (error) return jr({ ok: false, error: error.message }, 200);

    const results: Array<{ deal_id: string; action: string; reason?: string }> = [];

    for (const d of deals ?? []) {
      // último upload
      const { data: lastUpload } = await admin
        .from("label_spreadsheet_uploads")
        .select("created_at")
        .eq("deal_id", d.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastUpload && lastUpload.created_at > cutoff) {
        results.push({ deal_id: d.id, action: "skip", reason: "updated_recently" });
        continue;
      }

      // já enviado hoje?
      const { data: alreadySent } = await admin
        .from("label_spreadsheet_reminders")
        .select("id")
        .eq("deal_id", d.id)
        .eq("sent_for_date", today)
        .maybeSingle();
      if (alreadySent) {
        results.push({ deal_id: d.id, action: "skip", reason: "already_sent_today" });
        continue;
      }

      // resolve email do cliente
      const { data: clientRow } = await admin
        .from("curator_deal_songs")
        .select("client_id, clients:client_id(email)")
        .eq("deal_id", d.id)
        .not("client_id", "is", null)
        .limit(1)
        .maybeSingle();
      // deno-lint-ignore no-explicit-any
      const recipientEmail = (clientRow as any)?.clients?.email ?? null;

      if (!recipientEmail) {
        results.push({ deal_id: d.id, action: "skip", reason: "no_client_email" });
        continue;
      }

      const daysSince = lastUpload
        ? Math.floor((Date.now() - new Date(lastUpload.created_at).getTime()) / (24 * 60 * 60 * 1000))
        : null;

      const portalUrl = `${PORTAL_BASE}/${d.client_token}`;
      const idempotencyKey = `label-reminder-${d.id}-${today}`;

      try {
        await admin.functions.invoke("send-transactional-email", {
          body: {
            templateName: "label-spreadsheet-reminder",
            recipientEmail,
            idempotencyKey,
            templateData: {
              songName: d.song_name,
              songArtist: d.song_artist,
              daysSinceLastUpload: daysSince,
              portalUrl,
            },
          },
        });
        await admin.from("label_spreadsheet_reminders").insert({
          deal_id: d.id,
          sent_for_date: today,
          recipient_email: recipientEmail,
        });
        results.push({ deal_id: d.id, action: "sent" });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ deal_id: d.id, action: "error", reason: msg });
      }
    }

    const sent = results.filter((r) => r.action === "sent").length;
    const errored = results.filter((r) => r.action === "error").length;
    await reportCronHealth(admin, {
      job_name: "check-spreadsheet-reminders",
      status: errored > 0 ? "partial" : "ok",
      startedAt,
      metrics: { processed: results.length, sent, errored, skipped: results.length - sent - errored },
      message: `processed=${results.length} sent=${sent} errors=${errored}`,
    });
    return jr({ ok: true, processed: results.length, results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await reportCronHealth(admin, {
      job_name: "check-spreadsheet-reminders",
      status: "error",
      startedAt,
      message: msg.slice(0, 200),
    });
    return jr({ ok: false, error: msg }, 200);
  }
});
