// Public endpoint: returns SANITIZED campaign plan + live tracking data for a share token.
// READ-ONLY — não muta banco. Criação de deal é responsabilidade do approve-campaign-plan.
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

// Whitelist do que o cliente pode ver do simulation_snapshot.
// Tudo que envolve custo interno, margem, preço de compra ou multiplicadores fica fora.
function sanitizeSnapshot(raw: any): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const allowed = ["clientPriceTotal", "meta", "days"];
  const out: Record<string, unknown> = {};
  for (const k of allowed) {
    if (raw[k] !== undefined) out[k] = raw[k];
  }
  return out;
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

  // Lê só o estritamente necessário pro portal do cliente.
  const { data: campRaw, error: cErr } = await supabase
    .from("campaigns")
    .select("id, deal_id, track_name, artist, cover_url, spotify_track_url, goal_plays, status, started_at, deadline, simulation_snapshot, total_delivered, client_approved_at, client_rejected_at, client_adjustment_request")
    .eq("public_plan_token", token)
    .maybeSingle();

  if (cErr) return jr({ error: cErr.message }, 500);
  if (!campRaw) return jr({ error: "not_found" }, 404);

  // Payload sanitizado — sem custos, sem margens, sem campos internos.
  const camp = {
    id: campRaw.id,
    deal_id: campRaw.deal_id,
    track_name: campRaw.track_name,
    artist: campRaw.artist,
    cover_url: campRaw.cover_url,
    spotify_track_url: campRaw.spotify_track_url,
    goal_plays: campRaw.goal_plays,
    status: campRaw.status,
    started_at: campRaw.started_at,
    deadline: campRaw.deadline,
    total_delivered: campRaw.total_delivered,
    client_approved_at: campRaw.client_approved_at,
    client_rejected_at: campRaw.client_rejected_at,
    client_adjustment_request: campRaw.client_adjustment_request,
    simulation_snapshot: sanitizeSnapshot(campRaw.simulation_snapshot),
  };

  const { data: allocs, error: aErr } = await supabase
    .from("campaign_eco_allocations")
    .select("id, managed_playlist_id, planned_streams, start_day, status, dispatched_at, managed_playlists(name, cover_url, followers, spotify_url)")
    .eq("campaign_id", camp.id)
    .order("planned_streams", { ascending: false });

  if (aErr) return jr({ error: aErr.message }, 500);

  const { data: snaps } = await supabase
    .from("campaign_eco_snapshots")
    .select("id, managed_playlist_id, plays_24h, plays_7d, plays_28d, captured_at, source")
    .eq("campaign_id", camp.id)
    .order("captured_at", { ascending: false })
    .limit(500);

  const { data: pkgItems } = await supabase
    .from("campaign_external_package_items")
    .select("curator_deal_id, campaign_external_packages!inner(campaign_id)")
    .eq("campaign_external_packages.campaign_id", camp.id)
    .not("curator_deal_id", "is", null);

  const dealIds = (pkgItems ?? []).map((p: any) => p.curator_deal_id).filter(Boolean);
  let proofs: any[] = [];
  if (dealIds.length > 0) {
    const { data: dp } = await supabase
      .from("delivery_proofs")
      .select("id, playlist_id, playlist_name, screenshot_url, plays_total, plays_24h, position_in_playlist, source, captured_at")
      .in("deal_id", dealIds)
      .order("captured_at", { ascending: false })
      .limit(200);
    proofs = dp ?? [];
  }

  // Leitura do client_token + uploads — somente se o deal JÁ existir
  // (criação foi movida pra approve-campaign-plan).
  let clientToken: string | null = null;
  let lastSpreadsheetUploadAt: string | null = null;
  let recentUploads: any[] = [];
  const dealId = camp.deal_id as string | null;

  if (dealId) {
    const { data: song } = await supabase
      .from("curator_deal_songs")
      .select("id, client_token")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (song) {
      clientToken = (song as any).client_token ?? null;
    }

    const { data: uploads } = await supabase
      .from("label_spreadsheet_uploads")
      .select("id, created_at, rows_imported, total_streams, status, file_name")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(10);
    recentUploads = uploads ?? [];
    lastSpreadsheetUploadAt = (uploads as any)?.[0]?.created_at ?? null;
  }

  return jr({
    campaign: camp,
    allocations: allocs ?? [],
    snapshots: snaps ?? [],
    proofs,
    client_token: clientToken,
    last_spreadsheet_upload_at: lastSpreadsheetUploadAt,
    recent_uploads: recentUploads,
  });
});
