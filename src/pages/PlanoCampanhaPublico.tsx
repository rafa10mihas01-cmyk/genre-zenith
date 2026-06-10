import { useEffect, useMemo, useState } from "react";

// Portal público do cliente — força tema escuro independente da preferência
// salva no localStorage ou do sistema do visitante. O portal sempre preto.
function useForceDarkTheme() {
  useEffect(() => {
    const root = document.documentElement;
    const hadLight = root.classList.contains("light");
    const prevColorScheme = root.style.colorScheme;
    root.classList.remove("light");
    root.classList.add("dark");
    root.style.colorScheme = "dark";
    return () => {
      if (hadLight) {
        root.classList.remove("dark");
        root.classList.add("light");
      }
      root.style.colorScheme = prevColorScheme;
    };
  }, []);
}
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { ClientInvestmentCard } from "@/components/campanhas/ClientInvestmentCard";
import { CampaignFullPlanCard } from "@/components/campanhas/CampaignFullPlanCard";
import type { CampaignSnapshot } from "@/lib/campaignSnapshot";
import { CheckCircle2, MessageSquareWarning, Loader2 } from "lucide-react";
import { NexEngineLogo } from "@/components/NexEngineLogo";
import { toast } from "sonner";
import { CampaignHub } from "@/components/campaign-hub/CampaignHub";
import { OverviewTab } from "@/components/campaign-hub/tabs/OverviewTab";
import { PlaylistsGrid } from "@/components/campaign-hub/PlaylistsGrid";
import { ProofsTimeline, type ProofEvent } from "@/components/campaign-hub/ProofsTimeline";
import { CampaignDailyPlan } from "@/components/campanhas/CampaignDailyPlan";
import { distributeEcoPositions, chartTierFromTopPosition } from "@/lib/campaignOperationalPlan";
import { ClientHeroCard } from "@/components/campaign-hub/ClientHeroCard";
import { SpreadsheetUploadCard } from "@/components/client-portal/SpreadsheetUploadCard";
import { CampaignAccessGate, accessStorageKey } from "@/components/client-portal/CampaignAccessGate";
import {
  portalHeaders,
  clearPortalSession,
  isPortalAuthError,
  isLocalStorageAvailable,
  logPortalAuth,
  getPortalJwt,
} from "@/lib/portalSession";

import { MonitoredPlaylistsCard, type MonitoredPlaylist } from "@/components/client-portal/MonitoredPlaylistsCard";
import { AlgorithmicImpactCard } from "@/components/client-portal/AlgorithmicImpactCard";
import { PrintsHistoryCard, type PrintsHistoryEntry } from "@/components/client-portal/PrintsHistoryCard";
import type { CampaignHubCampaign, CampaignHubTabId, EcoAllocation } from "@/components/campaign-hub/types";
import { EvolutionChart, type EvolutionSeriesPoint } from "@/components/client-portal/EvolutionChart";
import { DeliveryForecastCard, type ForecastPayload } from "@/components/client-portal/DeliveryForecastCard";
import { GenresUsedChip, type GenreUsed } from "@/components/campanhas/GenresUsedChip";
import { PlanHistoryTab } from "@/components/campaign-hub/tabs/PlanHistoryTab";



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

type Camp = CampaignHubCampaign & {
  client_approved_by?: string | null;
  client_rejected_at?: string | null;
  client_adjustment_request?: string | null;
};

type SpreadsheetUpload = {
  id: string;
  created_at: string;
  rows_imported: number;
  total_streams: number;
  status: string;
  file_name: string | null;
};

type SharedCampaignPlanResponse = {
  error?: string;
  campaign?: Camp;
  allocations?: EcoAllocation[];
  snapshots?: EcoSnap[];
  proofs?: DeliveryProof[];
  client_token?: string | null;
  last_spreadsheet_upload_at?: string | null;
  recent_uploads?: SpreadsheetUpload[];
  has_spotify_access?: boolean;
  collection_mode?: "bot" | "spreadsheet";
  forecast?: ForecastPayload | null;
  genres_used?: GenreUsed[];
  organic_summary?: { total_plays?: number; by_kind?: Record<string, number> } | null;
};



