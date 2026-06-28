// replan-campaign-eco — Adiciona playlists novas do gênero primário ao plano
// de uma campanha já aprovada, sem mexer nas allocs existentes.
//
// POST { campaign_id: uuid, dry_run?: boolean }
// Header: Authorization: Bearer <jwt do dono da campanha>
//
// Comportamento:
//  - dry_run=true (preview): retorna quantas playlists entrariam e plays/dia
//    adicionais. NÃO grava nada.
//  - dry_run=false (default): insere as novas allocs com status='approved',
//    genre_source='primary', position calculada via distributeEcoPositions
//    APENAS sobre as novas (não rebalanceia as existentes).
//
// Regras:
//  - Só considera managed_playlists do MESMO genre_id primário da campanha
//    (gênero majoritário entre as allocs atuais), não-arquivadas, com followers > 0.
//  - Ignora playlists já presentes em campaign_eco_allocations desta campanha
//    (qualquer status — preserva dispatched/done/pending/approved).
//  - planned_streams = round(followers × mult/30 × POSITION_PCT[pos-1] × days)
//    — mesma fórmula do buildEcoPlan.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  distributeEcoPositions,
  distributeByDailyNeed,
  POSITION_PCT,
  ecoPlanTotalMultiplier,
  selectCoverageMode,
  AFFINITY_RANGE_BY_MODE,
  chartTierFromTopPosition,
  ECO_DAILY_TOLERANCE,
} from "../_shared/computeEcoPlan.ts";
import {
  getReservationsByPlaylist,
  reservationsToDailyCap,
  ECO_BUDGET_ENABLED,
  PLANNER_FREE_FIRST_ENABLED,
  getOccupiedPlaylistIds,
  partitionByOccupancy,
} from "../_shared/eco-budget.ts";
import { getGenreNeighbors } from "../_shared/genre-affinity.ts";
import { MIN_PLAYLIST_SAVES_FOR_CAMPAIGN } from "../_shared/eco-constants.ts";
// dominanceRelief é aplicado no approve-campaign-plan (campanhas novas).
// Replan NÃO toca em relief — campanhas em execução ficam congeladas.



