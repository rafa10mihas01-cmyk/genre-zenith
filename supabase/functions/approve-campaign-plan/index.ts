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
import { distributeEcoPositions, chartTierFromTopPosition } from "../_shared/computeEcoPlan.ts";
import { getGenreNeighbors } from "../_shared/genre-affinity.ts";

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
      "spotify_track_url, cover_url, goal_plays, deadline, started_at, simulation_snapshot, client_id",
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

  // 1.5) Fix #2: Verificação de conflito de posição.
  // Antes de aprovar, garante que nenhuma playlist do plano desta campanha já
  // tem outra campanha ATIVA/PAUSADA para a MESMA faixa. Sem isso, duas
  // campanhas concorreriam pela mesma posição na mesma playlist+faixa.
  if (campaign.spotify_track_id) {
    const { data: myAllocs } = await admin
      .from("campaign_eco_allocations")
      .select("managed_playlist_id, managed_playlists(name)")
      .eq("campaign_id", campaignId);

    const playlistIds = (myAllocs ?? [])
      .map((a: any) => a.managed_playlist_id)
      .filter(Boolean);

    if (playlistIds.length > 0) {
      const { data: conflicts } = await admin
        .from("campaign_eco_allocations")
        .select(
          "managed_playlist_id, managed_playlists(name), campaigns!inner(id, track_name, status, spotify_track_id)",
        )
        .in("managed_playlist_id", playlistIds)
        .neq("campaign_id", campaignId)
        .in("campaigns.status", ["active", "paused"])
        .eq("campaigns.spotify_track_id", campaign.spotify_track_id);

      if (conflicts && conflicts.length > 0) {
        const list = conflicts.map((c: any) => ({
          playlist_id: c.managed_playlist_id,
          playlist_name: c.managed_playlists?.name ?? "(playlist)",
          conflict_campaign_id: c.campaigns?.id,
          conflict_campaign_track: c.campaigns?.track_name,
        }));
        return json(
          {
            ok: false,
            error: "position_conflict",
            message:
              "Não é possível aprovar: esta faixa já está em campanha ativa em uma ou mais playlists do plano.",
            conflicts: list,
          },
          409,
        );
      }
    }
  }



  // 2) Aprova plano + garante valor_cobrado a partir do snapshot do cliente.
  // O simulation_snapshot.clientPriceTotal é a fonte de verdade do preço
  // apresentado (e aceito) pelo cliente no portal. Se valor_cobrado estiver
  // NULL no momento da aprovação, copiamos dali — sem isso o financeiro
  // perde o ticket dessa campanha.
  const snap = (campaign as any).simulation_snapshot ?? null;
  const snapPrice = Number(snap?.clientPriceTotal ?? 0);
  const resolvedValorCobrado =
    campaign.valor_cobrado != null
      ? Number(campaign.valor_cobrado)
      : Number.isFinite(snapPrice) && snapPrice > 0
        ? snapPrice
        : null;

  const nowIso = new Date().toISOString();
  const approvePatch: Record<string, unknown> = {
    plan_approved_at: nowIso,
    plan_approved_by: userId,
  };
  if (campaign.valor_cobrado == null && resolvedValorCobrado != null) {
    approvePatch.valor_cobrado = resolvedValorCobrado;
  }

  const { error: updErr } = await admin
    .from("campaigns")
    .update(approvePatch)
    .eq("id", campaignId);
  if (updErr) return json({ ok: false, error: `approve_failed: ${updErr.message}` }, 500);

  // Refletir no objeto local pra resto do fluxo (cost do deal usa isso).
  (campaign as any).valor_cobrado = resolvedValorCobrado;

  // Backfill: se a campanha (legada) foi criada sem `position` em campaign_eco_allocations,
  // materializa agora — idempotente. Só toca em linhas onde position IS NULL.
  try {
    const snapDays = Number(snap?.days ?? 0);
    const mult = Math.max(1, Math.round(Number((campaign as any).engagement_multiplier ?? snap?.engagement_multiplier ?? 30)));
    const topPos = Number(snap?.music?.top200Position ?? snap?.music?.top200Pos ?? 0) || null;
    const chartTier = chartTierFromTopPosition(topPos);
    if (snapDays > 0) {
      const { data: ecoRows } = await admin
        .from("campaign_eco_allocations")
        .select("id, planned_streams, position, genre_source, managed_playlists(followers)")
        .eq("campaign_id", campaignId);
      const rows = (ecoRows ?? []) as any[];
      const hasNull = rows.some(r => r.position == null);
      if (hasNull && rows.length > 0) {
        const positions = distributeEcoPositions(
          rows.map(r => ({
            id: r.id,
            planned_streams: Number(r.planned_streams ?? 0),
            followers: Number(r.managed_playlists?.followers ?? 0),
            genreSource: (r.genre_source as "primary" | "affinity" | null) ?? "primary",
          })),
          snapDays, mult, { chartTier },
        );
        // UPDATE só nas que estão NULL (preserva eventual override manual já gravado).
        await Promise.all(
          rows.filter(r => r.position == null).map(r =>
            admin.from("campaign_eco_allocations")
              .update({ position: positions.get(r.id) ?? null })
              .eq("id", r.id),
          ),
        );
      }
    }
  } catch (_e) {
    // Backfill é best-effort — não bloqueia aprovação.
  }


  // Safety net: se a capacidade total das allocs eco for < 80% do goal_plays
  // E ainda não houver expansão de afinidade gravada, busca gêneros vizinhos
  // (score ≥ 0.60) e completa com playlists novas até cobrir 100% — limite de
  // 40% da meta vindo de vizinhos. Idempotente: skip se já existe alloc
  // com genre_source='affinity'.
  try {
    const goalPlays = Number((campaign as any).goal_plays ?? 0);
    const snapDays = Number(snap?.days ?? 0);
    const mult = Math.max(1, Math.round(Number((campaign as any).engagement_multiplier ?? 30)));

    if (goalPlays > 0 && snapDays > 0) {
      const { data: existingAllocs } = await admin
        .from("campaign_eco_allocations")
        .select("id, planned_streams, managed_playlist_id, genre_source, managed_playlists(genre_id, followers)")
        .eq("campaign_id", campaignId);

      const allocs = (existingAllocs ?? []) as any[];
      const alreadyExpanded = allocs.some(a => a.genre_source === "affinity");
      const totalPlanned = allocs.reduce((s, a) => s + Number(a.planned_streams ?? 0), 0);
      const coverage = goalPlays > 0 ? totalPlanned / goalPlays : 1;

      // Descobre genre_id primário a partir das allocs existentes (moda)
      const genreCounts = new Map<string, number>();
      for (const a of allocs) {
        const gid = a.managed_playlists?.genre_id;
        if (gid) genreCounts.set(gid, (genreCounts.get(gid) ?? 0) + 1);
      }
      const primaryGenreId = [...genreCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

      if (!alreadyExpanded && coverage < 0.8 && primaryGenreId) {
        const neighbors = await getGenreNeighbors(admin, primaryGenreId, 0.6);
        if (neighbors.length > 0) {
          const usedIds = new Set(allocs.map(a => a.managed_playlist_id));
          const neighborGenreIds = neighbors.map(n => n.genre_id);
          const { data: candidatePls } = await admin
            .from("managed_playlists")
            .select("id, followers, genre_id")
            .in("genre_id", neighborGenreIds)
            .is("archived_at", null)
            .gte("followers", 100)
            .order("followers", { ascending: false });

          const affByGenre = new Map(neighbors.map(n => [n.genre_id, n.score]));
          const fresh = (candidatePls ?? []).filter((p: any) => !usedIds.has(p.id));

          // Limite: vizinhos até 40% do goal, mas só preenchendo o gap.
          const maxNeighborBudget = Math.round(goalPlays * 0.4);
          const gap = Math.max(0, goalPlays - totalPlanned);
          let neighborBudget = Math.min(maxNeighborBudget, gap);

          const SLOT_PCT = 0.08;
          const rows: any[] = [];
          for (const p of fresh) {
            if (neighborBudget <= 0) break;
            const followers = Number(p.followers ?? 0);
            const cap = Math.max(1, Math.round(followers * (mult / 30) * SLOT_PCT * snapDays));
            const planned = Math.min(cap, neighborBudget);
            if (planned <= 0) continue;
            rows.push({
              campaign_id: campaignId,
              managed_playlist_id: p.id,
              planned_streams: planned,
              start_day: 1,
              status: "pending",
              position: 3,
              genre_source: "affinity",
              genre_affinity_score: affByGenre.get(p.genre_id) ?? null,
            });
            neighborBudget -= planned;
          }

          if (rows.length > 0) {
            await admin.from("campaign_eco_allocations").insert(rows);
          }
        }
      }
    }
  } catch (e) {
    console.warn("[approve-campaign-plan] affinity expansion failed:", (e as Error).message);
  }


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

  // 8) Liga deal à campanha (bidirecional: campaigns.deal_id ↔ curator_deals.campaign_id)
  if (newDealId) {
    await admin
      .from("campaigns")
      .update({ deal_id: newDealId, auto_deal_created: true })
      .eq("id", campaignId);

    // 8.0) Grava o vínculo reverso no deal — sem isso o deal fica órfão da
    // campanha e queries por campaign_id (relatórios, financeiro, execução)
    // não acham o deal recém-criado.
    await admin
      .from("curator_deals")
      .update({ campaign_id: campaignId })
      .eq("id", newDealId);

    // 8.1) Marca songs shadow como auto_collect=true pra entrar na fila do bot.
    // Sem isso, bot-collect-queue filtra `.eq("auto_collect", true)` e nunca
    // coleta — campaign_eco_snapshots fica vazio.
    await admin
      .from("curator_deal_songs")
      .update({ auto_collect: true, next_auto_collect_at: new Date().toISOString() })
      .eq("deal_id", newDealId);
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
        // Plain insert — seed roda uma única vez por criação de deal.
        // O índice único existente é parcial com COALESCE, então ON CONFLICT
        // não casa; insert direto é seguro porque não há linhas pré-existentes.
        // deno-lint-ignore no-explicit-any
        await admin.from("curator_playlists").insert(rows as any[]);
        seeded_playlists = rows.length;
      }
    } catch (_e) {
      // Não bloqueia aprovação se seed falhar — log silencioso.
    }
  }

  // 10) Notifica o curador (destinatário = curators.user_id). O enum
  // notification_type tem apenas info/warning/critical — a categoria
  // semântica "new_deal" vai no metadata.
  let notification_sent = false;
  if (newDealId && campaign.curator_id) {
    try {
      const { data: curatorUser } = await admin
        .from("curators")
        .select("user_id, name")
        .eq("id", campaign.curator_id)
        .maybeSingle();
      const recipientUserId = (curatorUser as any)?.user_id ?? null;
      if (recipientUserId) {
        await admin.from("notifications").insert({
          user_id: recipientUserId,
          type: "info",
          title: "Novo deal criado",
          message:
            "Novo deal criado — acesse seu portal para registrar as playlists",
          metadata: {
            category: "new_deal",
            deal_id: newDealId,
            campaign_id: campaignId,
            curator_id: campaign.curator_id,
          },
        });
        notification_sent = true;
      }
    } catch (_e) {
      // Não bloqueia aprovação se notificação falhar.
    }
  }

  return json({
    ok: true,
    already_approved: false,
    deal_created: !!newDealId,
    deal_id: newDealId,
    seeded_playlists,
    notification_sent,
    flag_on: true,
  });
});