type PublicRpc = (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;

export default function PlanoCampanhaPublico() {
  useForceDarkTheme();
  const { token } = useParams<{ token: string }>();
  const [camp, setCamp] = useState<Camp | null>(null);
  const [allocs, setAllocs] = useState<EcoAllocation[]>([]);
  const [snaps, setSnaps] = useState<EcoSnap[]>([]);
  const [proofs, setProofs] = useState<DeliveryProof[]>([]);
  const [clientToken, setClientToken] = useState<string | null>(null);
  const [lastUploadAt, setLastUploadAt] = useState<string | null>(null);
  const [recentUploads, setRecentUploads] = useState<SpreadsheetUpload[]>([]);
  const [collectionMode, setCollectionMode] = useState<"bot" | "spreadsheet">("bot");
  const [forecast, setForecast] = useState<ForecastPayload | null>(null);
  const [genresUsed, setGenresUsed] = useState<GenreUsed[]>([]);
  const [organicSummary, setOrganicSummary] = useState<{ total_plays?: number; by_kind?: Record<string, number> } | null>(null);
  // Entregue real — fonte de verdade vw_campaign_playlist_growth (curadores + ecossistema, exclui orgânico)
  const [deliveredFromView, setDeliveredFromView] = useState<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<CampaignHubTabId>(() => {
    if (typeof window === "undefined") return "overview";
    const t = new URLSearchParams(window.location.search).get("tab");
    const allowed: CampaignHubTabId[] = ["overview", "playlists", "proofs", "upload", "history"];
    return (allowed as string[]).includes(t ?? "") ? (t as CampaignHubTabId) : "overview";
  });
  const [livePlaylists, setLivePlaylists] = useState<MonitoredPlaylist[]>([]);
  const [livePlaylistsLoading, setLivePlaylistsLoading] = useState(true);
  const [snapshotHistory, setSnapshotHistory] = useState<PrintsHistoryEntry[]>([]);

  const [evolutionSeries, setEvolutionSeries] = useState<EvolutionSeriesPoint[]>([]);

  const [approveOpen, setApproveOpen] = useState(false);
  const [approverName, setApproverName] = useState("");
  const [approving, setApproving] = useState(false);

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustMsg, setAdjustMsg] = useState("");
  const [adjustName, setAdjustName] = useState("");
  const [adjusting, setAdjusting] = useState(false);

  // ─── Gate por e-mail+OTP (opt-in por campanha) ───
  // Plano completo (/p/plano/<token>): pode pedir PIN se o operador
  // cadastrar e-mails autorizados em CampaignAccessManager.
  // Mapa (/p/plano/<token>?view=mapa): SEMPRE público, ignora o gate.
  const isMapView = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("view") === "mapa";

  const [gateChecked, setGateChecked] = useState(isMapView);
  const [gateRequired, setGateRequired] = useState(false);
  const [gateAuthed, setGateAuthed] = useState(isMapView);

  useEffect(() => {
    if (!token || isMapView) return;
    let cancelled = false;
    (async () => {
      // 0) Admin bypass via hash (#admin_jwt=...) — o operador abriu o portal
      //    pelo botão "Abrir portal" do hub interno, que pré-autenticou.
      try {
        const hash = window.location.hash || "";
        const match = hash.match(/[#&]admin_jwt=([^&]+)/);
        if (match) {
          const adminJwt = decodeURIComponent(match[1]);
          try {
            localStorage.setItem(
              `campaign_access_jwt:${token}`,
              JSON.stringify({ jwt: adminJwt, email: "admin", exp: Date.now() + 86400_000 }),
            );
          } catch { /* ignore */ }
          // Remove o hash da URL pra não vazar em prints/histórico.
          try { window.history.replaceState(null, "", window.location.pathname + window.location.search); } catch { /* ignore */ }
          if (!cancelled) { setGateAuthed(true); setGateChecked(true); }
          return;
        }
      } catch { /* ignore */ }

      // 1) JWT salvo ainda válido? Se sim, libera sem pedir nada.
      try {
        const raw = localStorage.getItem(`campaign_access_jwt:${token}`);
        if (raw) {
          const parsed = JSON.parse(raw) as { jwt?: string; exp?: number };
          if (parsed?.jwt && parsed?.exp && parsed.exp > Date.now()) {
            if (!cancelled) { setGateAuthed(true); setGateChecked(true); }
            return;
          }
        }
      } catch { /* ignore */ }

      // 2) Bypass admin — se o operador logado for admin, troca a sessão
      //    por um JWT do portal e libera direto, sem pedir PIN.
      try {
        const { data: sess } = await supabase.auth.getSession();
        if (sess?.session?.access_token) {
          const { data: bp } = await supabase.functions.invoke("admin-campaign-access", {
            body: { token },
          });
          const adminJwt = (bp as any)?.jwt as string | undefined;
          const adminEmail = (bp as any)?.email as string | undefined;
          if (adminJwt) {
            try {
              localStorage.setItem(
                `campaign_access_jwt:${token}`,
                JSON.stringify({ jwt: adminJwt, email: adminEmail ?? "admin", exp: Date.now() + 86400_000 }),
              );
            } catch { /* ignore */ }
            if (!cancelled) { setGateAuthed(true); setGateChecked(true); }
            return;
          }
        }
      } catch { /* ignore — cai no fluxo normal */ }

      // 3) Pergunta ao backend se essa campanha exige PIN.
      const { data } = await supabase.functions.invoke("check-campaign-access", {
        body: { token },
      });
      if (cancelled) return;
      const required = Boolean((data as any)?.required);
      setGateRequired(required);
      setGateChecked(true);
      if (!required) setGateAuthed(true);
    })();
    return () => { cancelled = true; };
  }, [token, isMapView]);

  // Handler único — qualquer endpoint do portal que devolver erro de auth
  // dispara esse caminho: limpa JWT cacheado, força gate e loga diagnóstico.
  // NUNCA renderiza dashboard parcial zerado.
  function handlePortalAuthError(endpoint: string, status: string) {
    clearPortalSession(token);
    setGateAuthed(false);
    setGateRequired(true);
    setLoading(false);
    setLivePlaylistsLoading(false);
    setLivePlaylists([]);
    setSnapshotHistory([]);
    setEvolutionSeries([]);
    logPortalAuth({
      campaign_id: (camp as any)?.id ?? null,
      endpoint,
      auth_status: status,
      jwt_present: Boolean(getPortalJwt(token)),
      localstorage_available: isLocalStorageAvailable(),
      token,
    });
  }

  async function load() {
    if (!token) return;
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("get-shared-campaign-plan", {
      body: { token, view: isMapView ? "mapa" : undefined },
      headers: portalHeaders(token),
    });
    const payload = data as SharedCampaignPlanResponse | null;
    // Sessão expirada/inválida → derruba JWT cacheado e força gate de novo.
    if (isPortalAuthError(payload?.error) && token) {
      handlePortalAuthError("get-shared-campaign-plan", payload!.error!);
      return;
    }
    if (error || payload?.error) {
      setErr(payload?.error ?? error?.message ?? "Erro");
    } else {
      setCamp(payload?.campaign ?? null);
      setAllocs(payload?.allocations ?? []);
      setSnaps(payload?.snapshots ?? []);
      setProofs(payload?.proofs ?? []);
      setClientToken(payload?.client_token ?? null);
      setLastUploadAt(payload?.last_spreadsheet_upload_at ?? null);
      setRecentUploads(payload?.recent_uploads ?? []);
      setCollectionMode(payload?.collection_mode === "spreadsheet" ? "spreadsheet" : "bot");
      setForecast(payload?.forecast ?? null);
      setGenresUsed(payload?.genres_used ?? []);
      setOrganicSummary(payload?.organic_summary ?? null);
      setErr(null);
    }
    setLoading(false);
  }

  // Só carrega dados depois que o gate liberou (mapa libera de cara).
  useEffect(() => { if (gateAuthed) load(); /* eslint-disable-next-line */ }, [token, gateAuthed]);

  // Carrega o payload público sanitizado em paralelo ao plano principal.
  // Antes dependia do client_token vindo de get-shared-campaign-plan; isso
  // criava cascata e deixava a aba Curadores presa no skeleton.
  useEffect(() => {
    if (!token || !gateAuthed || isMapView) return;
    let cancelled = false;
    setLivePlaylistsLoading(true);
    (async () => {
      const { data } = await supabase.functions.invoke("get-client-campaign-public", {
        body: { public_plan_token: token },
        headers: portalHeaders(token),
      });
      if (cancelled) return;
      const payload = data as { ok?: boolean; error?: string; playlists?: MonitoredPlaylist[]; snapshot_history?: PrintsHistoryEntry[]; snapshotHistory?: PrintsHistoryEntry[]; series?: EvolutionSeriesPoint[] } | null;
      // CRÍTICO — erro de auth aqui NÃO pode silenciosamente zerar listas
      // como acontecia antes. Tratamos igual ao load() pra evitar dashboard
      // parcial com playlists vazias / gráfico zerado / histórico ausente.
      if (payload && payload.ok === false && isPortalAuthError(payload.error)) {
        handlePortalAuthError("get-client-campaign-public", payload.error!);
        return;
      }
      if (!payload || payload.ok === false) {
        // Falha não-auth (rate limit, not_found etc) → mantém o que já tinha
        // e marca como "carregado" pra não travar skeleton infinito.
        setLivePlaylistsLoading(false);
        return;
      }
      setLivePlaylists(Array.isArray(payload.playlists) ? payload.playlists : []);
      const hist = payload.snapshot_history ?? payload.snapshotHistory ?? [];
      setSnapshotHistory(Array.isArray(hist) ? hist : []);
      setEvolutionSeries(Array.isArray(payload.series) ? payload.series : []);
      setLivePlaylistsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [token, gateAuthed, isMapView]);


  // Fonte de verdade do "Entregue" — mesma usada na Execução / OverviewTab / Lista de Campanhas.
  // Substitui campaigns.total_delivered (legado).
  useEffect(() => {
    const campaignId = (camp as any)?.id;
    if (!campaignId) { setDeliveredFromView(null); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("vw_campaign_playlist_growth")
        .select("attributed_to, delta")
        .eq("campaign_id", campaignId);
      if (cancelled || error || !Array.isArray(data)) return;
      const total = (data as Array<{ attributed_to: string | null; delta: number | null }>).reduce((acc, r) => {
        const at = r.attributed_to ?? "";
        if (at === "organic") return acc;
        if (at === "ecosystem" || at.startsWith("curator:")) return acc + Number(r.delta ?? 0);
        return acc;
      }, 0);
      setDeliveredFromView(total);
    })();
    return () => { cancelled = true; };
  }, [(camp as any)?.id]);

  const snapshot = camp?.simulation_snapshot ?? null;

  const ecoPositionByAllocation = useMemo(() => {
    if (!snapshot) return new Map<string, number>();
    const allPersisted = allocs.length > 0 && allocs.every(a => Number.isFinite((a as any).position) && (a as any).position >= 1);
    if (allPersisted) return new Map(allocs.map(a => [a.id, (a as any).position as number]));
    const top = (snapshot as any)?.music?.top200Position ?? (snapshot as any)?.music?.top200Pos ?? null;
    return distributeEcoPositions(
      allocs.map(a => ({
        id: a.id,
        planned_streams: a.planned_streams,
        followers: a.managed_playlists?.followers ?? 0,
        genreSource: ((a as any).genre_source as "primary" | "affinity" | null) ?? "primary",
      })),
      snapshot.days,
      camp?.engagement_multiplier ?? 35,
      { chartTier: chartTierFromTopPosition(top) },
    );
  }, [snapshot, allocs, camp?.engagement_multiplier]);

  const daysElapsed = useMemo(() => {
    if (!camp || !snapshot) return 0;
    const elapsedMs = Date.now() - new Date(camp.started_at).getTime();
    return Math.max(1, Math.min(snapshot.days, Math.ceil(elapsedMs / 86400_000)));
  }, [camp, snapshot]);

  const proofEvents = useMemo<ProofEvent[]>(() => {
    const ext: ProofEvent[] = proofs.map((p) => ({
      id: `dp-${p.id}`,
      captured_at: p.captured_at,
      playlist_name: p.playlist_name,
      playlist_cover: null,
      screenshot_url: p.screenshot_url,
      plays_total: Number(p.plays_total ?? 0),
      delta_plays: null,
      position: p.position_in_playlist ?? null,
      source: p.source ?? "bot",
    }));
    const plById = new Map(allocs.map(a => [a.managed_playlist_id, a.managed_playlists]));
    const eco: ProofEvent[] = snaps.map((s) => {
      const pl = plById.get(s.managed_playlist_id);
      return {
        id: `es-${s.id}`,
        captured_at: s.captured_at,
        playlist_name: pl?.name ?? "Playlist própria",
        playlist_cover: pl?.cover_url ?? null,
        screenshot_url: null,
        plays_total: Number(s.plays_28d ?? s.plays_7d ?? 0),
        delta_plays: null,
        position: null,
        source: s.source ?? "bot",
        spotify_url: pl?.spotify_url ?? null,
      };
    });
    return [...ext, ...eco].sort((a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime());
  }, [proofs, snaps, allocs]);

  if (!token) return null;

  // Gate UI — exibido antes de qualquer fetch de dados sensíveis.
  // Não aparece no modo mapa (isMapView libera de cara).
  if (gateChecked && gateRequired && !gateAuthed) {
    return (
      <CampaignAccessGate
        token={token}
        onAuthed={() => setGateAuthed(true)}
      />
    );
  }


  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 50% 40% at 50% 50%, hsl(141 76% 48% / 0.10) 0%, transparent 70%)",
          }}
        />
        <div className="relative flex flex-col items-center gap-6">
          <div className="animate-nx-logo-pulse">
            <NexEngineLogo variant="mark" size={64} />
          </div>
          <div className="relative h-[3px] w-40 overflow-hidden rounded-full bg-elevated">
            <div
              className="absolute inset-y-0 left-0 w-full origin-left rounded-full bg-gradient-to-r from-transparent via-primary to-transparent animate-nx-indeterminate"
              style={{ boxShadow: "0 0 6px hsl(var(--primary) / 0.5)" }}
            />
          </div>
        </div>
        <span className="sr-only">Carregando campanha...</span>
      </div>
    );
  }

  if (err || !camp || !snapshot) {
    const isClosed = err === "campaign_closed";
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center space-y-2">
          <p className="text-foreground font-medium">
            {isClosed ? "Campanha encerrada" : "Plano indisponível"}
          </p>
          <p className="text-sm text-muted-foreground">
            {isClosed
              ? "Este link expirou porque a campanha foi finalizada."
              : "Link inválido ou expirado."}
          </p>
        </div>
      </div>
    );
  }

  const isApproved = !!camp.client_approved_at;
  const isRejected = !!camp.client_rejected_at && !isApproved;
  const delivered = deliveredFromView ?? (camp.total_delivered ?? 0);
  const lastUpdateAt = proofEvents[0]?.captured_at ?? camp.started_at;

  // View minimalista: só o mapa de distribuição (compartilhado via ?view=mapa)
  const viewParam = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("view")
    : null;
  if (viewParam === "mapa") {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto p-4 md:p-6">
          <div className="flex items-center justify-between mb-4 print:hidden">
            <NexEngineLogo variant="dark" className="h-7 w-auto" />
            <span className="text-[11px] text-muted-foreground">Mapa de distribuição · somente leitura</span>
          </div>
          <CampaignFullPlanCard
            snapshot={snapshot}
            startedAt={camp.started_at}
            allocations={allocs as unknown as Parameters<typeof CampaignFullPlanCard>[0]["allocations"]}
            engagementMultiplier={camp.engagement_multiplier ?? 35}
            shareToken={null}
            showShare={false}
            radioGoal={Math.round(snapshot.meta * ((snapshot.splitOrganicPct ?? 15) / 100))}
            track={{
              name: camp.track_name,
              artist: camp.artist,
              coverUrl: camp.cover_url,
              spotifyUrl: camp.spotify_track_url ?? null,
            }}
          />
        </div>
      </div>
    );
  }

  async function handleApprove() {
    if (approverName.trim().length < 2) { toast.error("Informe seu nome"); return; }
    setApproving(true);
    const { data, error } = await supabase.functions.invoke("client-approve-campaign", {
      body: { token, approver_name: approverName.trim() },
      headers: portalHeaders(token),
    });
    setApproving(false);
    const errMsg = error?.message || (data && (data as any).ok === false ? (data as any).error : null);
    if (errMsg) { toast.error(errMsg); return; }
    toast.success("Campanha aprovada");
    setApproveOpen(false); setApproverName(""); load();
  }

  async function handleAdjust() {
    if (adjustMsg.trim().length < 3) { toast.error("Descreva o ajuste"); return; }
    setAdjusting(true);
    const { data, error } = await supabase.functions.invoke("client-request-adjustment", {
      body: { token, message: adjustMsg.trim(), requester_name: adjustName.trim() || null },
      headers: portalHeaders(token),
    });
    setAdjusting(false);
    const errMsg = error?.message || (data && (data as any).ok === false ? (data as any).error : null);
    if (errMsg) { toast.error(errMsg); return; }
    toast.success("Pedido de ajuste enviado");
    setAdjustOpen(false); setAdjustMsg(""); setAdjustName(""); load();
  }


  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto p-4 md:p-6">
        <div className="flex items-center justify-between mb-4 print:hidden">
          <NexEngineLogo variant="dark" className="h-7 w-auto" />
          <span className="text-[11px] text-muted-foreground">Portal do cliente · somente leitura</span>
        </div>

        {/* Banner contextual: aprovação pendente / ajuste pedido / aprovado */}
        {!isApproved && !isRejected && (() => {
          const clientPriceTotal = snapshot.clientPriceTotal && snapshot.clientPriceTotal > 0
            ? snapshot.clientPriceTotal
            : snapshot.pricePerStreamSell
              ? Math.round(snapshot.meta * snapshot.pricePerStreamSell * 100) / 100
              : 0;
          const perStream = snapshot.pricePerStreamSell ?? (snapshot.meta > 0 && clientPriceTotal > 0 ? clientPriceTotal / snapshot.meta : 0);
          const fmtBRL = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(n);
          const fmtInt = (n: number) => new Intl.NumberFormat("pt-BR").format(Math.round(n));
          return (
          <Card className="mb-4 border-primary/30 bg-gradient-to-br from-primary/[0.08] via-primary/[0.03] to-card print:hidden overflow-hidden">
            <CardContent className="p-5 sm:p-6 space-y-5">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-primary mb-1">Orçamento da campanha</div>
                  <div className="text-sm text-muted-foreground">
                    Revise o lançamento abaixo. Quando aprovar, esta página vira o acompanhamento ao vivo — sem trocar de link.
                  </div>
                </div>
                <div className="flex gap-2 w-full sm:w-auto shrink-0">
                  <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" className="hidden sm:inline-flex">
                        <MessageSquareWarning className="h-4 w-4 mr-1.5" /> Solicitar ajuste
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Solicitar ajuste</DialogTitle>
                        <DialogDescription>O que precisa ser ajustado neste plano?</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <Label>Seu nome (opcional)</Label>
                          <Input value={adjustName} onChange={(e) => setAdjustName(e.target.value)} placeholder="Quem está pedindo" />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Mensagem</Label>
                          <Textarea value={adjustMsg} onChange={(e) => setAdjustMsg(e.target.value)} rows={5}
                            placeholder="Ex: aumentar prazo pra 30 dias, remover playlists de funk." />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setAdjustOpen(false)} disabled={adjusting}>Cancelar</Button>
                        <Button onClick={handleAdjust} disabled={adjusting}>
                          {adjusting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Enviar pedido
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>

                  <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
                    <DialogTrigger asChild>
                      <Button className="flex-1 sm:flex-none">
                        <CheckCircle2 className="h-4 w-4 mr-1.5" /> Aprovar campanha
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Aprovar campanha</DialogTitle>
                        <DialogDescription>
                          Ao aprovar, autoriza a NexEngine a executar este plano nos termos descritos.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <Label>Seu nome completo</Label>
                          <Input value={approverName} onChange={(e) => setApproverName(e.target.value)}
                            placeholder="Como deve constar na aprovação" autoFocus />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setApproveOpen(false)} disabled={approving}>Cancelar</Button>
                        <Button onClick={handleApprove} disabled={approving}>
                          {approving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Confirmar aprovação
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>

              {clientPriceTotal > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-0 sm:gap-6 pt-4 border-t border-primary/15 divide-y divide-primary/10 sm:divide-y-0">
                  <div className="pb-5 sm:pb-0">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-2">Valor total da campanha</div>
                    <div className="text-[26px] leading-none sm:text-4xl font-semibold tabular-nums tracking-tight text-foreground">
                      {fmtBRL(clientPriceTotal)}
                    </div>
                    {perStream > 0 && (
                      <div className="text-[11px] text-muted-foreground mt-2 tabular-nums">
                        R$ {perStream.toFixed(3).replace(".", ",")} por stream
                      </div>
                    )}
                  </div>
                  <div className="py-5 sm:py-0 sm:border-l sm:border-primary/15 sm:pl-6">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-2">Streams contratados</div>
                    <div className="text-[22px] leading-none sm:text-3xl font-semibold tabular-nums text-foreground">{fmtInt(snapshot.meta)}</div>
                    <div className="text-[11px] text-muted-foreground mt-2">meta total entregue</div>
                  </div>
                  <div className="pt-5 sm:pt-0 sm:border-l sm:border-primary/15 sm:pl-6">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-2">Duração</div>
                    <div className="text-[22px] leading-none sm:text-3xl font-semibold tabular-nums text-foreground">{snapshot.days}d</div>
                    <div className="text-[11px] text-muted-foreground mt-2">contratado{snapshot.effectiveDays && snapshot.effectiveDays !== snapshot.days ? ` · plano real: ${snapshot.effectiveDays}d` : ""}</div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          );
        })()}

        {isRejected && (
          <Card className="mb-4 border-amber-500/40 bg-amber-500/5 print:hidden">
            <CardContent className="p-4 flex items-start gap-3">
              <MessageSquareWarning className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
              <div className="flex-1">
                <div className="font-semibold">Ajuste solicitado</div>
                <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{camp.client_adjustment_request}</p>
                <div className="text-[11px] text-muted-foreground mt-2">
                  em {new Date(camp.client_rejected_at!).toLocaleString("pt-BR")} — aguardando NexEngine revisar
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {isApproved && (
          <Card className="mb-4 border-primary/30 bg-primary/5 print:hidden">
            <CardContent className="p-3 flex items-center gap-3">
              <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
              <div className="text-xs">
                <span className="font-semibold">Aprovado por {camp.client_approved_by}</span>
                <span className="text-muted-foreground"> · {new Date(camp.client_approved_at!).toLocaleString("pt-BR")}</span>
              </div>
            </CardContent>
          </Card>
        )}

        <CampaignHub
          camp={camp}
          mode="client"
          tab={tab}
          onTabChange={setTab}
          hiddenTabs={["curve", "operacao", "finance", "logs"]}
          delivered={delivered}
          goal={snapshot.meta}
          daysElapsed={daysElapsed}
          daysTotal={snapshot.days}
          lastUpdateAt={lastUpdateAt}
          slots={{
            overview: (
              <div className="space-y-6">
                <ClientHeroCard
                  camp={camp}
                  delivered={delivered}
                  goal={snapshot.meta}
                  daysElapsed={daysElapsed}
                  daysTotal={snapshot.days}
                  allocations={allocs}
                  snapshots={snaps}
                  stage={isApproved ? "live" : isRejected ? "rejected" : "approval"}
                />
                {/* Chip de gêneros removido a pedido — info técnica não relevante pro cliente */}
                {(() => {
                  const valorCobrado = snapshot.clientPriceTotal && snapshot.clientPriceTotal > 0
                    ? snapshot.clientPriceTotal
                    : snapshot.pricePerStreamSell
                      ? Math.round(snapshot.meta * snapshot.pricePerStreamSell * 100) / 100
                      : 0;
                  return (
                    <AlgorithmicImpactCard
                      goalPlays={snapshot.meta}
                      valorCobrado={valorCobrado}
                      totalDelivered={delivered}
                      clientType={(camp as any)?.client_type ?? null}
                    />

                  );
                })()}
                {forecast && <DeliveryForecastCard forecast={forecast} organicSummary={organicSummary} spotifyTrackId={snapshot?.music?.spotifyTrackId ?? null} />}
                {isApproved && evolutionSeries.length > 1 && (
                  <EvolutionChart
                    series={evolutionSeries}
                    target={snapshot.meta}
                    pct={snapshot.meta > 0 ? Math.min(100, Math.round((delivered / snapshot.meta) * 100)) : 0}
                  />
                )}
                <OverviewTab
                  snapshot={snapshot}
                  delivered={delivered}
                  daysElapsed={daysElapsed}
                  showFinance={false}
                  hideDeliveryPlan
                  hideCurveShortcut
                  hideCurveCard
                  hideSplitRows
                  allocations={allocs}
                  snapshots={snaps}
                  topDeliveringPlaylists={livePlaylists.map(p => ({
                    name: p.name,
                    image_url: p.image_url,
                    delivered: p.delivered,
                    planned: p.planned ?? null,
                  }))}
                  proofs={isApproved ? proofs.map(p => ({
                    id: p.id,
                    captured_at: p.captured_at,
                    playlist_name: p.playlist_name,
                    screenshot_url: p.screenshot_url,
                    delta_plays: null,
                  })) : []}
                  onJumpTab={(t) => setTab(t)}
                />

              </div>
            ),
            playlists: (
              <MonitoredPlaylistsCard
                playlists={livePlaylists}
                loading={livePlaylistsLoading}
                clientName={camp.artist || undefined}
                campaignName={camp.track_name || undefined}
                artistName={camp.artist || undefined}
                collectionMode={collectionMode}
              />
            ),
            proofs: isApproved ? (
              <PrintsHistoryCard
                history={snapshotHistory}
                coverUrl={camp.cover_url ?? null}
              />
            ) : (
              <Card>
                <CardContent className="p-6 text-sm text-muted-foreground text-center">
                  As provas de entrega vão aparecer aqui assim que a campanha começar a rodar.
                </CardContent>
              </Card>
            ),
            upload: clientToken && collectionMode === "spreadsheet" ? (
              <SpreadsheetUploadCard
                clientToken={clientToken}
                lastUploadAt={lastUploadAt}
                recentUploads={recentUploads}
                onUploaded={load}
                approved={!!camp.client_approved_at}
              />

            ) : null,
            history: token ? <PlanHistoryTab publicToken={token} /> : null,

          }}
        />


        <p className="text-[10px] text-muted-foreground mt-6 text-center">
          Plano e acompanhamento gerados pela NexEngine. Acesso somente leitura.
        </p>
      </div>
    </div>
  );
}
