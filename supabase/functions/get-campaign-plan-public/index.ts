// Edge function pública: retorna o plano da campanha por token compartilhável.
// Sem autenticação. Lê apenas via service role e devolve um subset seguro.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { token } = await req.json().catch(() => ({}));
    if (!token || typeof token !== "string" || token.length < 8) {
      return new Response(JSON.stringify({ ok: false, error: "invalid_token" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: camp, error: cErr } = await supabase
      .from("campaigns")
      .select("id, track_name, artist, cover_url, goal_plays, deadline, started_at, status, total_delivered, simulation_snapshot, engagement_multiplier")
      .eq("public_plan_token", token.trim())
      .maybeSingle();

    if (cErr || !camp) {
      return new Response(JSON.stringify({ ok: false, error: "not_found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: allocs } = await supabase
      .from("campaign_eco_allocations")
      .select("id, planned_streams, start_day, status, managed_playlists(name, cover_url, followers)")
      .eq("campaign_id", camp.id);

    return new Response(JSON.stringify({
      ok: true,
      campaign: {
        track_name: camp.track_name,
        artist: camp.artist,
        cover_url: camp.cover_url,
        goal_plays: camp.goal_plays,
        deadline: camp.deadline,
        started_at: camp.started_at,
        status: camp.status,
        total_delivered: camp.total_delivered,
        engagement_multiplier: camp.engagement_multiplier ?? 30,
        simulation_snapshot: camp.simulation_snapshot,
      },
      allocations: allocs ?? [],
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
