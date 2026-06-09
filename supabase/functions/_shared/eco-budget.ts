// _shared/eco-budget.ts
// Camada de "orçamento de audiência" por playlist. NÃO altera a fórmula de
// projeção do sistema — apenas calcula quanto da capacidade teórica de cada
// playlist já está reservada por OUTRAS campanhas ativas que se sobrepõem
// temporalmente, e expõe esse saldo para os planners (replan e approve) usarem
// como teto ao escolher posição via `distributeByDailyNeed`.
//
// Regra de ativa: campaigns.status in ('active','approved') AND a janela
// [started_at, started_at + days] intersecta a janela da campanha alvo.
//
// Rollback instantâneo: setar ECO_BUDGET_ENABLED=false em env desliga a
// camada (os planners passam a chamar distributeByDailyNeed sem maxCapById).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { POSITION_PCT } from "./computeEcoPlan.ts";

export const ECO_BUDGET_ENABLED =
  (Deno.env.get("ECO_BUDGET_ENABLED") ?? "true").toLowerCase() !== "false";

// Anti-canibalização: Grupo A (livres) é consumido antes do Grupo B (ocupadas).
// "Ocupada" = está em outra campanha ativa OU em curator deal ativo cuja janela
// sobrepõe a janela alvo. Default: ligado. Rollback: env var = "false".
export const PLANNER_FREE_FIRST_ENABLED =
  (Deno.env.get("PLANNER_FREE_FIRST_ENABLED") ?? "true").toLowerCase() !== "false";

const ACTIVE_STATUSES = ["active", "approved"] as const;
const ACTIVE_ALLOC_STATUSES = ["pending", "approved", "dispatched"] as const;

export interface ReservationWindow {
  excludeCampaignId: string;
  playlistIds: string[];
  /** ISO date (inclusive) */
  windowStart: string;
  /** ISO date (exclusive) */
  windowEnd: string;
}

/**
 * Para cada playlist informada, soma `planned_streams` das allocations que
 * pertencem a OUTRAS campanhas ativas cuja janela intersecta a janela alvo.
 *
 * Retorna mapa playlist_id → total_streams_reservados_no_overlap.
 * Em caso de erro de query, retorna mapa vazio (degrada para "sem orçamento")
 * para não derrubar o planner.
 */
export async function getReservationsByPlaylist(
  admin: SupabaseClient,
  opts: ReservationWindow,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!ECO_BUDGET_ENABLED) return out;
  if (!opts.playlistIds.length) return out;

  const { data, error } = await admin
    .from("campaign_eco_allocations")
    .select(
      "managed_playlist_id, planned_streams, campaigns!inner(id, status, started_at, simulation_snapshot)",
    )
    .in("managed_playlist_id", opts.playlistIds)
    .neq("campaign_id", opts.excludeCampaignId)
    .in("status", ACTIVE_ALLOC_STATUSES as unknown as string[]);

  if (error) {
    console.warn("[eco-budget] reservations query failed:", error.message);
    return out;
  }

  const wsT = new Date(opts.windowStart).getTime();
  const weT = new Date(opts.windowEnd).getTime();
  if (!Number.isFinite(wsT) || !Number.isFinite(weT) || weT <= wsT) return out;

  for (const r of (data ?? []) as Array<{
    managed_playlist_id: string | null;
    planned_streams: number | null;
    campaigns:
      | { status: string | null; started_at: string | null; simulation_snapshot: unknown }
      | Array<{ status: string | null; started_at: string | null; simulation_snapshot: unknown }>
      | null;
  }>) {
    const camp = Array.isArray(r.campaigns) ? r.campaigns[0] : r.campaigns;
    if (!camp || !r.managed_playlist_id) continue;
    if (!ACTIVE_STATUSES.includes(camp.status as typeof ACTIVE_STATUSES[number])) continue;
    const started = camp.started_at ? new Date(camp.started_at).getTime() : NaN;
    if (!Number.isFinite(started)) continue;
    const snap = (camp.simulation_snapshot as { effectiveDays?: number; days?: number } | null) ?? {};
    const days = Math.max(1, Number(snap.effectiveDays ?? snap.days ?? 30));
    const ended = started + days * 86400000;
    // Overlap test (intervalos semi-abertos).
    if (ended <= wsT || started >= weT) continue;
    out.set(
      r.managed_playlist_id,
      (out.get(r.managed_playlist_id) ?? 0) + Number(r.planned_streams ?? 0),
    );
  }
  return out;
}

