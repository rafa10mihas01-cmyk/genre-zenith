// Public endpoint: returns SANITIZED campaign plan + live tracking data for a share token.
// READ-ONLY — não muta banco. Criação de deal é responsabilidade do approve-campaign-plan.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkRateLimit, clientIp, rateLimitResponse } from "../_shared/rate-limit.ts";
import { buildEcoPlan } from "../_shared/computeEcoPlan.ts";


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

  // Rate limit por IP — mesmo padrão do get-client-campaign-public (120 rpm/IP).
  const ip = clientIp(req);
  const rl = await checkRateLimit(`getSharedCampaignPlan:${ip}`, 60, 120);
  if (!rl.allowed) return rateLimitResponse(corsHeaders);


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
    .select("id, deal_id, track_name, artist, cover_url, spotify_track_url, goal_plays, status, started_at, deadline, simulation_snapshot, total_delivered, client_approved_at, client_rejected_at, client_adjustment_request, collection_mode, engagement_multiplier")
    .eq("public_plan_token", token)
    .maybeSingle();

  if (cErr) return jr({ error: cErr.message }, 500);
  if (!campRaw) return jr({ error: "not_found" }, 404);

  // Link expira automaticamente quando a campanha é encerrada.
  // Hoje só `status='completed'` indica encerramento (não existe coluna closed_at em campaigns).
  // Se um dia for adicionada, o gate já a contempla.
  const closedAt = (campRaw as { closed_at?: string | null }).closed_at ?? null;
  if (campRaw.status === "completed" || closedAt) {
    return jr({ error: "campaign_closed", message: "Campanha encerrada" }, 404);
  }

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
    .select("id, managed_playlist_id, planned_streams, start_day, status, dispatched_at, position, managed_playlists(name, cover_url, followers, spotify_url)")
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
  // Fonte de verdade: campaigns.collection_mode (escolha do operador no
  // momento da criação). Fallback pro deal só se a campanha não tiver valor.
  let collectionMode: "bot" | "spreadsheet" =
    (campRaw as any)?.collection_mode === "spreadsheet" ? "spreadsheet" : "bot";
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

    // Se a campanha não tinha collection_mode (rows antigas), checa o deal.
    if (!(campRaw as any)?.collection_mode) {
      const { data: dealRow } = await supabase
        .from("curator_deals")
        .select("collection_mode")
        .eq("id", dealId)
        .maybeSingle();
      if ((dealRow as any)?.collection_mode === "spreadsheet") collectionMode = "spreadsheet";
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

  // Forecast — curva acumulada PLANEJADA (não real). Usa a mesma lógica
  // canônica do buildEcoPlan (plano de distribuição aprovado), só agregando
  // por dia. Cliente vê só shape + dia previsto pra meta — sem playlist,
  // sem preço, sem nomes.
  let forecast: {
    curve: Array<{ day: number; cumulative: number }>;
    goalHitDay: number | null;
    totalDays: number;
    goalPlays: number;
    startedAt: string;
    top200Position: number | null;
    top200StreamsDay: number | null;
    plannedDailyAverage: number;
  } | null = null;
  try {
    const rawSnap = campRaw.simulation_snapshot as any;
    if (rawSnap?.days && Array.isArray(rawSnap?.curva) && (allocs?.length ?? 0) > 0) {
      const plan = buildEcoPlan({
        snapshot: rawSnap,
        startedAt: (campRaw as any).started_at ?? new Date().toISOString(),
        engagementMultiplier: Math.max(1, (campRaw as any).engagement_multiplier ?? 30),
        allocs: allocs as any,
      });
      const days = rawSnap.days as number;
      const dailyTotal: number[] = Array.from({ length: days }, () => 0);
      for (const row of plan) {
        for (let i = 0; i < days; i++) dailyTotal[i] += row.daily?.[i] ?? 0;
      }
      let running = 0;
      const curve: Array<{ day: number; cumulative: number }> = [];
      let goalHitDay: number | null = null;
      const goal = campRaw.goal_plays ?? 0;
      for (let i = 0; i < days; i++) {
        running += dailyTotal[i];
        curve.push({ day: i + 1, cumulative: running });
        if (goalHitDay === null && goal > 0 && running >= goal) goalHitDay = i + 1;
      }
      const plannedDailyAverage = days > 0 ? Math.round(running / days) : 0;
      const music = rawSnap.music ?? {};
      const t200p = Number(music?.top200Position);
      const t200s = Number(music?.top200StreamsDay);
      forecast = {
        curve,
        goalHitDay,
        totalDays: days,
        goalPlays: goal,
        startedAt: (campRaw as any).started_at ?? new Date().toISOString(),
        top200Position: Number.isFinite(t200p) && t200p > 0 ? t200p : null,
        top200StreamsDay: Number.isFinite(t200s) && t200s > 0 ? t200s : null,
        plannedDailyAverage,
      };
    }
  } catch (_) { /* forecast é opcional — não bloqueia a resposta */ }

  return jr({
    campaign: camp,
    allocations: allocs ?? [],
    snapshots: snaps ?? [],
    proofs,
    client_token: clientToken,
    last_spreadsheet_upload_at: lastSpreadsheetUploadAt,
    recent_uploads: recentUploads,
    collection_mode: collectionMode,
    forecast,
    // compat: até o portal antigo migrar
    has_spotify_access: collectionMode !== "spreadsheet",
  });
});

