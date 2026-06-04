// GET /campaign-daily-plan?campaign_id=<uuid>[&day=D1][&date=YYYY-MM-DD][&playlist_id=<uuid>]
//
// Auth (either):
//   - public_plan_token via ?token=<token>  OR  Authorization: Bearer <token>
//   - logged-in user JWT via Authorization: Bearer <jwt>
//
// Returns the planned plays per (playlist, day). Data is computed from the
// frozen snapshot + eco allocations — there is NO stored daily-plan table.
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildEcoPlan, dayLabel, isoDate } from "../_shared/computeEcoPlan.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[a-zA-Z0-9_-]{16,}$/;
const DAY_RE = /^D(\d{1,3})$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return jr({ error: "method_not_allowed" }, 405);

  const url = new URL(req.url);
  const campaignId = (url.searchParams.get("campaign_id") ?? "").trim();
  const playlistIdFilter = (url.searchParams.get("playlist_id") ?? "").trim() || null;
  const dayParam = (url.searchParams.get("day") ?? "").trim();
  const dateParam = (url.searchParams.get("date") ?? "").trim();
  let token = (url.searchParams.get("token") ?? "").trim();

  if (!campaignId || !UUID_RE.test(campaignId)) {
    return jr({ error: "invalid_campaign_id", message: "Pass ?campaign_id=<uuid>." }, 400);
  }
  if (playlistIdFilter && !UUID_RE.test(playlistIdFilter)) {
    return jr({ error: "invalid_playlist_id" }, 400);
  }
  if (dayParam && !DAY_RE.test(dayParam)) {
    return jr({ error: "invalid_day", message: "Use D1, D2, D30..." }, 400);
  }
  if (dateParam && !DATE_RE.test(dateParam)) {
    return jr({ error: "invalid_date", message: "Use YYYY-MM-DD." }, 400);
  }
  if (dayParam && dateParam) {
    return jr({ error: "conflict", message: "Use day OR date, not both." }, 400);
  }

  // Auth: token (public) takes precedence; otherwise validate user JWT.
  const authHeader = req.headers.get("authorization") ?? "";
  if (!token) {
    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    if (m && TOKEN_RE.test(m[1].trim()) && !m[1].includes(".")) {
      token = m[1].trim();
    }
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Auth check
  if (token) {
    if (!TOKEN_RE.test(token)) return jr({ error: "invalid_token" }, 401);
    const { data: tok } = await admin
      .from("campaigns")
      .select("id")
      .eq("id", campaignId)
      .eq("public_plan_token", token)
      .maybeSingle();
    if (!tok) return jr({ error: "token_mismatch", message: "Token does not match this campaign." }, 403);
  } else {
    if (!authHeader.startsWith("Bearer ")) {
      return jr({ error: "unauthorized", message: "Send Authorization: Bearer <jwt> or ?token=<public_plan_token>." }, 401);
    }
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claims, error: ce } = await userClient.auth.getClaims(authHeader.replace(/^Bearer\s+/i, ""));
    if (ce || !claims?.claims) return jr({ error: "unauthorized" }, 401);
  }

  // Fetch campaign + allocations
  const { data: camp, error: cErr } = await admin
    .from("campaigns")
    .select("id, track_name, started_at, simulation_snapshot, engagement_multiplier")
    .eq("id", campaignId)
    .maybeSingle();
  if (cErr) return jr({ error: cErr.message }, 500);
  if (!camp) return jr({ error: "not_found" }, 404);
  const snapshot = (camp as any).simulation_snapshot;
  if (!snapshot) return jr({ error: "no_snapshot", message: "Campaign has no frozen plan." }, 409);

  const { data: allocs, error: aErr } = await admin
    .from("campaign_eco_allocations")
    .select("id, planned_streams, start_day, status, position, managed_playlists(id, name, cover_url, followers, spotify_url, engagement_multiplier_override)")
    .eq("campaign_id", campaignId);
  if (aErr) return jr({ error: aErr.message }, 500);

  const plan = buildEcoPlan({
    snapshot,
    startedAt: (camp as any).started_at,
    engagementMultiplier: Math.max(1, (camp as any).engagement_multiplier ?? 35),
    allocs: (allocs ?? []) as any,
  });

  // Optional filter by playlist_id (managed_playlists.id)
  const filtered = playlistIdFilter
    ? plan.filter(p => p.playlist_id === playlistIdFilter)
    : plan;

  // Resolve target day (1-indexed) from day=D? or date=YYYY-MM-DD
  let targetDay: number | null = null;
  if (dayParam) {
    targetDay = parseInt(dayParam.slice(1), 10);
  } else if (dateParam) {
    const startedAt = (camp as any).started_at as string;
    const start = new Date(startedAt);
    start.setUTCHours(0, 0, 0, 0);
    const target = new Date(dateParam + "T00:00:00Z");
    const diff = Math.round((target.getTime() - start.getTime()) / 86400000) + 1;
    targetDay = diff;
  }

  const baseResp = {
    campaign_id: (camp as any).id,
    campaign_name: (camp as any).track_name,
  };

  // Plano roda sobre effectiveDays (real). Snapshots antigos caem em days.
  const planDays = (snapshot as any).effectiveDays ?? snapshot.days;

  // Single-day mode: flat items list
  if (targetDay !== null) {
    if (targetDay < 1 || targetDay > planDays) {
      return jr({ ...baseResp, day: `D${targetDay}`, items: [] });
    }
    const dayIdx = targetDay - 1;
    const items = filtered.map(p => ({
      playlist_id: p.playlist_id,
      playlist_name: p.playlist_name,
      playlist_url: p.playlist_url,
      day: `D${targetDay}`,
      date: isoDate((camp as any).started_at, targetDay),
      planned_plays: p.daily[dayIdx] ?? 0,
    })).filter(it => (it.planned_plays > 0) || playlistIdFilter);
    return jr({
      ...baseResp,
      day: `D${targetDay}`,
      date: isoDate((camp as any).started_at, targetDay),
      items,
    });
  }

  // Full schedule mode
  const items = filtered.map(p => ({
    playlist_id: p.playlist_id,
    playlist_name: p.playlist_name,
    playlist_url: p.playlist_url,
    total_planned_plays: p.total_streams,
    schedule: p.daily.map((v, i) => ({
      day: `D${i + 1}`,
      date: isoDate((camp as any).started_at, i + 1),
      planned_plays: v,
    })).filter(s => s.planned_plays > 0),
  }));
  return jr({
    ...baseResp,
    days: planDays,
    items,
  });
});
