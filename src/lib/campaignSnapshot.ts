import { supabase } from "@/integrations/supabase/client";
import type { CampaignResult } from "@/lib/campaignEngine";
import { distributeEcoPositions, POSITION_PCT, chartTierFromTopPosition } from "@/lib/campaignOperationalPlan";

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
    /** Marca a música como Funk Mandelão — bloqueia Trap >30k seguidores na distribuição eco. */
    isMandelao?: boolean;
    top200Position?: number | null;
    top200StreamsDay?: number | null;
    top200ChartDate?: string | null;
  };
  meta: number;
  /** Duração CONTRATADA (o que o cliente pediu). Vira o deadline. */
  days: number;
  /** Duração REAL do plano = ceil(days × 1.5). Inclui rampa + saída suave.
   *  Opcional para retrocompat: snapshots antigos só têm `days`. */
  effectiveDays?: number;
  modo: "simultaneo" | "sequencial";
  perfil: "frio" | "mercado" | "engajado";
  splitEcoPct: number;
  /** % de meta tratada como orgânico (sem custo). Opcional p/ retrocompat — ausente = 0. */
  splitOrganicPct?: number;
  /** Streams orgânicos esperados. Opcional p/ retrocompat. */
  streamsOrganic?: number;
  /** Meta operacional (que eco+ext cobrem). Opcional — ausente = meta (perfil 'artista' c/ orgânico 0). */
  metaOperacional?: number;
  /** Perfil do cliente. Opcional — ausente = 'artista'. */
  clientProfile?: "gravadora" | "artista";
  streamsEco: number;
  streamsExt: number;
  custoEco: number;
  custoExt: number;
  /** Custo do orgânico — mesma tarifa do eco (costs.eco). Opcional p/ retrocompat. */
  custoOrganic?: number;
  custoTotal: number;
  custoPorStream: number;
  picoPorDia: number;
  mediaPorDia: number;
  inercia: number;
  curva: { day: number; streamsDay: number; cumulative: number; streamsEcoDay?: number; streamsExtDay?: number }[];
  // Pricing pro cliente — snapshot do que ele vai pagar. Opcionais p/ retrocompat.
  pricePerStreamSell?: number;
  clientPriceTotal?: number;
  /** Multiplicador escolhido na calculadora (saves→plays). Espelha campaigns.engagement_multiplier. */
  engagementMultiplier?: number;
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
    effectiveDays: result.effectiveDays,
    modo: result.modo,
    perfil: result.perfil,
    splitEcoPct: result.splitEcoPct,
    splitOrganicPct: result.splitOrganicPct,
    streamsOrganic: result.streamsOrganic,
    metaOperacional: result.metaOperacional,
    clientProfile: result.clientProfile,
    streamsEco: result.streamsEco,
    streamsExt: result.streamsExt,
    custoEco: result.custoEco,
    custoExt: result.custoExt,
    custoOrganic: result.custoOrganic,
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
  /** 'primary' = gênero da campanha; 'affinity' = gênero vizinho via genre_affinities. */
  genre_source?: "primary" | "affinity";
  /** Score 0–1 quando vier de afinidade. */
  genre_affinity_score?: number | null;
}

export interface GenreContext {
  source: "primary" | "affinity";
  /** Map playlistId → affinity score (0–1). Só usado quando source='affinity'. */
  affinityByPlaylistId?: Map<string, number>;
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
  engagementMultiplier: number = 35,
  genreContext?: GenreContext,
  topPosition?: number | null,
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

  // 2) Distribui POSIÇÕES via lógica determinística do chartTier — sem RNG.
  //    Top50 = todas primárias em pos 1; Top100 = ranges por tier; Outside = rank-based.
  //    Vizinhos (affinity) recebem posições mais profundas (4-5 / 5-7 / 7-10).
  const source = genreContext?.source ?? "primary";
  const chartTier = chartTierFromTopPosition(topPosition ?? null);
  const positions = distributeEcoPositions(
    selected.map(c => ({
      id: c.id,
      planned_streams: 0,
      followers: c.followers,
      genreSource: source,
    })),
    days,
    Math.max(1, Math.round(engagementMultiplier)),
    { chartTier },
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
      const source = genreContext?.source ?? "primary";
      const score = source === "affinity"
        ? (genreContext?.affinityByPlaylistId?.get(c.id) ?? null)
        : null;
      return {
        managed_playlist_id: c.id,
        planned_streams: planned,
        start_day: ecoWarmupStartDay(index, selected.length, days, modo),
        position: positions.get(c.id) ?? 3,
        genre_source: source,
        genre_affinity_score: score,
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
let _houseCuratorIdCache: string | null = null;
async function getHouseCuratorId(): Promise<string | null> {
  if (_houseCuratorIdCache) return _houseCuratorIdCache;
  const { data } = await supabase.from("curators").select("id").eq("name", "NexEngine").is("archived_at", null).limit(1).maybeSingle();
  _houseCuratorIdCache = (data as { id?: string } | null)?.id ?? null;
  return _houseCuratorIdCache;
}


export async function closeCampaignFromCalculator(args: {
  snapshot: CampaignSnapshot;
  deadlineISO: string;
  allocations: EcoAllocationPlan[];
  engagementMultiplier?: number;
  clientId?: string | null;
  curatorId?: string | null;
  status?: "draft" | "active";
  campaignType?: "ecosystem" | "external" | "hybrid";
  collectionMode?: "bot" | "spreadsheet";
}): Promise<{ campaignId: string }> {
  const { snapshot, deadlineISO, allocations, engagementMultiplier = 35, clientId = null, curatorId = null, status = "draft", campaignType = "ecosystem", collectionMode = "bot" } = args;

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
    engagementMultiplier: Math.max(1, Math.round(engagementMultiplier)),
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
      curator_id: curatorId ?? (await getHouseCuratorId()),
      campaign_type: campaignType,
      collection_mode: collectionMode,
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
    const followersById = new Map<string, number>((mps ?? []).map((m) => [m.id, Number(m.followers) || 0]));
    const mult = Math.max(1, Math.round(engagementMultiplier));
    // Capacidade considera a duração REAL do plano (effectiveDays), não a contratada.
    const days = snapshot.effectiveDays ?? snapshot.days;

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
        genre_source: a.genre_source ?? "primary",
        genre_affinity_score: a.genre_affinity_score ?? null,
      };
    });
    const { error: allocErr } = await supabase.from("campaign_eco_allocations").insert(rows as any);
    if (allocErr) throw allocErr;

    // Realinha snapshot.streamsEco com o que REALMENTE foi gravado (após clamp
    // pela hardCap). Sem isso, header diz 1.5M e tabela entrega 154K — déficit
    // fake. Header = tabela = SUM(planned_streams).
    const realEcoStreams = rows.reduce((s, r) => s + (Number(r.planned_streams) || 0), 0);
    if (realEcoStreams !== snapshot.streamsEco) {
      const realignedSnapshot: CampaignSnapshot = {
        ...enrichedSnapshot,
        streamsEco: realEcoStreams,
      };
      await supabase
        .from("campaigns")
        .update({
          simulation_snapshot: realignedSnapshot as any,
          total_allocated: realEcoStreams,
        })
        .eq("id", campaign.id);
    }
  }


  return { campaignId: campaign.id };
}