/**
 * Converte reservas totais (streams) em CAP DIÁRIO DISPONÍVEL por playlist
 * dentro da campanha alvo. Usado como `maxCapById` em `distributeByDailyNeed`.
 *
 *   capTeoricoMax(playlist) = followers × (mult/30) × POSITION_PCT[0]   // pos #1
 *   saldoDiario(playlist)   = capTeoricoMax − reservedTotal/days
 *
 * Se saldoDiario ≤ 0, playlist sai do plano (planner não a aloca).
 */
export function reservationsToDailyCap(
  reservedByPlaylist: Map<string, number>,
  playlistsInfo: Map<string, { followers: number }>,
  mult: number,
  days: number,
): Map<string, number> {
  const out = new Map<string, number>();
  const topPct = POSITION_PCT[0] ?? 0.12;
  const safeMult = Math.max(1, mult);
  const safeDays = Math.max(1, days);
  for (const [pid, info] of playlistsInfo) {
    const followers = Math.max(0, info.followers);
    const capTheo = followers * (safeMult / 30) * topPct;
    const reservedTotal = reservedByPlaylist.get(pid) ?? 0;
    const reservedDaily = reservedTotal / safeDays;
    out.set(pid, Math.max(0, capTheo - reservedDaily));
  }
  return out;
}

/**
 * Ocupação por playlist (anti-canibalização).
 *
 * Combina DUAS fontes pra cada `managed_playlists.id`:
 *  1) campaign_eco_allocations de OUTRAS campanhas ativas cuja janela sobrepõe.
 *  2) curator_deals em estado active/collecting (closed_at IS NULL) cujas
 *     curator_playlists têm spotify_playlist_id igual ao da managed_playlist,
 *     e cuja janela [started_at, ends_at] sobrepõe a janela alvo.
 *
 * Retorna Map<playlist_id, { camps, deals, reservedStreams }>. Playlists
 * AUSENTES do mapa são LIVRES (Grupo A). Playlists presentes são OCUPADAS
 * (Grupo B), ordenáveis por `reservedStreams` ASC + `camps+deals` ASC pra
 * "menos ocupada primeiro" quando o Grupo A não bastar.
 *
 * Robusto a erro: em falha, retorna mapa vazio (degrada para "tudo livre")
 * pra não derrubar o planner.
 */
export interface OccupancyInfo {
  camps: number;
  deals: number;
  reservedStreams: number;
}

