// Public endpoint: returns sanitized campaign plan data for a given share token.
// No auth required — token acts as the bearer of access.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let token = "";
  try {
    const body = await req.json();
    token = String(body?.token ?? "").trim();
  } catch (_) { /* ignore */ }

  if (!token || token.length < 16 || !/^[a-zA-Z0-9_-]+$/.test(token)) {
    return jr({ error: "invalid_token" }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: camp, error: cErr } = await supabase
    .from("campaigns")
    .select("id, deal_id, track_name, artist, cover_url, spotify_track_url, spotify_track_id, started_at, deadline, simulation_snapshot, engagement_multiplier, client_approved_at, client_approved_by, client_rejected_at, client_adjustment_request")
    .eq("public_plan_token", token)
    .maybeSingle();

  if (cErr) return jr({ error: cErr.message }, 500);
  if (!camp) return jr({ error: "not_found" }, 404);

  const { data: allocs, error: aErr } = await supabase
    .from("campaign_eco_allocations")
    .select("id, planned_streams, start_day, managed_playlists(name, cover_url, followers, spotify_url)")
    .eq("campaign_id", camp.id)
    .order("planned_streams", { ascending: false });

  if (aErr) return jr({ error: aErr.message }, 500);

  // Se a campanha já virou deal, descobre o token do painel pra mandar o
  // cliente pra acompanhar a campanha ao vivo (o orçamento "some" e fica só
  // a página de acompanhamento).
  let trackingToken: string | null = null;
  if ((camp as any).deal_id) {
    const { data: songs } = await supabase
      .from("curator_deal_songs")
      .select("slug, client_token, campaign_id, position")
      .eq("deal_id", (camp as any).deal_id)
      .order("position", { ascending: true })
      .limit(50);
    if (songs && songs.length) {
      const match = songs.find((s: any) => s.campaign_id === camp.id) ?? songs[0];
      trackingToken = String((match as any).slug ?? (match as any).client_token ?? "") || null;
    }
  }

  return jr({ campaign: camp, allocations: allocs ?? [], tracking_token: trackingToken });
});