// Pequeno RNG determinístico (mesma família do computeEcoPlan) para
// distribuir uniformemente posições 5–10 nas playlists de gêneros vizinhos.
function seededRng(seed: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const NEIGHBOR_POS_MIN = 5;
const NEIGHBOR_POS_MAX = 10;
const NEIGHBOR_AFFINITY_THRESHOLD = 0.60;

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

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes?.user) return json({ ok: false, error: "invalid_jwt" }, 401);
  const userId = userRes.user.id;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: { campaign_id?: string; dry_run?: boolean; strategy?: "daily_need" | "chart_tier" };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  const campaignId = body?.campaign_id;
  const dryRun = !!body?.dry_run;
  const strategy: "daily_need" | "chart_tier" = body?.strategy === "chart_tier" ? "chart_tier" : "daily_need";
  if (!campaignId || typeof campaignId !== "string") {
    return json({ ok: false, error: "missing_campaign_id" }, 400);
  }


  // 1) Campanha + ownership
  const { data: campaign, error: campErr } = await admin
    .from("campaigns")
    .select("id, created_by, engagement_multiplier, simulation_snapshot, started_at, spotify_track_id")
    .eq("id", campaignId)
    .maybeSingle();
  if (campErr) return json({ ok: false, error: campErr.message }, 500);
  if (!campaign) return json({ ok: false, error: "campaign_not_found" }, 404);
  if (campaign.created_by && campaign.created_by !== userId) {
    const { data: isAdmin, error: roleErr } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });
    console.log("[replan] auth check", { userId, created_by: campaign.created_by, isAdmin, roleErr: roleErr?.message });
    if (!isAdmin) return json({ ok: false, error: "forbidden", debug: { userId, isAdmin, roleErr: roleErr?.message } }, 403);
  }

  const snap = (campaign as any).simulation_snapshot ?? null;
  const days = Number(snap?.effectiveDays ?? snap?.days ?? 0);
  const mult = Math.max(1, Math.round(Number((campaign as any).engagement_multiplier ?? snap?.engagement_multiplier ?? 35)));
  if (days <= 0) return json({ ok: false, error: "invalid_snapshot_days" }, 400);
  const campaignStartedAt = (campaign as any).started_at ? new Date((campaign as any).started_at) : new Date();
  const campaignEndsAt = new Date(campaignStartedAt.getTime() + days * 86400000);

  // 2) Allocs existentes — descobre gênero primário, playlists já usadas e capacidade atual
  const { data: existing, error: exErr } = await admin
    .from("campaign_eco_allocations")
    .select("managed_playlist_id, status, planned_streams, managed_playlists(genre_id)")
    .eq("campaign_id", campaignId);
  if (exErr) return json({ ok: false, error: exErr.message }, 500);

  const existingRows = (existing ?? []) as any[];
  if (existingRows.length === 0) {
    return json({ ok: false, error: "no_existing_allocations" }, 400);
  }

  const genreCounts = new Map<string, number>();
  const usedIds = new Set<string>();
  let existingTotalPlanned = 0;
  for (const r of existingRows) {
    if (r.managed_playlist_id) usedIds.add(r.managed_playlist_id);
    existingTotalPlanned += Number(r.planned_streams ?? 0);
    const gid = r.managed_playlists?.genre_id;
    if (gid) genreCounts.set(gid, (genreCounts.get(gid) ?? 0) + 1);
  }
  const primaryGenreId = [...genreCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  if (!primaryGenreId) {
    return json({ ok: false, error: "no_primary_genre" }, 400);
  }

  // 2b) Coverage ratio → modo adaptativo.
  //     metaEco = meta total × splitEcoPct/100; coverage = capacidade atual / metaEco.
  const meta = Number(snap?.meta ?? 0);
  const splitEcoPct = Number(snap?.splitEcoPct ?? 0);
  const metaEco = meta > 0 && splitEcoPct > 0 ? meta * (splitEcoPct / 100) : 0;
  const coverageRatio = metaEco > 0 ? existingTotalPlanned / metaEco : 1;
  const mode = selectCoverageMode(coverageRatio);
  const [affLo, affHi] = AFFINITY_RANGE_BY_MODE[mode];
  console.log("[replan] coverage", { existingTotalPlanned, metaEco, coverageRatio, mode, affinityRange: [affLo, affHi] });

  // 3) Candidatas PRIMÁRIAS: managed_playlists CAMPAIGN do mesmo gênero, fora do plano
  const { data: candidatePls, error: cErr } = await admin
    .from("managed_playlists")
    .select("id, followers, genre_id")
    .eq("genre_id", primaryGenreId)
    .eq("playlist_type", "CAMPAIGN")
    .gte("followers", MIN_PLAYLIST_SAVES_FOR_CAMPAIGN)
    .order("followers", { ascending: false });
  if (cErr) return json({ ok: false, error: cErr.message }, 500);

  const freshPrimary = (candidatePls ?? []).filter((p: any) => !usedIds.has(p.id));

  // 3b) Candidatas VIZINHAS: gêneros com afinidade >= 0.60 (excluindo o primário).
  //     Posições forçadas em AFFINITY_RANGE_BY_MODE (3-5 em modo máximo, senão 5-10).
  const neighbors = await getGenreNeighbors(admin, primaryGenreId, NEIGHBOR_AFFINITY_THRESHOLD);
  const neighborGenreIds = neighbors
    .map(n => n.genre_id)
    .filter(gid => gid && gid !== primaryGenreId);

  let freshNeighbor: any[] = [];
  if (neighborGenreIds.length > 0) {
    const { data: neighborPls, error: nErr } = await admin
      .from("managed_playlists")
      .select("id, followers, genre_id")
      .in("genre_id", neighborGenreIds)
      .eq("playlist_type", "CAMPAIGN")
      .gte("followers", MIN_PLAYLIST_SAVES_FOR_CAMPAIGN)
      .order("followers", { ascending: false });
    if (nErr) return json({ ok: false, error: nErr.message }, 500);
    freshNeighbor = (neighborPls ?? []).filter((p: any) => !usedIds.has(p.id));
  }

  if (freshPrimary.length === 0 && freshNeighbor.length === 0) {
    return json({
      ok: true,
      added: 0,
      plays_per_day_added: 0,
      mode,
      coverage_ratio: coverageRatio,
      message: "Nenhuma playlist nova (primário ou vizinhos) fora do plano.",
    });
  }

  // 4) Posições — CASCATA: primário primeiro, vizinho só pra fechar o gap.
  //    Regra: vizinhos (gêneros afins, ex: trap em campanha de funk) NÃO são
  //    misturados com primárias quando o primário ainda cobre a meta diária.
  //    Só entram se sobrar gap acima de NEIGHBOR_GAP_THRESHOLD após primário.
  const NEIGHBOR_GAP_THRESHOLD = 0.05; // 5% da meta diária
  const topPosition = Number(snap?.music?.top200Position ?? snap?.music?.top200Pos ?? 0) || null;
  const chartTier = chartTierFromTopPosition(topPosition);

  const primaryFresh = freshPrimary.map((p: any) => ({ id: p.id, planned_streams: 0, followers: Number(p.followers ?? 0), genreSource: "primary" as const }));
  const neighborFresh = freshNeighbor.map((p: any) => ({ id: p.id, planned_streams: 0, followers: Number(p.followers ?? 0), genreSource: "affinity" as const }));




  // Necessidade diária restante = (metaEco - já planejado) / dias.
  const dailyNeedRemaining = metaEco > 0
    ? Math.max(0, (metaEco - existingTotalPlanned)) / days
    : 0;

  // Se o plano aprovado já cobre a fatia ECO do snapshot, não existe gap de
  // PLANO para preencher. Antes daqui, daily_need caía no ramo chart_tier e,
  // com need=0, acabava selecionando todas as candidatas — por isso as duas
  // opções apareciam iguais (113 playlists) mesmo sem necessidade real.
  if (dailyNeedRemaining <= 0) {
    const summary = {
      added: 0,
      added_primary: 0,
      added_neighbor: 0,
      available_primary: freshPrimary.length,
      available_neighbor: freshNeighbor.length,
      plays_per_day_added: 0,
      plays_per_day_primary: 0,
      plays_per_day_neighbor: 0,
      neighbor_genres: neighborGenreIds,
      used_neighbors: false,
      coverage_ratio: coverageRatio,
      mode,
      affinity_range: [affLo, affHi],
      position_strategy: strategy === "chart_tier" ? "chart_tier_primary_only" : "daily_need_primary_only",
      strategy_requested: strategy,
      daily_need_remaining: 0,
      covered_daily_by_primary: 0,
      gap_after_primary: 0,
      neighbor_gap_threshold: NEIGHBOR_GAP_THRESHOLD,
      daily_tolerance: ECO_DAILY_TOLERANCE,
      eco_budget_enabled: ECO_BUDGET_ENABLED,
      playlists_dropped_by_budget: 0,
      message: "O plano aprovado já cobre a fatia ECO do snapshot; não há gap planejado para adicionar playlists.",
    };
    return json({ ok: true, dry_run: dryRun, ...summary });

  }

  // ─── Orçamento de audiência (camada de proteção) ───
  // Para cada playlist candidata, descobre quanto da capacidade teórica já
  // está reservada por OUTRAS campanhas ativas sobrepostas. O resultado é o
  // teto de cap diário que essa campanha pode consumir nessa playlist.
  // NÃO altera fórmula nem projeção: só limita a posição escolhida.
  const candidateIds = [
    ...primaryFresh.map(p => p.id),
    ...neighborFresh.map(p => p.id),
  ];
  const playlistsInfo = new Map<string, { followers: number }>();
  for (const p of primaryFresh) playlistsInfo.set(p.id, { followers: p.followers });
  for (const p of neighborFresh) playlistsInfo.set(p.id, { followers: p.followers });

  let maxCapById: Map<string, number> | undefined;
  let droppedByBudget = 0;
  if (ECO_BUDGET_ENABLED && candidateIds.length > 0) {
    const reservations = await getReservationsByPlaylist(admin, {
      excludeCampaignId: campaignId,
      playlistIds: candidateIds,
      windowStart: campaignStartedAt.toISOString(),
      windowEnd: campaignEndsAt.toISOString(),
    });
    maxCapById = reservationsToDailyCap(reservations, playlistsInfo, mult, days);
    for (const cap of maxCapById.values()) if (cap <= 0) droppedByBudget += 1;
  }

  // PRESENÇA: já está em alguma candidata? Promove em vez de rebaixar, e
  // ganha empate de cap. Não infla plano — só usa se a playlist couber.
  const currentPositionById = new Map<string, number>();
  if ((campaign as any).spotify_track_id && candidateIds.length > 0) {
    const { data: presence } = await admin
      .from("managed_playlist_tracks")
      .select("playlist_id, position")
      .eq("spotify_track_id", (campaign as any).spotify_track_id)
      .in("playlist_id", candidateIds);
    for (const t of (presence ?? []) as any[]) {
      const pos = Number(t.position);
      if (Number.isFinite(pos) && pos > 0) currentPositionById.set(t.playlist_id, pos);
    }
  }

  let allPositions: Map<string, number> = new Map();
  let positionStrategy: "daily_need_primary_only" | "daily_need_with_neighbors" | "chart_tier_primary_only" | "chart_tier_with_neighbors";
  let coveredDailyByNew = 0;
  let coveredDailyByPrimary = 0;
  let gapAfterPrimary = 0;
  let usedNeighbors = false;

  // ─── Anti-canibalização: particiona candidatas em Grupo A (livres) e B (ocupadas).
  // Consome SEMPRE A primeiro; B só entra se A não cobre a necessidade.
  let occupiedMap = new Map<string, import("../_shared/eco-budget.ts").OccupancyInfo>();
  const groupAStats = { primary: 0, neighbor: 0 };
  const groupBStats = { primary: 0, neighbor: 0, usedFromB: 0 };
  if (PLANNER_FREE_FIRST_ENABLED && candidateIds.length > 0) {
    occupiedMap = await getOccupiedPlaylistIds(admin, {
      excludeCampaignId: campaignId,
      playlistIds: candidateIds,
      windowStart: campaignStartedAt.toISOString(),
      windowEnd: campaignEndsAt.toISOString(),
    });
    groupAStats.primary = primaryFresh.filter(p => !occupiedMap.has(p.id)).length;
    groupAStats.neighbor = neighborFresh.filter(p => !occupiedMap.has(p.id)).length;
    groupBStats.primary = primaryFresh.length - groupAStats.primary;
    groupBStats.neighbor = neighborFresh.length - groupAStats.neighbor;
  }

  if (strategy === "daily_need" && dailyNeedRemaining > 0) {
    // 1ª fase: primárias.
    // Particiona em A (livres) e B (ocupadas). Tenta cobrir SÓ com A; se sobrar
    // gap relevante, tenta complementar com B (ordenado por menor ocupação).
    const primParts = PLANNER_FREE_FIRST_ENABLED
      ? partitionByOccupancy(primaryFresh, occupiedMap)
      : { groupA: primaryFresh, groupB: [] as typeof primaryFresh };

    const distA = primParts.groupA.length > 0
      ? distributeByDailyNeed(primParts.groupA, dailyNeedRemaining, mult, ECO_DAILY_TOLERANCE, { maxCapById, currentPositionById })
      : { positions: new Map<string, number>(), coveredDaily: 0, details: [] };
    for (const [k, v] of distA.positions) allPositions.set(k, v);
    coveredDailyByPrimary = distA.coveredDaily;

    const gapAfterA = Math.max(0, dailyNeedRemaining - coveredDailyByPrimary);
    if (gapAfterA > 0 && primParts.groupB.length > 0) {
      const distB = distributeByDailyNeed(primParts.groupB, gapAfterA, mult, ECO_DAILY_TOLERANCE, { maxCapById, currentPositionById });
      for (const [k, v] of distB.positions) allPositions.set(k, v);
      coveredDailyByPrimary += distB.coveredDaily;
      groupBStats.usedFromB += distB.positions.size;
    }
    gapAfterPrimary = Math.max(0, dailyNeedRemaining - coveredDailyByPrimary);
    const gapPct = dailyNeedRemaining > 0 ? gapAfterPrimary / dailyNeedRemaining : 0;
    coveredDailyByNew = coveredDailyByPrimary;

    // 2ª fase: vizinhos SÓ se sobrou gap relevante (mesma cascata A→B).
    if (gapPct > NEIGHBOR_GAP_THRESHOLD && neighborFresh.length > 0) {
      const neighParts = PLANNER_FREE_FIRST_ENABLED
        ? partitionByOccupancy(neighborFresh, occupiedMap)
        : { groupA: neighborFresh, groupB: [] as typeof neighborFresh };
      const nDistA = neighParts.groupA.length > 0
        ? distributeByDailyNeed(neighParts.groupA, gapAfterPrimary, mult, ECO_DAILY_TOLERANCE, { maxCapById, currentPositionById })
        : { positions: new Map<string, number>(), coveredDaily: 0, details: [] };
      for (const [k, v] of nDistA.positions) allPositions.set(k, v);
      coveredDailyByNew += nDistA.coveredDaily;
      const gapAfterNA = Math.max(0, gapAfterPrimary - nDistA.coveredDaily);
      if (gapAfterNA > 0 && neighParts.groupB.length > 0) {
        const nDistB = distributeByDailyNeed(neighParts.groupB, gapAfterNA, mult, ECO_DAILY_TOLERANCE, { maxCapById, currentPositionById });
        for (const [k, v] of nDistB.positions) allPositions.set(k, v);
        coveredDailyByNew += nDistB.coveredDaily;
        groupBStats.usedFromB += nDistB.positions.size;
      }
      usedNeighbors = true;
      positionStrategy = "daily_need_with_neighbors";
    } else {
      positionStrategy = "daily_need_primary_only";
    }
  } else {
    // Estratégia chart-tier "concentrada": atribui posições via tier do chart e
    // SELECIONA o menor subconjunto de playlists cuja soma de capacidade diária
    // cubra dailyNeedRemaining. Sem isso, todas as candidatas entrariam (mesmo
    // resultado da Espalhada). Mantém respeito a maxCapById (orçamento).
    const pickConcentrated = (
      pool: typeof primaryFresh,
      need: number,
    ): Map<string, number> => {
      if (need <= 0) return new Map<string, number>();
      const posMap = distributeEcoPositions(pool, days, mult, { chartTier });
      const ranked = pool.map(p => {
        const pos = posMap.get(p.id) ?? 3;
        const pct = POSITION_PCT[pos - 1] ?? 0.003;
        const rawCap = Math.max(1, Math.round(Number(p.followers ?? 0) * (mult / 30) * pct));
        const budgetCap = maxCapById?.get(p.id);
        const cap = typeof budgetCap === "number" ? Math.min(rawCap, Math.max(0, budgetCap)) : rawCap;
        return { id: p.id, pos, cap };
      })
      .filter(r => r.cap > 0)
      .sort((a, b) => b.cap - a.cap);

      const out = new Map<string, number>();
      let cumulative = 0;
      const target = Math.max(0, need);
      for (const r of ranked) {
        if (target > 0 && cumulative >= target) break;
        out.set(r.id, r.pos);
        cumulative += r.cap;
      }
      // Se não houver target (need<=0), não adiciona nada novo.
      return out;
    };

    if (primaryFresh.length > 0) {
      allPositions = pickConcentrated(primaryFresh, dailyNeedRemaining);
      // Mede cobertura e decide se precisa de vizinhos.
      for (const [, pos] of allPositions) {
        // coveredDailyByPrimary é estimado a partir das linhas montadas depois.
      }
      coveredDailyByPrimary = 0; // recalculado abaixo na fase de build
      positionStrategy = "chart_tier_primary_only";

      // Vizinhos só se ainda houver gap relevante (mesma lógica do daily_need).
      // Estima cobertura primária aqui pra decidir.
      let estPrimaryCovered = 0;
      for (const p of primaryFresh) {
        if (!allPositions.has(p.id)) continue;
        const pos = allPositions.get(p.id)!;
        const pct = POSITION_PCT[pos - 1] ?? 0.003;
        estPrimaryCovered += Math.max(1, Math.round(Number(p.followers ?? 0) * (mult / 30) * pct));
      }
      const gap = Math.max(0, dailyNeedRemaining - estPrimaryCovered);
      const gapPct = dailyNeedRemaining > 0 ? gap / dailyNeedRemaining : 0;
      if (gapPct > NEIGHBOR_GAP_THRESHOLD && neighborFresh.length > 0) {
        const neighPos = pickConcentrated(neighborFresh, gap);
        for (const [k, v] of neighPos) allPositions.set(k, v);
        usedNeighbors = true;
        positionStrategy = "chart_tier_with_neighbors";
      }
    } else if (neighborFresh.length > 0) {
      allPositions = pickConcentrated(neighborFresh, dailyNeedRemaining);
      positionStrategy = "chart_tier_with_neighbors";
      usedNeighbors = true;
    } else {
      positionStrategy = "chart_tier_primary_only";
    }
  }


  const primaryPositions = new Map<string, number>();
  const neighborPositions = new Map<string, number>();
  for (const p of freshPrimary) primaryPositions.set(p.id, allPositions.get(p.id) ?? 3);
  for (const p of freshNeighbor) neighborPositions.set(p.id, allPositions.get(p.id) ?? 5);

  console.log("[replan] positions", {
    strategy: positionStrategy,
    dailyNeedRemaining,
    coveredDailyByPrimary,
    coveredDailyByNew,
    gapAfterPrimary,
    usedNeighbors,
    neighborGapThreshold: NEIGHBOR_GAP_THRESHOLD,
    tolerance: ECO_DAILY_TOLERANCE,
    chartTier,
  });

  // 5) Monta linhas + soma plays/dia adicionais.
  //    Vizinhos só entram se `usedNeighbors=true` (gap > threshold após primário).
  let playsPerDayAdded = 0;
  let playsPerDayPrimary = 0;
  let playsPerDayNeighbor = 0;
  const rows: any[] = [];

  const planMultiplier = ecoPlanTotalMultiplier(days);
  const buildRow = (p: any, pos: number, source: "primary" | "affinity") => {
    const positionPct = POSITION_PCT[pos - 1] ?? 0.003;
    const followers = Number(p.followers ?? 0);
    const capDia = Math.max(1, Math.round(followers * (mult / 30) * positionPct));
    const plannedStreams = Math.max(1, Math.round(capDia * planMultiplier));
    playsPerDayAdded += capDia;
    if (source === "primary") playsPerDayPrimary += capDia;
    else playsPerDayNeighbor += capDia;
    rows.push({
      campaign_id: campaignId,
      managed_playlist_id: p.id,
      planned_streams: plannedStreams,
      start_day: 1,
      status: "pending",
      position: pos,
      genre_source: source,
    });
  };

  // Só insere primárias que receberam posição na cascata.
  for (const p of freshPrimary) {
    if (!allPositions.has(p.id)) continue;
    buildRow(p, primaryPositions.get(p.id) ?? 3, "primary");
  }
  // Vizinhos só entram quando usedNeighbors=true.
  if (usedNeighbors) {
    for (const p of freshNeighbor) {
      if (!allPositions.has(p.id)) continue;
      buildRow(p, neighborPositions.get(p.id) ?? affLo, "affinity");
    }
  }

  const addedPrimaryCount = rows.filter(r => r.genre_source === "primary").length;
  const addedNeighborCount = rows.filter(r => r.genre_source === "affinity").length;

  const summary = {
    added: rows.length,
    added_primary: addedPrimaryCount,
    added_neighbor: addedNeighborCount,
    available_primary: freshPrimary.length,
    available_neighbor: freshNeighbor.length,
    plays_per_day_added: playsPerDayAdded,
    plays_per_day_primary: playsPerDayPrimary,
    plays_per_day_neighbor: playsPerDayNeighbor,
    neighbor_genres: neighborGenreIds,
    used_neighbors: usedNeighbors,
    coverage_ratio: coverageRatio,
    mode,
    affinity_range: [affLo, affHi],
    position_strategy: positionStrategy,
    strategy_requested: strategy,
    daily_need_remaining: Math.round(dailyNeedRemaining),
    covered_daily_by_primary: Math.round(coveredDailyByPrimary),
    gap_after_primary: Math.round(gapAfterPrimary),
    neighbor_gap_threshold: NEIGHBOR_GAP_THRESHOLD,
    daily_tolerance: ECO_DAILY_TOLERANCE,
    eco_budget_enabled: ECO_BUDGET_ENABLED,
    playlists_dropped_by_budget: droppedByBudget,
    free_first_enabled: PLANNER_FREE_FIRST_ENABLED,
    group_a_primary_available: groupAStats.primary,
    group_a_neighbor_available: groupAStats.neighbor,
    group_b_primary_occupied: groupBStats.primary,
    group_b_neighbor_occupied: groupBStats.neighbor,
    used_from_group_b: groupBStats.usedFromB,
  };


  if (dryRun) {
    return json({ ok: true, dry_run: true, ...summary });
  }


  // 6) Insert
  const { error: insErr, count } = await admin
    .from("campaign_eco_allocations")
    .insert(rows, { count: "exact" });
  if (insErr) return json({ ok: false, error: insErr.message }, 500);

  return json({ ok: true, ...summary, added: count ?? rows.length });
});
