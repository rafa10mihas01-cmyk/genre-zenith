// /analytics — Aba "Deals".
// Lê DIRETO do motor vivo: curator_deals + curator_deal_snapshots.
// Aposentou: campaigns.total_delivered, campaign_allocations,
// v_playlist_delivery_history, v_campaign_velocity, RPC get_campaign_analytics_overview.
import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import { LineChart as LineIcon, RefreshCw, Handshake, Activity, Zap, TrendingUp, DollarSign } from "lucide-react";
import { Kpi } from "@/components/ui/kpi";
import { cn } from "@/lib/utils";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { AnalyticsTabs } from "@/components/AnalyticsTabs";
import HeatmapEntregas from "@/pages/HeatmapEntregas";
import {
  aggregateDeliveriesByDay,
  computeDealPace,
  isoSinceDays,
  playsDeliveredInWindow,
  realCostPerPlay,
  topPlaylistsByDelta,
  type Deal,
  type Snapshot,
} from "@/lib/dealsAnalytics";

export default function Analytics() {
  const qc = useQueryClient();
  const ANALYTICS_KEY = ["analytics_deals_overview"] as const;

  const query = useQuery({
    queryKey: ANALYTICS_KEY,
    queryFn: async () => {
      const since30 = isoSinceDays(30);
      const since7 = isoSinceDays(7);

      const [dealsRes, snap30Res, snap7Res] = await Promise.all([
        supabase
          .from("curator_deals")
          .select("id, state, song_artist, song_name, target_plays, baseline_plays, cost, started_at, ends_at"),
        supabase
          .from("curator_deal_snapshots")
          .select("deal_id, playlist_id, plays, captured_at")
          .gte("captured_at", since30)
          .order("captured_at", { ascending: true })
          .limit(10000),
        supabase
          .from("curator_deal_snapshots")
          .select("deal_id, playlist_id, plays, captured_at")
          .gte("captured_at", since7)
          .order("captured_at", { ascending: true })
          .limit(5000),
      ]);

      const deals = ((dealsRes.data ?? []) as unknown as Deal[]);
      const snapshots30d = ((snap30Res.data ?? []) as unknown as Snapshot[]);
      const snapshots7d = ((snap7Res.data ?? []) as unknown as Snapshot[]);

      const ids = [...new Set(snapshots30d.map((s) => s.playlist_id).filter(Boolean))] as string[];
      let playlistsMeta: Record<string, string> = {};
      if (ids.length > 0) {
        const { data: pls } = await supabase
          .from("v_curator_playlists_operational")
          .select("id, playlist_name")
          .in("id", ids);
        for (const p of (pls ?? []) as { id: string; playlist_name: string | null }[]) {
          if (p.playlist_name) playlistsMeta[p.id] = p.playlist_name;
        }
      }

      return { deals, snapshots30d, snapshots7d, playlistsMeta };
    },
  });

  const deals = query.data?.deals ?? [];
  const snapshots30d = query.data?.snapshots30d ?? [];
  const snapshots7d = query.data?.snapshots7d ?? [];
  const playlistsMeta = query.data?.playlistsMeta ?? {};
  const loading = query.isLoading && !query.data;
  const load = () => qc.invalidateQueries({ queryKey: ANALYTICS_KEY });

  // ─── KPIs ───
  const activeDeals = useMemo(() => deals.filter((d) => d.state === "active"), [deals]);
  const plays7d = useMemo(() => playsDeliveredInWindow(snapshots7d), [snapshots7d]);
  const plays30d = useMemo(() => playsDeliveredInWindow(snapshots30d), [snapshots30d]);
  const dailyAvg30d = Math.round(plays30d / 30);
  const cpp = useMemo(() => realCostPerPlay(deals, snapshots30d), [deals, snapshots30d]);

  // ─── Ritmo dos deals ativos ───
  const paceRows = useMemo(
    () => activeDeals
      .map((d) => computeDealPace(d, snapshots30d))
      .sort((a, b) => (a.pace_ratio ?? 99) - (b.pace_ratio ?? 99)),
    [activeDeals, snapshots30d],
  );

  // ─── Entregas por dia (30d) ───
  const dailyChart = useMemo(() => aggregateDeliveriesByDay(snapshots30d), [snapshots30d]);

  // ─── Top playlists ───
  const topPlaylists = useMemo(() => topPlaylistsByDelta(snapshots30d, 10), [snapshots30d]);

  return (
    <>
      <PageHeader
        kicker="Inteligência"
        icon={LineIcon}
        title="Analytics"
        subtitle="Motor de deals · Crescimento · Mercado"
        manualKey="analytics"
        actions={
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </Button>
        }
      />

      <PageContainer>
        <AnalyticsTabs />

        {/* KPIs reais */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Kpi
            variant="hero"
            className="md:col-span-1"
            icon={Activity}
            label="Deals ativos"
            value={activeDeals.length}
            hint={`${deals.length} no total`}
            domain="deals"
            loading={loading}
          />
          <Kpi
            icon={Zap}
            label="Plays entregues (7d)"
            value={plays7d.toLocaleString("pt-BR")}
            hint="Janela curta — ritmo recente"
            domain="campaigns"
            loading={loading}
          />
          <Kpi
            icon={TrendingUp}
            label="Média diária (30d)"
            value={dailyAvg30d.toLocaleString("pt-BR")}
            hint={`${plays30d.toLocaleString("pt-BR")} no período`}
            domain="playlists"
            loading={loading}
          />
          <Kpi
            icon={DollarSign}
            label="Custo por play"
            value={cpp != null ? `R$ ${cpp.toFixed(4)}` : "—"}
            hint={cpp != null ? "soma(custo) ÷ plays" : "Sem entregas"}
            domain="system"
            loading={loading}
          />
        </section>



        {/* Ritmo dos deals ativos */}
        <Section title="Ritmo dos deals ativos">
          {loading ? (
            <Skeleton className="h-32" />
          ) : paceRows.length === 0 ? (
            <Empty
              icon={<Handshake className="h-8 w-8 text-muted-foreground" />}
              title="Nenhum deal ativo"
              sub="Quando você abrir um deal em /playlist-deals, o ritmo aparece aqui."
            />
          ) : (
            <div className="grid gap-2 min-w-0">
              {paceRows.map((r) => {
                const tone = String(r.tone);
                const borderL =
                  tone === "destructive" || tone === "danger" || tone === "critical"
                    ? "border-l-destructive"
                    : tone === "warning" || tone === "warn"
                      ? "border-l-amber-500"
                      : tone === "success"
                        ? "border-l-primary"
                        : "border-l-border";
                return (
                  <div
                    key={r.deal.id}
                    className={cn(
                      "min-w-0 rounded-2xl border border-border border-l-2 bg-card p-4 flex flex-col gap-3 hover:bg-elevated/40 transition-colors sm:flex-row sm:items-center sm:gap-4",
                      borderL,
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">
                        {r.deal.song_artist ?? "—"} <span className="text-muted-foreground">·</span> {r.deal.song_name ?? "—"}
                      </div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {r.delivered.toLocaleString("pt-BR")} / {r.target.toLocaleString("pt-BR")} plays
                      </div>
                    </div>
                    <div className="hidden sm:block shrink-0 text-right">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Plays/dia</div>
                      <div className="font-semibold tabular-nums">{Math.round(r.plays_per_day).toLocaleString("pt-BR")}</div>
                    </div>
                    <div className="flex w-full min-w-0 items-center justify-between gap-3 sm:block sm:w-28 sm:shrink-0 sm:text-right">
                      <StatusDot variant={r.tone as any} label={r.label} className="min-w-0" />
                      {r.pace_ratio != null && (
                        <div className="shrink-0 text-xs text-muted-foreground tabular-nums sm:mt-1">
                          {Math.round(r.pace_ratio * 100)}%
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

          )}
        </Section>

        {/* Entregas por dia (30d) */}
        <Section title="Entregas por dia (30d)">
          <div className="h-64 rounded-2xl border border-border bg-card p-5">
            {loading ? (
              <Skeleton className="h-full" />
            ) : dailyChart.length === 0 ? (
              <p className="h-full flex items-center justify-center text-sm text-muted-foreground">
                Sem snapshots no período.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailyChart}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                    labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                    formatter={(v: number) => [v.toLocaleString("pt-BR"), "Plays"]}
                  />
                  <Line type="monotone" dataKey="plays" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </Section>

        {/* Top playlists entregando (30d) */}
        <Section title="Top playlists entregando (30d)">
          <div className="border border-border rounded-2xl overflow-hidden bg-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-elevated/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">Playlist</th>
                    <th className="hidden sm:table-cell px-4 py-2.5 text-right font-medium">Deals</th>
                    <th className="px-4 py-2.5 text-right font-medium">Plays entregues</th>
                    <th className="hidden sm:table-cell px-4 py-2.5 text-right font-medium">Último snapshot</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loading ? (
                    <tr><td colSpan={4} className="p-4"><Skeleton className="h-12" /></td></tr>
                  ) : topPlaylists.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                        Sem entregas registradas no período.
                      </td>
                    </tr>
                  ) : topPlaylists.map((p) => (
                    <tr key={p.playlist_id} className="hover:bg-elevated/40 transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="font-medium truncate max-w-[260px] sm:max-w-[320px]">
                          {playlistsMeta[p.playlist_id] ?? p.playlist_id.slice(0, 8)}
                        </div>
                      </td>
                      <td className="hidden sm:table-cell px-4 py-2.5 text-right tabular-nums">{p.deals_count}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                        {p.plays_delivered.toLocaleString("pt-BR")}
                      </td>
                      <td className="hidden sm:table-cell px-4 py-2.5 text-right tabular-nums text-xs text-muted-foreground">
                        {new Date(p.last_captured_at).toLocaleDateString("pt-BR")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </Section>

        {/* Heatmap — vivo, lê curator_deal_logs */}
        <Section title="Heatmap de entregas">
          <HeatmapEntregas embedded />
        </Section>
      </PageContainer>
    </>
  );
}

// Kpi local removido — usar <Kpi> de @/components/ui/kpi quando necessário


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

function Empty({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="border border-border rounded-2xl p-8 text-center bg-card flex flex-col items-center gap-2">
      {icon}
      <div className="font-medium">{title}</div>
      <div className="text-sm text-muted-foreground max-w-md">{sub}</div>
    </div>
  );
}
