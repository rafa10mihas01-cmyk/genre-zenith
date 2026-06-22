// Catálogo — segunda esteira operacional (paralela a Campanhas).
// Estrutura igual à página de Clientes: PageHeader com ações no topo,
// KPIs hero logo abaixo e tabs por último.
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Music2, Layers, Gauge, CircleSlash, TrendingUp, Activity, Brain, Send } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { Button } from "@/components/ui/button";
import { KpiBig } from "@/components/KpiBig";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { MusicasTab } from "@/components/catalogo/MusicasTab";
import { PlaylistsTab } from "@/components/catalogo/PlaylistsTab";
import { EnginePriorityTab } from "@/components/catalogo/EnginePriorityTab";
import { DistribuicaoTab } from "@/components/catalogo/DistribuicaoTab";

const VALID_TABS = ["musicas", "playlists", "distribuicao", "engine"] as const;
type TabId = (typeof VALID_TABS)[number];



type Summary = {
  total_tracks: number;
  total_playlists: number;
  active_placements: number;
  capacity_total: number;
  capacity_used: number;
  capacity_available: number;
};

async function fetchSummary(): Promise<Summary> {
  const [tracksRes, playlistsRes, placementsRes, occupancyRes] = await Promise.all([
    supabase.from("catalog_tracks").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("managed_playlists").select("id", { count: "exact", head: true }).eq("is_catalog", true),
    supabase.from("catalog_placements").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("v_catalog_playlist_occupancy").select("catalog_capacity, active_placements, available_slots"),
  ]);
  const totals = (occupancyRes.data ?? []).reduce(
    (acc, row: { catalog_capacity?: number; active_placements?: number; available_slots?: number }) => {
      acc.cap += row.catalog_capacity ?? 0;
      acc.used += row.active_placements ?? 0;
      acc.avail += row.available_slots ?? 0;
      return acc;
    },
    { cap: 0, used: 0, avail: 0 },
  );
  return {
    total_tracks: tracksRes.count ?? 0,
    total_playlists: playlistsRes.count ?? 0,
    active_placements: placementsRes.count ?? 0,
    capacity_total: totals.cap,
    capacity_used: totals.used,
    capacity_available: totals.avail,
  };
}

type GlobalTelemetry = {
  total_plays_28d: number;
  total_baseline: number;
  growth_abs: number;
  growth_pct: number | null;
  tracks_with_baseline: number;
  tracks_with_growth: number;
  playlists_detected: number;
  fresh_snapshots_24h: number;
  failed_queue: number;
};

async function fetchGlobalTelemetry(): Promise<GlobalTelemetry> {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [telRes, snapsRes, failQRes] = await Promise.all([
    supabase.from("v_catalog_track_telemetry").select("baseline_plays_28d, last_plays_28d, growth_abs, playlists_present_count"),
    supabase.from("song_snapshots").select("id", { count: "exact", head: true }).not("catalog_track_id", "is", null).gte("captured_at", since),
    supabase.from("catalog_snapshot_queue").select("id", { count: "exact", head: true }).eq("status", "failed"),
  ]);
  const rows = (telRes.data ?? []) as Array<{ baseline_plays_28d: number | null; last_plays_28d: number | null; growth_abs: number | null; playlists_present_count: number | null }>;
  let total = 0, base = 0, growth = 0, playlists = 0, withBaseline = 0, withGrowth = 0;
  for (const r of rows) {
    total += r.last_plays_28d ?? 0;
    base += r.baseline_plays_28d ?? 0;
    growth += r.growth_abs ?? 0;
    playlists += r.playlists_present_count ?? 0;
    if (r.baseline_plays_28d != null) withBaseline += 1;
    if (r.growth_abs != null) withGrowth += 1;
  }
  return {
    total_plays_28d: total,
    total_baseline: base,
    growth_abs: growth,
    growth_pct: base > 0 ? Math.round((growth / base) * 1000) / 10 : null,
    tracks_with_baseline: withBaseline,
    tracks_with_growth: withGrowth,
    playlists_detected: playlists,
    fresh_snapshots_24h: snapsRes.count ?? 0,
    failed_queue: failQRes.count ?? 0,
  };
}

function fmt(n: number | null | undefined) {
  return typeof n === "number" ? n.toLocaleString("pt-BR") : "—";
}

