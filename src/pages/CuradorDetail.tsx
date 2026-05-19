// CuradorDetail — página dedicada do curador. Substitui o antigo drawer lateral.
// Mostra identidade, KPIs, biblioteca/saldo, cérebro (trust score, sinais, recomendações)
// e deals — tudo organizado em abas.
import { useMemo } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Brain,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Lightbulb,
  ShieldAlert,
  Activity,
  TrendingUp,
  Users2,
  ExternalLink,
  Mail,
  Calendar,
  Library,
  CreditCard,
  FileText,
  ShieldCheck,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import { supabase } from "@/integrations/supabase/client";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KpiBig } from "@/components/KpiBig";
import { useCuratorBrain, useRecalcCuratorBrain } from "@/hooks/useCuratorBrain";
import { useCuratorDeals } from "@/hooks/useCuratorDeals";
import { CuratorLibraryPanel } from "@/components/curators/CuratorLibraryPanel";
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
  if (values.length < 2) return <div className="text-[11px] text-muted-foreground">Sem histórico ainda</div>;
  const w = 200, h = 40;
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const step = w / (values.length - 1);
  const points = values.map((v, i) => `${i * step},${h - ((v - min) / range) * h}`).join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={points} fill="none" stroke={color} strokeWidth={2} />
    </svg>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "primary" | "success" | "warning" | "muted" }) {
  return (
    <div className="nx-card !p-4">
      <div className="text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "text-2xl font-bold tabular-nums mt-1",
          tone === "primary" && "text-primary",
          tone === "success" && "text-emerald-400",
          tone === "warning" && "text-warning",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {typeof value === "number" ? value.toLocaleString("pt-BR") : value}
      </div>
    </div>
  );
}

