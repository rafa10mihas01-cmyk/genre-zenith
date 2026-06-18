// CuradorDetail — página dedicada do curador. Substitui o antigo drawer lateral.
// Mostra identidade, KPIs, biblioteca/saldo, cérebro (trust score, sinais, recomendações)
// e deals — tudo organizado em abas.
import { useMemo, useState } from "react";
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
  ChevronDown,
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
  const [healthOpen, setHealthOpen] = useState(false);

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

  if (!id) return <Navigate to="/curadores" replace />;

  if (!resolvedCurator) {
    return (
      <PageContainer>
        
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
            <Button variant="outline" size="sm" asChild className="gap-1.5 h-9 rounded-full px-2.5 sm:px-3">
              <Link to="/deals/comparar">
                <Activity className="h-4 w-4" />
                <span className="hidden sm:inline">Comparar</span>
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => recalc.mutate(id)}
              disabled={recalc.isPending}
              className="gap-1.5 h-9 rounded-full px-2.5 sm:px-3"
            >
              <RefreshCw className={cn("h-4 w-4", recalc.isPending && "animate-spin")} />
              <span className="hidden sm:inline">Recalcular cérebro</span>
            </Button>
          </div>
        }
      />

      {/* KPIs — hierarquia cockpit (mesmo padrão do Cliente) */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 pt-4 mb-6">
        <KpiBig
          label="Investido"
          value={formatBRL(investido)}
          icon={CreditCard}
          hint={curatorDeals.length > 0 ? `Em ${curatorDeals.length} deal${curatorDeals.length === 1 ? "" : "s"}` : "Sem deals"}
          tier="hero"
          domain="curators"
        />
        <KpiBig
          label="Negociações"
          value={curatorDeals.length}
          icon={FileText}
          hint={concluidos > 0 ? `${concluidos} concluído${concluidos === 1 ? "" : "s"} · ${ativos} ativo${ativos === 1 ? "" : "s"}` : `${ativos} em andamento`}
          domain="deals"
        />
        <KpiBig label="Ativos" value={ativos} icon={CheckCircle2} hint="Em andamento" tone="primary" domain="deals" />
        <KpiBig
          label="Trust score"
          value={brain ? `${brain.trust_score}/100` : "—"}
          icon={ShieldCheck}
          hint={brain ? `Confiança ${brain.confidence_score}%` : "Sem cálculo"}
          tone={trustTone === "success" ? "success" : trustTone === "primary" ? "primary" : trustTone === "destructive" ? "warning" : "default"}
          domain="curators"
        />
      </div>


      <Tabs defaultValue="biblioteca" className="space-y-4">
        <TabsList>
          <TabsTrigger value="biblioteca" className="gap-1.5"><Library className="h-3.5 w-3.5" /> Biblioteca</TabsTrigger>
          <TabsTrigger value="deals">Deals <span className="ml-1.5 text-muted-foreground">{curatorDeals.length}</span></TabsTrigger>
          <TabsTrigger value="notas">Notas</TabsTrigger>
        </TabsList>

        {/* ----- Biblioteca + Saúde (sinais/recomendações) + Saldo ----- */}
        <TabsContent value="biblioteca" className="space-y-4">
          {/* Saúde do curador — antes era aba "Cérebro" separada. Colapsável. */}
          {brain && ((brain.signals?.length ?? 0) > 0 || (brain.recommendations?.length ?? 0) > 0) && (
            <Card>
              <CardContent className="p-0">
                <button
                  type="button"
                  onClick={() => setHealthOpen((v) => !v)}
                  className="w-full flex items-center justify-between gap-2 px-5 py-4 text-left hover:bg-muted/20 transition-colors rounded-2xl"
                  aria-expanded={healthOpen}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Brain className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Saúde do curador</h3>
                    <div className="flex items-center gap-1.5 ml-1">
                      {(brain.signals?.length ?? 0) > 0 && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-warning/20 text-warning">
                          <AlertCircle className="h-3 w-3" /> {brain.signals!.length} sinais
                        </span>
                      )}
                      {(brain.recommendations?.length ?? 0) > 0 && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                          <Lightbulb className="h-3 w-3" /> {brain.recommendations!.length} ações
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[11px] text-muted-foreground hidden sm:inline">
                      Atualizado {brain.last_calculated_at ? new Date(brain.last_calculated_at).toLocaleString("pt-BR") : "—"}
                    </span>
                    <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", healthOpen && "rotate-180")} />
                  </div>
                </button>

                {healthOpen && (
                  <div className="px-5 pb-5 space-y-4 border-t border-border/40 pt-4">
                    {brain.signals && brain.signals.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                          <AlertCircle className="h-3.5 w-3.5" /> Sinais ({brain.signals.length})
                        </div>
                        <ul className="space-y-1.5">
                          {brain.signals.map((s, i) => {
                            const tone = sevTone(s.severity);
                            return (
                              <li
                                key={i}
                                className={cn(
                                  "flex items-start gap-3 rounded-lg border px-3 py-2 text-[12.5px]",
                                  tone === "destructive" && "border-destructive/30 bg-destructive/10",
                                  tone === "warning" && "border-warning/30 bg-warning/10",
                                  tone === "muted" && "border-border/40 bg-muted/30",
                                )}
                              >
                                <AlertCircle
                                  className={cn(
                                    "h-3.5 w-3.5 shrink-0 mt-0.5",
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
                      </div>
                    )}

                    {brain.recommendations && brain.recommendations.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                          <Lightbulb className="h-3.5 w-3.5" /> Recomendações ({brain.recommendations.length})
                        </div>
                        <ol className="space-y-1.5">
                          {brain.recommendations
                            .slice()
                            .sort((a, b) => a.priority - b.priority)
                            .map((r, i) => (
                              <li key={i} className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-[12.5px]">
                                <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-primary/20 text-primary text-[10px] font-bold shrink-0">
                                  {r.priority}
                                </span>
                                <div className="min-w-0">
                                  <div className="font-semibold">{r.action}</div>
                                  <div className="text-muted-foreground">{r.reason}</div>
                                </div>
                              </li>
                            ))}
                        </ol>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}


          <CuratorLibraryPanel
            curator={resolvedCurator}
            deals={curatorDeals}
            balance={balance}
            onAddPurchase={addCuratorPurchase}
          />
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
