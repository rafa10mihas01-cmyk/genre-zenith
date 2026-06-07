import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageLoader } from "@/components/PageLoader";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatBRL, formatInt } from "@/lib/campaignEngine";
import type { CampaignSnapshot } from "@/lib/campaignSnapshot";
import { ExternalPackageEditor } from "@/components/campanhas/ExternalPackageEditor";
import { BaselineAwaitingBanner } from "@/components/campanhas/BaselineAwaitingBanner";
import { BotCollectionStatus } from "@/components/campanhas/BotCollectionStatus";
import { SpreadsheetCollectionStatus } from "@/components/campanhas/SpreadsheetCollectionStatus";
import { MonitoramentoTab } from "@/components/campanhas/monitoramento/MonitoramentoTab";
import { CampaignDailyPlan } from "@/components/campanhas/CampaignDailyPlan";
import { PlaylistDailyPlanDialog } from "@/components/campanhas/PlaylistDailyPlanDialog";
import { buildEcoPlaylistPlan, distributeEcoPositions, chartTierFromTopPosition } from "@/lib/campaignOperationalPlan";
import { CampaignFullPlanCard, CampaignFullPlanSummary } from "@/components/campanhas/CampaignFullPlanCard";
import { CampaignExecutionStatus } from "@/components/campanhas/CampaignExecutionStatus";
import { CampaignDistributionConsole } from "@/components/campanhas/CampaignDistributionConsole";
import { CampaignManualQueue } from "@/components/campanhas/CampaignManualQueue";
import { TrackActionsPanel } from "@/components/campanhas/TrackActionsPanel";
import { ArrowLeft, Loader2, Save, Upload, Rocket, CheckCircle2, RefreshCw, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";

import { Badge } from "@/components/ui/badge";
import { NewDealDialog } from "@/components/playlist-deals/NewDealDialog";
import { cn } from "@/lib/utils";
import { CampaignHub } from "@/components/campaign-hub/CampaignHub";
import { OverviewTab } from "@/components/campaign-hub/tabs/OverviewTab";
import { RadioCollectedCard } from "@/components/campaign-hub/RadioCollectedCard";
import { useRadioCollected } from "@/hooks/useRadioCollected";

import { CampaignKpis } from "@/components/campaign-hub/CampaignKpis";
import { Lock } from "lucide-react";
import { OperacaoTab, type ExternalItemRow } from "@/components/campaign-hub/tabs/OperacaoTab";
import { PlaylistsGrid } from "@/components/campaign-hub/PlaylistsGrid";

import { GenresUsedFromAllocs } from "@/components/campanhas/GenresUsedFromAllocs";
import { CampaignAccessManager } from "@/components/campanhas/CampaignAccessManager";
import { type ProofEvent } from "@/components/campaign-hub/ProofsTimeline";

import { SpreadsheetUploadCard } from "@/components/client-portal/SpreadsheetUploadCard";
import { BaselineCard } from "@/components/campanhas/BaselineCard";

import { OrganicCollectedSection, type OrganicRow } from "@/components/campanhas/OrganicCollectedSection";
import type { CampaignHubCampaign, CampaignHubTabId, EcoAllocation } from "@/components/campaign-hub/types";
import { Kpi } from "@/components/ui/kpi";
import { toast } from "sonner";
import type { Json } from "@/integrations/supabase/types";
import { PlanHistoryTab } from "@/components/campaign-hub/tabs/PlanHistoryTab";
import { CampaignGatesCard } from "@/components/campanhas/CampaignGatesCard";

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
  const [distributionTab, setDistributionTab] = useState("mapa");
  const [selectedAlloc, setSelectedAlloc] = useState<EcoAllocation | null>(null);
  const [clientPriceInput, setClientPriceInput] = useState("");
  const [savingClientPrice, setSavingClientPrice] = useState(false);
  const [clientToken, setClientToken] = useState<string | null>(null);
  const [lastSpreadsheetUploadAt, setLastSpreadsheetUploadAt] = useState<string | null>(null);
  const [recentUploads, setRecentUploads] = useState<SpreadsheetUpload[]>([]);
  const [externalItems, setExternalItems] = useState<ExternalItemRow[]>([]);
  const [newDealOpen, setNewDealOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [organicRows, setOrganicRows] = useState<OrganicRow[]>([]);
  const [dispatching, setDispatching] = useState(false);
  const [approvingPlan, setApprovingPlan] = useState(false);
  const [baselineGate, setBaselineGate] = useState({ required: 0, collected: 0, capturedAt: null as string | null });
  const [dealStatus, setDealStatus] = useState<{ state: string | null; baselineCapturedAt: string | null }>({ state: null, baselineCapturedAt: null });
  // Dominance Relief agora é aplicado automaticamente em campanhas NOVAS no
  // momento da aprovação do plano (approve-campaign-plan). Removido o preview
  // manual: campanhas já aprovadas/em execução não sofrem reprocessamento.


  async function handleApprovePlan() {
    if (!camp) return;
    setApprovingPlan(true);
    try {
      const { data, error } = await supabase.functions.invoke("approve-campaign-plan", { body: { campaign_id: camp.id } });
      if (error) throw error;
      const res = data as { ok?: boolean; reason?: string; already_approved?: boolean; deal_created?: boolean };
      if (!res?.ok) {
        toast.error("Não foi possível aprovar o plano", { description: res?.reason ?? "" });
        return;
      }
      toast.success(res.already_approved ? "Plano já estava aprovado" : "Plano interno aprovado", {
        description: res.deal_created ? "Deal criado automaticamente." : undefined,
      });
      setCamp((c) => c ? ({ ...c, plan_approved_at: new Date().toISOString() } as CampaignHubCampaign) : c);
      loadCampaign();
    } catch (e: any) {
      toast.error("Erro ao aprovar plano", { description: e?.message ?? String(e) });
    } finally {
      setApprovingPlan(false);
    }
  }

  async function handleDispatchEco() {
    if (!camp) return;
    const baselineReady = baselineGate.required > 0 && baselineGate.collected >= baselineGate.required;
    setDispatching(true);
    try {
      // Caminho normal: RPC approve_campaign já carimba status='active' + eco_dispatched_at.
      // Caminho recovery: campanha ficou 'active' sem eco_dispatched_at (estado legado, hoje
      // já backfillado) — RPC não aceita reaprovar, então carimba direto.
      const alreadyActiveWithoutDispatch = camp.status === "active" && !camp.eco_dispatched_at;

      if (!alreadyActiveWithoutDispatch) {
        const { error } = await (supabase.rpc as any)("approve_campaign", { p_campaign_id: camp.id });
        if (error) throw error;
      } else {
        const { error: stampErr } = await supabase
          .from("campaigns")
          .update({ eco_dispatched_at: new Date().toISOString() })
          .eq("id", camp.id)
          .is("eco_dispatched_at", null);
        if (stampErr) throw stampErr;
      }

      // Dispara o planner agora pra enfileirar os ADDs imediatamente (sem esperar o cron de 1min).
      const { error: planErr } = await supabase.functions.invoke("execution-planner", { body: {} });
      if (planErr) {
        toast.success("Campanha distribuída", { description: "Deal pronto. Inserções começam no próximo ciclo (~1min)." });
      } else {
        toast.success("Campanha distribuída", {
          description: baselineReady
            ? "Inserções enfileiradas — músicas entram nas playlists nas próximas execuções do bot."
            : "Distribuição liberada mesmo sem baseline completa; o bot seguirá coletando o marco zero em paralelo.",
        });
      }
      // Recarrega do banco (fonte de verdade) — sem otimismo local pra não mascarar falhas silenciosas.
      await loadCampaign();
      setPlanRefreshKey((k) => k + 1);
      setTab("curve");
      setDistributionTab("console");
    } catch (e: any) {
      const raw = e?.message ?? String(e);
      const map: Record<string, string> = {
        client_approval_required: "O cliente ainda não aprovou o plano. Mande o link público antes.",
        baseline_required: "Cliente ainda não enviou a primeira planilha (baseline). Peça pra ele subir no portal antes de distribuir.",
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
        .select("id, deal_id, track_name, artist, cover_url, status, deadline, started_at, simulation_snapshot, snapshot_locked_at, eco_dispatched_at, engagement_multiplier, public_plan_token, spotify_track_id, spotify_track_url, goal_plays, created_by, total_delivered, client_approved_at, split_locked_at, locked_eco_streams, eco_max_pct, plan_approved_at, campaign_type, collection_mode, baseline_status, baseline_captured_at")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("campaign_eco_allocations")
        .select("id, managed_playlist_id, planned_streams, start_day, status, dispatched_at, position, genre_source, genre_affinity_score, managed_playlists(name, cover_url, followers, spotify_url, spotify_playlist_id, genre_id, engagement_multiplier_override, execution_mode)")
        .eq("campaign_id", id)
        .order("planned_streams", { ascending: false }),
      supabase
        .from("campaign_eco_snapshots")
        .select("id, managed_playlist_id, plays_24h, plays_7d, plays_28d, captured_at, source")
        .eq("campaign_id", id)
        .order("captured_at", { ascending: false })
        .order("id", { ascending: false })
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
      // Antes de criar um shadow deal, verifica se já existe QUALQUER deal vinculado
      // à campanha (ex.: deals reais de curadores via pacote externo). Se existir,
      // apenas linka o primeiro encontrado em vez de criar lixo.
      const { data: existingDeals } = await supabase
        .from("curator_deals")
        .select("id, curator_id, source, created_at")
        .eq("campaign_id", c.id)
        .order("created_at", { ascending: true });
      const realDeal = (existingDeals ?? []).find((d: any) => d.curator_id != null);
      const anyDeal = (existingDeals ?? [])[0];
      if (realDeal?.id) {
        dealId = realDeal.id;
        if (c.deal_id !== dealId) {
          await supabase.from("campaigns").update({ deal_id: dealId }).eq("id", c.id);
        }
        setCamp({ ...(c as unknown as CampaignHubCampaign), deal_id: dealId });
      } else if (anyDeal?.id) {
        dealId = anyDeal.id;
        if (c.deal_id !== dealId) {
          await supabase.from("campaigns").update({ deal_id: dealId }).eq("id", c.id);
        }
        setCamp({ ...(c as unknown as CampaignHubCampaign), deal_id: dealId });
      } else {
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

    // Hidrata estado real do deal (awaiting_baseline vs collecting vs active)
    if (dealId) {
      const { data: dealRow } = await supabase
        .from("curator_deals")
        .select("state, baseline_captured_at")
        .eq("id", dealId)
        .maybeSingle();
      setDealStatus({
        state: (dealRow as any)?.state ?? null,
        baselineCapturedAt: (dealRow as any)?.baseline_captured_at ?? null,
      });
    } else {
      setDealStatus({ state: null, baselineCapturedAt: null });
    }

    const plannedSpotifyIds = Array.from(new Set(((a ?? []) as any[]).map((alloc) => {
      const direct = alloc.managed_playlists?.spotify_playlist_id as string | null | undefined;
      if (direct) return direct;
      const url = alloc.managed_playlists?.spotify_url as string | null | undefined;
      return url?.match(/playlist\/([A-Za-z0-9]+)/)?.[1] ?? null;
    }).filter(Boolean) as string[]));
    // Autoritativo: campaigns.baseline_status é o flag oficial setado pelo bot-ingest
    // e pela importação de planilha. Se ele já marcou 'captured', a baseline existe
    // independente do que esteja em curator_deal_snapshots/logs (que podem usar IDs diferentes).
    const campBaselineStatus = (c as any)?.baseline_status as string | null | undefined;
    const campBaselineAt = (c as any)?.baseline_captured_at as string | null | undefined;
    if (campBaselineStatus === "captured") {
      const n = plannedSpotifyIds.length || 1;
      setBaselineGate({ required: n, collected: n, capturedAt: campBaselineAt ?? null });
    } else if (dealId && plannedSpotifyIds.length > 0) {
      const [{ data: baselineSnaps }, { data: baselineLog }] = await Promise.all([
        supabase
          .from("curator_deal_snapshots")
          .select("captured_at, curator_playlists!inner(spotify_playlist_id)")
          .eq("deal_id", dealId)
          .eq("is_baseline", true),
        supabase
          .from("curator_deal_logs")
          .select("created_at, total_plays")
          .eq("deal_id", dealId)
          .eq("is_baseline", true)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle(),
      ]);
      const collected = new Set<string>();
      let capturedAt: string | null = null;
      for (const snap of (baselineSnaps ?? []) as any[]) {
        const spid = snap.curator_playlists?.spotify_playlist_id as string | null | undefined;
        if (spid && plannedSpotifyIds.includes(spid)) collected.add(spid);
        if (snap.captured_at && (!capturedAt || snap.captured_at > capturedAt)) capturedAt = snap.captured_at;
      }
      if (collected.size === 0 && baselineLog?.created_at) {
        setBaselineGate({ required: plannedSpotifyIds.length, collected: plannedSpotifyIds.length, capturedAt: baselineLog.created_at });
      } else {
        setBaselineGate({ required: plannedSpotifyIds.length, collected: collected.size, capturedAt });
      }
    } else {
      setBaselineGate({ required: plannedSpotifyIds.length, collected: 0, capturedAt: null });
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
    // Dia 1 perf: removidos listeners `focus` + `visibilitychange` que disparavam
    // loadCampaign() em DUPLICATA com o canal Realtime abaixo. Realtime já
    // cobre allocations/campaigns; voltar pra aba não precisa refazer fetch.
    const channel = supabase
      .channel(`camp-exec-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "campaign_eco_allocations", filter: `campaign_id=eq.${id}` }, () => loadCampaign())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "campaigns", filter: `id=eq.${id}` }, () => loadCampaign())
      .subscribe();
    return () => {
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
      camp?.engagement_multiplier ?? 35,
      { chartTier: chartTierFromTopPosition(top) },
    );
  }, [snapshot, allocs, camp?.engagement_multiplier]);

  const ecoPlanByAllocation = useMemo(() => {
    if (!snapshot) return new Map<string, number>();
    const mult = camp?.engagement_multiplier ?? 35;
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

  // Rádio Spotify — baseline ancorada na ativação da campanha (atual - início).
  const { data: radioCollected } = useRadioCollected(camp?.id);
  const radioDelta = Math.max(0, radioCollected?.radio_delta ?? 0);


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
    return <PageLoader />;
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
    <PageContainer className="h-full min-h-0">
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
        hiddenTabs={["upload", "logs"]}
        heroExtraActions={
          <>
            <AuditCampaignButton campaignId={camp.id} />
            <CampaignAccessManager campaignId={camp.id} />
          </>
        }
        heroExtraActionsAfter={
          clientToken ? (
            <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
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
                  approved={!!camp.client_approved_at}
                />
              </DialogContent>
            </Dialog>
          ) : null
        }
        slots={{
          overview: (
            <div className="space-y-6">
              <BaselineAwaitingBanner
                dealState={dealStatus.state}
                baselineCapturedAt={dealStatus.baselineCapturedAt}
                dealId={camp.deal_id ?? null}
              />
              {(camp as any).collection_mode === "spreadsheet" ? (
                <SpreadsheetCollectionStatus
                  lastUploadAt={lastSpreadsheetUploadAt}
                  recentUploads={recentUploads}
                  onOpenUpload={clientToken ? () => setUploadOpen(true) : undefined}
                />
              ) : null}
              <RadioCollectedCard
                campaignId={camp.id}
                cppEco={snapshot.streamsEco > 0 ? snapshot.custoEco / snapshot.streamsEco : 0}
              />

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
                curveSlot={
                  <div className="space-y-4">
                    <CampaignGatesCard
                      clientApprovedAt={camp.client_approved_at ?? null}
                      planApprovedAt={(camp as any).plan_approved_at ?? null}
                      ecoDispatchedAt={camp.eco_dispatched_at ?? null}
                      collectionMode={(camp as any).collection_mode ?? null}
                      status={camp.status}
                      baselineReady={baselineGate.required > 0 && baselineGate.collected >= baselineGate.required}
                      baselineCollected={baselineGate.collected}
                      baselineRequired={baselineGate.required}
                      onApprovePlan={handleApprovePlan}
                      onDispatch={handleDispatchEco}
                      approvingPlan={approvingPlan}
                      dispatching={dispatching}
                    />
                    {(camp as any).collection_mode !== "spreadsheet" && (
                      <BotCollectionStatus
                        campaignId={camp.id}
                        dealId={camp.deal_id ?? null}
                      />
                    )}
                    {(() => {
                      const baseline = recentUploads.find((u) => u.is_baseline);
                      return baseline ? (
                        <BaselineCard
                          capturedAt={baseline.created_at}
                          totalStreams={baseline.total_streams}
                          playlistsDetected={baseline.rows_imported}
                          onClick={() => setTab("monitoramento")}
                        />
                      ) : null;
                    })()}
                  </div>
                }
              />
            </div>
          ),





          playlists: (
            <div className="space-y-4">
              <ExternalPackageEditor
                campaignId={camp.id}
                snapshot={snapshot}
                onChanged={() => setPlanRefreshKey(k => k + 1)}
                onNewDeal={() => setNewDealOpen(true)}
                headerExtra={<GenresUsedFromAllocs allocs={allocs} compact />}
                renderTabsRow={(extra, ctx) => {
                  // Pacote despachado: header já carrega CTAs + chip de gêneros — não renderiza linha extra.
                  if (ctx?.isDispatched) return null;
                  return (
                    <div className="flex items-center gap-2 flex-wrap">
                      <GenresUsedFromAllocs allocs={allocs} compact />
                      <div className="ml-auto flex items-center gap-2 flex-wrap">
                        <Button
                          size="sm"
                          onClick={() => setNewDealOpen(true)}
                          className="gap-1.5"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Novo deal
                        </Button>
                        {extra}
                      </div>
                    </div>
                  );
                }}
              />


            </div>
          ),
          curve: (
            <div className="space-y-4">
              <CampaignFullPlanSummary
                snapshot={snapshot}
                startedAt={camp.started_at}
                allocations={allocs as unknown as Parameters<typeof CampaignFullPlanSummary>[0]["allocations"]}
                engagementMultiplier={camp.engagement_multiplier ?? 35}
              />
              <Tabs value={distributionTab} onValueChange={setDistributionTab} className="space-y-4">
                <TabsList>
                  <TabsTrigger value="mapa">Cronograma</TabsTrigger>
                  <TabsTrigger value="console">Distribuição</TabsTrigger>
                  <TabsTrigger value="status">Acompanhamento</TabsTrigger>
                </TabsList>
                <TabsContent value="mapa" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                  <div className="flex items-center justify-end gap-3 flex-wrap">
                    <ReplanButton
                      campaignId={camp.id}
                      onReplanned={loadCampaign}
                    />
                  </div>

                  <CampaignFullPlanCard
                    snapshot={snapshot}
                    startedAt={camp.started_at}
                    allocations={allocs as unknown as Parameters<typeof CampaignFullPlanCard>[0]["allocations"]}
                    engagementMultiplier={camp.engagement_multiplier ?? 35}
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
                <TabsContent value="console" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                  <CampaignManualQueue campaignId={camp.id} onChanged={() => setPlanRefreshKey((k) => k + 1)} />
                  <CampaignDistributionConsole
                    key={`distribution-console-${camp.id}-${planRefreshKey}`}
                    campaignId={camp.id}
                    spotifyTrackId={camp.spotify_track_id ?? null}
                    allocations={allocs}
                    ecoPositionByAllocation={ecoPositionByAllocation}
                    ecoDispatchedAt={camp.eco_dispatched_at ?? null}
                    baselineReady={baselineGate.required > 0 && baselineGate.collected >= baselineGate.required}
                    baselineCollected={baselineGate.collected}
                    baselineRequired={baselineGate.required}
                    baselineCapturedAt={baselineGate.capturedAt}
                    campaignStartedAt={camp.started_at ?? null}
                    snapshot={snapshot}
                    engagementMultiplier={camp.engagement_multiplier ?? 35}
                    custoTotal={snapshot.custoTotal ?? 0}
                    dispatching={dispatching}
                    onDispatch={handleDispatchEco}
                  />

                </TabsContent>
                <TabsContent value="status" forceMount className="mt-0 space-y-4 data-[state=inactive]:hidden">
                  <CampaignManualQueue campaignId={camp.id} onChanged={() => setPlanRefreshKey((k) => k + 1)} />
                  <CampaignExecutionStatus key={`execution-status-${camp.id}-${planRefreshKey}`} campaignId={camp.id} />
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
                approvedAt={camp.client_approved_at ?? null}
              />
            </div>
          ),

          monitoramento: <MonitoramentoTab campaignId={camp.id} />,


          upload: clientToken ? (
            <SpreadsheetUploadCard
              clientToken={clientToken}
              lastUploadAt={lastSpreadsheetUploadAt}
              recentUploads={recentUploads}
              onUploaded={loadCampaign}
              approved={!!camp.client_approved_at}
            />

          ) : (
            <Card>
              <CardContent className="p-5 text-sm text-muted-foreground">
                Gere o link público do cliente pra habilitar a importação de planilhas (snapshot de streams).
              </CardContent>
            </Card>
          ),
          history: <PlanHistoryTab campaignId={camp.id} />,
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
        engagementMultiplier={camp.engagement_multiplier ?? 35}
      />

      <NewDealDialog
        open={newDealOpen}
        onOpenChange={setNewDealOpen}
        campaignId={camp.id}
        onSaved={() => setPlanRefreshKey(k => k + 1)}
      />
    </PageContainer>
  );
}

function ClientPriceEditor({
  snapshot, value, onChange, onSave, saving, approved, approvedAt, showFinanceKpis = true,
}: {
  snapshot: CampaignSnapshot;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  saving: boolean;
  approved: boolean;
  approvedAt?: string | null;
  showFinanceKpis?: boolean;
}) {
  const currentTotal = getClientPriceTotal(snapshot);
  const typedTotal = parseBRLInput(value);
  const effectiveTotal = Number.isFinite(typedTotal) && typedTotal > 0 ? typedTotal : currentTotal;
  const perMillion = snapshot.meta > 0 ? (effectiveTotal / snapshot.meta) * 1_000_000 : 0;
  const margin = effectiveTotal - snapshot.custoTotal;
  const marginPct = effectiveTotal > 0 ? Math.round((margin / effectiveTotal) * 100) : 0;
  const locked = approved;
  const approvedLabel = approvedAt
    ? new Date(approvedAt).toLocaleString("pt-BR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;

  const ecoPctOfCost = snapshot.custoTotal > 0 ? (snapshot.custoEco / snapshot.custoTotal) * 100 : 0;
  const extPctOfCost = snapshot.custoTotal > 0 ? (snapshot.custoExt / snapshot.custoTotal) * 100 : 0;
  const costPctOfRevenue = effectiveTotal > 0 ? Math.min(100, (snapshot.custoTotal / effectiveTotal) * 100) : 0;
  const marginPctOfRevenue = Math.max(0, 100 - costPctOfRevenue);

  return (
    <Card className="border-border/60 overflow-hidden">
      {/* Hero — valor do cliente */}
      <div className="px-5 pt-5 pb-4 border-b border-border/60">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Cliente paga</div>
            <div className="text-3xl sm:text-4xl font-semibold tabular-nums text-foreground mt-1">
              {formatBRL(effectiveTotal)}
            </div>
            <div className="text-xs text-muted-foreground mt-1 tabular-nums">
              {formatInt(snapshot.meta)} streams · {formatBRL(perMillion)}/1M
            </div>
          </div>
          {approved && (
            <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-primary font-semibold border border-primary/40 bg-primary/10 rounded-full px-2.5 py-1 shrink-0">
              <CheckCircle2 className="h-3 w-3" /> Aprovado
            </span>
          )}
        </div>

        {locked && approvedLabel && (
          <p className="text-[11px] text-muted-foreground mt-3">
            Travado em <strong className="text-foreground">{approvedLabel}</strong>. Para alterar, contate o cliente.
          </p>
        )}
      </div>

      {/* Editor */}
      <div className="px-5 py-4 border-b border-border/60">
        {(() => {
          const isDirty = !locked && Number.isFinite(typedTotal) && typedTotal > 0 && Math.abs(typedTotal - currentTotal) > 0.005;
          const isSaved = !isDirty && currentTotal > 0;
          return (
            <div className="space-y-2">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Valor fechado</Label>
              <div className="flex gap-2">
                <Input
                  value={value}
                  onChange={(e) => onChange(e.target.value)}
                  inputMode="decimal"
                  placeholder="Ex.: 50.000,00"
                  disabled={locked}
                  className={cn(
                    "text-base font-semibold tabular-nums transition-colors flex-1",
                    isSaved && "text-muted-foreground/70",
                    locked && "opacity-60 cursor-not-allowed",
                  )}
                />
                <Button
                  onClick={onSave}
                  disabled={saving || !isDirty || locked}
                  variant={isDirty ? "default" : "outline"}
                  size="icon"
                  className="shrink-0 h-10 w-10"
                  title={isSaved ? "Orçamento salvo" : "Salvar"}
                  aria-label={isSaved ? "Orçamento salvo" : "Salvar"}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : isSaved ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          );
        })()}
      </div>

      {showFinanceKpis && (
        <>
          {/* P&L visual: Receita → Custo + Margem */}
          <div className="px-5 py-4 border-b border-border/60 space-y-3">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>Margem da campanha</span>
              <span className="tabular-nums text-foreground font-semibold">{marginPct}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-elevated/40 overflow-hidden flex">
              <div className="h-full bg-muted-foreground/40" style={{ width: `${costPctOfRevenue}%` }} title={`Custo ${formatBRL(snapshot.custoTotal)}`} />
              <div className="h-full bg-primary" style={{ width: `${marginPctOfRevenue}%` }} title={`Margem ${formatBRL(margin)}`} />
            </div>
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60" />
                  Seu custo
                </div>
                <div className="text-base font-semibold tabular-nums text-foreground mt-0.5">{formatBRL(snapshot.custoTotal)}</div>
              </div>
              <div className="text-right">
                <div className="flex items-center justify-end gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  Margem
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                </div>
                <div className="text-base font-semibold tabular-nums text-primary mt-0.5">{formatBRL(margin)}</div>
              </div>
            </div>
          </div>

          {/* Composição do custo: Eco vs Externo */}
          <div className="px-5 py-4 space-y-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Composição do custo</div>
            <div className="h-2 w-full rounded-full bg-elevated/40 overflow-hidden flex">
              <div className="h-full bg-primary" style={{ width: `${ecoPctOfCost}%` }} title={`Eco ${formatBRL(snapshot.custoEco)}`} />
              <div className="h-full bg-curators" style={{ width: `${extPctOfCost}%` }} title={`Externo ${formatBRL(snapshot.custoExt)}`} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Eco</div>
                  <div className="text-sm font-semibold tabular-nums text-foreground">{formatBRL(snapshot.custoEco)}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 min-w-0 justify-end text-right">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Externo</div>
                  <div className="text-sm font-semibold tabular-nums text-foreground">{formatBRL(snapshot.custoExt)}</div>
                </div>
                <span className="w-2 h-2 rounded-full bg-curators shrink-0" />
              </div>
            </div>
          </div>
        </>
      )}
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

type ReplanPreview = { added: number; plays_per_day_added: number; message?: string };
type ReplanStrategy = "daily_need" | "chart_tier";

function ReplanButton({ campaignId, onReplanned }: { campaignId: string; onReplanned: () => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState<ReplanStrategy | null>(null);
  const [previews, setPreviews] = useState<Record<ReplanStrategy, ReplanPreview | null>>({
    daily_need: null,
    chart_tier: null,
  });

  const fetchPreview = async (strategy: ReplanStrategy): Promise<ReplanPreview> => {
    const { data, error } = await supabase.functions.invoke("replan-campaign-eco", {
      body: { campaign_id: campaignId, dry_run: true, strategy },
    });
    if (error) throw error;
    const res = data as { ok: boolean; added?: number; plays_per_day_added?: number; message?: string; error?: string };
    if (!res?.ok) throw new Error(res?.error ?? "Falha ao calcular replanejamento");
    return { added: Number(res.added ?? 0), plays_per_day_added: Number(res.plays_per_day_added ?? 0), message: res.message };
  };


  const handleOpen = async () => {
    setOpen(true);
    setPreviews({ daily_need: null, chart_tier: null });
    setLoading(true);
    try {
      const [daily, chart] = await Promise.all([fetchPreview("daily_need"), fetchPreview("chart_tier")]);
      setPreviews({ daily_need: daily, chart_tier: chart });
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, "Falha ao calcular replanejamento"));
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async (strategy: ReplanStrategy) => {
    setExecuting(strategy);
    try {
      const { data, error } = await supabase.functions.invoke("replan-campaign-eco", {
        body: { campaign_id: campaignId, dry_run: false, strategy },
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
      setExecuting(null);
    }
  };

  const hasAny = (previews.daily_need?.added ?? 0) + (previews.chart_tier?.added ?? 0) > 0;
  const busy = executing !== null;

  const renderOption = (
    strategy: ReplanStrategy,
    title: string,
    description: string,
    preview: ReplanPreview | null,
  ) => (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md bg-background/50 p-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Playlists</div>
          <div className="text-xl font-semibold tabular-nums">{preview?.added ?? 0}</div>
        </div>
        <div className="rounded-md bg-background/50 p-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Plays/dia</div>
          <div className="text-xl font-semibold tabular-nums">
            {(preview?.plays_per_day_added ?? 0).toLocaleString("pt-BR")}
          </div>
        </div>
      </div>


      <Button
        size="sm"
        className="w-full"
        onClick={() => handleConfirm(strategy)}
        disabled={busy || !preview || preview.added === 0}
      >
        {executing === strategy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
        Aplicar
      </Button>
    </div>
  );

  return (
    <>
      {/* Botão "Replanejar plano" ocultado a pedido — dialog ainda acessível via handleOpen se reativado.
      <Button variant="outline" size="sm" onClick={handleOpen}>
        <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
        Replanejar plano
      </Button>
      */}
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Replanejar plano</DialogTitle>
          </DialogHeader>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
              <Loader2 className="h-4 w-4 animate-spin" /> Calculando os dois cenários…
            </div>
          ) : !hasAny ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {previews.chart_tier?.message ?? previews.daily_need?.message ?? "Nenhuma playlist nova para adicionar ao plano atual."}
              </p>
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Fechar</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Escolha a estratégia. As 22 playlists atuais (e despachadas) não são alteradas em nenhum cenário.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {renderOption(
                  "chart_tier",
                  "Concentrado",
                  "Mesma lógica do plano original: poucas playlists em posições boas.",
                  previews.chart_tier,
                )}
                {renderOption(
                  "daily_need",
                  "Espalhado",
                  "Muitas playlists em posição baixa, distribuído contra a meta diária.",
                  previews.daily_need,
                )}
              </div>
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={busy}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function FinKpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <Kpi variant="compact" label={label} value={value} hint={sub} />;
}

// ─────────────────────────────────────────────────────────────
// AuditCampaignButton — chama audit-campaign-flow e mostra as 7 etapas
// num dialog com badge ok/failed/skipped por linha. Read-only.
// ─────────────────────────────────────────────────────────────
type AuditStepRow = {
  step: string;
  label: string;
  status: "ok" | "failed" | "pending" | "skipped";
  detail: string;
};
type AuditReport = {
  ok: boolean;
  campaign_id: string;
  collection_mode: "bot" | "spreadsheet" | null;
  steps: AuditStepRow[];
};

function AuditCampaignButton({ campaignId }: { campaignId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<AuditReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runAudit = async () => {
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const { data, error: invErr } = await supabase.functions.invoke("audit-campaign-flow", {
        body: { campaign_id: campaignId },
      });
      if (invErr) throw invErr;
      setReport(data as AuditReport);
    } catch (e) {
      setError((e as Error).message ?? "Erro ao auditar");
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = (next: boolean) => {
    setOpen(next);
    if (next && !report && !loading) void runAudit();
  };

  const statusStyles: Record<AuditStepRow["status"], string> = {
    ok: "bg-primary/10 text-primary border-primary/30",
    failed: "bg-destructive/15 text-destructive border-destructive/40",
    pending: "bg-amber-500/10 text-amber-500 border-amber-500/30",
    skipped: "bg-muted text-muted-foreground border-border",
  };
  const statusLabel: Record<AuditStepRow["status"], string> = {
    ok: "OK",
    failed: "FALHOU",
    pending: "PENDENTE",
    skipped: "N/A",
  };

  const counts = report
    ? report.steps.reduce(
        (acc, s) => ({ ...acc, [s.status]: (acc[s.status] ?? 0) + 1 }),
        { ok: 0, failed: 0, pending: 0, skipped: 0 } as Record<AuditStepRow["status"], number>,
      )
    : null;

  const modeLabel =
    report?.collection_mode === "spreadsheet"
      ? "Coleta via planilha (cliente envia no portal)"
      : report?.collection_mode === "bot"
        ? "Coleta automática via Spotify (bot)"
        : null;

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 px-2 lg:px-3 lg:gap-1.5" title="Auditar campanha" aria-label="Auditar">
          <CheckCircle2 className="h-4 w-4 lg:mr-0" />
          <span className="hidden lg:inline">Auditar</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto bg-card border-border">
        <DialogHeader>
          <DialogTitle>Auditoria da campanha</DialogTitle>
          <DialogDescription>
            Checklist do que falta pra campanha rodar. <span className="text-foreground/70">Não escreve nada no banco.</span>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            {modeLabel && (
              <span className="text-xs uppercase tracking-wider rounded border border-border bg-background/40 px-2 py-1 text-muted-foreground">
                {modeLabel}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={runAudit} disabled={loading} className="ml-auto">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
              Reexecutar
            </Button>
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Auditando…
            </div>
          )}

          {error && (
            <div className="text-sm text-destructive border border-destructive/40 bg-destructive/10 rounded-lg p-3">
              {error}
            </div>
          )}

          {report && counts && (
            <>
              {/* Banner-resumo: distingue erro real (FALHOU) de etapa só esperando ação (PENDENTE) */}
              <div className={cn(
                "text-sm font-semibold rounded-lg px-3 py-2 border flex items-center justify-between gap-3 flex-wrap",
                counts.failed > 0
                  ? "bg-destructive/15 text-destructive border-destructive/40"
                  : counts.pending > 0
                    ? "bg-amber-500/10 text-amber-500 border-amber-500/30"
                    : "bg-primary/10 text-primary border-primary/30",
              )}>
                <span>
                  {counts.failed > 0
                    ? `${counts.failed} falha(s) real(is) — precisam de correção`
                    : counts.pending > 0
                      ? `${counts.pending} etapa(s) aguardando ação humana`
                      : "Tudo certo — campanha pronta pra operar"}
                </span>
                <span className="text-xs font-normal opacity-80">
                  {counts.ok} ok · {counts.pending} pendente · {counts.failed} falha · {counts.skipped} N/A
                </span>
              </div>

              <ul className="space-y-2">
                {report.steps.map((s) => (
                  <li key={s.step} className="border border-border bg-background/40 rounded-lg p-3">
                    <div className="flex items-start gap-2">
                      <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider border shrink-0 mt-0.5", statusStyles[s.status])}>
                        {statusLabel[s.status]}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-foreground">{s.label}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{s.detail}</div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="text-[11px] text-muted-foreground border-t border-border pt-3">
                <span className="inline-flex items-center gap-1.5 mr-3"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> OK = funcionando</span>
                <span className="inline-flex items-center gap-1.5 mr-3"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Pendente = falta uma ação manual</span>
                <span className="inline-flex items-center gap-1.5 mr-3"><span className="h-1.5 w-1.5 rounded-full bg-destructive" /> Falhou = problema real</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" /> N/A = não se aplica neste modo</span>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}


