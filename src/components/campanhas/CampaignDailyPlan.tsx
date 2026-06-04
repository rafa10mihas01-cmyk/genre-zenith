import { useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Download, CalendarDays, ListChecks, Users, Music2, Music, AlertTriangle, Clock, Heart, Gauge, ListMusic, TrendingUp, CalendarDays as CalendarIcon, Target, BarChart3, Activity, Layers } from "lucide-react";
import { KpiBig } from "@/components/KpiBig";
import { formatBRL, formatInt } from "@/lib/campaignEngine";
import type { CampaignSnapshot } from "@/lib/campaignSnapshot";
import {
  buildDailyCampaignPlan,
  buildEcoPlaylistPlan,
  buildExternalPlan,
  exportCampaignPlanCsv,
  type EcoPlanInput,
  type ExternalPlanInput,
} from "@/lib/campaignOperationalPlan";
import { REPORTING_DELAY_DAYS } from "@/lib/campaignOperationalPlan";
import { ensureExternalPackageDraft } from "@/lib/externalPackage";
import { cn } from "@/lib/utils";

type Props = {
  campaignId: string;
  snapshot: CampaignSnapshot;
  startedAt: string;
  ecoAllocations: EcoPlanInput[];
  refreshKey?: number;
  /** Estratégia salva na campanha (plays/save/mês). Default 30 (mercado). */
  engagementMultiplier?: number;
  /** Callback opcional pro pai sincronizar estado local após persistir. */
  onEngagementChange?: (v: number) => void;
};