export default function CuradorDetail() {
  const { id } = useParams<{ id: string }>();

  if (!id) return <Navigate to="/curadores" replace />;

  const { curators, deals: allDeals, balances, addCuratorPurchase } = useCuratorDeals();
  const curator = useMemo(() => curators.find((c) => c.id === id) ?? null, [curators, id]);
  const balance = useMemo(() => balances.find((b) => b.curator_id === id) ?? null, [balances, id]);
  const curatorDeals = useMemo(() => allDeals.filter((d) => d.curator_id === id), [allDeals, id]);

  // Fallback direto: se ainda não carregou via useCuratorDeals, busca o registro mínimo.
  const { data: fallbackCurator } = useQuery({
    queryKey: ["curator_record", id],
    enabled: !!id && !curator,
    queryFn: async () => {
      const { data, error } = await supabase.from("curators").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const resolvedCurator = curator ?? (fallbackCurator as typeof curator | undefined) ?? null;

  const { data: brain, isLoading: loadingBrain } = useCuratorBrain(id);
  const recalc = useRecalcCuratorBrain();

  const { data: history = [] } = useQuery({
    queryKey: ["curator_brain_history", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("curator_brain_history")
        .select("trust_score, delivery_rate_pct, calculated_at")
        .eq("curator_id", id)
        .order("calculated_at", { ascending: true })
        .limit(60);
      if (error) throw error;
      return data ?? [];
    },
  });

  const trustSeries = useMemo(() => history.map((h) => Number(h.trust_score ?? 0)), [history]);
  const deliverySeries = useMemo(() => history.map((h) => Number(h.delivery_rate_pct ?? 0)), [history]);

  if (!resolvedCurator) {
    return (
      <PageContainer>
        <div className="mb-3">
          <Button variant="ghost" size="sm" asChild className="gap-1.5 h-8 -ml-2 text-muted-foreground">
            <Link to="/curadores"><ArrowLeft className="h-4 w-4" /> Curadores</Link>
          </Button>
        </div>
        <PageHeader
        domain="curators" title="Carregando curador…" subtitle="Buscando dados do curador" />
      </PageContainer>
    );
  }

  const initials = resolvedCurator.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

  const ativos = curatorDeals.filter((d) => !d.closed_at).length;
  const concluidos = curatorDeals.filter((d) => d.closed_status === "completed").length;
  const investido = curatorDeals.reduce((acc, d) => acc + (d.cost ?? 0), 0);

  const sevTone = (s: string) =>
    s === "high" ? "destructive" : s === "medium" ? "warning" : "muted";

  const trustTone = !brain
    ? "muted"
    : brain.trust_score >= 75
    ? "success"
    : brain.trust_score >= 50
    ? "primary"
    : "destructive";

  return (
    <PageContainer>
      <div className="mb-3">
        <Button variant="ghost" size="sm" asChild className="gap-1.5 h-8 -ml-2 text-muted-foreground">
          <Link to="/curadores"><ArrowLeft className="h-4 w-4" /> Curadores</Link>
        </Button>
      </div>

      <PageHeader
        title={resolvedCurator.name}
        subtitle={[
          "Curador",
          resolvedCurator.deal_type === "mensal" ? "plano mensal" : null,
          resolvedCurator.contact || null,
          `Desde ${format(new Date(resolvedCurator.created_at), "dd MMM yyyy", { locale: ptBR })}`,
        ].filter(Boolean).join(" · ")}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild className="gap-1.5 h-9 rounded-full">
              <Link to="/deals/comparar"><Activity className="h-4 w-4" /> Comparar</Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => recalc.mutate(id)}
              disabled={recalc.isPending}
              className="gap-1.5 h-9 rounded-full"
            >
              <RefreshCw className={cn("h-4 w-4", recalc.isPending && "animate-spin")} />
              Recalcular cérebro
            </Button>
          </div>
        }
      />

      {/* KPIs — hierarquia cockpit (mesmo padrão do Cliente) */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2 pt-4 mb-6">
        <KpiBig
          label="Investido"
          value={formatBRL(investido)}
          icon={CreditCard}
          hint={curatorDeals.length > 0 ? `Em ${curatorDeals.length} deal${curatorDeals.length === 1 ? "" : "s"}` : "Sem deals"}
          tier="hero"
          domain="curators"
        />
        <KpiBig label="Deals" value={curatorDeals.length} icon={FileText} hint="Total fechados" domain="deals" />
        <KpiBig label="Ativos" value={ativos} icon={CheckCircle2} hint="Em andamento" tone="primary" domain="deals" />
        <KpiBig
          label="Trust score"
          value={brain ? `${brain.trust_score}/100` : "—"}
          icon={ShieldCheck}
          hint={brain ? `Confiança ${brain.confidence_score}%` : "Sem cálculo"}
          tone={trustTone === "success" ? "success" : trustTone === "primary" ? "primary" : trustTone === "destructive" ? "warning" : "default"}
          domain="curators"
        />
        <KpiBig label="Concluídos" value={concluidos} icon={CheckCircle2} hint="Entregues" tier="quiet" />
      </div>


      <Tabs defaultValue="biblioteca" className="space-y-4">
        <TabsList>
          <TabsTrigger value="biblioteca" className="gap-1.5"><Library className="h-3.5 w-3.5" /> Biblioteca</TabsTrigger>
          <TabsTrigger value="cerebro" className="gap-1.5"><Brain className="h-3.5 w-3.5" /> Cérebro</TabsTrigger>
          <TabsTrigger value="deals">Deals <span className="ml-1.5 text-muted-foreground">{curatorDeals.length}</span></TabsTrigger>
          <TabsTrigger value="notas">Notas</TabsTrigger>
        </TabsList>

        {/* ----- Biblioteca + Saldo ----- */}
        <TabsContent value="biblioteca">
          <Card>
            <CardContent className="p-5">
              <CuratorLibraryPanel
                curator={resolvedCurator}
                deals={curatorDeals}
                balance={balance}
                onAddPurchase={addCuratorPurchase}
                flush
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ----- Cérebro ----- */}
        <TabsContent value="cerebro" className="space-y-4">
          {loadingBrain ? (
            <div className="nx-card py-10 text-center text-sm text-muted-foreground">Carregando cérebro…</div>
          ) : !brain ? (
            <div className="nx-card py-10 text-center space-y-3">
              <div className="text-sm text-muted-foreground">Cérebro ainda não calculado.</div>
              <Button onClick={() => recalc.mutate(id)} disabled={recalc.isPending}>
                <RefreshCw className={cn("h-4 w-4 mr-2", recalc.isPending && "animate-spin")} />
                Calcular agora
              </Button>
            </div>
          ) : (
            <>
              {/* KPIs cérebro */}
              <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className={cn(
                  "rounded-2xl border px-5 py-4",
                  trustTone === "success" && "bg-success/10 border-success/30",
                  trustTone === "primary" && "bg-primary/10 border-primary/30",
                  trustTone === "destructive" && "bg-destructive/10 border-destructive/30",
                  trustTone === "muted" && "bg-muted/30 border-border/40",
                )}>
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                    <Brain className="h-3.5 w-3.5" /> Trust score
                  </div>
                  <div className="text-[32px] font-bold tabular-nums leading-none mt-2">
                    {brain.trust_score}
                    <span className="text-[12px] text-muted-foreground font-medium">/100</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">Confiança {brain.confidence_score}%</div>
                </div>
                <div className="rounded-2xl border border-border/40 bg-[hsl(var(--card))] px-5 py-4">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Taxa de entrega</div>
                  <div className="text-[32px] font-bold tabular-nums leading-none mt-2">
                    {brain.delivery_rate_pct !== null ? `${brain.delivery_rate_pct}%` : "—"}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    No prazo: {brain.on_time_rate_pct !== null ? `${brain.on_time_rate_pct}%` : "—"}
                  </div>
                </div>
                <div className="rounded-2xl border border-border/40 bg-[hsl(var(--card))] px-5 py-4">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">CPP médio</div>
                  <div className="text-[32px] font-bold tabular-nums leading-none mt-2">{formatCPP(brain.avg_cpp)}</div>
                  <div className="text-[11px] text-muted-foreground mt-1">ROI score {brain.roi_score ?? "—"}</div>
                </div>
                <div className="rounded-2xl border border-border/40 bg-[hsl(var(--card))] px-5 py-4">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Capacidade</div>
                  <div className="text-[32px] font-bold tabular-nums leading-none mt-2">
                    {brain.capacity_avg_per_deal !== null ? formatNumber(brain.capacity_avg_per_deal) : "—"}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    P90: {brain.capacity_p90 !== null ? formatNumber(brain.capacity_p90) : "—"} plays/deal
                  </div>
                </div>
              </section>

              {/* Histórico */}
              <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="nx-card">
                  <div className="mb-3">
                    <h3 className="text-[14px] font-semibold flex items-center gap-1.5">
                      <TrendingUp className="h-4 w-4 text-primary" /> Trust ao longo do tempo
                    </h3>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Últimas {history.length} medições</p>
                  </div>
                  <Sparkline values={trustSeries} />
                </div>
                <div className="nx-card">
                  <div className="mb-3">
                    <h3 className="text-[14px] font-semibold flex items-center gap-1.5">
                      <Activity className="h-4 w-4 text-success" /> Taxa de entrega
                    </h3>
                    <p className="text-[11px] text-muted-foreground mt-0.5">% das metas batidas</p>
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
                    <div><span className="text-muted-foreground">Tipo:</span> {brain.identity?.deal_type ?? "—"}</div>
                    <div><span className="text-muted-foreground">Playlists mapeadas:</span> {brain.identity?.playlists_count ?? 0}</div>
                    <div><span className="text-muted-foreground">Alcance total:</span> {formatNumber(brain.identity?.total_followers_alcance ?? 0)} seguidores</div>
                    <div><span className="text-muted-foreground">Idade na base:</span> {brain.identity?.age_days ?? 0} dias</div>
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
                      <span className="text-muted-foreground">Sucessos:</span> {brain.reliability?.successful ?? 0} ·{" "}
                      <span className="text-muted-foreground">Falhas:</span> {brain.reliability?.failed ?? 0}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Total investido:</span>{" "}
                      {formatBRL(Number(brain.economics?.total_invested ?? 0))}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Alertas abertos:</span> {brain.risk?.open_alerts ?? 0}
                      {(brain.risk?.high_alerts ?? 0) > 0 && (
                        <span className="text-destructive ml-1">({brain.risk?.high_alerts} alta)</span>
                      )}
                    </div>
                  </div>
                </div>
              </section>

              {/* Sinais */}
              <section className="space-y-3">
                <h3 className="text-[14px] font-semibold flex items-center gap-1.5">
                  <AlertCircle className="h-4 w-4" /> Sinais ({brain.signals?.length ?? 0})
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
                  <Lightbulb className="h-4 w-4" /> Recomendações ({brain.recommendations?.length ?? 0})
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
                        <li key={i} className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-[13px]">
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

              <div className="text-[11px] text-muted-foreground text-right">
                Atualizado{" "}
                {brain.last_calculated_at ? new Date(brain.last_calculated_at).toLocaleString("pt-BR") : "—"}
              </div>
            </>
          )}
        </TabsContent>

        {/* ----- Deals ----- */}
        <TabsContent value="deals">
          {curatorDeals.length === 0 ? (
            <Card>
              <CardContent className="p-10 text-center">
                <p className="text-sm text-muted-foreground">Sem deals.</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="!p-0 overflow-hidden">
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
                    {curatorDeals.map((d) => (
                      <tr key={d.id} className="border-b border-border/50 last:border-b-0 hover:bg-muted/30">
                        <td className="px-5 py-3 truncate max-w-[260px]">
                          <Link to={`/deals/${d.id}`} className="hover:text-primary">{d.song_name ?? "—"}</Link>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{formatBRL(Number(d.cost ?? 0))}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{formatNumber(Number(d.target_plays ?? 0))}</td>
                        <td className="px-3 py-3 text-muted-foreground">
                          {d.started_at ? new Date(d.started_at).toLocaleDateString("pt-BR") : "—"}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span
                            className={cn(
                              "inline-flex text-[11px] font-medium px-2 py-0.5 rounded",
                              d.closed_at ? "bg-success/15 text-success" : "bg-primary/15 text-primary",
                            )}
                          >
                            {d.closed_at ? "Fechado" : "Aberto"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </TabsContent>

        {/* ----- Notas ----- */}
        <TabsContent value="notas">
          <Card>
            <CardContent className="p-5">
              {resolvedCurator.notes ? (
                <p className="text-sm text-foreground whitespace-pre-wrap">{resolvedCurator.notes}</p>
              ) : (
                <p className="text-sm text-muted-foreground">Sem observações.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
