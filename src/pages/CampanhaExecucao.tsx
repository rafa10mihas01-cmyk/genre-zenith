import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBRL, formatInt } from "@/lib/campaignEngine";
import type { CampaignSnapshot } from "@/lib/campaignSnapshot";
import { ExternalPackageEditor } from "@/components/campanhas/ExternalPackageEditor";
import { CampaignMonitoring } from "@/components/campanhas/CampaignMonitoring";
import { CampaignDailyPlan } from "@/components/campanhas/CampaignDailyPlan";
import { PlaylistDailyPlanDialog } from "@/components/campanhas/PlaylistDailyPlanDialog";
import { buildEcoPlaylistPlan, distributeEcoPositions } from "@/lib/campaignOperationalPlan";
import { CampaignFullPlanCard } from "@/components/campanhas/CampaignFullPlanCard";
import { ArrowLeft, ListMusic } from "lucide-react";
import { cn } from "@/lib/utils";
import { CampaignHub } from "@/components/campaign-hub/CampaignHub";
import { OverviewTab } from "@/components/campaign-hub/tabs/OverviewTab";
import type { CampaignHubCampaign, CampaignHubTabId, EcoAllocation } from "@/components/campaign-hub/types";

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
  const [camp, setCamp] = useState<CampaignHubCampaign | null>(null);
  const [allocs, setAllocs] = useState<EcoAllocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [planRefreshKey, setPlanRefreshKey] = useState(0);
  const [tab, setTab] = useState<CampaignHubTabId>("overview");
  const [selectedAlloc, setSelectedAlloc] = useState<EcoAllocation | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      const [{ data: c }, { data: a }] = await Promise.all([
        supabase
          .from("campaigns")
          .select("id, track_name, artist, cover_url, status, deadline, started_at, simulation_snapshot, snapshot_locked_at, eco_dispatched_at, engagement_multiplier, public_plan_token, spotify_track_url, total_delivered, client_approved_at")
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

  const ecoPositionByAllocation = useMemo(() => {
    if (!snapshot) return new Map<string, number>();
    return distributeEcoPositions(
      allocs.map(a => ({
        id: a.id,
        planned_streams: a.planned_streams,
        followers: a.managed_playlists?.followers ?? 0,
      })),
      snapshot.days,
      camp?.engagement_multiplier ?? 30,
    );
  }, [snapshot, allocs, camp?.engagement_multiplier]);

  const ecoPlanByAllocation = useMemo(() => {
    if (!snapshot) return new Map<string, number>();
    const mult = camp?.engagement_multiplier ?? 30;
    return new Map(
      buildEcoPlaylistPlan(snapshot, allocs as any, {
        startedAt: camp?.started_at,
        engagementMultiplier: mult,
        positions: ecoPositionByAllocation,
      }).map(plan => [plan.allocationId, plan.startDay]),
    );
  }, [snapshot, allocs, camp?.started_at, camp?.engagement_multiplier, ecoPositionByAllocation]);

  const daysElapsed = useMemo(() => {
    if (!camp || !snapshot) return 0;
    const elapsedMs = Date.now() - new Date(camp.started_at).getTime();
    return Math.max(1, Math.min(snapshot.days, Math.ceil(elapsedMs / 86400_000)));
  }, [camp, snapshot]);

  const delivered = camp?.total_delivered ?? 0;

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
        <PageHeader domain="campaigns" title="Execução" subtitle="Campanha não encontrada ou sem snapshot" />
        <Link to="/campanhas" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mt-4">
          <ArrowLeft className="h-4 w-4" /> Voltar para campanhas
        </Link>
      </PageContainer>
    );
  }

  const ecoTotals = {
    planned: allocs.reduce((s, a) => s + a.planned_streams, 0),
    count: allocs.length,
    dispatched: allocs.filter(a => a.status !== "pending").length,
  };

  const playlistsSlot = (
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
          <div className="text-sm text-muted-foreground py-6 text-center">Sem alocação Eco.</div>
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
  );

  return (
    <PageContainer>
      <CampaignHub
        camp={camp}
        mode="internal"
        tab={tab}
        onTabChange={setTab}
        delivered={delivered}
        goal={snapshot.meta}
        daysElapsed={daysElapsed}
        daysTotal={snapshot.days}
        lastUpdateAt={camp.started_at}
        slots={{
          overview: (
            <OverviewTab
              snapshot={snapshot}
              delivered={delivered}
              daysElapsed={daysElapsed}
              showFinance={false}
            />
          ),
          playlists: (
            <div className="space-y-6">
              {playlistsSlot}
              <ExternalPackageEditor campaignId={camp.id} snapshot={snapshot} onChanged={() => setPlanRefreshKey(k => k + 1)} />
            </div>
          ),
          proofs: (
            <CampaignMonitoring
              campaignId={camp.id}
              snapshot={snapshot}
              campaignStartedAt={camp.started_at}
              campaignStatus={camp.status}
            />
          ),
          curve: (
            <div className="space-y-6">
              <CampaignDailyPlan
                campaignId={camp.id}
                snapshot={snapshot}
                startedAt={camp.started_at}
                ecoAllocations={allocs as any}
                refreshKey={planRefreshKey}
                engagementMultiplier={camp.engagement_multiplier ?? 30}
                onEngagementChange={(v) => setCamp((c) => c ? ({ ...c, engagement_multiplier: v }) : c)}
              />
              <CampaignFullPlanCard
                snapshot={snapshot}
                startedAt={camp.started_at}
                allocations={allocs as any}
                engagementMultiplier={camp.engagement_multiplier ?? 30}
                shareToken={camp.public_plan_token ?? null}
                track={{
                  name: camp.track_name,
                  artist: camp.artist,
                  coverUrl: camp.cover_url,
                  spotifyUrl: camp.spotify_track_url ?? null,
                }}
              />
            </div>
          ),
          finance: (
            <Card>
              <CardContent className="p-5 space-y-4">
                <div className="text-sm font-semibold">Resumo financeiro interno</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <FinKpi label="Investimento total" value={formatBRL(snapshot.custoTotal)} />
                  <FinKpi label="CPP" value={formatBRL(snapshot.custoPorStream)} sub="custo por stream" />
                  <FinKpi label="Eco" value={`${snapshot.splitEcoPct}%`} sub={`${formatInt(snapshot.streamsEco)} streams`} />
                  <FinKpi label="Externo" value={`${100 - snapshot.splitEcoPct}%`} sub={`${formatInt(snapshot.streamsExt)} streams`} />
                </div>
              </CardContent>
            </Card>
          ),
          logs: (
            <Card>
              <CardContent className="p-5 text-sm text-muted-foreground">
                Auditoria detalhada vai aparecer aqui na próxima fase.
              </CardContent>
            </Card>
          ),
        }}
      />

      <PlaylistDailyPlanDialog
        open={!!selectedAlloc}
        onOpenChange={(o) => !o && setSelectedAlloc(null)}
        allocation={selectedAlloc as any}
        allAllocations={allocs as any}
        snapshot={snapshot}
        startedAt={camp.started_at}
        campaignTitle={camp.track_name}
        engagementMultiplier={camp.engagement_multiplier ?? 30}
      />
    </PageContainer>
  );
}

function FinKpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
      <div className="text-xl font-semibold tabular-nums leading-tight mt-1">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}