export async function getOccupiedPlaylistIds(
  admin: SupabaseClient,
  opts: ReservationWindow,
): Promise<Map<string, OccupancyInfo>> {
  const out = new Map<string, OccupancyInfo>();
  if (!opts.playlistIds.length) return out;

  const wsT = new Date(opts.windowStart).getTime();
  const weT = new Date(opts.windowEnd).getTime();
  if (!Number.isFinite(wsT) || !Number.isFinite(weT) || weT <= wsT) return out;

  const bump = (pid: string, deltaCamps: number, deltaDeals: number, deltaStreams: number) => {
    const prev = out.get(pid) ?? { camps: 0, deals: 0, reservedStreams: 0 };
    out.set(pid, {
      camps: prev.camps + deltaCamps,
      deals: prev.deals + deltaDeals,
      reservedStreams: prev.reservedStreams + deltaStreams,
    });
  };

  // Fonte 1: outras campanhas ativas.
  try {
    const { data, error } = await admin
      .from("campaign_eco_allocations")
      .select(
        "managed_playlist_id, planned_streams, campaigns!inner(id, status, started_at, simulation_snapshot)",
      )
      .in("managed_playlist_id", opts.playlistIds)
      .neq("campaign_id", opts.excludeCampaignId)
      .in("status", ACTIVE_ALLOC_STATUSES as unknown as string[]);
    if (error) throw error;
    const seenPerCamp = new Set<string>();
    for (const r of (data ?? []) as Array<{
      managed_playlist_id: string | null;
      planned_streams: number | null;
      campaigns:
        | { id: string; status: string | null; started_at: string | null; simulation_snapshot: unknown }
        | Array<{ id: string; status: string | null; started_at: string | null; simulation_snapshot: unknown }>
        | null;
    }>) {
      const camp = Array.isArray(r.campaigns) ? r.campaigns[0] : r.campaigns;
      if (!camp || !r.managed_playlist_id) continue;
      if (!ACTIVE_STATUSES.includes(camp.status as typeof ACTIVE_STATUSES[number])) continue;
      const started = camp.started_at ? new Date(camp.started_at).getTime() : NaN;
      if (!Number.isFinite(started)) continue;
      const snap = (camp.simulation_snapshot as { effectiveDays?: number; days?: number } | null) ?? {};
      const days = Math.max(1, Number(snap.effectiveDays ?? snap.days ?? 30));
      const ended = started + days * 86400000;
      if (ended <= wsT || started >= weT) continue;
      const dedup = `${r.managed_playlist_id}:${camp.id}`;
      const isFirstForCamp = !seenPerCamp.has(dedup);
      if (isFirstForCamp) seenPerCamp.add(dedup);
      bump(r.managed_playlist_id, isFirstForCamp ? 1 : 0, 0, Number(r.planned_streams ?? 0));
    }
  } catch (e) {
    console.warn("[eco-budget] occupied camps query failed:", (e as Error).message);
  }

  // Fonte 2: curator deals ativos via spotify_playlist_id ↔ managed.spotify_playlist_id.
  try {
    // Resolver spotify_playlist_id pra cada managed candidate.
    const { data: mps, error: mpErr } = await admin
      .from("managed_playlists")
      .select("id, spotify_playlist_id")
      .in("id", opts.playlistIds);
    if (mpErr) throw mpErr;
    const spotifyToManaged = new Map<string, string>();
    for (const m of (mps ?? []) as Array<{ id: string; spotify_playlist_id: string | null }>) {
      if (m.spotify_playlist_id) spotifyToManaged.set(m.spotify_playlist_id, m.id);
    }
    const spotifyIds = [...spotifyToManaged.keys()];
    if (spotifyIds.length === 0) return out;

    const { data: cps, error: cpErr } = await admin
      .from("curator_playlists")
      .select("spotify_playlist_id, curator_deals!inner(id, state, closed_at, started_at, ends_at)")
      .in("spotify_playlist_id", spotifyIds);
    if (cpErr) throw cpErr;

    const seenPerDeal = new Set<string>();
    for (const r of (cps ?? []) as Array<{
      spotify_playlist_id: string | null;
      curator_deals:
        | { id: string; state: string | null; closed_at: string | null; started_at: string | null; ends_at: string | null }
        | Array<{ id: string; state: string | null; closed_at: string | null; started_at: string | null; ends_at: string | null }>
        | null;
    }>) {
      const deal = Array.isArray(r.curator_deals) ? r.curator_deals[0] : r.curator_deals;
      if (!deal || !r.spotify_playlist_id) continue;
      if (deal.closed_at) continue;
      if (deal.state !== "active" && deal.state !== "collecting") continue;
      const dStart = deal.started_at ? new Date(deal.started_at).getTime() : wsT;
      const dEnd = deal.ends_at ? new Date(deal.ends_at).getTime() : (dStart + 30 * 86400000);
      if (!Number.isFinite(dStart) || !Number.isFinite(dEnd) || dEnd <= dStart) continue;
      if (dEnd <= wsT || dStart >= weT) continue;
      const mpId = spotifyToManaged.get(r.spotify_playlist_id);
      if (!mpId) continue;
      const dedup = `${mpId}:${deal.id}`;
      if (seenPerDeal.has(dedup)) continue;
      seenPerDeal.add(dedup);
      bump(mpId, 0, 1, 0);
    }
  } catch (e) {
    console.warn("[eco-budget] occupied deals query failed:", (e as Error).message);
  }

  return out;
}

/**
 * Particiona uma lista de candidatas em Grupo A (livres) e Grupo B (ocupadas).
 * Grupo B é ordenado por menor ocupação primeiro (menor camps+deals, depois
 * menor reservedStreams) pra quando precisar entrar.
 *
 * Mantém a ORDEM ORIGINAL dentro de cada grupo (que já vem rankeada por score
 * upstream) — a única reordenação é Grupo B pela ocupação ascendente.
 */
export function partitionByOccupancy<T extends { id: string }>(
  candidates: T[],
  occupied: Map<string, OccupancyInfo>,
): { groupA: T[]; groupB: T[] } {
  const groupA: T[] = [];
  const groupB: Array<{ item: T; occ: OccupancyInfo; originalIdx: number }> = [];
  candidates.forEach((c, idx) => {
    const occ = occupied.get(c.id);
    if (!occ || (occ.camps === 0 && occ.deals === 0)) {
      groupA.push(c);
    } else {
      groupB.push({ item: c, occ, originalIdx: idx });
    }
  });
  groupB.sort((a, b) => {
    const ua = a.occ.camps + a.occ.deals;
    const ub = b.occ.camps + b.occ.deals;
    if (ua !== ub) return ua - ub;
    if (a.occ.reservedStreams !== b.occ.reservedStreams) {
      return a.occ.reservedStreams - b.occ.reservedStreams;
    }
    return a.originalIdx - b.originalIdx;
  });
  return { groupA, groupB: groupB.map(b => b.item) };
}
