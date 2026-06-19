// Fase 14.1 — Service único de consolidação.
// Fonte: public.v_campaign_overview (toda regra de agregação vive na view).
// Aqui NÃO recalculamos KPIs. Apenas tipamos, agrupamos e (timeline) montamos eventos.
import { supabase } from "@/integrations/supabase/client";

export type CampaignOverviewRow = {
  campaign_id: string;
  client_id: string | null;
  status: string | null;
  track_name: string | null;
  artist: string | null;
  genre: string | null;
  created_at: string;
  plan_approved_at: string | null;
  client_approved_at: string | null;
  baseline_captured_at: string | null;
  eco_dispatched_at: string | null;
  closed_at: string | null;

  contratado: number;
  recebido: number;
  pendente: number;

  custo_curadores_diretos: number;
  custo_eco: number;
  custo_externos: number;
  custo_operacional: number;

  margem_prevista: number;
  margem_pct: number;

  deals_total: number;
  deals_abertos: number;
  deals_concluidos: number;
  eco_total: number;
  eco_dispatched: number;
  pacotes_total: number;
  pacotes_confirmados: number;
  externos_items_total: number;
  curadores_unicos: number;

  streams_previstos: number;
  streams_entregues: number;
  progresso_pct: number;
};

export type TimelineEvent = {
  when: string;
  label: string;
  kind:
    | "campaign_created"
    | "plan_approved"
    | "client_approved"
    | "baseline_captured"
    | "eco_dispatched"
    | "campaign_closed";
  campaign_id: string;
};

export type CampaignOverview = CampaignOverviewRow & { timeline: TimelineEvent[] };

export type OverviewTotals = {
  contratado: number;
  recebido: number;
  pendente: number;
  custo_curadores_diretos: number;
  custo_eco: number;
  custo_externos: number;
  custo_operacional: number;
  margem_prevista: number;
  margem_pct: number;
  deals_total: number;
  deals_abertos: number;
  deals_concluidos: number;
  eco_total: number;
  eco_dispatched: number;
  pacotes_total: number;
  pacotes_confirmados: number;
  externos_items_total: number;
  curadores_unicos: number;
  streams_previstos: number;
  streams_entregues: number;
  progresso_pct: number;
  campanhas_total: number;
  campanhas_ativas: number;
};

const N = (v: unknown): number => (v == null ? 0 : Number(v));

function normalize(row: any): CampaignOverviewRow {
  return {
    campaign_id: row.campaign_id,
    client_id: row.client_id ?? null,
    status: row.status ?? null,
    track_name: row.track_name ?? null,
    artist: row.artist ?? null,
    genre: row.genre ?? null,
    created_at: row.created_at,
    plan_approved_at: row.plan_approved_at ?? null,
    client_approved_at: row.client_approved_at ?? null,
    baseline_captured_at: row.baseline_captured_at ?? null,
    eco_dispatched_at: row.eco_dispatched_at ?? null,
    closed_at: row.closed_at ?? null,

    contratado: N(row.contratado),
    recebido: N(row.recebido),
    pendente: N(row.pendente),

    custo_curadores_diretos: N(row.custo_curadores_diretos),
    custo_eco: N(row.custo_eco),
    custo_externos: N(row.custo_externos),
    custo_operacional: N(row.custo_operacional),

    margem_prevista: N(row.margem_prevista),
    margem_pct: N(row.margem_pct),

    deals_total: N(row.deals_total),
    deals_abertos: N(row.deals_abertos),
    deals_concluidos: N(row.deals_concluidos),
    eco_total: N(row.eco_total),
    eco_dispatched: N(row.eco_dispatched),
    pacotes_total: N(row.pacotes_total),
    pacotes_confirmados: N(row.pacotes_confirmados),
    externos_items_total: N(row.externos_items_total),
    curadores_unicos: N(row.curadores_unicos),

    streams_previstos: N(row.streams_previstos),
    streams_entregues: N(row.streams_entregues),
    progresso_pct: N(row.progresso_pct),
  };
}

