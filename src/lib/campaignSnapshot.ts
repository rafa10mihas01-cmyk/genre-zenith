import { supabase } from "@/integrations/supabase/client";
import type { CampaignResult } from "@/lib/campaignEngine";
import { distributeEcoPositions, POSITION_PCT } from "@/lib/campaignOperationalPlan";

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
  /** Posição sorteada já no momento do fechamento — usada pra gravar campaign_eco_allocations.position. */
  position: number;
}

const PLAYS_PER_SAVE_MONTH = 30;
const DEFAULT_CAMPAIGN_SLOT_PCT = 0.08; // posição #3 — usada SÓ pra dimensionar inventário

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
  engagementMultiplier: number = 30,
): EcoAllocationPlan[] {
  if (streamsEco <= 0 || playlists.length === 0) return [];

  // 1) SELEÇÃO de inventário (capacidade proxy em posição #3 — só pra escolher
  //    quantas playlists entram, não pra calcular planned_streams).
  const sizingCapacities = playlists
    .map(p => ({
      id: p.id,
      followers: Math.max(1, p.followers),
      sizingCap: Math.max(1, Math.round(Math.max(1, p.followers) * (PLAYS_PER_SAVE_MONTH / 30) * DEFAULT_CAMPAIGN_SLOT_PCT * days)),
    }))
    .sort((a, b) => b.sizingCap - a.sizingCap);
  const selected: typeof sizingCapacities = [];
  let selectedSizing = 0;
  for (const c of sizingCapacities) {
    if (selectedSizing >= streamsEco) break;
    selected.push(c);
    selectedSizing += c.sizingCap;
  }
  if (selected.length === 0) return [];

  // 2) Sorteia POSIÇÕES reais pra cada playlist selecionada (mesmo engine da UI).
  // Usa fake planned_streams = streamsEco/N como proxy pro maxViablePosition —
  // refinaremos abaixo. Sem preferredSlots aqui (default da distribuição padrão).
  const proxyPerPl = Math.max(1, Math.round(streamsEco / selected.length));
  const positions = distributeEcoPositions(
    selected.map(c => ({ id: c.id, planned_streams: proxyPerPl, followers: c.followers })),
    days,
    Math.max(1, Math.round(engagementMultiplier)),
  );

  // 3) Capacidade REAL na posição sorteada: followers × (mult/30) × POSITION_PCT[pos] × days.
  const realCapById = new Map<string, number>();
  let totalReal = 0;
  for (const c of selected) {
    const pos = positions.get(c.id) ?? 3;
    const pct = POSITION_PCT[pos - 1] ?? 0.003;
    const cap = Math.max(1, Math.round(c.followers * (Math.max(1, engagementMultiplier) / 30) * pct * days));
    realCapById.set(c.id, cap);
    totalReal += cap;
  }
  if (totalReal <= 0) return [];

  // 4) Reparte streamsEco proporcional à capacidade real, respeitando cap por playlist
  //    (mantém a propriedade: nenhuma playlist recebe mais que entrega).
  let allocated = 0;
  const ordered = selected
    .map((c, index) => {
      const cap = realCapById.get(c.id) ?? 0;
      const planned = index === selected.length - 1
        ? Math.max(0, Math.min(cap, streamsEco - allocated))
        : Math.min(cap, Math.round((cap / totalReal) * streamsEco));
      allocated += planned;
      return {
        managed_playlist_id: c.id,
        planned_streams: planned,
        start_day: ecoWarmupStartDay(index, selected.length, days, modo),
        position: positions.get(c.id) ?? 3,
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
  campaignType?: "ecosystem" | "external" | "hybrid";
}): Promise<{ campaignId: string }> {
  const { snapshot, deadlineISO, allocations, engagementMultiplier = 30, clientId = null, curatorId = null, status = "draft", campaignType = "ecosystem" } = args;

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
      campaign_type: campaignType,
    } as any)
    .select("id")
    .single();

  if (error || !campaign) throw error ?? new Error("Falha ao criar campanha");

  if (allocations.length > 0) {
    // Trava defensiva: clamp planned_streams pela capacidade REAL da playlist
    // (followers × mult/30 × POSITION_PCT[pos] × days). Garante invariante no
    // banco mesmo se alguma rota antiga gerar alocação acima do cap.
    const playlistIds = allocations.map(a => a.managed_playlist_id);
    const { data: mps } = await supabase
      .from("managed_playlists")
      .select("id, followers")
      .in("id", playlistIds);
    const followersById = new Map<string, number>((mps ?? []).map((m: any) => [m.id, Number(m.followers) || 0]));
    const mult = Math.max(1, Math.round(engagementMultiplier));
    const days = snapshot.days;

    // `position` já vem materializada do planEcoAllocations (Fix 2) — usa direto.
    // Se a alloc vier sem position (chamada externa antiga), grava NULL e o
    // backfill em approve-campaign-plan resolve depois.
    const rows = allocations.map(a => {
      const followers = followersById.get(a.managed_playlist_id) ?? 0;
      const posRaw = Number.isFinite((a as any).position) ? (a as any).position as number : 3;
      const pct = POSITION_PCT[posRaw - 1] ?? 0.003;
      const hardCap = Math.max(1, Math.round(followers * (mult / 30) * pct * days));
      return {
        campaign_id: campaign.id,
        managed_playlist_id: a.managed_playlist_id,
        planned_streams: Math.min(a.planned_streams, hardCap),
        start_day: a.start_day,
        status: "pending" as const,
        position: Number.isFinite((a as any).position) ? (a as any).position : null,
        cost_per_stream_op: pricingOpEco,
        market_per_stream: pricingMarketEco,
        price_per_stream_sell: finalPricePerStream,
      };
    });
    const { error: allocErr } = await supabase.from("campaign_eco_allocations").insert(rows as any);
    if (allocErr) throw allocErr;
  }


  return { campaignId: campaign.id };
}
