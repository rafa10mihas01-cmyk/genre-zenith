// Cron: reconcilia deals ativos a partir de curator_deal_snapshots.
// Fonte única de verdade: prints do Spotify for Artists enviados pelo admin.
// Cada playlist tem N snapshots. Entrega real = soma das diferenças
// (snapshot atual - snapshot anterior) por playlist NÃO-baseline.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

type SnapshotRow = {
  playlist_id: string;
  plays: number;
  captured_at: string;
  is_baseline: boolean;
};

function computeDeliveredFromSnapshots(snapshots: SnapshotRow[]): {
  delivered: number;
  latestCapturedAt: string | null;
} {
  if (!snapshots.length) return { delivered: 0, latestCapturedAt: null };

  const byPlaylist = new Map<string, SnapshotRow[]>();
  for (const s of snapshots) {
    const arr = byPlaylist.get(s.playlist_id) ?? [];
    arr.push(s);
    byPlaylist.set(s.playlist_id, arr);
  }

  let delivered = 0;
  let latest: string | null = null;
  for (const [, list] of byPlaylist) {
    list.sort((a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime());
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const curr = list[i];
      // Apenas playlists não-baseline contam pra entrega do curador.
      // Baseline = primeiro snapshot, não soma.
      if (curr.is_baseline) continue;
      const diff = Math.max(0, Number(curr.plays) - Number(prev.plays));
      delivered += diff;
      if (!latest || new Date(curr.captured_at).getTime() > new Date(latest).getTime()) {
        latest = curr.captured_at;
      }
    }
  }
  return { delivered, latestCapturedAt: latest };
}

async function reconcileDeal(supabase: any, deal: any) {
  const { data: snaps, error: snapErr } = await supabase
    .from("curator_deal_snapshots")
    .select("playlist_id, plays, captured_at, is_baseline")
    .eq("deal_id", deal.id);
  if (snapErr) throw snapErr;

  const { delivered, latestCapturedAt } = computeDeliveredFromSnapshots(snaps ?? []);

  await supabase
    .from("curator_deals")
    .update({
      reconciled_total_plays: delivered,
      reconciled_streams_7d: 0,
      reconciled_streams_28d: 0,
      last_reconciled_at: new Date().toISOString(),
    })
    .eq("id", deal.id);

  const milestone = await checkDealMilestones(supabase, deal, delivered);

  return {
    deal_id: deal.id,
    delivered,
    snapshots_count: snaps?.length ?? 0,
    latest_capture_at: latestCapturedAt,
    milestone,
  };
}

async function checkDealMilestones(
  supabase: any,
  deal: { id: string; song_name: string; curator_name: string; target_plays?: number; ends_at?: string | null },
  delivered: number,
): Promise<{ goal: boolean; overdue: boolean }> {
  const result = { goal: false, overdue: false };
  const target = Number(deal.target_plays ?? 0) || 0;

  if (target > 0 && delivered >= target) {
    const { data: existing } = await supabase
      .from("notifications").select("id")
      .eq("metadata->>kind", "goal_reached")
      .eq("metadata->>deal_id", deal.id).limit(1);
    if (!existing || existing.length === 0) {
      await supabase.from("notifications").insert({
        type: "success",
        title: `Meta batida: ${deal.song_name}`,
        message: `Curador "${deal.curator_name}" entregou ${delivered.toLocaleString("pt-BR")} de ${target.toLocaleString("pt-BR")} plays.`,
        action_url: `/playlist-deals?deal=${deal.id}`,
        metadata: { kind: "goal_reached", deal_id: deal.id, delivered, target },
      });
      result.goal = true;
    }
  }

  if (deal.ends_at) {
    const ends = new Date(deal.ends_at);
    if (ends < new Date() && delivered < target) {
      const { data: existing } = await supabase
        .from("notifications").select("id")
        .eq("metadata->>kind", "deal_overdue")
        .eq("metadata->>deal_id", deal.id).limit(1);
      if (!existing || existing.length === 0) {
        const remaining = Math.max(target - delivered, 0);
        await supabase.from("notifications").insert({
          type: "warning",
          title: `Deal atrasado: ${deal.song_name}`,
          message: `Prazo venceu em ${ends.toLocaleDateString("pt-BR")} e faltam ${remaining.toLocaleString("pt-BR")} plays para a meta.`,
          action_url: `/playlist-deals?deal=${deal.id}`,
          metadata: { kind: "deal_overdue", deal_id: deal.id, delivered, target, ends_at: deal.ends_at },
        });
        result.overdue = true;
      }
    }
  }

  return result;
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

    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: deals, error } = await supabase
      .from("curator_deals")
      .select("id, user_id, song_name, curator_name, started_at, ends_at, target_plays")
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

    console.log(`[cron-reconcile] ${results.length} deals processados via snapshots`);

    return new Response(
      JSON.stringify({ deals_processed: results.length, results }),
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
