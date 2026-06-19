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
import { distributeEcoPositions, distributeByDailyNeed, chartTierFromTopPosition, ECO_DAILY_TOLERANCE } from "../_shared/computeEcoPlan.ts";
import { applyDominanceRelief, type ReliefCandidate } from "../_shared/dominanceRelief.ts";

import {
  getReservationsByPlaylist,
  reservationsToDailyCap,
  ECO_BUDGET_ENABLED,
} from "../_shared/eco-budget.ts";
import { getGenreNeighbors } from "../_shared/genre-affinity.ts";
import { MIN_PLAYLIST_SAVES_FOR_CAMPAIGN } from "../_shared/eco-constants.ts";

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
  // Autorização: dono da campanha OU membro do time (admin/curador).
  // Campanhas legadas podem ter created_by NULL — nesse caso liberamos só pro time.
  if (campaign.created_by !== userId) {
    const { data: hasAccess, error: accessErr } = await userClient.rpc("has_team_access");
    if (accessErr || !hasAccess) {
      return json({ ok: false, error: "forbidden" }, 403);
    }
    // Backfill leve: se created_by estava NULL, registra o aprovador como dono.
    if (!campaign.created_by) {
      await admin.from("campaigns").update({ created_by: userId }).eq("id", campaignId);
      (campaign as any).created_by = userId;
    }
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
  // Regra (pós-consolidação financeira): valor_cobrado é OBRIGATÓRIO.
  // Tentamos resolver pelo simulation_snapshot.clientPriceTotal; se não houver
  // valor válido em nenhuma fonte, a aprovação é bloqueada — sem isso a
  // campanha entraria no sistema sem ticket financeiro e quebraria os KPIs
  // consolidados (v_financial_summary).
  const snap = (campaign as any).simulation_snapshot ?? null;
  const snapPrice = Number(snap?.clientPriceTotal ?? 0);
  const resolvedValorCobrado =
    campaign.valor_cobrado != null
      ? Number(campaign.valor_cobrado)
      : Number.isFinite(snapPrice) && snapPrice > 0
        ? snapPrice
        : null;

  if (resolvedValorCobrado == null || !Number.isFinite(resolvedValorCobrado) || resolvedValorCobrado <= 0) {
    return json(
      {
        ok: false,
        error: "valor_cobrado_required",
        message:
          "Valor contratado obrigatório. Defina o preço da campanha (valor cobrado) antes de aprovar o plano.",
      },
      400,
    );
  }


  const nowIso = new Date().toISOString();

  // ─── ATOMICIDADE (Fix Auditoria #1) ───
  // Calculamos os payloads em TS (lógica de afinidade, distribuição de
  // posições) mas o UPDATE de aprovação + backfill de positions + INSERT
  // de allocs de afinidade roda numa única transação via RPC
  // `approve_campaign_plan_atomic`. Se qualquer passo falhar, tudo reverte
  // — sem campanha aprovada com posições NULL ou cobertura quebrada.
  let positionUpdates: Array<{ id: string; position: number }> = [];
  const newAffinityAllocs: any[] = [];

  // 2a) Calcula backfill de positions (lê estado atual)
  try {
    const snapDays = Number(snap?.days ?? 0);
    const mult = Math.max(1, Math.round(Number((campaign as any).engagement_multiplier ?? snap?.engagement_multiplier ?? 35)));
    const topPos = Number(snap?.music?.top200Position ?? snap?.music?.top200Pos ?? 0) || null;
    const chartTier = chartTierFromTopPosition(topPos);
    if (snapDays > 0) {
      const { data: ecoRows } = await admin
        .from("campaign_eco_allocations")
        .select("id, planned_streams, position, genre_source, managed_playlist_id, managed_playlists(id, followers)")
        .eq("campaign_id", campaignId);
      const rows = (ecoRows ?? []) as any[];
      const hasNull = rows.some(r => r.position == null);
      if (hasNull && rows.length > 0) {
        // NOVO: posição por capacidade real vs. necessidade diária.
        // dailyNeed = soma de planned_streams / days (o que o planner alocou).
        // Fallback para chart-tier se dailyNeed inválido (snapshot incompleto).
        const totalPlanned = rows.reduce((s, r) => s + Number(r.planned_streams ?? 0), 0);
        const dailyNeed = snapDays > 0 ? totalPlanned / snapDays : 0;

        const allocsInput = rows.map(r => ({
          id: r.id,
          planned_streams: Number(r.planned_streams ?? 0),
          followers: Number(r.managed_playlists?.followers ?? 0),
          genreSource: (r.genre_source as "primary" | "affinity" | null) ?? "primary",
        }));

        // ─── Orçamento de audiência (camada de proteção) ───
        let maxCapById: Map<string, number> | undefined;
        let droppedByBudget = 0;
        if (ECO_BUDGET_ENABLED && (campaign as any).started_at) {
          const startedAt = new Date((campaign as any).started_at);
          const endsAt = new Date(startedAt.getTime() + snapDays * 86400000);
          const playlistIds = rows
            .map(r => r.managed_playlist_id ?? r.managed_playlists?.id)
            .filter((v): v is string => typeof v === "string" && v.length > 0);
          if (playlistIds.length > 0) {
            const reservations = await getReservationsByPlaylist(admin, {
              excludeCampaignId: campaignId,
              playlistIds,
              windowStart: startedAt.toISOString(),
              windowEnd: endsAt.toISOString(),
            });
            const playlistsInfo = new Map<string, { followers: number }>();
            for (const r of rows) {
              const pid = r.managed_playlist_id ?? r.managed_playlists?.id;
              if (typeof pid === "string") {
                playlistsInfo.set(pid, { followers: Number(r.managed_playlists?.followers ?? 0) });
              }
            }
            const capByPlaylist = reservationsToDailyCap(reservations, playlistsInfo, mult, snapDays);
            // Re-mapear playlist_id → alloc_id (distributeByDailyNeed indexa por alloc id).
            maxCapById = new Map();
            for (const r of rows) {
              const pid = r.managed_playlist_id ?? r.managed_playlists?.id;
              const cap = typeof pid === "string" ? capByPlaylist.get(pid) ?? Infinity : Infinity;
              maxCapById.set(r.id, cap);
              if (cap <= 0) droppedByBudget += 1;
            }
          }
        }

        // PRESENÇA: se a música já está em alguma managed_playlist do plano,
        // o planner usa essa posição como teto (promove se for melhorar, nunca
        // rebaixa) e dá leve preferência a essas playlists em empates de cap.
        const currentPositionById = new Map<string, number>();
        if ((campaign as any).spotify_track_id) {
          const playlistIds = rows
            .map(r => r.managed_playlist_id ?? r.managed_playlists?.id)
            .filter((v): v is string => typeof v === "string");
          if (playlistIds.length > 0) {
            const { data: presence } = await admin
              .from("managed_playlist_tracks")
              .select("playlist_id, position")
              .eq("spotify_track_id", (campaign as any).spotify_track_id)
              .in("playlist_id", playlistIds);
            const posByPlaylist = new Map<string, number>();
            for (const t of (presence ?? []) as any[]) {
              const pos = Number(t.position);
              if (Number.isFinite(pos) && pos > 0) posByPlaylist.set(t.playlist_id, pos);
            }
            for (const r of rows) {
              const pid = r.managed_playlist_id ?? r.managed_playlists?.id;
              const pos = pid ? posByPlaylist.get(pid) : null;
              if (pos != null) currentPositionById.set(r.id, pos);
            }
          }
        }

        let positions: Map<string, number>;
        if (dailyNeed > 0) {
          const dist = distributeByDailyNeed(allocsInput, dailyNeed, mult, ECO_DAILY_TOLERANCE, { maxCapById, currentPositionById });
          positions = dist.positions;
          console.log("[approve] positions via daily_need", {
            dailyNeed: Math.round(dailyNeed),
            coveredDaily: Math.round(dist.coveredDaily),
            tolerance: ECO_DAILY_TOLERANCE,
            playlists: rows.length,
            ecoBudgetEnabled: ECO_BUDGET_ENABLED,
            droppedByBudget,
            withPresence: currentPositionById.size,
          });
        } else {
          positions = distributeEcoPositions(allocsInput, snapDays, mult, { chartTier });
          console.log("[approve] positions via chart_tier fallback", { chartTier, playlists: rows.length });
        }

        // ─── Diversificação de POSIÇÃO (anti-repetição entre campanhas) ───
        // Para cada playlist usada, consulta posições já ocupadas por allocs
        // ATIVAS de OUTRAS campanhas (últimos 30d) e escolhe, dentro de uma
        // FAIXA fixa [base, base+SPREAD-1] clampada em [1,20], a posição
        // menos ocupada. Empate → menor (preserva base). Não troca playlist,
        // não altera planned_streams; só evita posições idênticas.
        const SPREAD_WINDOW = 5;
        const MAX_POS = 20;
        const usageByPlaylist = new Map<string, Map<number, number>>();
        try {
          const playlistIds = rows
            .map(r => r.managed_playlist_id ?? r.managed_playlists?.id)
            .filter((v): v is string => typeof v === "string" && v.length > 0);
          if (playlistIds.length > 0) {
            const sinceIso = new Date(Date.now() - 30 * 86400000).toISOString();
            const { data: otherAllocs } = await admin
              .from("campaign_eco_allocations")
              .select("managed_playlist_id, position, status, campaigns!inner(id, started_at)")
              .in("managed_playlist_id", playlistIds)
              .in("status", ["pending", "approved", "dispatched", "done"])
              .neq("campaign_id", campaignId)
              .gte("campaigns.started_at", sinceIso);
            for (const a of (otherAllocs ?? []) as any[]) {
              const pid = a.managed_playlist_id;
              const pos = Number(a.position);
              if (!pid || !Number.isFinite(pos) || pos <= 0) continue;
              let m = usageByPlaylist.get(pid);
              if (!m) { m = new Map(); usageByPlaylist.set(pid, m); }
              m.set(pos, (m.get(pos) ?? 0) + 1);
            }
          }
        } catch (e) {
          console.warn("[approve] spread lookup failed (using base positions):", (e as Error)?.message ?? e);
        }

        const pickSpread = (playlistId: string | null | undefined, basePos: number): number => {
          const base = Math.max(1, Math.min(MAX_POS, Math.round(basePos)));
          if (!playlistId) return base;
          const hi = Math.min(MAX_POS, base + SPREAD_WINDOW - 1);
          const usage = usageByPlaylist.get(playlistId) ?? new Map<number, number>();
          let bestPos = base;
          let bestCount = usage.get(base) ?? 0;
          for (let p = base + 1; p <= hi; p++) {
            const c = usage.get(p) ?? 0;
            if (c < bestCount) { bestCount = c; bestPos = p; }
          }
          // Marca uso local pra que próximas linhas desta mesma campanha
          // também diversifiquem entre si.
          let m = usageByPlaylist.get(playlistId);
          if (!m) { m = new Map(); usageByPlaylist.set(playlistId, m); }
          m.set(bestPos, (m.get(bestPos) ?? 0) + 1);
          return bestPos;
        };

        positionUpdates = rows
          .filter(r => r.position == null)
          // Se a playlist ficou sem saldo (cap=0), ainda gravamos uma posição
          // (a mais profunda) — não removemos allocs no backfill pra não
          // quebrar plano já aprovado pelo cliente. O orçamento só age
          // efetivamente no replan (que escolhe novas playlists).
          .map(r => {
            const base = positions.get(r.id) ?? 3;
            const pid = r.managed_playlist_id ?? r.managed_playlists?.id ?? null;
            return { id: r.id, position: pickSpread(pid, base) };
          });
        console.log("[approve] position spread applied", {
          window: SPREAD_WINDOW,
          maxPos: MAX_POS,
          playlistsWithUsage: usageByPlaylist.size,
        });
      }

    }
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    console.error("[approve-campaign-plan] position backfill calc failed:", msg);
    return json(
      {
        ok: false,
        error: "position_backfill_failed",
        message:
          "Falha ao calcular posições do plano. Aprovação abortada para não gravar alocações sem position. Detalhe: " +
          msg,
      },
      500,
    );
  }


  // 2b) Calcula expansão de afinidade (safety net se cobertura ECO < 80%).
  // IMPORTANTE: compara contra a meta Eco congelada, não contra a meta total
  // da campanha. Caso contrário, campanha híbrida de funk puxa trap sem precisar.
  try {
    const goalPlays = Number((campaign as any).goal_plays ?? 0);
    const snapDays = Number(snap?.effectiveDays ?? snap?.days ?? 0);
    const mult = Math.max(1, Math.round(Number((campaign as any).engagement_multiplier ?? 35)));
    const snapEcoTarget = Number(snap?.streamsEco ?? 0);
    const splitEcoPct = Number(snap?.splitEcoPct ?? 0);
    const ecoTarget = snapEcoTarget > 0
      ? snapEcoTarget
      : goalPlays > 0 && splitEcoPct > 0
        ? Math.round(goalPlays * (splitEcoPct / 100))
        : 0;

    if (ecoTarget > 0 && snapDays > 0) {
      const { data: existingAllocs } = await admin
        .from("campaign_eco_allocations")
        .select("id, planned_streams, managed_playlist_id, genre_source, managed_playlists(genre_id, followers)")
        .eq("campaign_id", campaignId);

      const allocs = (existingAllocs ?? []) as any[];
      const alreadyExpanded = allocs.some(a => a.genre_source === "affinity");
      const totalPlanned = allocs.reduce((s, a) => s + Number(a.planned_streams ?? 0), 0);
      const coverage = ecoTarget > 0 ? totalPlanned / ecoTarget : 1;

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
          const { data: primaryCandidates } = await admin
            .from("managed_playlists")
            .select("id, followers")
            .eq("genre_id", primaryGenreId)
            .is("archived_at", null)
            .gte("followers", MIN_PLAYLIST_SAVES_FOR_CAMPAIGN)
            .order("followers", { ascending: false });
          const remainingPrimaryDaily = ((primaryCandidates ?? []) as any[])
            .filter((p: any) => !usedIds.has(p.id))
            .reduce((sum: number, p: any) => sum + Number(p.followers ?? 0) * (mult / 30) * 0.12, 0);
          const remainingEcoDailyGap = Math.max(0, (ecoTarget - totalPlanned) / snapDays);
          const primaryCoversGap = remainingPrimaryDaily >= remainingEcoDailyGap * 0.95;
          if (primaryCoversGap) {
            console.log("[approve] affinity skipped: primary inventory covers eco gap", {
              ecoTarget,
              totalPlanned,
              remainingEcoDailyGap: Math.round(remainingEcoDailyGap),
              remainingPrimaryDaily: Math.round(remainingPrimaryDaily),
            });
          }
          const neighborGenreIds = primaryCoversGap ? [] : neighbors.map(n => n.genre_id);
          const { data: candidatePls } = neighborGenreIds.length > 0
            ? await admin
                .from("managed_playlists")
                .select("id, followers, genre_id")
                .in("genre_id", neighborGenreIds)
                .is("archived_at", null)
                .gte("followers", MIN_PLAYLIST_SAVES_FOR_CAMPAIGN)
                .order("followers", { ascending: false })
            : { data: [] };

          const affByGenre = new Map(neighbors.map(n => [n.genre_id, n.score]));
          const fresh = (candidatePls ?? []).filter((p: any) => !usedIds.has(p.id));

          const maxNeighborBudget = Math.round(ecoTarget * 0.4);
          const gap = Math.max(0, ecoTarget - totalPlanned);
          let neighborBudget = Math.min(maxNeighborBudget, gap);

          const SLOT_PCT = 0.08;
          for (const p of fresh) {
            if (neighborBudget <= 0) break;
            const followers = Number(p.followers ?? 0);
            const cap = Math.max(1, Math.round(followers * (mult / 30) * SLOT_PCT * snapDays));
            const planned = Math.min(cap, neighborBudget);
            if (planned <= 0) continue;
            newAffinityAllocs.push({
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
        }
      }
    }
  } catch (e) {
    console.warn("[approve-campaign-plan] affinity expansion calc failed:", (e as Error).message);
  }

  // 2c) Executa atomicamente via RPC. Reverte tudo se qualquer passo falhar.
  const { data: rpcApprove, error: rpcApproveErr } = await admin.rpc(
    "approve_campaign_plan_atomic",
    {
      p_campaign_id: campaignId,
      p_user_id: userId,
      p_valor_cobrado: resolvedValorCobrado,
      p_position_updates: positionUpdates,
      p_new_allocs: newAffinityAllocs,
    },
  );

  if (rpcApproveErr) {
    return json({ ok: false, error: `approve_failed: ${rpcApproveErr.message}` }, 500);
  }
  if ((rpcApprove as any)?.already_approved) {
    return json({ ok: true, already_approved: true, deal_id: campaign.deal_id ?? null });
  }

  // Reflete no objeto local pra resto do fluxo (cost do deal usa isso).
  (campaign as any).valor_cobrado = resolvedValorCobrado;

  // ─── DOMINANCE_RELIEF_DEFAULT_FOR_NEW_CAMPAIGNS ───
  // Aplica alívio de concentração APENAS aqui (aprovação de plano novo).
  // Campanhas já aprovadas saem antes (`already_approved` short-circuit acima)
  // e nunca passam por esta seção — Carnívoro/Toma Botadão ficam intocados.
  // Replan, swap e execução também NÃO acionam relief.
  try {
    const mult = Math.max(1, Math.round(Number((campaign as any).engagement_multiplier ?? 35)));
    const { data: finalAllocs } = await admin
      .from("campaign_eco_allocations")
      .select("id, managed_playlist_id, planned_streams, position, genre_source, managed_playlists(followers, genre_id)")
      .eq("campaign_id", campaignId);

    const allocList = ((finalAllocs ?? []) as any[])
      .filter(a => a.managed_playlist_id && Number(a.planned_streams) > 0 && Number(a.position) > 0);

    if (allocList.length >= 5) {
      const reliefInput = allocList.map(a => ({
        id: a.id as string,
        playlist_id: a.managed_playlist_id as string,
        followers: Number(a.managed_playlists?.followers ?? 0),
        position: Number(a.position),
        planned_streams: Number(a.planned_streams),
        genre_source: (a.genre_source ?? "primary") as "primary" | "affinity",
      }));

      const usedIds = new Set(reliefInput.map(a => a.playlist_id));
      const genreCounts = new Map<string, number>();
      for (const a of allocList) {
        const g = a.managed_playlists?.genre_id;
        if (g) genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
      }
      const primaryGenreId = [...genreCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

      let pool: ReliefCandidate[] = [];
      if (primaryGenreId) {
        const { data: candPls } = await admin
          .from("managed_playlists")
          .select("id, followers")
          .eq("genre_id", primaryGenreId)
          .is("archived_at", null)
          .gte("followers", MIN_PLAYLIST_SAVES_FOR_CAMPAIGN)
          .order("followers", { ascending: false })
          .limit(20);
        pool = ((candPls ?? []) as any[])
          .filter(p => !usedIds.has(p.id))
          .map(p => ({ playlist_id: p.id, followers: Number(p.followers ?? 0), rank_score: Number(p.followers ?? 0) }));
      }

      const relief = applyDominanceRelief(reliefInput, pool, mult);
      console.log("[approve] dominance_relief", {
        applied: relief.applied,
        reason: relief.reason,
        top1Before: Number(relief.top1Before.toFixed(2)),
        top1After: Number(relief.top1After.toFixed(2)),
        redistributed: relief.redistributedStreams,
        added: relief.addedAllocs.length,
        capUsed: relief.capUsed,
      });

      if (relief.applied) {
        // Atualiza planned_streams das allocs existentes que mudaram.
        const originalById = new Map(reliefInput.map(r => [r.id, r.planned_streams]));
        const updates = relief.allocs
          .filter(a => !a.id.startsWith("relief:"))
          .filter(a => originalById.get(a.id) !== a.planned_streams)
          .map(a =>
            admin.from("campaign_eco_allocations")
              .update({ planned_streams: a.planned_streams })
              .eq("id", a.id),
          );

        // Insere playlists de expansão controlada (sempre primárias).
        if (relief.addedAllocs.length > 0) {
          const newRows = relief.addedAllocs.map(a => ({
            campaign_id: campaignId,
            managed_playlist_id: a.playlist_id,
            planned_streams: a.planned_streams,
            start_day: 1,
            status: "pending",
            position: a.position,
            genre_source: "primary",
          }));
          updates.push(admin.from("campaign_eco_allocations").insert(newRows) as any);
        }

        const results = await Promise.all(updates);
        for (const r of results) {
          if ((r as any)?.error) {
            console.warn("[approve] dominance_relief partial write error:", (r as any).error.message);
          }
        }
      }
    }
  } catch (e) {
    // Relief é best-effort: se falhar, o plano aprovado original permanece válido.
    console.warn("[approve-campaign-plan] dominance relief skipped:", (e as Error).message);
  }




  // 3) Lê feature flag
  const { data: flagRow } = await admin
    .from("system_flags")
    .select("auto_deal_from_campaign")
    .maybeSingle();
  // Default true quando flag está ausente/null — opt-out explícito (false) é o único jeito de desligar.
  const flagOn = flagRow?.auto_deal_from_campaign !== false;

  // 4) Decide se cria deal automaticamente
  const canAutoCreate =
    flagOn &&
    !campaign.deal_id &&
    !campaign.auto_deal_created &&
    (campaign.campaign_type === "ecosystem" || campaign.campaign_type === "hybrid") &&
    !!campaign.curator_id &&
    !!campaign.spotify_track_id;

  if (!canAutoCreate) {
    // Se o deal JÁ existe (criado em outro fluxo, ex.: criação da campanha),
    // ainda assim precisamos garantir o shadow-prep pra baseline rodar:
    // state=collecting, source=campaign_internal, auto_collect=true e seed das
    // managed playlists em curator_playlists. Sem isso, bot-collect-queue não
    // dispatcha e a baseline fica eternamente "Aguardando coleta".
    if (campaign.deal_id) {
      const existingDealId = campaign.deal_id as string;
      try {
        // Deal já existia: marca como shadow de campanha e ATIVA direto.
        // (Reversão 30/05: removido gate de awaiting_baseline — bot coleta
        // como antes; a 1ª foto S4A passa a ser captura natural, não bloqueio.)
        await admin
          .from("curator_deals")
          .update({
            campaign_id: campaignId,
            source: "campaign_internal",
            collection_mode: "bot",
            state: "active",
          })
          .eq("id", existingDealId);


        await admin
          .from("curator_deal_songs")
          .update({ auto_collect: true, next_auto_collect_at: new Date().toISOString() })
          .eq("deal_id", existingDealId);

        // Promove TODOS os demais curator_deals da mesma campanha (external
        // package / múltiplos curadores) que ainda estejam em collecting.
        // Sem isso, deals secundários ficam travados e o bot nunca dispara.
        const { data: promotedSecondary } = await admin
          .from("curator_deals")
          .update({ state: "active" })
          .eq("campaign_id", campaignId)
          .neq("id", existingDealId)
          .in("state", ["collecting", "awaiting_baseline"])
          .select("id");

        return json({
          ok: true,
          already_approved: false,
          deal_created: false,
          deal_id: existingDealId,
          shadow_prepared: true,
          seeded_playlists: 0,
          promoted_secondary_deals: promotedSecondary?.length ?? 0,
          flag_on: flagOn,
        });
      } catch (e) {
        return json({
          ok: true,
          already_approved: false,
          deal_created: false,
          deal_id: existingDealId,
          shadow_prepared: false,
          error: (e as Error).message,
          flag_on: flagOn,
        });
      }
    }

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
    // Marca baseline_status='pending' — a 1ª coleta do S4A vira a baseline oficial
    // (lida pelo bot-ingest-snapshot e gravada via ingest_campaign_collection_batch).
    await admin
      .from("campaigns")
      .update({
        deal_id: newDealId,
        auto_deal_created: true,
        baseline_status: "pending",
      })
      .eq("id", campaignId);

    // 8.0) Grava vínculo reverso + marca shadow de campanha interna.
    // (Reversão 30/05: deal nasce ATIVO; sem gate de baseline. Bot coleta como
    // antes, a 1ª foto S4A vira captura natural via bot-ingest-snapshot.)
    await admin
      .from("curator_deals")
      .update({
        campaign_id: campaignId,
        source: "campaign_internal",
        collection_mode: "bot",
        state: "active",
      })
      .eq("id", newDealId);


    // 8.1) Marca songs shadow como auto_collect=true pra entrar na fila do bot.
    // Sem isso, bot-collect-queue filtra `.eq("auto_collect", true)` e nunca
    // coleta — campaign_eco_snapshots fica vazio.
    await admin
      .from("curator_deal_songs")
      .update({ auto_collect: true, next_auto_collect_at: new Date().toISOString() })
      .eq("deal_id", newDealId);

    // Promove demais deals da mesma campanha (multi-curador / external package).
    await admin
      .from("curator_deals")
      .update({ state: "active" })
      .eq("campaign_id", campaignId)
      .neq("id", newDealId)
      .in("state", ["collecting", "awaiting_baseline"]);
  }

  // 9) Não semeia playlists planejadas como baseline. A baseline correta vem
  // do Spotify for Artists da música: o bot abre a faixa, lê todas as playlists
  // onde ela já aparece e só depois as listas próprias são cruzadas pelo ID.
  const seeded_playlists = 0;

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
        const curatorName = (curatorUser as any)?.name ?? "curador";
        await admin.rpc("create_notification" as any, {
          p_type: "info",
          p_title: "Nova parceria disponível",
          p_message:
            `Um novo deal foi criado para ${curatorName}. ` +
            `Ação: acesse o portal para registrar suas playlists.`,
          p_action_url: `/playlist-deals?deal=${newDealId}`,
          p_metadata: {
            domain: "curator",
            severity: "info",
            kind: "new_deal",
            action_required: true,
            deal_id: newDealId,
            campaign_id: campaignId,
            curator_id: campaign.curator_id,
          },
          p_dedupe_key: `new_deal:${newDealId}`,
          p_cooldown_minutes: 60 * 24,
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