function buildTimeline(rows: CampaignOverviewRow[]): TimelineEvent[] {
  const ev: TimelineEvent[] = [];
  for (const r of rows) {
    const tag = r.track_name ?? "Campanha";
    ev.push({ when: r.created_at, kind: "campaign_created", label: `Campanha criada · ${tag}`, campaign_id: r.campaign_id });
    if (r.plan_approved_at)
      ev.push({ when: r.plan_approved_at, kind: "plan_approved", label: `Plano aprovado · ${tag}`, campaign_id: r.campaign_id });
    if (r.client_approved_at)
      ev.push({ when: r.client_approved_at, kind: "client_approved", label: `Cliente aprovou · ${tag}`, campaign_id: r.campaign_id });
    if (r.baseline_captured_at)
      ev.push({ when: r.baseline_captured_at, kind: "baseline_captured", label: `Baseline capturada · ${tag}`, campaign_id: r.campaign_id });
    if (r.eco_dispatched_at)
      ev.push({ when: r.eco_dispatched_at, kind: "eco_dispatched", label: `Ecossistema disparado · ${tag}`, campaign_id: r.campaign_id });
    if (r.closed_at)
      ev.push({ when: r.closed_at, kind: "campaign_closed", label: `Campanha encerrada · ${tag}`, campaign_id: r.campaign_id });
  }
  return ev.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
}

export function aggregate(rows: CampaignOverviewRow[]): OverviewTotals {
  const t: OverviewTotals = {
    contratado: 0, recebido: 0, pendente: 0,
    custo_curadores_diretos: 0, custo_eco: 0, custo_externos: 0, custo_operacional: 0,
    margem_prevista: 0, margem_pct: 0,
    deals_total: 0, deals_abertos: 0, deals_concluidos: 0,
    eco_total: 0, eco_dispatched: 0,
    pacotes_total: 0, pacotes_confirmados: 0, externos_items_total: 0,
    curadores_unicos: 0,
    streams_previstos: 0, streams_entregues: 0, progresso_pct: 0,
    campanhas_total: rows.length,
    campanhas_ativas: 0,
  };
  for (const r of rows) {
    t.contratado += r.contratado;
    t.recebido += r.recebido;
    t.pendente += r.pendente;
    t.custo_curadores_diretos += r.custo_curadores_diretos;
    t.custo_eco += r.custo_eco;
    t.custo_externos += r.custo_externos;
    t.custo_operacional += r.custo_operacional;
    t.margem_prevista += r.margem_prevista;
    t.deals_total += r.deals_total;
    t.deals_abertos += r.deals_abertos;
    t.deals_concluidos += r.deals_concluidos;
    t.eco_total += r.eco_total;
    t.eco_dispatched += r.eco_dispatched;
    t.pacotes_total += r.pacotes_total;
    t.pacotes_confirmados += r.pacotes_confirmados;
    t.externos_items_total += r.externos_items_total;
    t.curadores_unicos += r.curadores_unicos; // soma de únicos por campanha; OK p/ KPI de "trabalhando"
    t.streams_previstos += r.streams_previstos;
    t.streams_entregues += r.streams_entregues;
    if (r.status === "active") t.campanhas_ativas += 1;
  }
  t.margem_pct = t.contratado > 0 ? Math.round((t.margem_prevista / t.contratado) * 10000) / 100 : 0;
  t.progresso_pct = t.streams_previstos > 0
    ? Math.min(100, Math.round((t.streams_entregues / t.streams_previstos) * 10000) / 100)
    : 0;
  return t;
}

async function fetchOverview(filter?: { campaignId?: string; clientId?: string }): Promise<CampaignOverviewRow[]> {
  let q = supabase.from("v_campaign_overview" as never).select("*").limit(2000);
  if (filter?.campaignId) q = (q as any).eq("campaign_id", filter.campaignId);
  if (filter?.clientId) q = (q as any).eq("client_id", filter.clientId);
  const { data, error } = await (q as any);
  if (error) throw error;
  return (data ?? []).map(normalize);
}

export async function getCampaignOverview(campaignId: string): Promise<CampaignOverview | null> {
  const rows = await fetchOverview({ campaignId });
  if (rows.length === 0) return null;
  const row = rows[0];
  return { ...row, timeline: buildTimeline([row]) };
}

export async function getClientOverview(clientId: string): Promise<{
  campaigns: CampaignOverviewRow[];
  totals: OverviewTotals;
  timeline: TimelineEvent[];
}> {
  const rows = await fetchOverview({ clientId });
  return { campaigns: rows, totals: aggregate(rows), timeline: buildTimeline(rows) };
}

export async function getCockpitOverview(): Promise<{
  campaigns: CampaignOverviewRow[];
  totals: OverviewTotals;
  timeline: TimelineEvent[];
}> {
  const rows = await fetchOverview();
  return { campaigns: rows, totals: aggregate(rows), timeline: buildTimeline(rows) };
}
