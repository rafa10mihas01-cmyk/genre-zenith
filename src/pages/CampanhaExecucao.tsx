import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatBRL, formatInt } from "@/lib/campaignEngine";
import type { CampaignSnapshot } from "@/lib/campaignSnapshot";
import { ExternalPackageEditor } from "@/components/campanhas/ExternalPackageEditor";
import { CampaignMonitoring } from "@/components/campanhas/CampaignMonitoring";
import { CampaignDailyPlan } from "@/components/campanhas/CampaignDailyPlan";
import { PlaylistDailyPlanDialog } from "@/components/campanhas/PlaylistDailyPlanDialog";
import { buildEcoPlaylistPlan, distributeEcoPositions } from "@/lib/campaignOperationalPlan";
import { CampaignFullPlanCard } from "@/components/campanhas/CampaignFullPlanCard";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft, Lock, Music, ListMusic, Loader2, CalendarDays, Users, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

type EcoAllocRow = {
  id: string;
  managed_playlist_id: string;
  planned_streams: number;
  start_day: number;
  status: string;
  dispatched_at: string | null;
  managed_playlists?: { name: string; cover_url: string | null; followers: number } | null;
};

type CampaignRow = {
  started_at: string;
  id: string;
  track_name: string;
  artist: string | null;
  cover_url: string | null;
  status: string;
  deadline: string | null;
  simulation_snapshot: CampaignSnapshot | null;
  snapshot_locked_at: string | null;
  eco_dispatched_at: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Aguardando",
  dispatched: "Enviada ao bot",
  active: "No ar",
  done: "Concluída",
  failed: "Falhou",
  cancelled: "Cancelada",
};

const STATUS_TONE: Record<string, string> = {
  pending: "bg-muted text-muted-foreground border-border",
  dispatched: "bg-warning/10 text-warning border-warning/30",
  active: "bg-primary/15 text-primary border-primary/40",
  done: "bg-primary/10 text-primary border-primary/30",
  failed: "bg-destructive/10 text-destructive border-destructive/30",
  cancelled: "bg-muted text-muted-foreground border-border",
};

