// detect-curator-fraud — detecta playlists suspeitas de um deal e
// gera registros em `curator_fraud_alerts`. NÃO atualiza métricas
// de progresso (reconciled_*) — isso é responsabilidade exclusiva
// do cron-reconcile-curator-deals (snapshots S4A).
//
// Auth: JWT do usuário. Só processa deals do próprio usuário.
// Body: { deal_id?: string } — se ausente, processa todos os deals do user.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { reportCronHealth } from "../_shared/cron-health.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Playlist = {
  id: string;
  deal_id: string;
  playlist_name: string;
  spotify_owner_id: string | null;
  spotify_owner_name: string | null;
  added_at_spotify: string | null;
  match_status: string;
  streams_7d: number;
  streams_28d: number;
  streams_total: number;
  followers: number | null;
};

type Deal = {
  id: string;
  user_id: string;
  song_name: string;
  curator_name: string;
  spotify_owner_id: string | null;
  started_at: string;
  ends_at: string | null;
  target_plays: number;
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

async function detectForDeal(supabase: any, deal: Deal) {
  const { data: allPlaylists, error: e2 } = await supabase
    .from("v_curator_playlists_operational")
    .select(
      "id, deal_id, playlist_name, spotify_owner_id, spotify_owner_name, added_at_spotify, match_status, streams_7d, streams_28d, streams_total, followers",
    )
    .eq("deal_id", deal.id);
  if (e2) throw e2;

  const matchedNames = (allPlaylists as Playlist[])
    .filter((p) => p.match_status === "curator" || p.match_status === "baseline")
    .map((p) => p.playlist_name);

  const dealStart = new Date(deal.started_at);
  const alerts: any[] = [];

  for (const p of allPlaylists as Playlist[]) {
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
        if (s > bestSim) {
          bestSim = s;
          bestName = n;
        }
      }
      if (bestSim >= 0.6) {
        alerts.push({
          deal_id: deal.id,
          playlist_id: p.id,
          alert_type: "lookalike_name",
          severity: bestSim >= 0.85 ? "high" : "medium",
          title: `Playlist com nome similar: "${p.playlist_name}"`,
          description: `Nome muito parecido com "${bestName}" mas dono diferente (${p.spotify_owner_name ?? p.spotify_owner_id}).`,
          evidence: {
            similarity: bestSim,
            similar_to: bestName,
            owner_id: p.spotify_owner_id,
            streams_7d: p.streams_7d,
          },
        });
      } else {
        alerts.push({
          deal_id: deal.id,
          playlist_id: p.id,
          alert_type: "owner_mismatch",
          severity: "medium",
          title: `Dono diferente do esperado: "${p.playlist_name}"`,
          description: `Owner ${p.spotify_owner_name ?? p.spotify_owner_id} não corresponde ao curador do deal.`,
          evidence: {
            expected_owner: deal.spotify_owner_id,
            actual_owner: p.spotify_owner_id,
            streams_7d: p.streams_7d,
          },
        });
      }
    }

    if (p.added_at_spotify) {
      const addedAt = new Date(p.added_at_spotify);
      if (addedAt < dealStart) {
        const daysBefore = Math.floor(
          (dealStart.getTime() - addedAt.getTime()) / (1000 * 60 * 60 * 24),
        );
        if (daysBefore >= 2) {
          alerts.push({
            deal_id: deal.id,
            playlist_id: p.id,
            alert_type: "pre_deal_addition",
            severity: daysBefore > 30 ? "high" : "low",
            title: `Adição anterior ao deal: "${p.playlist_name}"`,
            description: `Música foi adicionada ${daysBefore} dia(s) antes do início do deal.`,
            evidence: {
              added_at: p.added_at_spotify,
              deal_started_at: deal.started_at,
              days_before: daysBefore,
            },
          });
        }
      }
    }

    if (p.streams_7d > 1000 && (p.followers ?? 0) < 200) {
      alerts.push({
        deal_id: deal.id,
        playlist_id: p.id,
        alert_type: "suspicious_growth",
        severity: "high",
        title: `Streams desproporcionais: "${p.playlist_name}"`,
        description: `${p.streams_7d.toLocaleString("pt-BR")} streams em 7d com apenas ${p.followers ?? 0} seguidores.`,
        evidence: {
          streams_7d: p.streams_7d,
          followers: p.followers,
          ratio: p.followers ? p.streams_7d / p.followers : null,
        },
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
      const { error: insErr } = await supabase
        .from("curator_fraud_alerts")
        .insert(toInsert);
      if (insErr) throw insErr;
      createdAlerts = toInsert.length;
    }
  }

  return {
    deal_id: deal.id,
    playlists_scanned: allPlaylists?.length ?? 0,
    alerts_created: createdAlerts,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startedAt = Date.now();
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const dealId: string | undefined = body?.deal_id;
    const scanAllActive: boolean = body?.scan_all_active === true;

    // === Modo cron (service role) — Authorization: Bearer <SERVICE_ROLE_KEY> ===
    const authHeader = req.headers.get("Authorization") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const isCron = scanAllActive && serviceKey && authHeader === `Bearer ${serviceKey}`;

    let supabase: any;
    let userId: string | null = null;

    if (isCron) {
      supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
    } else {
      const userAuth = req.headers.get("Authorization");
      if (!userAuth) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: userAuth } } },
      );
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = user.id;
    }

    let dealsQuery = supabase
      .from("curator_deals")
      .select(
        "id, user_id, song_name, curator_name, spotify_owner_id, started_at, ends_at, target_plays",
      );

    if (!isCron && userId) dealsQuery = dealsQuery.eq("user_id", userId);
    if (dealId) dealsQuery = dealsQuery.eq("id", dealId);
    if (isCron && !dealId) dealsQuery = dealsQuery.eq("state", "active");

    const { data: deals, error } = await dealsQuery;
    if (error) throw error;
    if (!deals || deals.length === 0) {
      return new Response(JSON.stringify({ results: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results = [];
    for (const d of deals as Deal[]) {
      try {
        results.push(await detectForDeal(supabase, d));
      } catch (err) {
        console.error("detect-curator-fraud error", d.id, err);
        results.push({ deal_id: d.id, error: String(err) });
      }
    }

    if (isCron) {
      const errCount = results.filter((r: any) => r.error).length;
      await reportCronHealth(supabase, {
        job_name: "detect-curator-fraud",
        status: errCount === 0 ? "ok" : (errCount === results.length ? "error" : "partial"),
        startedAt,
        metrics: { processed: results.length, errors: errCount },
      });
    }

    return new Response(JSON.stringify({ results, mode: isCron ? "cron" : "user" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("detect-curator-fraud error", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
