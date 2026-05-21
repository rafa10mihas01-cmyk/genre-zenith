// /analytics — Aba "Deals".
// Lê DIRETO do motor vivo: curator_deals + curator_deal_snapshots.
// Aposentou: campaigns.total_delivered, campaign_allocations,
// v_playlist_delivery_history, v_campaign_velocity, RPC get_campaign_analytics_overview.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import { LineChart as LineIcon, RefreshCw, Handshake } from "lucide-react";
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
  const [deals, setDeals] = useState<Deal[]>([]);
  const [snapshots30d, setSnapshots30d] = useState<Snapshot[]>([]);
  const [snapshots7d, setSnapshots7d] = useState<Snapshot[]>([]);
  const [playlistsMeta, setPlaylistsMeta] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
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

    setDeals(((dealsRes.data ?? []) as unknown as Deal[]));
    const s30 = ((snap30Res.data ?? []) as unknown as Snapshot[]);
    setSnapshots30d(s30);
    setSnapshots7d(((snap7Res.data ?? []) as unknown as Snapshot[]));

    // Busca nomes das playlists envolvidas (snapshots.playlist_id → curator_playlists.id)
    const ids = [...new Set(s30.map((s) => s.playlist_id).filter(Boolean))] as string[];
    if (ids.length > 0) {
      const { data: pls } = await supabase
        .from("curator_playlists")
        .select("id, playlist_name")
        .in("id", ids);
      const map: Record<string, string> = {};
      for (const p of (pls ?? []) as { id: string; playlist_name: string | null }[]) {
        if (p.playlist_name) map[p.id] = p.playlist_name;
      }
      setPlaylistsMeta(map);
    } else {
      setPlaylistsMeta({});
    }

    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

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
        subtitle="Motor de deals — entrega real"
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Kpi
            label="Deals ativos"
            value={activeDeals.length.toString()}
            sub={`${deals.length} no total`}
            loading={loading}
          />
          <Kpi
            label="Plays entregues (7d)"
            value={plays7d.toLocaleString("pt-BR")}
            loading={loading}
          />
          <Kpi
            label="Média diária (30d)"
            value={dailyAvg30d.toLocaleString("pt-BR")}
            sub={`${plays30d.toLocaleString("pt-BR")} no período`}
            loading={loading}
          />
          <Kpi
            label="Custo por play real"
            value={cpp != null ? `R$ ${cpp.toFixed(4)}` : "—"}
            sub={cpp != null ? "soma(custo) ÷ plays entregues" : "Sem entregas no período"}
            loading={loading}
          />
        </div>

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
            <div className="grid gap-2">
              {paceRows.map((r) => (
                <div key={r.deal.id} className="rounded-2xl border border-border bg-card p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      {r.deal.song_artist ?? "—"} <span className="text-muted-foreground">·</span> {r.deal.song_name ?? "—"}
                    </div>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {r.delivered.toLocaleString("pt-BR")} / {r.target.toLocaleString("pt-BR")} plays
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Plays/dia</div>
                    <div className="font-semibold tabular-nums">{Math.round(r.plays_per_day).toLocaleString("pt-BR")}</div>
                  </div>
                  <div className="w-28 text-right">
                    <StatusDot variant={r.tone as any} label={r.label} />
                    {r.pace_ratio != null && (
                      <div className="text-xs text-muted-foreground tabular-nums mt-1">
                        {Math.round(r.pace_ratio * 100)}%
                      </div>
                    )}
                  </div>
                </div>
              ))}
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
              <table className="w-full text-sm min-w-[640px]">
                <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left">Playlist</th>
                    <th className="px-4 py-3 text-right">Deals</th>
                    <th className="px-4 py-3 text-right">Plays entregues</th>
                    <th className="px-4 py-3 text-right">Último snapshot</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={4} className="p-4"><Skeleton className="h-12" /></td></tr>
                  ) : topPlaylists.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                        Sem entregas registradas no período.
                      </td>
                    </tr>
                  ) : topPlaylists.map((p) => (
                    <tr key={p.playlist_id} className="border-t border-border">
                      <td className="px-4 py-3">
                        <div className="font-medium truncate max-w-[320px]">
                          {playlistsMeta[p.playlist_id] ?? p.playlist_id.slice(0, 8)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{p.deals_count}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">
                        {p.plays_delivered.toLocaleString("pt-BR")}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-xs text-muted-foreground">
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

function Empty({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="border border-border rounded-2xl p-8 text-center bg-card flex flex-col items-center gap-2">
      {icon}
      <div className="font-medium">{title}</div>
      <div className="text-sm text-muted-foreground max-w-md">{sub}</div>
    </div>
  );
}
