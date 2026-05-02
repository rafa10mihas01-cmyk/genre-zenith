// Cron: reconcilia todos os deals ativos (não terminados) a cada execução.
// Chamado via pg_cron com header X-Cron-Secret. Usa service role para bypassar RLS.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

function similarity(a: string, b: string): number {
  const x = a.toLowerCase().trim();
  const y = b.toLowerCase().trim();
  if (!x || !y) return 0;
  if (x === y) return 1;
  const ta = new Set(x.split(/\s+/));
  const tb = new Set(y.split(/\s+/));
  const inter = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  return union === 0 ? 0 : inter / union;
}

async function reconcileDeal(supabase: any, deal: any) {
  const { data: matched } = await supabase
    .from("curator_playlists")
    .select("streams_7d, streams_28d, streams_total")
    .eq("deal_id", deal.id)
    .in("match_status", ["curator", "baseline"]);

  const totals = (matched ?? []).reduce(
    (acc: any, p: any) => ({
      s7: acc.s7 + (p.streams_7d ?? 0),
      s28: acc.s28 + (p.streams_28d ?? 0),
      stotal: acc.stotal + (p.streams_total ?? 0),
    }),
    { s7: 0, s28: 0, stotal: 0 },
  );

  await supabase
    .from("curator_deals")
    .update({
      reconciled_streams_7d: totals.s7,
      reconciled_streams_28d: totals.s28,
      reconciled_total_plays: totals.stotal,
      last_reconciled_at: new Date().toISOString(),
    })
    .eq("id", deal.id);

  const { data: allPlaylists } = await supabase
    .from("curator_playlists")
    .select(
      "id, deal_id, playlist_name, spotify_owner_id, spotify_owner_name, added_at_spotify, match_status, streams_7d, followers",
    )
    .eq("deal_id", deal.id);

  const matchedNames = (allPlaylists ?? [])
    .filter((p: any) => p.match_status === "curator" || p.match_status === "baseline")
    .map((p: any) => p.playlist_name);

  const dealStart = new Date(deal.started_at);
  const alerts: any[] = [];

  for (const p of allPlaylists ?? []) {
    if (p.match_status === "curator" || p.match_status === "baseline") continue;

    if (
      p.match_status === "suspicious" &&
      deal.spotify_owner_id &&
      p.spotify_owner_id &&
      p.spotify_owner_id !== deal.spotify_owner_id
    ) {
      let bestSim = 0;
      let bestName = "";
      for (const n of matchedNames) {
        const s = similarity(p.playlist_name, n);
        if (s > bestSim) { bestSim = s; bestName = n; }
      }
      if (bestSim >= 0.6) {
        alerts.push({
          deal_id: deal.id, playlist_id: p.id, alert_type: "lookalike_name",
          severity: bestSim >= 0.85 ? "high" : "medium",
          title: `Playlist com nome similar: "${p.playlist_name}"`,
          description: `Nome muito parecido com "${bestName}" mas dono diferente (${p.spotify_owner_name ?? p.spotify_owner_id}).`,
          evidence: { similarity: bestSim, similar_to: bestName, owner_id: p.spotify_owner_id, streams_7d: p.streams_7d },
        });
      } else {
        alerts.push({
          deal_id: deal.id, playlist_id: p.id, alert_type: "owner_mismatch",
          severity: "medium",
          title: `Dono diferente do esperado: "${p.playlist_name}"`,
          description: `Owner ${p.spotify_owner_name ?? p.spotify_owner_id} não corresponde ao curador do deal.`,
          evidence: { expected_owner: deal.spotify_owner_id, actual_owner: p.spotify_owner_id, streams_7d: p.streams_7d },
        });
      }
    }

    if (p.added_at_spotify) {
      const addedAt = new Date(p.added_at_spotify);
      if (addedAt < dealStart) {
        const daysBefore = Math.floor((dealStart.getTime() - addedAt.getTime()) / 86400000);
        if (daysBefore >= 2) {
          alerts.push({
            deal_id: deal.id, playlist_id: p.id, alert_type: "pre_deal_addition",
            severity: daysBefore > 30 ? "high" : "low",
            title: `Adição anterior ao deal: "${p.playlist_name}"`,
            description: `Música foi adicionada ${daysBefore} dia(s) antes do início do deal.`,
            evidence: { added_at: p.added_at_spotify, deal_started_at: deal.started_at, days_before: daysBefore },
          });
        }
      }
    }

    if (p.streams_7d > 1000 && (p.followers ?? 0) < 200) {
      alerts.push({
        deal_id: deal.id, playlist_id: p.id, alert_type: "suspicious_growth",
        severity: "high",
        title: `Streams desproporcionais: "${p.playlist_name}"`,
        description: `${p.streams_7d.toLocaleString("pt-BR")} streams em 7d com apenas ${p.followers ?? 0} seguidores.`,
        evidence: { streams_7d: p.streams_7d, followers: p.followers, ratio: p.followers ? p.streams_7d / p.followers : null },
      });
    }
  }

  let createdAlerts = 0;
  if (alerts.length > 0) {
    const { data: existing } = await supabase
      .from("curator_fraud_alerts")
      .select("playlist_id, alert_type")
      .eq("deal_id", deal.id)
      .eq("status", "open");

    const existingKeys = new Set(
      (existing ?? []).map((e: any) => `${e.playlist_id}::${e.alert_type}`),
    );
    const toInsert = alerts.filter(
      (a) => !existingKeys.has(`${a.playlist_id}::${a.alert_type}`),
    );
    if (toInsert.length > 0) {
      await supabase.from("curator_fraud_alerts").insert(toInsert);
      createdAlerts = toInsert.length;

      // Notificação global p/ admins (notifications é team-wide)
      const high = toInsert.filter((a) => a.severity === "high").length;
      await supabase.from("notifications").insert({
        type: high > 0 ? "warning" : "info",
        title: `Anti-fraude: ${toInsert.length} novo(s) alerta(s)`,
        message: `Deal "${deal.song_name}" (${deal.curator_name}): ${toInsert.length} alerta(s)${high > 0 ? `, ${high} de severidade alta` : ""}.`,
        action_url: `/playlist-deals?deal=${deal.id}`,
        metadata: { deal_id: deal.id, alerts_created: toInsert.length, high_severity: high },
      });
    }
  }

  return { deal_id: deal.id, ...totals, alerts_created: createdAlerts };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const cronSecret = Deno.env.get("CRON_SECRET");
    const provided = req.headers.get("x-cron-secret");
    if (!cronSecret || provided !== cronSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Deals ativos: não terminados ou terminados nos últimos 7 dias
    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: deals, error } = await supabase
      .from("curator_deals")
      .select("id, user_id, song_name, curator_name, spotify_owner_id, started_at, ends_at")
      .or(`ends_at.is.null,ends_at.gte.${cutoff}`);

    if (error) throw error;

    const results = [];
    for (const d of deals ?? []) {
      try {
        results.push(await reconcileDeal(supabase, d));
      } catch (err) {
        console.error("reconcile error", d.id, err);
        results.push({ deal_id: d.id, error: String(err) });
      }
    }

    const totalAlerts = results.reduce((s, r: any) => s + (r.alerts_created ?? 0), 0);
    console.log(`[cron-reconcile] ${results.length} deals, ${totalAlerts} novos alertas`);

    return new Response(
      JSON.stringify({ deals_processed: results.length, alerts_created: totalAlerts, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("cron-reconcile error", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
