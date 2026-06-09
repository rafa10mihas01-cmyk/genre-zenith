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
