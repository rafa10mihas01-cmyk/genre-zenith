import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import { LineChart as LineIcon, RefreshCw } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { toast } from "@/hooks/use-toast";
import { AnalyticsTabs } from "@/components/AnalyticsTabs";

type Overview = {
  totals: {
    total_campaigns: number; active_campaigns: number; completed_campaigns: number;
    draft_campaigns: number; paused_campaigns: number;
    total_promised: number; total_delivered: number;
    avg_fulfillment_rate: number | null;
  };
  top_performers: Performer[];
  bottom_performers: Performer[];
  campaigns_by_status_over_time: { month: string; status: string; count: number }[];
  cost_per_play: number | null;
  generated_at: string;
};

type Performer = {
  playlist_id: string; playlist_name: string; cover_url: string | null;
  campaigns_count: number; total_promised: number; total_delivered: number;
  fulfillment_rate: number; avg_daily_delivery: number;
};

type Velocity = {
  campaign_id: string; track_name: string; status: string;
  goal_plays: number; total_delivered: number;
  delivered_per_day: number; pace_ratio: number | null;
};

const STATUS_COLOR: Record<string, string> = {
  active: "hsl(var(--primary))",
  completed: "hsl(var(--muted-foreground))",
  draft: "hsl(var(--border))",
  paused: "hsl(var(--warning))",
  cancelled: "hsl(var(--destructive))",
};