export default function Catalogo() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab") ?? "musicas";
  const tab: TabId = (VALID_TABS as readonly string[]).includes(raw) ? (raw as TabId) : "musicas";

  const setTab = (next: string) => {
    const p = new URLSearchParams(params);
    p.set("tab", next);
    setParams(p, { replace: true });
  };

  const qc = useQueryClient();
  const summaryQ = useQuery({ queryKey: ["catalog", "summary"], queryFn: fetchSummary, staleTime: 30_000 });
  const telemetryQ = useQuery({ queryKey: ["catalog", "global-telemetry"], queryFn: fetchGlobalTelemetry, staleTime: 30_000, refetchInterval: 60_000 });
  const s = summaryQ.data;
  const g = telemetryQ.data;
  const pct = s && s.capacity_total > 0 ? Math.round((s.capacity_used / s.capacity_total) * 100) : null;

  const openAdd = () => window.dispatchEvent(new Event("catalogo:add-track"));
  const reload = () => qc.invalidateQueries({ queryKey: ["catalog"] });

  return (
    <>
      <PageHeader
        domain="playlists"
        title="Catálogo"
        subtitle="Distribuir músicas em massa na rede de playlists"
        manualKey="catalogo"
        actions={
          <div className="flex items-center gap-2">
            {/* Mobile: só ícone +  · Desktop: ícone + label */}
            <Button
              size="sm"
              className="h-9 w-9 sm:w-auto sm:gap-1.5 rounded-full p-0 sm:px-3"
              onClick={openAdd}
              aria-label="Adicionar música"
              title="Adicionar música"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Adicionar música</span>
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="rounded-full h-9 w-9"
              onClick={reload}
              disabled={summaryQ.isFetching}
              aria-label="Recarregar"
              title="Recarregar"
            >
              <RefreshCw className={`h-4 w-4 ${summaryQ.isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        }
      />

      <PageContainer>
        {/* Mobile + Tablet: card consolidado — 4 colunas finas + barra de capacidade */}
        <div className="lg:hidden">
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="grid grid-cols-4 divide-x divide-border">
              <div className="px-1.5 py-3 flex flex-col items-center justify-center gap-0.5">
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">Músicas</span>
                <span className="text-base font-semibold tabular-nums text-foreground">
                  {summaryQ.isLoading ? "—" : fmt(s?.total_tracks)}
                </span>
              </div>
              <div className="px-1.5 py-3 flex flex-col items-center justify-center gap-0.5">
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">Placements</span>
                <span className="text-base font-semibold tabular-nums text-foreground">
                  {summaryQ.isLoading ? "—" : fmt(s?.active_placements)}
                </span>
              </div>
              <div className="px-1.5 py-3 flex flex-col items-center justify-center gap-0.5">
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">Usado</span>
                <span className="text-base font-semibold tabular-nums text-foreground">
                  {summaryQ.isLoading ? "—" : fmt(s?.capacity_used)}
                </span>
              </div>
              <div className="px-1.5 py-3 flex flex-col items-center justify-center gap-0.5">
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">Livres</span>
                <span className="text-base font-semibold tabular-nums text-foreground">
                  {summaryQ.isLoading ? "—" : fmt(s?.capacity_available)}
                </span>
              </div>
            </div>
            <div className="h-1 bg-border w-full">
              <div
                className="h-full bg-primary transition-all duration-500"
                style={{ width: `${pct ?? 0}%` }}
              />
            </div>
          </div>
        </div>

        {/* Desktop: 4 cards separados */}
        <section className="hidden lg:grid grid-cols-4 gap-3">
          <KpiBig
            tier="hero"
            icon={Music2}
            label="Músicas no catálogo"
            value={fmt(s?.total_tracks)}
            hint={`${fmt(s?.total_playlists)} playlists na rede`}
            domain="playlists"
            loading={summaryQ.isLoading}
          />
          <KpiBig
            icon={Layers}
            label="Placements ativos"
            value={fmt(s?.active_placements)}
            hint="Faixas distribuídas hoje"
            domain="campaigns"
            loading={summaryQ.isLoading}
          />
          <KpiBig
            icon={Gauge}
            label="Capacidade utilizada"
            value={fmt(s?.capacity_used)}
            hint={pct != null ? `${pct}% de ${fmt(s?.capacity_total)}` : "—"}
            domain="deals"
            loading={summaryQ.isLoading}
          />
          <KpiBig
            tier="quiet"
            icon={CircleSlash}
            label="Capacidade disponível"
            value={fmt(s?.capacity_available)}
            hint="Slots livres na rede"
            domain="system"
            loading={summaryQ.isLoading}
          />
        </section>


        {/* Mobile + Tablet: telemetria consolidada — 4 colunas finas */}
        <div className="lg:hidden">
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="grid grid-cols-4 divide-x divide-border">
              <div className="px-1.5 py-3 flex flex-col items-center justify-center gap-0.5">
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium text-center">Streams 28d</span>
                <span className="text-base font-semibold tabular-nums text-foreground">
                  {telemetryQ.isLoading ? "—" : fmt(g?.total_plays_28d)}
                </span>
              </div>
              <div className="px-1.5 py-3 flex flex-col items-center justify-center gap-0.5">
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium text-center">Δ Baseline</span>
                <span className="text-base font-semibold tabular-nums text-foreground">
                  {telemetryQ.isLoading ? "—" : (g?.growth_abs != null ? `${g.growth_abs >= 0 ? "+" : ""}${fmt(g.growth_abs)}` : "—")}
                </span>
              </div>
              <div className="px-1.5 py-3 flex flex-col items-center justify-center gap-0.5">
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium text-center">Playlists</span>
                <span className="text-base font-semibold tabular-nums text-foreground">
                  {telemetryQ.isLoading ? "—" : fmt(g?.playlists_detected)}
                </span>
              </div>
              <div className="px-1.5 py-3 flex flex-col items-center justify-center gap-0.5">
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium text-center">Saúde 24h</span>
                <span className="text-base font-semibold tabular-nums text-foreground">
                  {telemetryQ.isLoading ? "—" : fmt(g?.fresh_snapshots_24h)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Desktop: KPIs globais de telemetria (agregado de todas as faixas) */}
        <section className="hidden lg:grid grid-cols-4 gap-3">
          <KpiBig
            tier="hero"
            icon={TrendingUp}
            label="Streams 28d (total)"
            value={fmt(g?.total_plays_28d)}
            hint={g?.growth_pct != null ? `${g.growth_pct >= 0 ? "+" : ""}${g.growth_pct}% vs baseline` : "Aguardando 2º snapshot"}
            domain="campaigns"
            loading={telemetryQ.isLoading}
          />
          <KpiBig
            icon={TrendingUp}
            label="Δ vs baseline"
            value={g?.growth_abs != null ? `${g.growth_abs >= 0 ? "+" : ""}${fmt(g.growth_abs)}` : "—"}
            hint={`${fmt(g?.tracks_with_growth)} faixas com delta`}
            domain="playlists"
            loading={telemetryQ.isLoading}
          />
          <KpiBig
            icon={Layers}
            label="Playlists detectadas"
            value={fmt(g?.playlists_detected)}
            hint="Soma das presenças (VPS)"
            domain="deals"
            loading={telemetryQ.isLoading}
          />
          <KpiBig
            tier="quiet"
            icon={Activity}
            label="Saúde da coleta (24h)"
            value={fmt(g?.fresh_snapshots_24h)}
            hint={g && g.failed_queue > 0 ? `${g.failed_queue} na fila com falha` : "Fila saudável"}
            domain={g && g.failed_queue > 0 ? "campaigns" : "system"}
            loading={telemetryQ.isLoading}
          />
        </section>


        {(() => {
          const TABS = [
            { id: "musicas" as const, label: "Músicas", icon: Music2 },
            { id: "playlists" as const, label: "Playlists", icon: Layers },
            { id: "distribuicao" as const, label: "Distribuição", icon: Send },
            { id: "engine" as const, label: "Engine", icon: Brain },
          ];


          return (
            <>
              {/* Mobile: grid de cards */}
              <div className="grid grid-cols-4 gap-1.5 sm:hidden">

                {TABS.map((t) => {
                  const Icon = t.icon;
                  const active = tab === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setTab(t.id)}
                      className={cn(
                        "rounded-xl border px-1 py-2 flex flex-col items-center justify-center gap-1 transition-colors",
                        active
                          ? "border-primary/60 bg-primary/10 text-foreground"
                          : "border-border bg-card text-muted-foreground hover:text-foreground",
                      )}
                      aria-pressed={active}
                    >
                      <Icon className={cn("h-4 w-4", active && "text-primary")} />
                      <span className="text-[11px] font-medium leading-none text-center">{t.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Desktop: rail clássico */}
              <div className="hidden sm:flex items-center gap-1 border-b border-border overflow-x-auto overflow-y-hidden scrollbar-none -mx-4 px-4 lg:mx-0 lg:px-0">
                {TABS.map((t) => {
                  const Icon = t.icon;
                  const active = tab === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setTab(t.id)}
                      className={cn(
                        "px-3 lg:px-4 h-10 inline-flex items-center gap-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap shrink-0",
                        active
                          ? "border-primary text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground",
                      )}
                      aria-pressed={active}
                    >
                      <Icon className="h-4 w-4" />
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </>
          );
        })()}

        <div>
          {tab === "musicas" && <MusicasTab />}
          {tab === "playlists" && <PlaylistsTab />}
          {tab === "distribuicao" && <DistribuicaoTab />}
          {tab === "engine" && <EnginePriorityTab />}


        </div>

      </PageContainer>
    </>
  );
}
