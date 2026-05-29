// campaign-cleanup-dryrun
// Roda 1x/dia via pg_cron. Para cada campanha `completed` com closed_at > X dias,
// identifica quais faixas AINDA estão em managed_playlist_tracks (deveriam ter
// sido removidas pós-campanha) e gera um relatório em cron_health + notificação.
//
// IMPORTANTE: dry-run. Não remove nada. Só reporta o que seria removido.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const RETENTION_DAYS = 14; // dias após closed_at em que a faixa deveria sair

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const startedAt = Date.now();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
    .toISOString();

  // Campanhas concluídas há mais de RETENTION_DAYS, com spotify_track_id
  const { data: campaigns, error: cErr } = await admin
    .from("campaigns")
    .select("id, track_name, artist, spotify_track_id, closed_at")
    .eq("status", "completed")
    .not("spotify_track_id", "is", null)
    .lt("closed_at", cutoff);

  if (cErr) {
    console.error("[campaign-cleanup-dryrun] campaigns query failed:", cErr);
    await admin.from("cron_health").insert({
      job_name: "campaign-cleanup-dryrun",
      status: "error",
      metrics: { error: cErr.message, duration_ms: Date.now() - startedAt },
    });
    return new Response(JSON.stringify({ ok: false, error: cErr.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }

  const report: Array<{
    campaign_id: string;
    track: string;
    spotify_track_id: string;
    closed_at: string | null;
    still_in_playlists: number;
  }> = [];

  for (const c of campaigns ?? []) {
    const { count, error: pErr } = await admin
      .from("managed_playlist_tracks")
      .select("id", { count: "exact", head: true })
      .eq("spotify_track_id", c.spotify_track_id);

    if (pErr) {
      console.error(
        `[campaign-cleanup-dryrun] count failed for ${c.id}:`,
        pErr,
      );
      continue;
    }

    if ((count ?? 0) > 0) {
      report.push({
        campaign_id: c.id,
        track: `${c.track_name}${c.artist ? " - " + c.artist : ""}`,
        spotify_track_id: c.spotify_track_id!,
        closed_at: c.closed_at,
        still_in_playlists: count ?? 0,
      });
    }
  }

  const totalStuck = report.reduce((s, r) => s + r.still_in_playlists, 0);

  await admin.from("cron_health").insert({
    job_name: "campaign-cleanup-dryrun",
    status: "ok",
    metrics: {
      campaigns_checked: campaigns?.length ?? 0,
      campaigns_with_residue: report.length,
      total_track_instances: totalStuck,
      retention_days: RETENTION_DAYS,
      duration_ms: Date.now() - startedAt,
      sample: report.slice(0, 10),
    },
  });

  if (report.length > 0) {
    await admin.rpc("create_notification", {
      p_type: "info",
      p_title: `Limpeza pendente: ${report.length} campanhas`,
      p_message:
        `${report.length} campanha(s) concluída(s) há mais de ${RETENTION_DAYS} dias ` +
        `ainda têm ${totalStuck} ocorrência(s) de faixa em playlists gerenciadas. ` +
        `Dry-run — nada foi removido.`,
      p_action_url: "/sistema?tab=saude",
      p_metadata: { campaigns: report.length, total: totalStuck },
      p_dedupe_key: "campaign-cleanup-residue",
      p_cooldown_minutes: 24 * 60,
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      dry_run: true,
      retention_days: RETENTION_DAYS,
      campaigns_checked: campaigns?.length ?? 0,
      campaigns_with_residue: report.length,
      total_track_instances: totalStuck,
      report,
    }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    },
  );
});