export default function Analytics() {
  const [data, setData] = useState<Overview | null>(null);
  const [velocity, setVelocity] = useState<Velocity[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"top" | "bottom">("top");

  const load = useCallback(async () => {
    setLoading(true);
    const [ovr, vel] = await Promise.all([
      (supabase.rpc as any)("get_campaign_analytics_overview"),
      supabase.from("v_campaign_velocity" as any)
        .select("*")
        .in("status", ["active", "paused"])
        .order("pace_ratio", { ascending: true, nullsFirst: false }),
    ]);
    setLoading(false);
    if (ovr.error) toast({ title: "Erro", description: ovr.error.message, variant: "destructive" });
    setData((ovr.data as Overview) ?? null);
    setVelocity(((vel.data as any) ?? []) as Velocity[]);
  }, []);

  useEffect(() => { load(); }, [load]);

  const chartData = useMemo(() => {
    if (!data?.campaigns_by_status_over_time) return [];
    const map = new Map<string, Record<string, any>>();
    data.campaigns_by_status_over_time.forEach(r => {
      const cur = map.get(r.month) ?? { month: r.month };
      cur[r.status] = (cur[r.status] ?? 0) + r.count;
      map.set(r.month, cur);
    });
    return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
  }, [data]);

  const fulfillment = data?.totals.avg_fulfillment_rate;
  const performers = view === "top" ? (data?.top_performers ?? []) : (data?.bottom_performers ?? []);

  return (
    <>
      <PageHeader
        kicker="Operação"
        icon={LineIcon}
        title="Analytics"
        subtitle="Promessa vs entrega"
        actions={
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </Button>
        }
      />

      <PageContainer>
        <AnalyticsTabs />
        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Kpi label="Campanhas" value={(data?.totals.total_campaigns ?? 0).toString()} sub={`${data?.totals.active_campaigns ?? 0} ativas`} loading={loading} />
          <Kpi label="Prometido" value={(data?.totals.total_promised ?? 0).toLocaleString()} loading={loading} />
          <Kpi label="Entregue" value={(data?.totals.total_delivered ?? 0).toLocaleString()}
               sub={fulfillment != null ? `${Math.round(fulfillment * 100)}% cumprimento` : undefined} loading={loading} />
          <Kpi label="Custo por play"
               value={data?.cost_per_play != null ? `R$ ${Number(data.cost_per_play).toFixed(4)}` : "—"}
               loading={loading} />
        </div>

        {/* Gráfico evolução */}
        <Section title="Campanhas ao longo do tempo">
          <div className="h-64 rounded-2xl border border-border bg-card p-5">
            {loading ? <Skeleton className="h-full" /> : chartData.length === 0 ? (
              <p className="h-full flex items-center justify-center text-sm text-muted-foreground">Sem dados nos últimos 12 meses.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {Object.entries(STATUS_COLOR).map(([s, color]) => (
                    <Bar key={s} dataKey={s} stackId="a" fill={color} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Section>

        {/* Performance por playlist */}
        <Section
          title="Performance por playlist"
          actions={
            <div className="flex gap-2">
              <Button size="sm" variant={view === "top" ? "default" : "outline"} onClick={() => setView("top")}>Top 10</Button>
              <Button size="sm" variant={view === "bottom" ? "default" : "outline"} onClick={() => setView("bottom")}>Bottom 10</Button>
            </div>
          }
        >
          <div className="border border-border rounded-2xl overflow-hidden bg-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left">Playlist</th>
                    <th className="px-4 py-3 text-right">Camp.</th>
                    <th className="px-4 py-3 text-right">Prometido</th>
                    <th className="px-4 py-3 text-right">Entregue</th>
                    <th className="px-4 py-3 text-right">Cumprimento</th>
                    <th className="px-4 py-3 text-right">Plays/dia</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={6} className="p-4"><Skeleton className="h-12" /></td></tr>
                  ) : performers.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Sem histórico de campanhas ainda.</td></tr>
                  ) : performers.map(p => {
                    const pct = Math.round(p.fulfillment_rate * 100);
                    const tone = pct >= 100 ? "text-primary" : pct >= 70 ? "text-foreground" : "text-destructive";
                    return (
                      <tr key={p.playlist_id} className="border-t border-border">
                        <td className="px-4 py-3"><div className="font-medium truncate max-w-[280px]">{p.playlist_name}</div></td>
                        <td className="px-4 py-3 text-right tabular-nums">{p.campaigns_count}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{Number(p.total_promised).toLocaleString()}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{Number(p.total_delivered).toLocaleString()}</td>
                        <td className={`px-4 py-3 text-right tabular-nums font-medium ${tone}`}>{pct}%</td>
                        <td className="px-4 py-3 text-right tabular-nums">{Math.round(Number(p.avg_daily_delivery))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </Section>

        {/* Velocidade campanhas ativas */}
        <Section title="Velocidade — campanhas em execução">
          {loading ? <Skeleton className="h-32" /> : velocity.length === 0 ? (
            <div className="border border-border rounded-2xl p-8 text-center text-muted-foreground">Nenhuma campanha ativa.</div>
          ) : (
            <div className="grid gap-2">
              {velocity.map(v => {
                const pace = v.pace_ratio;
                let tone: "success" | "warning" | "danger" | "neutral" = "neutral";
                let label = "—";
                if (pace != null) {
                  if (pace >= 1.1) { tone = "success"; label = "Adiantada"; }
                  else if (pace >= 0.9) { tone = "primary" as any; label = "No ritmo"; }
                  else if (pace >= 0.6) { tone = "warning"; label = "Lenta"; }
                  else { tone = "danger"; label = "Crítica"; }
                }
                return (
                  <div key={v.campaign_id} className="rounded-2xl border border-border bg-card p-4 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{v.track_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {Number(v.total_delivered).toLocaleString()} / {Number(v.goal_plays).toLocaleString()} plays
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">Plays/dia</div>
                      <div className="font-semibold tabular-nums">{Math.round(Number(v.delivered_per_day))}</div>
                    </div>
                    <div className="w-28 text-right">
                      <StatusDot variant={tone as any} label={label} />
                      {pace != null && <div className="text-xs text-muted-foreground tabular-nums mt-1">{Math.round(pace * 100)}%</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>
      </PageContainer>
    </>
  );
}

function Kpi({ label, value, sub, loading }: { label: string; value: string; sub?: string; loading?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      {loading ? <Skeleton className="h-8 mt-1" /> : <div className="text-2xl font-semibold mt-1 tabular-nums">{value}</div>}
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function Section({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}
