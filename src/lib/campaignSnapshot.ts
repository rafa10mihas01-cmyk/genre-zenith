import { supabase } from "@/integrations/supabase/client";
import type { CampaignResult } from "@/lib/campaignEngine";

/**
 * Snapshot imutável da calculadora — gravado em campaigns.simulation_snapshot
 * no momento em que o usuário fecha a campanha. Depois disso ninguém recalcula.
 */
export interface CampaignSnapshot {
  version: 1;
  lockedAt: string;
  music: {
    spotifyTrackId: string | null;
    trackUrl: string | null;
    title: string | null;
    artist: string | null;
    coverUrl: string | null;
    baselineStreamsDay: number;
    genre?: string | null;
    top200Position?: number | null;
    top200StreamsDay?: number | null;
    top200ChartDate?: string | null;
  };
  meta: number;
  days: number;
  modo: "simultaneo" | "sequencial";
  perfil: "frio" | "mercado" | "engajado";
  splitEcoPct: number;
  streamsEco: number;
  streamsExt: number;
  custoEco: number;
  custoExt: number;
  custoTotal: number;
  custoPorStream: number;
  picoPorDia: number;
  mediaPorDia: number;
  inercia: number;
  curva: { day: number; streamsDay: number; cumulative: number; streamsEcoDay?: number; streamsExtDay?: number }[];
  // Pricing pro cliente — snapshot do que ele vai pagar. Opcionais p/ retrocompat.
  pricePerStreamSell?: number;
  clientPriceTotal?: number;
}

export function buildSnapshot(
  result: CampaignResult,
  music: CampaignSnapshot["music"],
  pricing?: { clientPriceTotal?: number | null; pricePerStreamSell?: number | null },
): CampaignSnapshot {
  return {
    version: 1,
    lockedAt: new Date().toISOString(),
    music,
    meta: result.meta,
    days: result.days,
    modo: result.modo,
    perfil: result.perfil,
    splitEcoPct: result.splitEcoPct,
    streamsEco: result.streamsEco,
    streamsExt: result.streamsExt,
    custoEco: result.custoEco,
    custoExt: result.custoExt,
    custoTotal: result.custoTotal,
    custoPorStream: result.custoPorStream,
    picoPorDia: result.picoPorDia,
    mediaPorDia: result.mediaPorDia,
    inercia: result.inercia,
    curva: result.curva,
    clientPriceTotal: pricing?.clientPriceTotal ?? undefined,
    pricePerStreamSell: pricing?.pricePerStreamSell ?? undefined,
  };
}

/**
 * Distribui streamsEco entre playlists próprias proporcional à capacidade
 * teórica (followers × 30 plays/mês ÷ 30 dias = followers plays/dia).
 *
 * Retorna o plano sem gravar. Gravação acontece em `closeCampaign`.
 */
export interface EcoAllocationPlan {
  managed_playlist_id: string;
  planned_streams: number;
  start_day: number;
}

const PLAYS_PER_SAVE_MONTH = 30;

function ecoWarmupStartDay(index: number, total: number, days: number, modo: CampaignSnapshot["modo"]) {
  if (total <= 1) return 1;
  const rampPct = modo === "sequencial" ? 0.7 : 0.25;
  const rampDays = Math.max(3, Math.min(days, Math.ceil(days * rampPct)));
  return Math.min(days, 1 + Math.floor((index / Math.max(1, total - 1)) * (rampDays - 1)));
}

export function planEcoAllocations(
  streamsEco: number,
  days: number,
  playlists: { id: string; followers: number }[],
  modo: CampaignSnapshot["modo"] = "simultaneo",
): EcoAllocationPlan[] {
  if (streamsEco <= 0 || playlists.length === 0) return [];

  // Capacidade teórica total ao longo da campanha: followers/dia × dias
  const capacities = playlists.map(p => ({
    id: p.id,
    capacity: Math.max(1, p.followers) * days, // followers × dias (proxy de tráfego total)
  }));
  const totalCapacity = capacities.reduce((s, c) => s + c.capacity, 0);
  if (totalCapacity <= 0) return [];

  let allocated = 0;
  const ordered = capacities
    .sort((a, b) => b.capacity - a.capacity)
    .map((c, index) => {
      const planned = index === capacities.length - 1
        ? Math.max(0, streamsEco - allocated)
        : Math.round((c.capacity / totalCapacity) * streamsEco);
      allocated += planned;
      return {
        managed_playlist_id: c.id,
        planned_streams: planned,
        start_day: ecoWarmupStartDay(index, capacities.length, days, modo),
      };
    })
    .filter(a => a.planned_streams > 0);

  return ordered;
}

