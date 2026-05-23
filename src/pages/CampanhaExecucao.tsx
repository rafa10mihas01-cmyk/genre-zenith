import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { formatBRL, formatInt } from "@/lib/campaignEngine";
import type { CampaignSnapshot } from "@/lib/campaignSnapshot";
import { ExternalPackageEditor } from "@/components/campanhas/ExternalPackageEditor";
import { CampaignMonitoring } from "@/components/campanhas/CampaignMonitoring";
import { CampaignDailyPlan } from "@/components/campanhas/CampaignDailyPlan";
import { PlaylistDailyPlanDialog } from "@/components/campanhas/PlaylistDailyPlanDialog";
import { buildEcoPlaylistPlan, distributeEcoPositions } from "@/lib/campaignOperationalPlan";
import { CampaignFullPlanCard } from "@/components/campanhas/CampaignFullPlanCard";
import { ArrowLeft } from "lucide-react";
import { CampaignHub } from "@/components/campaign-hub/CampaignHub";
import { OverviewTab } from "@/components/campaign-hub/tabs/OverviewTab";
import { PlaylistsGrid } from "@/components/campaign-hub/PlaylistsGrid";
import { ProofsTimeline, type ProofEvent } from "@/components/campaign-hub/ProofsTimeline";
import type { CampaignHubCampaign, CampaignHubTabId, EcoAllocation } from "@/components/campaign-hub/types";

type EcoSnap = {
  id: string;
  managed_playlist_id: string;
  plays_24h: number | null;
  plays_7d: number | null;
  plays_28d: number | null;
  captured_at: string;
  source?: string | null;
};

type DeliveryProof = {
  id: string;
  playlist_id: string;
  playlist_name: string;
  screenshot_url: string | null;
  plays_total: number;
  plays_24h: number | null;
  position_in_playlist: number | null;
  source: string | null;
  captured_at: string;
};

export default function CampanhaExecucao() {
  const { id } = useParams<{ id: string }>();
  const [camp, setCamp] = useState<CampaignHubCampaign | null>(null);
  const [allocs, setAllocs] = useState<EcoAllocation[]>([]);
  const [snaps, setSnaps] = useState<EcoSnap[]>([]);
  const [proofs, setProofs] = useState<DeliveryProof[]>([]);
  const [loading, setLoading] = useState(true);
  const [planRefreshKey, setPlanRefreshKey] = useState(0);
  const [tab, setTab] = useState<CampaignHubTabId>("overview");
  const [selectedAlloc, setSelectedAlloc] = useState<EcoAllocation | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      const [{ data: c }, { data: a }, { data: s }, { data: pkg }] = await Promise.all([
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
        supabase
          .from("campaign_eco_snapshots")
          .select("id, managed_playlist_id, plays_24h, plays_7d, plays_28d, captured_at, source")
          .eq("campaign_id", id)
          .order("captured_at", { ascending: false })
          .limit(500),
        supabase
          .from("campaign_external_package_items")
          .select("curator_deal_id, campaign_external_packages!inner(campaign_id)")
          .eq("campaign_external_packages.campaign_id", id)
          .not("curator_deal_id", "is", null),
      ]);
      setCamp(c as any);
      setAllocs((a ?? []) as any);
      setSnaps((s ?? []) as any);

      const dealIds = (pkg ?? []).map((p: any) => p.curator_deal_id).filter(Boolean);
      if (dealIds.length > 0) {
        const { data: dp } = await supabase
          .from("delivery_proofs")
          .select("id, playlist_id, playlist_name, screenshot_url, plays_total, plays_24h, position_in_playlist, source, captured_at")
          .in("deal_id", dealIds)
          .order("captured_at", { ascending: false })
          .limit(200);
        setProofs((dp ?? []) as any);
      } else {
        setProofs([]);
      }
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

  const proofEvents = useMemo<ProofEvent[]>(() => {

    // 1) Provas externas (delivery_proofs) — já têm screenshot
    const ext: ProofEvent[] = proofs.map((p) => ({
      id: `dp-${p.id}`,
      captured_at: p.captured_at,
      playlist_name: p.playlist_name,
      playlist_cover: null,
      screenshot_url: p.screenshot_url,
      plays_total: Number(p.plays_total ?? 0),
      delta_plays: p.plays_24h ?? null,
      position: p.position_in_playlist ?? null,
      source: p.source ?? "bot",
    }));

    // 2) Eco snapshots — sem screenshot, mas mostram crescimento
    const plById = new Map(allocs.map(a => [a.managed_playlist_id, a.managed_playlists]));
    const eco: ProofEvent[] = snaps.map((s) => {
      const pl = plById.get(s.managed_playlist_id);
      return {
        id: `es-${s.id}`,
        captured_at: s.captured_at,
        playlist_name: pl?.name ?? "Playlist própria",
        playlist_cover: pl?.cover_url ?? null,
        screenshot_url: null,
        plays_total: Number(s.plays_28d ?? s.plays_7d ?? s.plays_24h ?? 0),
        delta_plays: s.plays_24h ?? null,
        position: null,
        source: s.source ?? "bot",
        spotify_url: pl?.spotify_url ?? null,
      };
    });

    return [...ext, ...eco].sort((a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime());
  }, [proofs, snaps, allocs]);

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

  const lastUpdateAt = proofEvents[0]?.captured_at ?? camp.started_at;


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
        lastUpdateAt={lastUpdateAt}
        slots={{
          overview: (
            <div className="space-y-6">
              {camp.public_plan_token && (
                <ShareLinkCard
                  token={camp.public_plan_token}
                  trackName={camp.track_name}
                  artist={camp.artist}
                  approved={!!camp.client_approved_at}
                />
              )}
              <OverviewTab
                snapshot={snapshot}
                delivered={delivered}
                daysElapsed={daysElapsed}
                showFinance={true}
                allocations={allocs}
                snapshots={snaps}
                proofs={proofs.map(p => ({
                  id: p.id,
                  captured_at: p.captured_at,
                  playlist_name: p.playlist_name,
                  screenshot_url: p.screenshot_url,
                  delta_plays: p.plays_24h ?? null,
                }))}
                onJumpTab={(t) => setTab(t)}
              />
            </div>
          ),

          playlists: (
            <div className="space-y-6">
              <PlaylistsGrid
                allocations={allocs}
                snapshots={snaps}
                proofThumbs={proofs.map(p => ({
                  playlist_id: p.playlist_id,
                  screenshot_url: p.screenshot_url,
                  captured_at: p.captured_at,
                }))}
                positions={ecoPositionByAllocation}
                mode="internal"
              />
              <ExternalPackageEditor campaignId={camp.id} snapshot={snapshot} onChanged={() => setPlanRefreshKey(k => k + 1)} />
            </div>
          ),
          proofs: (
            <div className="space-y-6">
              <ProofsTimeline events={proofEvents} />
              <CampaignMonitoring
                campaignId={camp.id}
                snapshot={snapshot}
                campaignStartedAt={camp.started_at}
                campaignStatus={camp.status}
              />
            </div>
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
