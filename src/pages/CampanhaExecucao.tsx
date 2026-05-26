import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatBRL, formatInt } from "@/lib/campaignEngine";
import type { CampaignSnapshot } from "@/lib/campaignSnapshot";
import { ExternalPackageEditor } from "@/components/campanhas/ExternalPackageEditor";
import { CampaignMonitoring } from "@/components/campanhas/CampaignMonitoring";
import { CampaignDailyPlan } from "@/components/campanhas/CampaignDailyPlan";
import { PlaylistDailyPlanDialog } from "@/components/campanhas/PlaylistDailyPlanDialog";
import { buildEcoPlaylistPlan, distributeEcoPositions, chartTierFromTopPosition } from "@/lib/campaignOperationalPlan";
import { CampaignFullPlanCard, CampaignFullPlanSummary } from "@/components/campanhas/CampaignFullPlanCard";
import { TrackActionsPanel } from "@/components/campanhas/TrackActionsPanel";
import { ArrowLeft, Loader2, Save, Upload, Rocket, CheckCircle2, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { CampaignHub } from "@/components/campaign-hub/CampaignHub";
import { OverviewTab } from "@/components/campaign-hub/tabs/OverviewTab";
import { CampaignKpis } from "@/components/campaign-hub/CampaignKpis";
import { Lock } from "lucide-react";
import { OperacaoTab, type ExternalItemRow } from "@/components/campaign-hub/tabs/OperacaoTab";
import { PlaylistsGrid } from "@/components/campaign-hub/PlaylistsGrid";
import { InternalEcosystemHeader } from "@/components/campaign-hub/InternalEcosystemHeader";
import { GenresUsedFromAllocs } from "@/components/campanhas/GenresUsedFromAllocs";
import { CampaignAccessManager } from "@/components/campanhas/CampaignAccessManager";
import { ProofsTimeline, type ProofEvent } from "@/components/campaign-hub/ProofsTimeline";

import { SpreadsheetUploadCard } from "@/components/client-portal/SpreadsheetUploadCard";
import { BaselineCard } from "@/components/campanhas/BaselineCard";
import { BaselineTab } from "@/components/campanhas/BaselineTab";
import { OrganicCollectedSection, type OrganicRow } from "@/components/campanhas/OrganicCollectedSection";
import type { CampaignHubCampaign, CampaignHubTabId, EcoAllocation } from "@/components/campaign-hub/types";
import { Kpi } from "@/components/ui/kpi";
import { toast } from "sonner";
import type { Json } from "@/integrations/supabase/types";

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

type PackageItem = { curator_deal_id: string | null };

type SpreadsheetUpload = {
  id: string;
  created_at: string;
  rows_imported: number;
  total_streams: number;
  status: string;
  file_name: string | null;
  is_baseline?: boolean | null;
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
  const [clientPriceInput, setClientPriceInput] = useState("");
  const [savingClientPrice, setSavingClientPrice] = useState(false);
  const [clientToken, setClientToken] = useState<string | null>(null);
  const [lastSpreadsheetUploadAt, setLastSpreadsheetUploadAt] = useState<string | null>(null);
  const [recentUploads, setRecentUploads] = useState<SpreadsheetUpload[]>([]);
  const [externalItems, setExternalItems] = useState<ExternalItemRow[]>([]);
  const [organicRows, setOrganicRows] = useState<OrganicRow[]>([]);
  const [dispatching, setDispatching] = useState(false);

  async function handleDispatchEco() {
    if (!camp) return;
    setDispatching(true);
    try {
      const { error } = await (supabase.rpc as any)("approve_campaign", { p_campaign_id: camp.id });
      if (error) throw error;
      // Dispara o planner agora pra enfileirar os ADDs imediatamente (sem esperar o cron de 1min).
      const { error: planErr } = await supabase.functions.invoke("execution-planner", { body: {} });
      if (planErr) {
        toast.success("Campanha distribuída", { description: "Deal criado. Inserções começam no próximo ciclo (~1min)." });
      } else {
        toast.success("Campanha distribuída", { description: "Inserções enfileiradas — músicas entram nas playlists nas próximas execuções do bot." });
      }
      setCamp((c) => c ? ({ ...c, status: "active", eco_dispatched_at: new Date().toISOString() }) : c);
      setPlanRefreshKey((k) => k + 1);
    } catch (e: any) {
      const raw = e?.message ?? String(e);
      const map: Record<string, string> = {
        client_approval_required: "O cliente ainda não aprovou o plano. Mande o link público antes.",
        curator_required: "Edite a campanha e selecione o curador dono das playlists.",
        campaign_not_in_approvable_state: "Esta campanha já foi distribuída.",
        campaign_not_found: "Campanha não encontrada.",
      };
      const key = Object.keys(map).find((k) => raw.includes(k));
      toast.error("Não foi possível distribuir", { description: key ? map[key] : raw });
    } finally {
      setDispatching(false);
    }
  }

  const loadCampaign = async () => {
    if (!id) return;
    setLoading(true);
    const [{ data: c }, { data: a }, { data: s }, { data: pkg }] = await Promise.all([
      supabase
        .from("campaigns")
        .select("id, deal_id, track_name, artist, cover_url, status, deadline, started_at, simulation_snapshot, snapshot_locked_at, eco_dispatched_at, engagement_multiplier, public_plan_token, spotify_track_id, spotify_track_url, goal_plays, created_by, total_delivered, client_approved_at, split_locked_at, locked_eco_streams, eco_max_pct")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("campaign_eco_allocations")
        .select("id, managed_playlist_id, planned_streams, start_day, status, dispatched_at, position, genre_source, genre_affinity_score, managed_playlists(name, cover_url, followers, spotify_url, genre_id)")
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
    setCamp(c as unknown as CampaignHubCampaign | null);
    setAllocs((a ?? []) as unknown as EcoAllocation[]);
    setSnaps((s ?? []) as EcoSnap[]);

    let dealId = (c as { deal_id?: string | null } | null)?.deal_id ?? null;
    if (!dealId && c?.spotify_track_id) {
      const { data: auth } = await supabase.auth.getUser();
      const userId = c.created_by ?? auth.user?.id ?? null;
      if (userId) {
        const goal = Number(c.goal_plays ?? snapshot?.meta ?? 0);
        const { data: newDeal } = await supabase
          .from("curator_deals")
          .insert({
            user_id: userId,
            curator_name: "Campanha",
            song_spotify_url: c.spotify_track_url || `spotify:track:${c.spotify_track_id}`,
            song_name: c.track_name,
            song_artist: c.artist,
            song_cover_url: c.cover_url,
            target_plays: goal,
            baseline_plays: 0,
            cost: 0,
            started_at: c.started_at,
            ends_at: c.deadline ? `${c.deadline}T23:59:59.000Z` : null,
            state: "active",
            source: "campaign_internal",
            origin: "campaign",
            campaign_id: c.id,
          })
          .select("id")
          .single();
        if (newDeal?.id) {
          dealId = newDeal.id;
          await supabase.from("curator_deal_songs").insert({
            deal_id: dealId,
            spotify_track_id: c.spotify_track_id,
            song_spotify_url: c.spotify_track_url || `spotify:track:${c.spotify_track_id}`,
            song_name: c.track_name,
            song_artist: c.artist,
            song_cover_url: c.cover_url,
            target_plays: goal,
            baseline_plays: 0,
            position: 1,
            started_at: c.started_at,
            ends_at: c.deadline ? `${c.deadline}T23:59:59.000Z` : null,
          });
          await supabase.from("campaigns").update({ deal_id: dealId }).eq("id", c.id);
          setCamp({ ...(c as unknown as CampaignHubCampaign), deal_id: dealId });
        }
      }
    }
    let hydratedUploadState = false;
    if (!dealId && (c as { public_plan_token?: string | null } | null)?.public_plan_token) {
      const { data: shared } = await supabase.functions.invoke("get-shared-campaign-plan", {
        body: { token: (c as { public_plan_token: string }).public_plan_token },
      });
      dealId = (shared as { campaign?: { deal_id?: string | null } } | null)?.campaign?.deal_id ?? null;
      if (dealId) setCamp({ ...(c as unknown as CampaignHubCampaign), deal_id: dealId });
      if ((shared as { client_token?: string | null } | null)?.client_token) {
        setClientToken((shared as { client_token: string }).client_token);
        setRecentUploads(((shared as { recent_uploads?: SpreadsheetUpload[] }).recent_uploads ?? []) as SpreadsheetUpload[]);
        setLastSpreadsheetUploadAt((shared as { last_spreadsheet_upload_at?: string | null }).last_spreadsheet_upload_at ?? null);
        hydratedUploadState = true;
      }
    }
    if (dealId) {
      const { data: song } = await supabase
        .from("curator_deal_songs")
        .select("id, client_token")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      let token = (song as { client_token?: string | null } | null)?.client_token ?? null;
      if (!token && song?.id) {
        token = `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
        const { error: tokenError } = await supabase
          .from("curator_deal_songs")
          .update({ client_token: token })
          .eq("id", song.id);
        if (tokenError) token = null;
      }

      const { data: uploads } = await supabase
        .from("label_spreadsheet_uploads")
        .select("id, created_at, rows_imported, total_streams, status, file_name, is_baseline")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(10);

      setClientToken(token);
      setRecentUploads((uploads ?? []) as SpreadsheetUpload[]);
      setLastSpreadsheetUploadAt((uploads as SpreadsheetUpload[] | null)?.[0]?.created_at ?? null);
    } else if (!hydratedUploadState) {
      setClientToken(null);
      setRecentUploads([]);
      setLastSpreadsheetUploadAt(null);
    }

    const dealIds = ((pkg ?? []) as PackageItem[]).map((p) => p.curator_deal_id).filter((dealId): dealId is string => !!dealId);
    if (dealIds.length > 0) {
      const { data: dp } = await supabase
        .from("delivery_proofs")
        .select("id, playlist_id, playlist_name, screenshot_url, plays_total, plays_24h, position_in_playlist, source, captured_at")
        .in("deal_id", dealIds)
        .order("captured_at", { ascending: false })
        .limit(200);
      setProofs((dp ?? []) as DeliveryProof[]);
    } else {
      setProofs([]);
    }

    // Itens externos do pacote (curadores contratados) com plays reais via curator_deals
    const { data: extPkg } = await supabase
      .from("campaign_external_packages")
      .select("id")
      .eq("campaign_id", id)
      .maybeSingle();
    if (extPkg?.id) {
      const { data: items } = await supabase
        .from("campaign_external_package_items")
        .select("id, assigned_streams, assigned_cost, curator_deal_id, curators(name), curator_deals(reconciled_total_plays, state)")
        .eq("package_id", extPkg.id)
        .order("assigned_streams", { ascending: false });
      const mapped: ExternalItemRow[] = ((items ?? []) as unknown as Array<{
        id: string;
        assigned_streams: number;
        assigned_cost: number;
        curator_deal_id: string | null;
        curators: { name: string } | null;
        curator_deals: { reconciled_total_plays: number | null; state: string | null } | null;
      }>).map((it) => ({
        id: it.id,
        curator_name: it.curators?.name ?? "Curador",
        assigned_streams: Number(it.assigned_streams ?? 0),
        assigned_cost: Number(it.assigned_cost ?? 0),
        curator_deal_id: it.curator_deal_id,
        delivered_plays: Number(it.curator_deals?.reconciled_total_plays ?? 0),
        state: it.curator_deals?.state ?? "pending",
      }));
      setExternalItems(mapped);
    } else {
      setExternalItems([]);
    }

    // Snapshots orgânicos (rádio, autoplay, mixes, editoriais, listas de usuário)
    // capturados pelo bot e ligados ao deal desta campanha.
    if (dealId) {
      const { data: organic } = await supabase
        .from("organic_plays_snapshots")
        .select("id, spotify_playlist_id, playlist_name, kind, plays_24h, plays_7d, plays_28d, captured_at")
        .eq("deal_id", dealId)
        .order("captured_at", { ascending: false })
        .limit(500);
      setOrganicRows((organic ?? []) as OrganicRow[]);
    } else {
      setOrganicRows([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!id) return;
    loadCampaign();
    // Refetch quando a aba volta ao foco (cobre backfills/replans externos
    // que mudam allocations/positions sem o usuário ter recarregado a página).
    const onFocus = () => loadCampaign();
    const onVisible = () => { if (document.visibilityState === "visible") loadCampaign(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    // Realtime: qualquer mudança nas allocations desta campanha → refetch.
    const channel = supabase
      .channel(`camp-exec-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "campaign_eco_allocations", filter: `campaign_id=eq.${id}` }, () => loadCampaign())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "campaigns", filter: `id=eq.${id}` }, () => loadCampaign())
      .subscribe();
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);


  const snapshot = camp?.simulation_snapshot ?? null;

  useEffect(() => {
    if (!snapshot) return;
    const total = getClientPriceTotal(snapshot);
    setClientPriceInput(total > 0 ? total.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");
  }, [camp?.id, snapshot]);

  const handleSaveClientPrice = async () => {
    if (!camp || !snapshot) return;
    const total = parseBRLInput(clientPriceInput);
    if (!Number.isFinite(total) || total <= 0) {
      toast.error("Informe o valor total que o cliente vai pagar");
      return;
    }
    const pricePerStreamSell = snapshot.meta > 0 ? Number((total / snapshot.meta).toFixed(6)) : 0;
    const nextSnapshot: CampaignSnapshot = {
      ...snapshot,
      pricePerStreamSell,
      clientPriceTotal: Number(total.toFixed(2)),
    };

    setSavingClientPrice(true);
    try {
      const { error } = await supabase
        .from("campaigns")
        .update({ simulation_snapshot: nextSnapshot as unknown as Json })
        .eq("id", camp.id);
      if (error) throw error;

      await supabase
        .from("campaign_eco_allocations")
        .update({ price_per_stream_sell: pricePerStreamSell })
        .eq("campaign_id", camp.id);

      setCamp({ ...camp, simulation_snapshot: nextSnapshot });
      setClientPriceInput(total.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
      toast.success("Preço do cliente salvo no orçamento");
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, "Falha ao salvar preço do cliente"));
    } finally {
      setSavingClientPrice(false);
    }
  };

  const handleLockSplit = async (ecoStreams: number) => {
    if (!camp) return;
    try {
      const lockedAt = new Date().toISOString();
      const { error } = await supabase
        .from("campaigns")
        .update({ split_locked_at: lockedAt, locked_eco_streams: Math.round(ecoStreams) })
        .eq("id", camp.id);
      if (error) throw error;
      setCamp({ ...camp, split_locked_at: lockedAt, locked_eco_streams: Math.round(ecoStreams) });
      toast.success("Split eco/externo travado");
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, "Falha ao travar split"));
    }
  };

  const handleUnlockSplit = async () => {
    if (!camp) return;
    try {
      const { error } = await supabase
        .from("campaigns")
        .update({ split_locked_at: null, locked_eco_streams: null })
        .eq("id", camp.id);
      if (error) throw error;
      setCamp({ ...camp, split_locked_at: null, locked_eco_streams: null });
      toast.success("Split destravado — recalculando automaticamente");
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, "Falha ao destravar split"));
    }
  };


  const ecoPositionByAllocation = useMemo(() => {
    if (!snapshot) return new Map<string, number>();
    const allPersisted = allocs.length > 0 && allocs.every(a => Number.isFinite(a.position as number) && (a.position as number) >= 1);
    if (allPersisted) return new Map(allocs.map(a => [a.id, a.position as number]));
    const top = (snapshot as any)?.music?.top200Position ?? (snapshot as any)?.music?.top200Pos ?? null;
    return distributeEcoPositions(
      allocs.map(a => ({
        id: a.id,
        planned_streams: a.planned_streams,
        followers: a.managed_playlists?.followers ?? 0,
        genreSource: (a.genre_source as "primary" | "affinity" | null) ?? "primary",
      })),
      snapshot.days,
      camp?.engagement_multiplier ?? 30,
      { chartTier: chartTierFromTopPosition(top) },
    );
  }, [snapshot, allocs, camp?.engagement_multiplier]);

  const ecoPlanByAllocation = useMemo(() => {
    if (!snapshot) return new Map<string, number>();
    const mult = camp?.engagement_multiplier ?? 30;
    return new Map(
      buildEcoPlaylistPlan(snapshot, allocs as unknown as Parameters<typeof buildEcoPlaylistPlan>[1], {
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

  // Soma dos plays_7d mais recentes por playlist em organic_plays_snapshots —
  // alimenta o label "coletado" da linha Rádio/Orgânico no plano completo.
  const radioCollectedTotal = useMemo(() => {
    if (organicRows.length === 0) return null;
    const latest = new Map<string, OrganicRow>();
    for (const r of organicRows) {
      const key = r.spotify_playlist_id ?? `name:${r.playlist_name ?? r.id}`;
      const prev = latest.get(key);
      if (!prev || new Date(r.captured_at) > new Date(prev.captured_at)) latest.set(key, r);
    }
    let total = 0;
    for (const r of latest.values()) total += Number(r.plays_7d ?? r.plays_28d ?? 0);
    return total > 0 ? total : null;
  }, [organicRows]);


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
        hiddenTabs={["upload"]}
        heroExtraActions={
          <>
            <CampaignAccessManager campaignId={camp.id} />
            {clientToken ? (
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline" size="icon" className="h-9 w-9" title="Importar planilha" aria-label="Importar planilha">
                    <Upload className="h-4 w-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Importar planilha de streams</DialogTitle>
                  </DialogHeader>
                  <SpreadsheetUploadCard
                    clientToken={clientToken}
                    lastUploadAt={lastSpreadsheetUploadAt}
                    recentUploads={recentUploads}
                    onUploaded={loadCampaign}
                  />
                </DialogContent>
              </Dialog>
            ) : null}
          </>
        }
        slots={{
          overview: (
            <div className="space-y-6">
              {(() => {
                const baseline = recentUploads.find((u) => u.is_baseline);
                return baseline ? (
                  <BaselineCard
                    capturedAt={baseline.created_at}
                    totalStreams={baseline.total_streams}
                    playlistsDetected={baseline.rows_imported}
                    onClick={() => setTab("baseline")}
                  />
                ) : null;
              })()}
              <OverviewTab
                snapshot={snapshot}
                delivered={delivered}
                daysElapsed={daysElapsed}
                showFinance={false}
                
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
                splitLockedAt={camp.split_locked_at ?? null}
                lockedEcoStreams={camp.locked_eco_streams ?? null}
                ecoMaxPct={camp.eco_max_pct ?? 70}
                canManageSplit={true}
                onLockSplit={handleLockSplit}
                onUnlockSplit={handleUnlockSplit}
              />
              <CampaignMonitoring
                campaignId={camp.id}
                snapshot={snapshot}
                campaignStartedAt={camp.started_at}
                campaignStatus={camp.status}
              />
              <ProofsTimeline events={proofEvents} />
              <ClientPriceEditor
                snapshot={snapshot}
                value={clientPriceInput}
                onChange={setClientPriceInput}
                onSave={handleSaveClientPrice}
                saving={savingClientPrice}
                approved={!!camp.client_approved_at}
                showFinanceKpis={false}
              />
              <Card>
                <CardContent className="p-5 space-y-4">
                  <div>
                    <div className="text-sm font-semibold">Resumo financeiro interno</div>
                    <div className="text-xs text-muted-foreground">Quanto entra, quanto sai e quanto sobra desta campanha.</div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <FinKpi label="Cliente paga" value={formatBRL(getClientPriceTotal(snapshot))} sub={`${formatInt(snapshot.meta)} streams`} />
                    <FinKpi label="Tabela" value={formatBRL(snapshot.meta > 0 ? (getClientPriceTotal(snapshot) / snapshot.meta) * 1_000_000 : 0)} sub="por 1M streams" />
                    <FinKpi label="Seu custo" value={formatBRL(snapshot.custoTotal)} sub="interno" />
                    <FinKpi label="Margem" value={formatBRL(getClientPriceTotal(snapshot) - snapshot.custoTotal)} sub={`${getClientPriceTotal(snapshot) > 0 ? Math.round(((getClientPriceTotal(snapshot) - snapshot.custoTotal) / getClientPriceTotal(snapshot)) * 100) : 0}% sobre venda`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          ),


          operacao: (
            <OperacaoTab
              allocations={allocs}
              snapshots={snaps}
              externalItems={externalItems}
              totalDays={snapshot.days}
              startedAt={camp.started_at}
            />
          ),


          playlists: (() => {
            const tabsRow = (
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <TabsList>
                  <TabsTrigger value="interno">Interno ({allocs.length})</TabsTrigger>
                  <TabsTrigger value="externo">Externo</TabsTrigger>
                </TabsList>
                <div className="flex items-center gap-2">
                  <CampaignAccessManager campaignId={camp.id} />
                  <ReplanButton campaignId={camp.id} onReplanned={loadCampaign} />
                </div>
              </div>
            );
            return (
            <Tabs defaultValue="interno" className="space-y-4">
              <TabsContent value="interno" className="mt-0 space-y-4">
                <GenresUsedFromAllocs allocs={allocs} />
                <InternalEcosystemHeader
                  snapshot={snapshot}
                  allocations={allocs}
                  snaps={snaps}
                />
                {tabsRow}
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
                  flat
                />
                <OrganicCollectedSection rows={organicRows} />
              </TabsContent>
              <TabsContent value="externo" className="mt-0 space-y-4">
                <ExternalPackageEditor campaignId={camp.id} snapshot={snapshot} onChanged={() => setPlanRefreshKey(k => k + 1)} tabsRow={tabsRow} />
              </TabsContent>
            </Tabs>
            );
          })(),
          curve: (
            <div className="space-y-4">
              <CampaignFullPlanSummary
                snapshot={snapshot}
                startedAt={camp.started_at}
                allocations={allocs as unknown as Parameters<typeof CampaignFullPlanSummary>[0]["allocations"]}
                engagementMultiplier={camp.engagement_multiplier ?? 30}
              />
              <Tabs defaultValue="mapa" className="space-y-4">
                <TabsList>
                  <TabsTrigger value="mapa">Mapa</TabsTrigger>
                  <TabsTrigger value="distribuicao">Distribuição</TabsTrigger>
                </TabsList>
                <TabsContent value="mapa" className="mt-0 space-y-4">
                  <CampaignFullPlanCard
                    snapshot={snapshot}
                    startedAt={camp.started_at}
                    allocations={allocs as unknown as Parameters<typeof CampaignFullPlanCard>[0]["allocations"]}
                    engagementMultiplier={camp.engagement_multiplier ?? 30}
                    shareToken={camp.public_plan_token ?? null}
                    campaignId={camp.id}
                    onPositionsRedistributed={loadCampaign}
                    radioGoal={Math.round(snapshot.meta * ((snapshot.splitOrganicPct ?? 15) / 100))}
                    radioCollectedTotal={radioCollectedTotal}
                    track={{
                      name: camp.track_name,
                      artist: camp.artist,
                      coverUrl: camp.cover_url,
                      spotifyUrl: camp.spotify_track_url ?? null,
                    }}
                  />
                </TabsContent>
                <TabsContent value="distribuicao" className="mt-0 space-y-4">
                  <Card className={cn(
                    "border-2",
                    camp.eco_dispatched_at ? "border-primary/30 bg-primary/[0.03]" : "border-primary/40",
                  )}>
                    <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        {camp.eco_dispatched_at ? (
                          <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                        ) : (
                          <Rocket className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="text-sm font-semibold">
                            {camp.eco_dispatched_at ? "Ecossistema distribuído" : "Distribuir pro ecossistema"}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {camp.eco_dispatched_at ? (
                              <>Disparado em {new Date(camp.eco_dispatched_at).toLocaleString("pt-BR")}. Deal criado e playlists na fila de coleta.</>
                            ) : (
                              <>Confirma o plano acima e dispara: cria o deal real e manda as playlists do ecossistema pra fila de coleta do Spotify.</>
                            )}
                          </p>
                        </div>
                      </div>
                      {!camp.eco_dispatched_at && (
                        <Button size="sm" variant="solid" onClick={handleDispatchEco} disabled={dispatching}>
                          {dispatching ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Rocket className="h-4 w-4 mr-1.5" />}
                          Distribuir agora
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                  <TrackActionsPanel
                    spotifyTrackId={camp.spotify_track_id ?? null}
                    allocations={allocs as unknown as Parameters<typeof TrackActionsPanel>[0]["allocations"]}
                    targetPositionsByAllocId={ecoPositionByAllocation}
                  />
                </TabsContent>
              </Tabs>
            </div>
          ),

          finance: (
            <div className="space-y-6">
              <ClientPriceEditor
                snapshot={snapshot}
                value={clientPriceInput}
                onChange={setClientPriceInput}
                onSave={handleSaveClientPrice}
                saving={savingClientPrice}
                approved={!!camp.client_approved_at}
              />
              <Card>
                <CardContent className="p-5 space-y-4">
                  <div className="text-sm font-semibold">Resumo financeiro interno</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <FinKpi label="Custo total" value={formatBRL(snapshot.custoTotal)} sub="quanto você paga" />
                    <FinKpi label="Venda ao cliente" value={formatBRL(getClientPriceTotal(snapshot))} sub="valor do orçamento" />
                    <FinKpi label="Margem" value={formatBRL(getClientPriceTotal(snapshot) - snapshot.custoTotal)} sub="venda menos custo" />
                    <FinKpi label="CPP interno" value={formatBRL(snapshot.custoPorStream)} sub="custo por stream" />
                  </div>
                </CardContent>
              </Card>
            </div>
          ),
          baseline: <BaselineTab dealId={camp.deal_id ?? null} />,
          upload: clientToken ? (
            <SpreadsheetUploadCard
              clientToken={clientToken}
              lastUploadAt={lastSpreadsheetUploadAt}
              recentUploads={recentUploads}
              onUploaded={loadCampaign}
            />
          ) : (
            <Card>
              <CardContent className="p-5 text-sm text-muted-foreground">
                Gere o link público do cliente pra habilitar a importação de planilhas (snapshot de streams).
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
        allocation={selectedAlloc as unknown as Parameters<typeof PlaylistDailyPlanDialog>[0]["allocation"]}
        allAllocations={allocs as unknown as Parameters<typeof PlaylistDailyPlanDialog>[0]["allAllocations"]}
        snapshot={snapshot}
        startedAt={camp.started_at}
        campaignTitle={camp.track_name}
        engagementMultiplier={camp.engagement_multiplier ?? 30}
      />
    </PageContainer>
  );
}

function ClientPriceEditor({
  snapshot, value, onChange, onSave, saving, approved, showFinanceKpis = true,
}: {
  snapshot: CampaignSnapshot;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  saving: boolean;
  approved: boolean;
  showFinanceKpis?: boolean;
}) {
  const currentTotal = getClientPriceTotal(snapshot);
  const typedTotal = parseBRLInput(value);
  const effectiveTotal = Number.isFinite(typedTotal) && typedTotal > 0 ? typedTotal : currentTotal;
  const perMillion = snapshot.meta > 0 ? (effectiveTotal / snapshot.meta) * 1_000_000 : 0;
  const margin = effectiveTotal - snapshot.custoTotal;
  const marginPct = effectiveTotal > 0 ? Math.round((margin / effectiveTotal) * 100) : 0;

  return (
    <Card className="border-primary/30">
      <CardContent className="p-5 space-y-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-sm font-semibold">Preço do cliente</div>
            <div className="text-xs text-muted-foreground">
              Este é o valor total que aparece no portal para o cliente aprovar.
            </div>
          </div>
          {approved && <div className="text-[10px] uppercase tracking-wide text-primary font-semibold">Cliente já aprovou</div>}
        </div>

        {(() => {
          const isDirty = Number.isFinite(typedTotal) && typedTotal > 0 && Math.abs(typedTotal - currentTotal) > 0.005;
          const isSaved = !isDirty && currentTotal > 0;
          return (
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(220px,1fr)_auto] gap-3 lg:items-end">
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Valor fechado da campanha</Label>
                <Input
                  value={value}
                  onChange={(e) => onChange(e.target.value)}
                  inputMode="decimal"
                  placeholder="Ex.: 50.000,00"
                  className={cn(
                    "text-lg font-semibold tabular-nums transition-colors",
                    isSaved && "text-muted-foreground/70",
                  )}
                />
              </div>
              <Button
                onClick={onSave}
                disabled={saving || !isDirty}
                variant={isDirty ? "default" : "outline"}
                className="w-full lg:w-auto"
              >
                {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                {isSaved ? "Orçamento salvo" : "Salvar orçamento"}
              </Button>
            </div>
          );
        })()}


        {showFinanceKpis && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <FinKpi label="Cliente paga" value={formatBRL(effectiveTotal)} sub={`${formatInt(snapshot.meta)} streams`} />
            <FinKpi label="Tabela" value={formatBRL(perMillion)} sub="por 1M streams" />
            <FinKpi label="Seu custo" value={formatBRL(snapshot.custoTotal)} sub="interno" />
            <FinKpi label="Margem" value={formatBRL(margin)} sub={`${marginPct}% sobre venda`} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function parseBRLInput(value: string) {
  const normalized = value.trim().replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  return Number(normalized);
}

function getClientPriceTotal(snapshot: CampaignSnapshot) {
  if (snapshot.clientPriceTotal && snapshot.clientPriceTotal > 0) return snapshot.clientPriceTotal;
  if (snapshot.pricePerStreamSell && snapshot.pricePerStreamSell > 0) {
    return Math.round(snapshot.meta * snapshot.pricePerStreamSell * 100) / 100;
  }
  return 0;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function ReplanButton({ campaignId, onReplanned }: { campaignId: string; onReplanned: () => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [preview, setPreview] = useState<{ added: number; plays_per_day_added: number } | null>(null);

  const handleOpen = async () => {
    setOpen(true);
    setPreview(null);
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("replan-campaign-eco", {
        body: { campaign_id: campaignId, dry_run: true },
      });
      if (error) throw error;
      const res = data as { ok: boolean; added?: number; plays_per_day_added?: number; error?: string };
      if (!res?.ok) throw new Error(res?.error ?? "Falha ao calcular replanejamento");
      setPreview({ added: Number(res.added ?? 0), plays_per_day_added: Number(res.plays_per_day_added ?? 0) });
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, "Falha ao calcular replanejamento"));
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    setExecuting(true);
    try {
      const { data, error } = await supabase.functions.invoke("replan-campaign-eco", {
        body: { campaign_id: campaignId, dry_run: false },
      });
      if (error) throw error;
      const res = data as { ok: boolean; added?: number; error?: string };
      if (!res?.ok) throw new Error(res?.error ?? "Falha ao replanejar");
      toast.success(`${res.added ?? 0} playlists adicionadas ao plano`);
      setOpen(false);
      await onReplanned();
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, "Falha ao replanejar"));
    } finally {
      setExecuting(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={handleOpen}>
        <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
        Replanejar plano
      </Button>
      <Dialog open={open} onOpenChange={(o) => !executing && setOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Replanejar plano</DialogTitle>
          </DialogHeader>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
              <Loader2 className="h-4 w-4 animate-spin" /> Buscando playlists do gênero…
            </div>
          ) : preview ? (
            preview.added === 0 ? (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Nenhuma playlist nova do gênero primário fora do plano atual.
                </p>
                <div className="flex justify-end">
                  <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Fechar</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-border bg-card p-3">
                    <div className="text-xs text-muted-foreground">Playlists novas</div>
                    <div className="text-2xl font-semibold tabular-nums">{preview.added}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-card p-3">
                    <div className="text-xs text-muted-foreground">Plays/dia adicionais</div>
                    <div className="text-2xl font-semibold tabular-nums">{preview.plays_per_day_added.toLocaleString("pt-BR")}</div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  As playlists existentes (incluindo já despachadas) não serão alteradas. Só novas allocs serão inseridas com status <span className="font-mono">approved</span>.
                </p>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={executing}>Cancelar</Button>
                  <Button size="sm" onClick={handleConfirm} disabled={executing}>
                    {executing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
                    Confirmar
                  </Button>
                </div>
              </div>
            )
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function FinKpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <Kpi variant="compact" label={label} value={value} hint={sub} />;
}

