import { useMemo } from "react";
import { useParams, Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Brain,
  RefreshCw,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Lightbulb,
  ShieldAlert,
  Activity,
  TrendingUp,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { useCuratorBrain, useRecalcCuratorBrain } from "@/hooks/useCuratorBrain";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const formatBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

const formatCPP = (v: number | null) => {
  if (v === null || !isFinite(v)) return "—";
  const opts =
    v < 0.01
      ? { minimumFractionDigits: 4, maximumFractionDigits: 4 }
      : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", ...opts }).format(v);
};

function Sparkline({ values, color = "hsl(var(--primary))" }: { values: number[]; color?: string }) {
  if (values.length < 2) {
    return <div className="text-[11px] text-muted-foreground">Sem histórico ainda</div>;
  }
  const w = 200;
  const h = 40;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = w / (values.length - 1);
  const points = values
    .map((v, i) => `${i * step},${h - ((v - min) / range) * h}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={points} fill="none" stroke={color} strokeWidth={2} />
    </svg>
  );
}

export default function CuradorDetail() {
  const { id } = useParams<{ id: string }>();

  const { data: curator, isLoading: loadingCurator } = useQuery({
    queryKey: ["curator", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("curators")
        .select("*")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: brain, isLoading: loadingBrain } = useCuratorBrain(id);
  const recalc = useRecalcCuratorBrain();

  const { data: history = [] } = useQuery({
    queryKey: ["curator_brain_history", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("curator_brain_history")
        .select("trust_score, delivery_rate_pct, calculated_at")
        .eq("curator_id", id!)
        .order("calculated_at", { ascending: true })
        .limit(60);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: deals = [] } = useQuery({
    queryKey: ["curator_deals_list", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("curator_deals")
        .select("id, song_name, cost, target_plays, started_at, closed_at, state")
        .eq("curator_id", id!)
        .order("started_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });

  const trustSeries = useMemo(
    () => history.map((h) => Number(h.trust_score ?? 0)),
    [history],
  );
  const deliverySeries = useMemo(
    () => history.map((h) => Number(h.delivery_rate_pct ?? 0)),
    [history],
  );

  if (!id) return <Navigate to="/playlist-deals" replace />;

  const sevTone = (s: string) =>
    s === "high" ? "destructive" : s === "medium" ? "warning" : "muted";

  const trustTone =
    !brain
      ? "muted"
      : brain.trust_score >= 75
      ? "success"
      : brain.trust_score >= 50
      ? "primary"
      : "destructive";

  return (
    <div className="space-y-8 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-3">
          <Link
            to="/playlist-deals"
            className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Voltar para Playlist Deals
          </Link>
          <PageHeader
            title={curator?.name ?? (loadingCurator ? "Carregando…" : "Curador")}
            subtitle="Acompanhar trust score, sinais e histórico de performance"
          />
        </div>
        <Button
          variant="outline"
          onClick={() => recalc.mutate(id)}
          disabled={recalc.isPending}
        >
          <RefreshCw className={cn("h-4 w-4 mr-2", recalc.isPending && "animate-spin")} />
          Recalcular cérebro
        </Button>
      </div>

      {loadingBrain ? (
        <div className="nx-card py-10 text-center text-sm text-muted-foreground">
          Carregando cérebro…
        </div>
      ) : !brain ? (
        <div className="nx-card py-10 text-center space-y-3">
          <div className="text-sm text-muted-foreground">
            Nenhum cérebro calculado ainda para este curador.
          </div>
          <Button onClick={() => recalc.mutate(id)} disabled={recalc.isPending}>
            <RefreshCw className={cn("h-4 w-4 mr-2", recalc.isPending && "animate-spin")} />
            Calcular agora
          </Button>
        </div>
      ) : (
        <>
          {/* KPIs principais */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div
              className={cn(
                "rounded-2xl border px-5 py-4",
                trustTone === "success" && "bg-success/10 border-success/30",
                trustTone === "primary" && "bg-primary/10 border-primary/30",
                trustTone === "destructive" && "bg-destructive/10 border-destructive/30",
                trustTone === "muted" && "bg-muted/30 border-border/40",
              )}
            >
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                <Brain className="h-3.5 w-3.5" /> Trust score
              </div>
              <div className="text-[32px] font-bold tabular-nums leading-none mt-2">
                {brain.trust_score}
                <span className="text-[12px] text-muted-foreground font-medium">/100</span>
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                Confiança {brain.confidence_score}%
              </div>
            </div>

            <div className="rounded-2xl border border-border/40 bg-[hsl(var(--card))] px-5 py-4">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                Taxa de entrega
              </div>
              <div className="text-[32px] font-bold tabular-nums leading-none mt-2">
                {brain.delivery_rate_pct !== null ? `${brain.delivery_rate_pct}%` : "—"}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                No prazo: {brain.on_time_rate_pct !== null ? `${brain.on_time_rate_pct}%` : "—"}
              </div>
            </div>

            <div className="rounded-2xl border border-border/40 bg-[hsl(var(--card))] px-5 py-4">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                CPP médio
              </div>
              <div className="text-[32px] font-bold tabular-nums leading-none mt-2">
                {formatCPP(brain.avg_cpp)}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                ROI score {brain.roi_score ?? "—"}
              </div>
            </div>

            <div className="rounded-2xl border border-border/40 bg-[hsl(var(--card))] px-5 py-4">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                Capacidade
              </div>
              <div className="text-[32px] font-bold tabular-nums leading-none mt-2">
                {brain.capacity_avg_per_deal !== null
                  ? formatNumber(brain.capacity_avg_per_deal)
                  : "—"}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                P90:{" "}
                {brain.capacity_p90 !== null ? formatNumber(brain.capacity_p90) : "—"} plays/deal
              </div>
            </div>
          </section>

          {/* Histórico */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="nx-card">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-[14px] font-semibold flex items-center gap-1.5">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    Trust ao longo do tempo
                  </h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Últimas {history.length} medições
                  </p>
                </div>
              </div>
              <Sparkline values={trustSeries} color="hsl(var(--primary))" />
            </div>
            <div className="nx-card">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-[14px] font-semibold flex items-center gap-1.5">
                    <Activity className="h-4 w-4 text-success" />
                    Taxa de entrega
                  </h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">% das metas batidas</p>
                </div>
              </div>
              <Sparkline values={deliverySeries} color="hsl(var(--success))" />
            </div>
          </section>

          {/* Identidade & Risco */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="nx-card space-y-2">
              <div className="text-[12px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5" /> Identidade
              </div>
              <div className="text-[13px] space-y-1">
                <div>
                  <span className="text-muted-foreground">Tipo:</span>{" "}
                  {brain.identity?.deal_type ?? "—"}
                </div>
                <div>
                  <span className="text-muted-foreground">Playlists mapeadas:</span>{" "}
                  {brain.identity?.playlists_count ?? 0}
                </div>
                <div>
                  <span className="text-muted-foreground">Alcance total:</span>{" "}
                  {formatNumber(brain.identity?.total_followers_alcance ?? 0)} seguidores
                </div>
                <div>
                  <span className="text-muted-foreground">Idade na base:</span>{" "}
                  {brain.identity?.age_days ?? 0} dias
                </div>
              </div>
            </div>
            <div className="nx-card space-y-2">
              <div className="text-[12px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                <ShieldAlert className="h-3.5 w-3.5" /> Risco & histórico
              </div>
              <div className="text-[13px] space-y-1">
                <div>
                  <span className="text-muted-foreground">Deals fechados:</span>{" "}
                  {brain.reliability?.closed_deals ?? 0} / {brain.reliability?.total_deals ?? 0}
                </div>
                <div>
                  <span className="text-muted-foreground">Sucessos:</span>{" "}
                  {brain.reliability?.successful ?? 0} ·{" "}
                  <span className="text-muted-foreground">Falhas:</span>{" "}
                  {brain.reliability?.failed ?? 0}
                </div>
                <div>
                  <span className="text-muted-foreground">Total investido:</span>{" "}
                  {formatBRL(Number(brain.economics?.total_invested ?? 0))}
                </div>
                <div>
                  <span className="text-muted-foreground">Alertas abertos:</span>{" "}
                  {brain.risk?.open_alerts ?? 0}
                  {(brain.risk?.high_alerts ?? 0) > 0 && (
                    <span className="text-destructive ml-1">
                      ({brain.risk?.high_alerts} alta)
                    </span>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Sinais */}
          <section className="space-y-3">
            <h3 className="text-[14px] font-semibold flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4" />
              Sinais ({brain.signals?.length ?? 0})
            </h3>
            {!brain.signals || brain.signals.length === 0 ? (
              <div className="rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-[13px] text-success flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" /> Nenhum sinal de risco detectado
              </div>
            ) : (
              <ul className="space-y-2">
                {brain.signals.map((s, i) => {
                  const tone = sevTone(s.severity);
                  return (
                    <li
                      key={i}
                      className={cn(
                        "flex items-start gap-3 rounded-lg border px-4 py-3 text-[13px]",
                        tone === "destructive" && "border-destructive/30 bg-destructive/10",
                        tone === "warning" && "border-warning/30 bg-warning/10",
                        tone === "muted" && "border-border/40 bg-muted/30",
                      )}
                    >
                      <AlertCircle
                        className={cn(
                          "h-4 w-4 shrink-0 mt-0.5",
                          tone === "destructive" && "text-destructive",
                          tone === "warning" && "text-warning",
                          tone === "muted" && "text-muted-foreground",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold">{s.code}</div>
                        <div className="text-muted-foreground">{s.message}</div>
                      </div>
                      <span
                        className={cn(
                          "text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0",
                          tone === "destructive" && "bg-destructive/20 text-destructive",
                          tone === "warning" && "bg-warning/20 text-warning",
                          tone === "muted" && "bg-muted text-muted-foreground",
                        )}
                      >
                        {s.severity}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Recomendações */}
          <section className="space-y-3">
            <h3 className="text-[14px] font-semibold flex items-center gap-1.5">
              <Lightbulb className="h-4 w-4" />
              Recomendações ({brain.recommendations?.length ?? 0})
            </h3>
            {!brain.recommendations || brain.recommendations.length === 0 ? (
              <div className="rounded-lg border border-border/40 bg-muted/20 px-4 py-3 text-[13px] text-muted-foreground">
                Sem ações sugeridas no momento.
              </div>
            ) : (
              <ol className="space-y-2">
                {brain.recommendations
                  .slice()
                  .sort((a, b) => a.priority - b.priority)
                  .map((r, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-[13px]"
                    >
                      <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-primary/20 text-primary text-[11px] font-bold shrink-0">
                        {r.priority}
                      </span>
                      <div className="min-w-0">
                        <div className="font-semibold">{r.action}</div>
                        <div className="text-muted-foreground">{r.reason}</div>
                      </div>
                    </li>
                  ))}
              </ol>
            )}
          </section>

          {/* Deals recentes */}
          <section className="nx-card !p-0 overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <h3 className="text-[14px] font-semibold">Deals recentes</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Últimos {deals.length} deals deste curador
              </p>
            </div>
            {deals.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Nenhum deal registrado
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                      <th className="text-left px-5 py-3 font-medium">Música</th>
                      <th className="text-right px-3 py-3 font-medium">Custo</th>
                      <th className="text-right px-3 py-3 font-medium">Meta</th>
                      <th className="text-left px-3 py-3 font-medium">Aberto</th>
                      <th className="text-right px-5 py-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deals.map((d) => (
                      <tr
                        key={d.id}
                        className="border-b border-border/50 last:border-b-0 hover:bg-muted/30"
                      >
                        <td className="px-5 py-3 truncate max-w-[260px]">{d.song_name ?? "—"}</td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {formatBRL(Number(d.cost ?? 0))}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {formatNumber(Number(d.target_plays ?? 0))}
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">
                          {d.started_at
                            ? new Date(d.started_at).toLocaleDateString("pt-BR")
                            : "—"}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span
                            className={cn(
                              "inline-flex text-[11px] font-medium px-2 py-0.5 rounded",
                              d.closed_at
                                ? "bg-success/15 text-success"
                                : "bg-primary/15 text-primary",
                            )}
                          >
                            {d.closed_at ? "Fechado" : d.state ?? "Aberto"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="text-[11px] text-muted-foreground text-right">
            Atualizado{" "}
            {brain.last_calculated_at
              ? new Date(brain.last_calculated_at).toLocaleString("pt-BR")
              : "—"}
          </div>
        </>
      )}
    </div>
  );
}
