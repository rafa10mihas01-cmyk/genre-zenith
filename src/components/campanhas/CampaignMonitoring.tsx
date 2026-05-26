import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatInt, formatBRL, recomputeCurva } from "@/lib/campaignEngine";
import type { CampaignSnapshot } from "@/lib/campaignSnapshot";
import { toast } from "@/hooks/use-toast";
import { CampaignCuratorDeals } from "./CampaignCuratorDeals";

type Props = {
  campaignId: string;
  snapshot: CampaignSnapshot;
  campaignStartedAt: string;
  campaignStatus: string;
  onClosed?: () => void;
};

type EcoRow = { managed_playlist_id: string; planned_streams: number; status: string };
type DealRow = { reconciled_total_plays: number; closed_at: string | null };
type EcoSnap = { managed_playlist_id: string; plays_28d: number | null; plays_7d: number | null; plays_24h: number | null; captured_at: string };

export function CampaignMonitoring({ campaignId, snapshot, campaignStartedAt, campaignStatus, onClosed }: Props) {
  const [loading, setLoading] = useState(true);
  const [eco, setEco] = useState<EcoRow[]>([]);
  const [ecoSnaps, setEcoSnaps] = useState<EcoSnap[]>([]);
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [closing, setClosing] = useState(false);

  async function load() {
    setLoading(true);
    const [{ data: ecoData }, { data: pkgData }, { data: snapsData }] = await Promise.all([
      supabase
        .from("campaign_eco_allocations")
        .select("managed_playlist_id, planned_streams, status")
        .eq("campaign_id", campaignId),
      supabase
        .from("campaign_external_package_items")
        .select("curator_deal_id, campaign_external_packages!inner(campaign_id)")
        .eq("campaign_external_packages.campaign_id", campaignId)
        .not("curator_deal_id", "is", null),
      supabase
        .from("campaign_eco_snapshots")
        .select("managed_playlist_id, plays_28d, plays_7d, plays_24h, captured_at")
        .eq("campaign_id", campaignId)
        .order("captured_at", { ascending: false }),
    ]);
    setEco((ecoData ?? []) as any);
    setEcoSnaps((snapsData ?? []) as any);

    const dealIds = (pkgData ?? []).map((p: any) => p.curator_deal_id).filter(Boolean);
    if (dealIds.length > 0) {
      const { data: dealsData } = await supabase
        .from("curator_deals")
        .select("reconciled_total_plays, closed_at")
        .in("id", dealIds);
      setDeals((dealsData ?? []) as any);
    } else {
      setDeals([]);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [campaignId]);

  // Curva fresca, recomputada com o envelope ATUAL do motor.
  // Snapshot continua fonte de verdade pra meta/effectiveDays/split/custos;
  // só a FORMA (streamsDay por dia) é refeita aqui.
  const freshCurva = useMemo(() => {
    const eff = (snapshot as any).effectiveDays ?? snapshot.days;
    return recomputeCurva(snapshot.meta, eff, snapshot.splitEcoPct);
  }, [snapshot.meta, (snapshot as any).effectiveDays, snapshot.days, snapshot.splitEcoPct]);

  const metrics = useMemo(() => {
    const totalDays = freshCurva.length || snapshot.days;
    const elapsedMs = Date.now() - new Date(campaignStartedAt).getTime();
    const elapsedDays = Math.max(1, Math.min(totalDays, Math.ceil(elapsedMs / (1000 * 60 * 60 * 24))));

    // Planejado até hoje (cumulativo da curva FRESCA)
    const plannedToDate = freshCurva
      .slice(0, elapsedDays)
      .reduce((s, p) => s + p.streamsDay, 0);

    // Entregue Eco REAL: pega o snapshot mais recente por playlist (plays_28d como proxy do acumulado da campanha).
    // Se ainda não tem snapshot pra uma playlist alocada, cai pro estimado proporcional como fallback.
    const latestByPlaylist = new Map<string, EcoSnap>();
    for (const s of ecoSnaps) {
      if (!latestByPlaylist.has(s.managed_playlist_id)) latestByPlaylist.set(s.managed_playlist_id, s);
    }
    const hasRealData = latestByPlaylist.size > 0;
    const ecoDelivered = eco.reduce((s, a) => {
      const snap = latestByPlaylist.get(a.managed_playlist_id);
      if (snap) {
        const v = snap.plays_28d ?? snap.plays_7d ?? snap.plays_24h ?? 0;
        return s + Number(v);
      }
      // Fallback estimado se ainda não houver coleta
      if (a.status === "done") return s + a.planned_streams;
      if (a.status === "active" || a.status === "dispatched") {
        return s + Math.round(a.planned_streams * (elapsedDays / totalDays));
      }
      return s;
    }, 0);

    // Entregue Externo: soma de reconciled_total_plays dos deals do pacote
    const extDelivered = deals.reduce((s, d) => s + Number(d.reconciled_total_plays ?? 0), 0);

    const delivered = ecoDelivered + extDelivered;
    const adherence = plannedToDate > 0 ? (delivered / plannedToDate) * 100 : 0;
    const daysLeft = Math.max(0, totalDays - elapsedDays);
    const deviating = elapsedDays >= 2 && adherence < 85;

    return { totalDays, elapsedDays, plannedToDate, ecoDelivered, extDelivered, delivered, adherence, daysLeft, deviating, hasRealData };
  }, [snapshot, campaignStartedAt, eco, ecoSnaps, deals]);

  async function handleClose() {
    if (!confirm("Encerrar a campanha? Essa ação fixa o resultado final.")) return;
    setClosing(true);
    try {
      const { error } = await supabase
        .from("campaigns")
        .update({ status: "completed", total_delivered: metrics.delivered })
        .eq("id", campaignId);
      if (error) throw error;
      toast({ title: "Campanha encerrada" });
      onClosed?.();
    } catch (e: any) {
      toast({ title: "Erro ao encerrar", description: e.message, variant: "destructive" });
    } finally {
      setClosing(false);
    }
  }

  if (loading) return <Skeleton className="h-64" />;

  const isCompleted = campaignStatus === "completed" || campaignStatus === "cancelled";

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" /> Monitoramento
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Comparando entrega real (Eco + Externo) contra a curva planejada do snapshot.
          </p>
        </div>
        {!isCompleted && metrics.daysLeft === 0 && (
          <Button size="sm" variant="solid" onClick={handleClose} disabled={closing}>
            {closing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1.5" />}
            Encerrar campanha
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <KPI label="Dia" value={`${metrics.elapsedDays}/${metrics.totalDays}`} hint={`${metrics.daysLeft}d restantes`} />
          <KPI label="Planejado até hoje" value={formatInt(metrics.plannedToDate)} />
          <KPI label={metrics.hasRealData ? "Entregue real" : "Entregue (estim.)"} value={formatInt(metrics.delivered)} hint={`Eco ${formatInt(metrics.ecoDelivered)} · Ext ${formatInt(metrics.extDelivered)}${metrics.hasRealData ? " · bot" : ""}`} />
          <KPI
            label="Aderência"
            value={`${metrics.adherence.toFixed(0)}%`}
            tone={metrics.deviating ? "warning" : "primary"}
          />
        </div>

        {/* Alerta de desvio */}
        {metrics.deviating && !isCompleted && (
          <div className="flex items-start gap-2 rounded-md bg-warning/10 border border-warning/30 p-3">
            <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
            <div className="text-xs">
              <div className="font-medium text-warning">Campanha fora do mapa</div>
              <p className="text-muted-foreground mt-0.5">
                Entrega real está {(100 - metrics.adherence).toFixed(0)}% abaixo do planejado para o dia {metrics.elapsedDays}.
                Reforce o Eco ou adicione curadores ao pacote externo.
              </p>
            </div>
          </div>
        )}

        {/* Entrega por fonte (curadores externos) — sobe pra cima do gráfico */}
        <CampaignCuratorDeals campaignId={campaignId} />

        {/* Gráfico planejado x real */}
        <div className="rounded-lg border border-border bg-elevated/30 p-3">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-2">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-primary/40" /> Planejado/dia
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-0.5 bg-primary" /> Real acumulado (projetado)
              </span>
            </div>
            <span className="tabular-nums">{formatBRL(snapshot.custoTotal)} orçado</span>
          </div>
          <CurvaReal curva={freshCurva} elapsedDays={metrics.elapsedDays} delivered={metrics.delivered} />
        </div>

        {isCompleted && (
          <div className="flex items-start gap-2 rounded-md bg-primary/10 border border-primary/30 p-3">
            <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div className="text-xs">
              <div className="font-medium text-primary">Campanha encerrada</div>
              <p className="text-muted-foreground mt-0.5">
                Resultado final: {formatInt(metrics.delivered)} streams entregues · aderência {metrics.adherence.toFixed(0)}% vs meta.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function KPI({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "primary" | "warning" }) {
  return (
    <div className="rounded-lg border border-border bg-elevated/30 p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn(
        "text-base font-semibold tabular-nums mt-0.5",
        tone === "warning" && "text-warning",
        tone === "primary" && "text-primary",
      )}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

function CurvaReal({ curva, elapsedDays, delivered }: { curva: { day: number; streamsDay: number; cumulative: number }[]; elapsedDays: number; delivered: number }) {
  if (curva.length === 0) return null;
  const w = 720, h = 140, pad = 12;
  const maxS = Math.max(...curva.map(p => p.streamsDay), 1);
  const maxC = curva[curva.length - 1].cumulative;
  const xs = (i: number) => pad + (i / Math.max(curva.length - 1, 1)) * (w - pad * 2);
  const yC = (v: number) => h - pad - (v / maxC) * (h - pad * 2);
  const yBar = (v: number) => h - pad - (v / maxS) * (h - pad * 2);
  const barW = Math.max(1, (w - pad * 2) / curva.length - 1);

  // Linha real: projeção linear de "delivered" sobre dias decorridos
  const realLine = Array.from({ length: elapsedDays }, (_, i) => {
    const x = xs(i);
    const y = yC((delivered * (i + 1)) / elapsedDays);
    return `${i === 0 ? "M" : "L"} ${x} ${y}`;
  }).join(" ");

  const plannedLine = curva
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xs(i)} ${yC(p.cumulative)}`)
    .join(" ");

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-32" preserveAspectRatio="none">
        {curva.map((p, i) => (
          <rect
            key={p.day}
            x={xs(i) - barW / 2}
            y={yBar(p.streamsDay)}
            width={barW}
            height={h - pad - yBar(p.streamsDay)}
            fill="hsl(var(--primary))"
            opacity={i < elapsedDays ? 0.35 : 0.12}
          />
        ))}
        <path d={plannedLine} fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth={1} strokeDasharray="3 3" opacity={0.6} />
        {elapsedDays > 0 && (
          <path d={realLine} fill="none" stroke="hsl(var(--primary))" strokeWidth={1.5} />
        )}
        <line x1={xs(elapsedDays - 1)} y1={pad} x2={xs(elapsedDays - 1)} y2={h - pad} stroke="hsl(var(--primary))" strokeWidth={0.5} strokeDasharray="2 2" opacity={0.5} />
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1 tabular-nums">
        <span>D1</span>
        <span>Hoje · D{elapsedDays}</span>
        <span>D{curva.length}</span>
      </div>
    </div>
  );
}