export default function CampanhaExecucao() {
  const { id } = useParams<{ id: string }>();
  const [camp, setCamp] = useState<CampaignRow | null>(null);
  const [allocs, setAllocs] = useState<EcoAllocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dispatchingEco, setDispatchingEco] = useState(false);
  const [planRefreshKey, setPlanRefreshKey] = useState(0);
  const [tab, setTab] = useState<"diario" | "eco" | "externo" | "monitor">("diario");
  const [selectedAlloc, setSelectedAlloc] = useState<EcoAllocRow | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      const [{ data: c }, { data: a }] = await Promise.all([
        supabase
          .from("campaigns")
          .select("id, track_name, artist, cover_url, status, deadline, started_at, simulation_snapshot, snapshot_locked_at, eco_dispatched_at, engagement_multiplier, public_plan_token, spotify_track_url")
          .eq("id", id)
          .maybeSingle(),
        supabase
          .from("campaign_eco_allocations")
          .select("id, managed_playlist_id, planned_streams, start_day, status, dispatched_at, managed_playlists(name, cover_url, followers, spotify_url)")
          .eq("campaign_id", id)
          .order("planned_streams", { ascending: false }),
      ]);
      setCamp(c as any);
      setAllocs((a ?? []) as any);
      setLoading(false);
    })();
  }, [id]);

  const snapshot = camp?.simulation_snapshot ?? null;

  const ecoTotals = useMemo(() => {
    const planned = allocs.reduce((s, a) => s + a.planned_streams, 0);
    const dispatched = allocs.filter(a => a.status !== "pending").length;
    return { planned, count: allocs.length, dispatched };
  }, [allocs]);

  const ecoPositionByAllocation = useMemo(() => {
    if (!snapshot) return new Map<string, number>();
    return distributeEcoPositions(
      allocs.map(a => ({
        id: a.id,
        planned_streams: a.planned_streams,
        followers: a.managed_playlists?.followers ?? 0,
      })),
      snapshot.days,
      (camp as any)?.engagement_multiplier ?? 30,
    );
  }, [snapshot, allocs, (camp as any)?.engagement_multiplier]);

  const ecoPlanByAllocation = useMemo(() => {
    if (!snapshot) return new Map<string, number>();
    const mult = (camp as any)?.engagement_multiplier ?? 30;
    return new Map(
      buildEcoPlaylistPlan(snapshot, allocs, {
        startedAt: camp?.started_at,
        engagementMultiplier: mult,
        positions: ecoPositionByAllocation,
      }).map(plan => [plan.allocationId, plan.startDay]),
    );
  }, [snapshot, allocs, camp?.started_at, (camp as any)?.engagement_multiplier, ecoPositionByAllocation]);

  const hasPendingEco = allocs.some(a => a.status === "pending");

  async function handleDispatchEco() {
    if (!id || !hasPendingEco) return;
    setDispatchingEco(true);
    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("campaign_eco_allocations")
        .update({ status: "dispatched", dispatched_at: now })
        .eq("campaign_id", id)
        .eq("status", "pending");
      if (error) throw error;
      setAllocs(prev => prev.map(a => a.status === "pending" ? { ...a, status: "dispatched", dispatched_at: now } : a));
      toast({ title: "Eco disparado", description: "Playlists próprias marcadas como enviadas ao bot." });
    } catch (e: any) {
      toast({ title: "Erro ao disparar Eco", description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setDispatchingEco(false);
    }
  }

  if (loading) {
    return (
      <PageContainer>
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-32 mt-6" />
        <Skeleton className="h-96 mt-4" />
      </PageContainer>
    );
  }

  if (!camp || !snapshot) {
    return (
      <PageContainer>
        <PageHeader
        domain="campaigns" title="Execução" subtitle="Campanha não encontrada ou sem snapshot" />
        <Link to="/campanhas" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mt-4">
          <ArrowLeft className="h-4 w-4" /> Voltar para campanhas
        </Link>
      </PageContainer>
    );
  }

  const pctEco = snapshot.splitEcoPct;
  const pctExt = 100 - pctEco;

  return (
    <PageContainer>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <PageHeader title={camp.track_name} subtitle="Mapa congelado" />
        <Link to="/campanhas">
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1.5" /> Campanhas
          </Button>
        </Link>
      </div>

      {/* Hero unificado: música + meta + snapshot + curva em uma única faixa */}
      <Card className="mt-6 overflow-hidden">
        <div className="flex flex-col divide-y divide-border">
          {/* Topo: música + snapshot */}
          <div className="p-3 flex flex-col gap-2 bg-elevated/20">
            <div className="flex items-center gap-3">
              {camp.cover_url ? (
                <img src={camp.cover_url} alt="" className="w-12 h-12 rounded-md object-cover shadow-sm" />
              ) : (
                <div className="w-12 h-12 rounded-md bg-muted grid place-items-center">
                  <Music className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-base font-semibold truncate leading-tight">{camp.track_name}</div>
                <div className="text-xs text-muted-foreground truncate">{camp.artist ?? "—"}</div>
                <div className="mt-1.5 inline-flex items-center gap-1.5 text-[10px] text-primary">
                  <Lock className="h-3 w-3" />
                  Congelada {camp.snapshot_locked_at ? new Date(camp.snapshot_locked_at).toLocaleDateString("pt-BR") : "—"}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <HeroStat label="Meta" value={formatInt(snapshot.meta)} hint="streams" />
              <HeroStat label="Duração" value={`${snapshot.days}d`} hint={`${snapshot.modo === "simultaneo" ? "simultâneo" : "sequencial"} · pico ${formatInt(snapshot.picoPorDia)}/dia`} />
              <HeroStat label="Investimento" value={formatBRL(snapshot.custoTotal)} hint={`${formatBRL(snapshot.custoPorStream)}/play`} />
            </div>

            {/* Split bar */}
            <div>
              <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1.5">
                <span>Distribuição da meta</span>
                <span className="tabular-nums">{pctEco}% próprio · {pctExt}% externo</span>
              </div>
              <div className="flex h-2 rounded-full overflow-hidden bg-muted">
                <div className="bg-primary" style={{ width: `${pctEco}%` }} />
                <div className="bg-warning" style={{ width: `${pctExt}%` }} />
              </div>
              <div className="flex justify-between text-[10px] tabular-nums mt-1">
                <span className="text-primary">Eco {formatInt(snapshot.streamsEco)}</span>
                <span className="text-warning">Externo {formatInt(snapshot.streamsExt)}</span>
              </div>
            </div>
          </div>

          {/* Embaixo: curva */}
          <div className="p-3">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-sm font-semibold">Mapa de entrega</div>
                <div className="text-[10px] text-muted-foreground">Curva planejada · barras = streams/dia · linha = acumulado</div>
              </div>
              <div className="text-right text-[10px] text-muted-foreground tabular-nums">
                média {formatInt(snapshot.mediaPorDia)}/dia
              </div>
            </div>
            <MiniCurva curva={snapshot.curva} />
          </div>
        </div>
      </Card>

      {/* Tabs operacionais */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="mt-5">
        <TabsList className="bg-elevated/60">
          <TabsTrigger value="diario" className="gap-1.5"><CalendarDays className="h-3.5 w-3.5" /> Plano diário</TabsTrigger>
          <TabsTrigger value="eco" className="gap-1.5">
            <ListMusic className="h-3.5 w-3.5" /> Próprio
            <span className="ml-1 text-[10px] tabular-nums text-muted-foreground">{ecoTotals.count}</span>
          </TabsTrigger>
          <TabsTrigger value="externo" className="gap-1.5"><Users className="h-3.5 w-3.5" /> Externo</TabsTrigger>
          <TabsTrigger value="monitor" className="gap-1.5"><Activity className="h-3.5 w-3.5" /> Monitor</TabsTrigger>
        </TabsList>

        <TabsContent value="diario" className="mt-4">
          <CampaignDailyPlan
            campaignId={camp.id}
            snapshot={snapshot}
            startedAt={camp.started_at}
            ecoAllocations={allocs}
            refreshKey={planRefreshKey}
            engagementMultiplier={(camp as any).engagement_multiplier ?? 30}
            onEngagementChange={(v) => setCamp((c) => c ? ({ ...c, engagement_multiplier: v } as any) : c)}
          />
        </TabsContent>

        <TabsContent value="eco" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <ListMusic className="h-4 w-4 text-primary" /> Ecossistema próprio
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                <strong className="text-foreground tabular-nums">{formatInt(ecoTotals.planned)}</strong> streams
                em <strong className="text-foreground">{ecoTotals.count}</strong> playlists
                {ecoTotals.dispatched > 0 && <> · {ecoTotals.dispatched} já enviadas ao bot</>}
                <span className="ml-1 text-[10px] text-primary">· clique numa playlist para ver o plano diário</span>
              </p>
            </CardHeader>
            <CardContent>
              {allocs.length === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center">
                  Sem alocação Eco.
                </div>
              ) : (
                <div className="rounded-lg border border-border overflow-hidden">
                  <div className="max-h-[560px] overflow-auto">
                    <table className="w-full text-xs border-separate border-spacing-0">
                      <thead className="text-muted-foreground sticky top-0 bg-card z-10">
                        <tr>
                          <th className="text-left font-medium py-2 px-3 border-b border-border">Playlist</th>
                          <th className="text-right font-medium py-2 px-3 border-b border-border w-32">Planejado</th>
                          <th className="text-right font-medium py-2 px-3 border-b border-border w-20">Posição</th>
                          <th className="text-right font-medium py-2 px-3 border-b border-border w-20">Início</th>
                          <th className="text-right font-medium py-2 px-3 border-b border-border w-32">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allocs.map((a, i) => (
                          <tr key={a.id} onClick={() => setSelectedAlloc(a)} className={cn("hover:bg-primary/5 cursor-pointer transition-colors", i % 2 === 1 && "bg-elevated/30")}>
                            <td className="py-2 px-3 border-b border-border/30">
                              <div className="flex items-center gap-2">
                                {a.managed_playlists?.cover_url ? (
                                  <img src={a.managed_playlists.cover_url} alt="" className="w-7 h-7 rounded object-cover" />
                                ) : (
                                  <div className="w-7 h-7 rounded bg-muted" />
                                )}
                                <div className="min-w-0">
                                  <div className="font-medium truncate">{a.managed_playlists?.name ?? "—"}</div>
                                  <div className="text-[10px] text-muted-foreground tabular-nums">
                                    {formatInt(a.managed_playlists?.followers ?? 0)} saves
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="py-2 px-3 text-right tabular-nums font-semibold border-b border-border/30">
                              {formatInt(a.planned_streams)}
                            </td>
                            <td className="py-2 px-3 text-right tabular-nums border-b border-border/30">
                              {(() => {
                                const pos = ecoPositionByAllocation.get(a.id) ?? 3;
                                const tone = pos <= 5 ? "text-primary" : pos <= 12 ? "text-foreground" : "text-muted-foreground";
                                return <span className={cn("font-semibold", tone)}>#{pos}</span>;
                              })()}
                            </td>
                            <td className="py-2 px-3 text-right tabular-nums text-muted-foreground border-b border-border/30">
                              D{ecoPlanByAllocation.get(a.id) ?? a.start_day}
                            </td>
                            <td className="py-2 px-3 text-right border-b border-border/30">
                              <span className={cn("inline-flex items-center px-2 h-5 rounded text-[10px] font-medium border", STATUS_TONE[a.status] ?? STATUS_TONE.pending)}>
                                {STATUS_LABEL[a.status] ?? a.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <CampaignFullPlanCard
            snapshot={snapshot}
            startedAt={camp.started_at}
            allocations={allocs as any}
            engagementMultiplier={(camp as any).engagement_multiplier ?? 30}
            shareToken={(camp as any).public_plan_token ?? null}
            track={{
              name: camp.track_name,
              artist: camp.artist,
              coverUrl: camp.cover_url,
              spotifyUrl: (camp as any).spotify_track_url ?? null,
            }}
          />
        </TabsContent>

        <TabsContent value="externo" className="mt-4">
          <ExternalPackageEditor campaignId={camp.id} snapshot={snapshot} onChanged={() => setPlanRefreshKey(k => k + 1)} />
        </TabsContent>

        <TabsContent value="monitor" className="mt-4">
          <CampaignMonitoring
            campaignId={camp.id}
            snapshot={snapshot}
            campaignStartedAt={camp.started_at}
            campaignStatus={camp.status}
          />
        </TabsContent>
      </Tabs>

      <PlaylistDailyPlanDialog
        open={!!selectedAlloc}
        onOpenChange={(o) => !o && setSelectedAlloc(null)}
        allocation={selectedAlloc}
        allAllocations={allocs}
        snapshot={snapshot}
        startedAt={camp.started_at}
        campaignTitle={camp.track_name}
        engagementMultiplier={(camp as any).engagement_multiplier ?? 30}
      />
    </PageContainer>
  );
}

function HeroStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
      <div className="text-lg font-semibold tabular-nums leading-tight mt-0.5">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground tabular-nums mt-0.5">{hint}</div>}
    </div>
  );
}

function MiniCurva({ curva }: { curva: CampaignSnapshot["curva"] }) {
  if (curva.length === 0) return null;
  const w = 720, h = 160, pad = 12;
  const maxS = Math.max(...curva.map(p => p.streamsDay), 1);
  const maxC = curva[curva.length - 1].cumulative;
  const xs = (i: number) => pad + (i / Math.max(curva.length - 1, 1)) * (w - pad * 2);
  const ysBar = (v: number) => h - pad - (v / maxS) * (h - pad * 2);
  const lineCum = curva
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xs(i)} ${h - pad - (p.cumulative / maxC) * (h - pad * 2)}`)
    .join(" ");

  const barW = Math.max(1, (w - pad * 2) / curva.length - 1);

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-16" preserveAspectRatio="none">
        {curva.map((p, i) => (
          <rect
            key={p.day}
            x={xs(i) - barW / 2}
            y={ysBar(p.streamsDay)}
            width={barW}
            height={h - pad - ysBar(p.streamsDay)}
            fill="hsl(var(--primary))"
            opacity={0.3}
          />
        ))}
        <path d={lineCum} fill="none" stroke="hsl(var(--primary))" strokeWidth={1.5} />
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1 tabular-nums">
        <span>D1</span>
        <span>D{Math.round(curva.length / 2)}</span>
        <span>D{curva.length}</span>
      </div>
    </div>
  );
}