/**
 * Cria a campanha com snapshot congelado + plano de alocação Eco.
 * Pricing (operacional + mercado + venda) é snapshotado por alocação.
 * Default status = "draft" — só vira "active" depois da aprovação do cliente
 * + approve_campaign interno.
 */
const NEXENGINE_CURATOR_ID = "f37de5a5-c2e6-44bd-a14e-2718c83b1bd8";

export async function closeCampaignFromCalculator(args: {
  snapshot: CampaignSnapshot;
  deadlineISO: string;
  allocations: EcoAllocationPlan[];
  engagementMultiplier?: number;
  clientId?: string | null;
  curatorId?: string | null;
  status?: "draft" | "active";
}): Promise<{ campaignId: string }> {
  const { snapshot, deadlineISO, allocations, engagementMultiplier = 30, clientId = null, curatorId = null, status = "draft" } = args;

  // Snapshot de pricing (operacional + mercado + venda) pras alocações eco
  const { data: { user } } = await supabase.auth.getUser();
  let pricingOpEco = 0, pricingMarketEco = 0, pricingSell = 0;
  if (user) {
    const { data: pricing } = await supabase
      .from("pricing_settings")
      .select("cost_per_stream_eco, market_per_stream_eco, price_per_stream_sell")
      .eq("user_id", user.id)
      .maybeSingle();
    if (pricing) {
      pricingOpEco = Number((pricing as any).cost_per_stream_eco) || 0;
      pricingMarketEco = Number((pricing as any).market_per_stream_eco) || 0;
      pricingSell = Number((pricing as any).price_per_stream_sell) || 0;
    }
  }

  // Enriquecer snapshot com o preço cobrado do cliente (congelado no fechamento).
  // Se a calculadora já fechou um valor manual, ele tem prioridade sobre a tabela.
  const manualClientPrice = typeof snapshot.clientPriceTotal === "number" && snapshot.clientPriceTotal > 0
    ? snapshot.clientPriceTotal
    : null;
  const finalClientPrice = manualClientPrice ?? Math.round(snapshot.meta * pricingSell * 100) / 100;
  const finalPricePerStream = manualClientPrice && snapshot.meta > 0
    ? manualClientPrice / snapshot.meta
    : pricingSell;
  const enrichedSnapshot: CampaignSnapshot = {
    ...snapshot,
    pricePerStreamSell: finalPricePerStream,
    clientPriceTotal: finalClientPrice,
  };


  const { data: campaign, error } = await supabase
    .from("campaigns")
    .insert({
      track_name: snapshot.music.title ?? "Sem título",
      artist: snapshot.music.artist,
      spotify_track_id: snapshot.music.spotifyTrackId,
      spotify_track_url: snapshot.music.trackUrl,
      cover_url: snapshot.music.coverUrl,
      goal_plays: snapshot.meta,
      deadline: deadlineISO,
      status,
      total_allocated: allocations.reduce((s, a) => s + a.planned_streams, 0),
      engagement_multiplier: Math.max(1, Math.round(engagementMultiplier)),
      simulation_snapshot: enrichedSnapshot as any,
      snapshot_locked_at: snapshot.lockedAt,
      client_id: clientId,
      curator_id: curatorId ?? NEXENGINE_CURATOR_ID,
    } as any)
    .select("id")
    .single();

  if (error || !campaign) throw error ?? new Error("Falha ao criar campanha");

  if (allocations.length > 0) {
    const rows = allocations.map(a => ({
      campaign_id: campaign.id,
      managed_playlist_id: a.managed_playlist_id,
      planned_streams: a.planned_streams,
      start_day: a.start_day,
      status: "pending" as const,
      cost_per_stream_op: pricingOpEco,
      market_per_stream: pricingMarketEco,
      price_per_stream_sell: finalPricePerStream,
    }));
    const { error: allocErr } = await supabase.from("campaign_eco_allocations").insert(rows as any);
    if (allocErr) throw allocErr;
  }

  return { campaignId: campaign.id };
}
