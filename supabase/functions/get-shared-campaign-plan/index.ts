// Public endpoint: returns sanitized campaign plan + live tracking data for a share token.
// Same token is valid before and after approval — the page morphs from "orçamento"
// to "live portal" without changing URL.
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
    .select("id, deal_id, track_name, artist, cover_url, spotify_track_url, spotify_track_id, status, started_at, deadline, simulation_snapshot, snapshot_locked_at, eco_dispatched_at, engagement_multiplier, total_delivered, client_approved_at, client_approved_by, client_rejected_at, client_adjustment_request")
    .eq("public_plan_token", token)
    .maybeSingle();

  if (cErr) return jr({ error: cErr.message }, 500);
  if (!camp) return jr({ error: "not_found" }, 404);

  const { data: allocs, error: aErr } = await supabase
    .from("campaign_eco_allocations")
    .select("id, managed_playlist_id, planned_streams, start_day, status, dispatched_at, managed_playlists(name, cover_url, followers, spotify_url)")
    .eq("campaign_id", camp.id)
    .order("planned_streams", { ascending: false });

  if (aErr) return jr({ error: aErr.message }, 500);

  // Live data: only relevant once the client approved (so the orçamento stays
  // limpo antes). We still query it sempre — barato e simplifica o front.
  const { data: snaps } = await supabase
    .from("campaign_eco_snapshots")
    .select("id, managed_playlist_id, plays_24h, plays_7d, plays_28d, captured_at, source")
    .eq("campaign_id", camp.id)
    .order("captured_at", { ascending: false })
    .limit(500);

  // Provas externas (telas) ligadas aos deals desta campanha
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

  // Cliente também precisa subir planilha — pegamos o client_token da primeira
  // música do deal correspondente (mesma lógica do portal /campanha/:token).
  let clientToken: string | null = null;
  let lastSpreadsheetUploadAt: string | null = null;
  let recentUploads: any[] = [];
  if (camp.deal_id) {
    const { data: song } = await supabase
      .from("curator_deal_songs")
      .select("client_token")
      .eq("deal_id", camp.deal_id)
      .not("client_token", "is", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    clientToken = (song as any)?.client_token ?? null;

    const { data: uploads } = await supabase
      .from("label_spreadsheet_uploads")
      .select("id, created_at, rows_imported, total_streams, status, file_name")
      .eq("deal_id", camp.deal_id)
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

