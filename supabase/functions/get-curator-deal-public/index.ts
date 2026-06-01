// get-curator-deal-public — retorna dados públicos de um deal de curador
// a partir do public_token (sem expor user_id). Usado pela página pública
// que o curador acessa para ver a meta e cadastrar playlists.
// Sem auth (rota pública). Service role para ignorar RLS.
//
// Fonte de verdade do progresso: curator_deal_snapshots (prints do admin via S4A).
// O frontend não calcula nada — apenas renderiza `progress` e `snapshot_history`.
import { corsHeaders } from "npm:@supabase/supabase-js/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { assertDealOperable } from "../_shared/deal-access.ts";
import { checkRateLimit, clientIp, rateLimitResponse } from "../_shared/rate-limit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Rate limit: 120 req/min por IP.
  const ip = clientIp(req);
  const rl = await checkRateLimit(`get-curator-deal-public:${ip}`, 60, 120);
  if (!rl.allowed) return rateLimitResponse(corsHeaders);

  try {
    const body = await req.json().catch(() => ({}));
    const token = typeof body?.public_token === "string" ? body.public_token.trim() : "";
    const slug = typeof body?.slug === "string" ? body.slug.trim() : "";

    if (!token && !slug) {
      return jr({ ok: false, error: "public_token ou slug obrigatório" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    // Aceita slug (preferencial) ou token (compatibilidade com links antigos).
    const looksLikeToken = (v: string) => /^[a-f0-9]{20,}$/i.test(v);
    let query = admin
      .from("curator_deals")
      .select(
        "id, curator_name, song_spotify_url, song_name, song_artist, song_cover_url, target_plays, daily_goal, baseline_plays, cost, started_at, ends_at, public_token, slug, created_at, spotify_owner_id, spotify_owner_url, state, closed_at, closed_status, token_revoked_at, token_expires_at, campaign_id, source",
      );

    if (token) {
      query = query.eq("public_token", token);
    } else if (looksLikeToken(slug)) {
      query = query.eq("public_token", slug);
    } else {
      query = query.eq("slug", slug);
    }

    const { data: deal, error: dealErr } = await query.maybeSingle();

    if (dealErr) return jr({ ok: false, error: dealErr.message }, 200);
    if (!deal) return jr({ ok: false, error: "not found" }, 200);

    // Dados base + RPCs de progresso e histórico (snapshots como fonte única).
    const [
      { data: playlists, error: plErr },
      { data: songs, error: songsErr },
      { data: progressRpc, error: progressErr },
      { data: historyRpc, error: historyErr },
      { data: latestSnaps, error: snapsErr },
    ] = await Promise.all([
      admin
        .from("curator_playlists")
        .select(
          "id, deal_id, song_id, spotify_url, playlist_name, followers, is_baseline, added_at, spotify_playlist_id, spotify_owner_id, spotify_owner_name, image_url, added_at_spotify, match_status, match_reason, last_paste_at",
        )
        .eq("deal_id", deal.id)
        .or("match_status.eq.curator,is_baseline.eq.true")
        .order("added_at", { ascending: true }),
      admin
        .from("curator_deal_songs")
        .select(
          "id, deal_id, song_spotify_url, spotify_track_id, song_name, song_artist, song_cover_url, daily_goal, target_plays, baseline_plays, position, started_at, ends_at, ramp_up_days, created_at",
        )
        .eq("deal_id", deal.id)
        .order("position", { ascending: true }),
      admin.rpc("get_curator_deal_progress", { p_deal_id: deal.id }),
      admin.rpc("get_curator_deal_snapshot_history", { p_deal_id: deal.id }),
      admin
        .from("curator_deal_snapshots")
        .select("playlist_id, captured_at, plays_24h, plays_7d, plays_28d, is_baseline")
        .eq("deal_id", deal.id)
        .eq("is_baseline", false)
        .order("captured_at", { ascending: false }),
    ]);

    if (plErr) return jr({ ok: false, error: plErr.message }, 200);
    if (songsErr) return jr({ ok: false, error: songsErr.message }, 200);
    if (progressErr) return jr({ ok: false, error: progressErr.message }, 200);
    if (historyErr) return jr({ ok: false, error: historyErr.message }, 200);
    if (snapsErr) return jr({ ok: false, error: snapsErr.message }, 200);

    // Último snapshot por playlist (já vem ordenado desc).
    const latestByPlaylist: Record<string, { plays_24h: number | null; plays_7d: number | null; plays_28d: number | null; captured_at: string }> = {};
    for (const s of (latestSnaps ?? []) as any[]) {
      if (!s.playlist_id) continue;
      if (!latestByPlaylist[s.playlist_id]) {
        latestByPlaylist[s.playlist_id] = {
          plays_24h: s.plays_24h ?? null,
          plays_7d: s.plays_7d ?? null,
          plays_28d: s.plays_28d ?? null,
          captured_at: s.captured_at,
        };
      }
    }

    // Gate informativo: leitura segue permitida (curador vê o histórico),
    // mas o frontend usa esse flag pra desabilitar mutações.
    const gate = assertDealOperable(deal as any);
    const access = gate.ok
      ? { writable: true }
      : { writable: false, code: gate.code, reason: gate.error };

    // Campaign shadow context: quando o deal é shadow de uma campanha,
    // o portal precisa saber se a baseline já foi capturada antes de aceitar
    // cadastros de playlist (sistema de identidade por playlist_id).
    let campaign_context: {
      is_campaign_shadow: boolean;
      campaign_id: string | null;
      baseline_status: string | null;
      baseline_captured_at: string | null;
      baseline_playlist_count: number;
    } = {
      is_campaign_shadow: false,
      campaign_id: null,
      baseline_status: null,
      baseline_captured_at: null,
      baseline_playlist_count: 0,
    };
    if ((deal as any).source === "campaign_internal" && (deal as any).campaign_id) {
      const campaignId = (deal as any).campaign_id as string;
      const { data: camp } = await admin
        .from("campaigns")
        .select("baseline_status, baseline_captured_at")
        .eq("id", campaignId)
        .maybeSingle();
      const { count: baselineCount } = await admin
        .from("campaign_playlist_collections")
        .select("playlist_id", { count: "exact", head: true })
        .eq("campaign_id", campaignId)
        .eq("is_baseline", true);
      campaign_context = {
        is_campaign_shadow: true,
        campaign_id: campaignId,
        baseline_status: (camp as any)?.baseline_status ?? null,
        baseline_captured_at: (camp as any)?.baseline_captured_at ?? null,
        baseline_playlist_count: baselineCount ?? 0,
      };
    }

    return jr({
      ok: true,
      deal,
      access,
      campaign_context,
      playlists: (playlists ?? []).map((p: any) => ({
        ...p,
        plays_24h: latestByPlaylist[p.id]?.plays_24h ?? null,
        plays_7d: latestByPlaylist[p.id]?.plays_7d ?? null,
        plays_28d: latestByPlaylist[p.id]?.plays_28d ?? null,
        last_window_capture_at: latestByPlaylist[p.id]?.captured_at ?? null,
      })),
      songs: songs ?? [],
      progress: progressRpc ?? null,
      snapshot_history: historyRpc ?? [],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jr({ ok: false, error: msg }, 200);
  }
});
