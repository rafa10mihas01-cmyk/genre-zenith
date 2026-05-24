// approve-campaign-plan — Etapa 2/4 do Item 2 (fluxo único pela campanha)
//
// Responsabilidade:
//   1) Marcar a campanha como "plano aprovado" (plan_approved_at / plan_approved_by).
//   2) Se a feature flag global `auto_deal_from_campaign` estiver ATIVA E
//      a campanha for ecosystem/hybrid E ainda não tiver deal vinculado E
//      tiver curator_id + custo + faixa → criar deal automaticamente via RPC
//      `create_curator_deal_atomic` e marcar `auto_deal_created = true`.
//
// PROTEÇÃO: flag default = false. Sem a flag, NUNCA cria deal — só aprova o plano.
// Os 9 deals legados estão seguros: nada toca neles.
//
// POST { campaign_id: uuid }
// Header: Authorization: Bearer <jwt do usuário dono da campanha>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ ok: false, error: "missing_auth" }, 401);
  }

  // Cliente "anon" só para validar JWT e descobrir o usuário
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes?.user) return json({ ok: false, error: "invalid_jwt" }, 401);
  const userId = userRes.user.id;

  // Cliente service-role para ler flag e gravar
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: { campaign_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  const campaignId = body?.campaign_id;
  if (!campaignId || typeof campaignId !== "string") {
    return json({ ok: false, error: "missing_campaign_id" }, 400);
  }

  // 1) Carrega campanha
  const { data: campaign, error: campErr } = await admin
    .from("campaigns")
    .select(
      "id, created_by, status, campaign_type, plan_approved_at, auto_deal_created, " +
      "deal_id, curator_id, valor_cobrado, track_name, artist, spotify_track_id, " +
      "spotify_track_url, cover_url, goal_plays, deadline, started_at",
    )
    .eq("id", campaignId)
    .maybeSingle();

  if (campErr) return json({ ok: false, error: campErr.message }, 500);
  if (!campaign) return json({ ok: false, error: "campaign_not_found" }, 404);
  if (campaign.created_by !== userId) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  // Idempotência: já aprovado
  if (campaign.plan_approved_at) {
    return json({
      ok: true,
      already_approved: true,
      deal_id: campaign.deal_id ?? null,
      auto_deal_created: !!campaign.auto_deal_created,
    });
  }

  // 2) Aprova plano
  const nowIso = new Date().toISOString();
  const { error: updErr } = await admin
    .from("campaigns")
    .update({
      plan_approved_at: nowIso,
      plan_approved_by: userId,
    })
    .eq("id", campaignId);
  if (updErr) return json({ ok: false, error: `approve_failed: ${updErr.message}` }, 500);

  // 3) Lê feature flag
  const { data: flagRow } = await admin
    .from("system_flags")
    .select("auto_deal_from_campaign")
    .maybeSingle();
  const flagOn = !!flagRow?.auto_deal_from_campaign;

  // 4) Decide se cria deal automaticamente
  const canAutoCreate =
    flagOn &&
    !campaign.deal_id &&
    !campaign.auto_deal_created &&
    (campaign.campaign_type === "ecosystem" || campaign.campaign_type === "hybrid") &&
    !!campaign.curator_id &&
    !!campaign.spotify_track_id;

  if (!canAutoCreate) {
    return json({
      ok: true,
      already_approved: false,
      deal_created: false,
      reason: flagOn ? "preconditions_not_met" : "flag_disabled",
      flag_on: flagOn,
    });
  }

  // 5) Busca nome do curador
  const { data: curatorRow } = await admin
    .from("curators")
    .select("name")
    .eq("id", campaign.curator_id!)
    .maybeSingle();
  const curatorName = curatorRow?.name ?? "Curador";

  // 6) Monta payload do RPC
  const goal = Number(campaign.goal_plays ?? 0);
  const startedAt = campaign.started_at ?? nowIso;
  const endsAt = campaign.deadline
    ? new Date(`${campaign.deadline}T23:59:59Z`).toISOString()
    : null;
  const durationDays = endsAt
    ? Math.max(
        1,
        Math.round(
          (new Date(endsAt).getTime() - new Date(startedAt).getTime()) / 86400000,
        ),
      )
    : 30;

  const dealPayload = {
    curator_id: campaign.curator_id,
    curator_name: curatorName,
    baseline_plays: 0,
    cost: campaign.valor_cobrado ?? null,
    started_at: startedAt,
    ends_at: endsAt,
    ramp_up_days: 5,
    billing_model: "per_streams",
    monthly_amount: null,
    cycle_months: null,
  };

  const songPayload = [{
    song_spotify_url: campaign.spotify_track_url,
    spotify_track_id: campaign.spotify_track_id,
    song_name: campaign.track_name,
    song_artist: campaign.artist ?? null,
    artist_candidates: campaign.artist ? [campaign.artist] : [],
    song_cover_url: campaign.cover_url ?? null,
    client_id: campaign.client_id ?? null,
    smartlink_url: null,
    daily_goal: Math.max(1, Math.round(goal / Math.max(1, durationDays))),
    duration_days: durationDays,
    target_plays: goal,
    position: 0,
    started_at: startedAt,
    ends_at: endsAt,
    ramp_up_days: 5,
  }];

  // 7) Cria deal via RPC atômica
  // IMPORTANTE: A RPC usa auth.uid() internamente (SECURITY DEFINER mas exige
  // contexto de usuário). Precisa ser chamada via userClient (JWT do dono da
  // campanha), não pelo admin (service role).
  // deno-lint-ignore no-explicit-any
  const { data: rpcRes, error: rpcErr } = await (userClient as any).rpc(
    "create_curator_deal_atomic",
    { p_deal: dealPayload, p_songs: songPayload, p_force: false, p_new_curator: null },
  );

  if (rpcErr) {
    const msg = String(rpcErr.message ?? rpcErr);
    // Aprovação manteve, só não criou deal
    return json({
      ok: true,
      already_approved: false,
      deal_created: false,
      reason: "rpc_failed",
      detail: msg,
    });
  }

  const newDealId = (rpcRes as { deal_id?: string })?.deal_id ?? null;

  // 8) Liga deal à campanha
  if (newDealId) {
    await admin
      .from("campaigns")
      .update({ deal_id: newDealId, auto_deal_created: true })
      .eq("id", campaignId);
  }

  // 9) Seed das managed playlists planejadas (campaign_eco_allocations) como
  // curator_playlists do deal-shadow. Sem isso, o bot DOM coleta e descarta
  // tudo como "no_match" e campaign_eco_snapshots nunca recebe linha.
  let seeded_playlists = 0;
  if (newDealId) {
    try {
      const { data: ecoAllocs } = await admin
        .from("campaign_eco_allocations")
        .select("managed_playlist_id, managed_playlists!inner(spotify_playlist_id,name)")
        .eq("campaign_id", campaignId);

      const { data: dealSongs } = await admin
        .from("curator_deal_songs")
        .select("id")
        .eq("deal_id", newDealId)
        .limit(1);
      const songId = (dealSongs?.[0] as any)?.id ?? null;

      const rows = (ecoAllocs ?? [])
        // deno-lint-ignore no-explicit-any
        .map((a: any) => {
          const spId = a.managed_playlists?.spotify_playlist_id;
          if (!spId) return null;
          return {
            deal_id: newDealId,
            song_id: songId,
            spotify_url: `https://open.spotify.com/playlist/${spId}`,
            spotify_playlist_id: spId,
            playlist_name: a.managed_playlists?.name ?? "Managed Playlist",
            is_baseline: true,
            match_status: "baseline",
            attribution_method: "campaign_seed",
            attribution_reason: "Seed from campaign_eco_allocations (auto)",
          };
        })
        .filter(Boolean);

      if (rows.length > 0) {
        // deno-lint-ignore no-explicit-any
        const { error: seedErr } = await admin
          .from("curator_playlists")
          .upsert(rows as any[], {
            onConflict: "deal_id,song_id,spotify_playlist_id",
            ignoreDuplicates: true,
          });
        if (!seedErr) seeded_playlists = rows.length;
      }
    } catch (_e) {
      // Não bloqueia aprovação se seed falhar — log silencioso.
    }
  }

  return json({
    ok: true,
    already_approved: false,
    deal_created: !!newDealId,
    deal_id: newDealId,
    seeded_playlists,
    flag_on: true,
  });
});