export function CampaignDailyPlan({
  campaignId, snapshot, startedAt, ecoAllocations, refreshKey = 0,
  engagementMultiplier: initialMultiplier = 35,
  onEngagementChange,
}: Props) {
  const [externalItems, setExternalItems] = useState<ExternalPlanInput[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState(1);
  const [source, setSource] = useState<"todos" | "eco" | "externo">("todos");
  // Multiplicador plays/save/mês — agora é estratégia salva da campanha.
  // 18 = conservador · 30 = mercado · 50 = altamente engajado.
  const [engagementMultiplier, setEngagementMultiplier] = useState<number>(initialMultiplier);
  const [savingMult, setSavingMult] = useState(false);
  const [customMultOpen, setCustomMultOpen] = useState(false);

  // Sincroniza com prop se mudar (ex.: refetch da campanha).
  useEffect(() => { setEngagementMultiplier(initialMultiplier); }, [initialMultiplier]);

  // Persiste com debounce no banco quando o usuário muda o valor.
  useEffect(() => {
    if (engagementMultiplier === initialMultiplier) return;
    const v = Math.max(1, Math.min(200, Math.round(engagementMultiplier)));
    const t = setTimeout(async () => {
      setSavingMult(true);
      const { error } = await supabase
        .from("campaigns")
        .update({ engagement_multiplier: v })
        .eq("id", campaignId);
      setSavingMult(false);
      if (!error) onEngagementChange?.(v);
    }, 400);
    return () => clearTimeout(t);
  }, [engagementMultiplier, initialMultiplier, campaignId, onEngagementChange]);

  // Diário base vem do snapshot da calculadora (informado no momento de criar a campanha).
  const baselineStreams = Number(snapshot.music?.baselineStreamsDay ?? 0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await ensureExternalPackageDraft(campaignId, snapshot);
      const { data } = await supabase
        .from("campaign_external_package_items")
        .select("id, assigned_streams, assigned_cost, cost_per_stream, curators(name, contact), campaign_external_packages!inner(campaign_id)")
        .eq("campaign_external_packages.campaign_id", campaignId)
        .order("assigned_streams", { ascending: false });
      if (!cancelled) {
        setExternalItems((data ?? []) as any);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [campaignId, refreshKey]);

  const plan = useMemo(() => {
    const ecoPlans = buildEcoPlaylistPlan(snapshot, ecoAllocations, {
      engagementMultiplier,
      startedAt,
    });
    const externalPlans = buildExternalPlan(snapshot, externalItems, { startedAt });
    const daily = buildDailyCampaignPlan({ snapshot, startedAt, ecoPlans, externalPlans });
    return { ecoPlans, externalPlans, daily };
  }, [snapshot, startedAt, ecoAllocations, externalItems, engagementMultiplier]);

  const day = plan.daily[selectedDay - 1] ?? plan.daily[0];
  const ecoForDay = plan.ecoPlans
    .map(p => ({ ...p, streamsToday: p.daily[selectedDay - 1] ?? 0 }))
    .filter(p => p.streamsToday > 0)
    .sort((a, b) => b.streamsToday - a.streamsToday);
  const externalForDay = plan.externalPlans
    .map(p => ({ ...p, streamsToday: p.daily[selectedDay - 1] ?? 0 }))
    .filter(p => p.streamsToday > 0)
    .sort((a, b) => b.streamsToday - a.streamsToday);

  const visibleEco = source !== "externo";
  const visibleExternal = source !== "eco";
  const dayTotalForSource = source === "eco" ? (day?.eco ?? 0) : source === "externo" ? (day?.external ?? 0) : (day?.total ?? 0);
  const cumulativeForSource = plan.daily
    .slice(0, Math.max(0, selectedDay))
    .reduce((sum, d) => sum + (source === "eco" ? d.eco : source === "externo" ? d.external : d.total), 0);
  const sourceTotal = source === "eco" ? snapshot.streamsEco : source === "externo" ? snapshot.streamsExt : snapshot.meta;
  const sourceLabel = source === "eco" ? "Eco" : source === "externo" ? "Externo" : "Total";
  const dayHint = source === "eco"
    ? "Somente ecossistema próprio"
    : source === "externo"
      ? "Somente curadores externos"
      : `Eco ${formatInt(day?.eco ?? 0)} · Ext ${formatInt(day?.external ?? 0)}`;
  const activeValue = source === "eco"
    ? String(day?.activePlaylists ?? 0)
    : source === "externo"
      ? String(day?.activeCurators ?? 0)
      : `${day?.activePlaylists ?? 0} / ${day?.activeCurators ?? 0}`;
  const activeHint = source === "eco" ? "playlists próprias" : source === "externo" ? "curadores externos" : "playlists / curadores";

  function handleExport() {
    exportCampaignPlanCsv({
      fileName: `plano-marketing-${campaignId.slice(0, 8)}.csv`,
      daily: plan.daily,
      ecoPlans: plan.ecoPlans,
      externalPlans: plan.externalPlans,
    });
  }

  if (loading) return <Skeleton className="h-80" />;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-sm flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-primary" /> Plano operacional diário
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Aquecimento por dia, entrada de playlists e metas para Ads/marketing.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={handleExport}>
          <Download className="h-4 w-4 mr-1.5" /> Exportar CSV
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">


        {(plan.ecoPlans as any).unmetEco > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <div className="font-medium text-destructive">Inventário eco insuficiente</div>
              <div className="text-muted-foreground">
                Faltam <span className="tabular-nums font-medium text-foreground">{formatInt((plan.ecoPlans as any).unmetEco)}</span> streams de capacidade nas playlists próprias para fechar a curva. Aumente o multiplicador acima, adicione mais playlists eco ou reforce o pacote externo.
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          Contabilização do Spotify com defasagem de {REPORTING_DELAY_DAYS} dias aplicada · pico da curva ≤ 1,8× média.
        </div>


        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiBig
            icon={CalendarIcon}
            label="Dia selecionado"
            value={`D${day?.day ?? 1}`}
            hint={day?.dateLabel}
            domain="campaigns"
          />
          <KpiBig
            icon={Music}
            label="Música diário"
            value={formatInt(baselineStreams)}
            hint={baselineStreams > 0 ? "orgânico (baseline)" : "não informado"}
            domain="playlists"
          />
          <KpiBig
            tier="hero"
            icon={Target}
            label={`Meta do dia · ${sourceLabel}`}
            value={formatInt(dayTotalForSource)}
            hint={dayHint}
            domain="deals"
          />
          <KpiBig
            icon={BarChart3}
            label="Esperado no Spotify"
            value={formatInt(baselineStreams + dayTotalForSource)}
            hint={baselineStreams > 0 ? `${formatInt(baselineStreams)} + ${formatInt(dayTotalForSource)}` : "música + meta"}
            domain="clients"
          />
          <KpiBig
            icon={Layers}
            label={`Acumulado · ${sourceLabel}`}
            value={formatInt(cumulativeForSource)}
            hint={`${formatInt(sourceTotal)} no filtro`}
            domain="curators"
          />
          <KpiBig
            tier="quiet"
            icon={Activity}
            label="Ativos no dia"
            value={activeValue}
            hint={activeHint}
            domain="community"
          />
        </div>


        <div className="rounded-lg border border-border bg-elevated/20 p-3">
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <Tabs value={source} onValueChange={(v) => setSource(v as typeof source)}>
              <TabsList className="bg-elevated/60">
                <TabsTrigger value="todos">Todos</TabsTrigger>
                <TabsTrigger value="eco">Eco</TabsTrigger>
                <TabsTrigger value="externo">Externo</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="text-[10px] text-muted-foreground tabular-nums">
              {snapshot.days} dias · {formatInt(snapshot.streamsEco)} Eco · {formatInt(snapshot.streamsExt)} externo
            </div>
          </div>

          <div className="grid grid-cols-7 sm:grid-cols-10 md:grid-cols-[repeat(15,minmax(0,1fr))] gap-1.5">
            {(() => {
              const firstEcoDay = plan.daily.find(d => d.eco > 0)?.day;
              const firstExtDay = plan.daily.find(d => d.external > 0)?.day;
              const peak = Math.max(1, ...plan.daily.map(p => source === "eco" ? p.eco : source === "externo" ? p.external : p.total));
              return plan.daily.map(d => {
                const active = selectedDay === d.day;
                const filteredTotal = source === "eco" ? d.eco : source === "externo" ? d.external : d.total;
                const intensity = Math.min(1, filteredTotal / peak);
                const showStack = source === "todos";
                const ecoPct = showStack ? (d.eco / peak) * 100 : 0;
                const extPct = showStack ? (d.external / peak) * 100 : 0;
                const isEcoStart = source !== "externo" && d.day === firstEcoDay;
                const isExtStart = source !== "eco" && d.day === firstExtDay;
                const marker = isEcoStart && isExtStart ? "★" : isEcoStart ? "♪" : isExtStart ? "◆" : null;
                const markerTitle = isEcoStart && isExtStart ? "Início Eco + Externo" : isEcoStart ? "Início Eco" : isExtStart ? "Início Externo" : "";
                return (
                  <button
                    key={d.day}
                    onClick={() => setSelectedDay(d.day)}
                    className={cn(
                      "h-12 rounded-md border text-[10px] transition-colors text-left px-2 overflow-hidden relative",
                      active ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background hover:bg-elevated/70 text-muted-foreground",
                      marker && !active && "border-dashed",
                    )}
                    title={`D${d.day}: ${formatInt(filteredTotal)} streams${markerTitle ? ` · ${markerTitle}` : ""}`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-medium tabular-nums">D{d.day}</span>
                      {marker && (
                        <span className={cn("text-[10px] leading-none", isEcoStart && isExtStart ? "text-foreground" : isEcoStart ? "text-primary" : "text-warning")}>
                          {marker}
                        </span>
                      )}
                    </div>
                    {showStack ? (
                      <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden flex">
                        <div className="h-full bg-primary" style={{ width: `${ecoPct}%` }} />
                        <div className="h-full bg-warning" style={{ width: `${extPct}%` }} />
                      </div>
                    ) : (
                      <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden">
                        <div className={cn("h-full", source === "externo" ? "bg-warning" : "bg-primary")} style={{ width: `${filteredTotal > 0 ? Math.max(8, intensity * 100) : 0}%` }} />
                      </div>
                    )}
                  </button>
                );
              });
            })()}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {visibleEco && (
            <PlanTable
              title="Playlists próprias no dia"
              icon={<Music2 className="h-4 w-4 text-primary" />}
              empty="Nenhuma playlist Eco programada para este dia."
              rows={ecoForDay.map(p => ({
                id: p.allocationId,
                name: p.playlistName,
                detail: `${formatInt(p.followers)} saves · entrada D${p.startDay}`,
                today: p.streamsToday,
                total: p.totalStreams,
                badge: p.startDay === selectedDay ? "Entrada" : "Ativa",
              }))}
            />
          )}

          {visibleExternal && (
            <PlanTable
              title="Curadores externos no dia"
              icon={<Users className="h-4 w-4 text-primary" />}
              empty="Nenhum curador externo carregado para este dia."
              rows={externalForDay.map(p => ({
                id: p.itemId,
                name: p.curatorName,
                detail: `${p.contact ?? "sem contato"} · entrada D${p.startDay} · ${formatBRL(p.streamsToday * p.costPerStream)}`,
                today: p.streamsToday,
                total: p.totalStreams,
                badge: "Meta diária",
              }))}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-elevated/30 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums mt-1">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

function MetricEditable({
  label,
  icon,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  icon?: ReactNode;
  value: number;
  onChange: (v: number) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-elevated/30 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
        {icon} {label}
      </div>
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        value={value || ""}
        placeholder={placeholder}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="h-7 mt-1 px-1 text-lg font-semibold tabular-nums border-0 bg-transparent focus-visible:ring-1 focus-visible:ring-primary/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

function PlanTable({
  title,
  icon,
  rows,
  empty,
}: {
  title: string;
  icon: ReactNode;
  empty: string;
  rows: { id: string; name: string; detail: string; today: number; total: number; badge: string }[];
}) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-elevated/30">
        {icon}
        <div className="font-medium text-sm">{title}</div>
      </div>
      {rows.length === 0 ? (
        <div className="p-6 text-sm text-muted-foreground text-center">{empty}</div>
      ) : (
        <div className="divide-y divide-border/50 max-h-96 overflow-auto">
          {rows.map(row => (
            <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_120px] gap-3 px-3 py-2.5 hover:bg-elevated/40">
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{row.name}</div>
                <div className="text-[10px] text-muted-foreground truncate">{row.detail}</div>
              </div>
              <div className="text-right">
                <div className="font-semibold tabular-nums">{formatInt(row.today)}</div>
                <div className="flex justify-end mt-1">
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal text-muted-foreground">
                    <ListChecks className="h-3 w-3 mr-1" /> {row.badge}
                  </Badge>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}