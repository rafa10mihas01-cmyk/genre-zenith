import { useEffect, useMemo, useState } from "react";
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
import { distributeEcoPositions } from "@/lib/campaignOperationalPlan";
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

type Camp = CampaignHubCampaign & {
  client_approved_by?: string | null;
  client_rejected_at?: string | null;
  client_adjustment_request?: string | null;
};

export default function PlanoCampanhaPublico() {
  const { token } = useParams<{ token: string }>();
  const [camp, setCamp] = useState<Camp | null>(null);
  const [allocs, setAllocs] = useState<EcoAllocation[]>([]);
  const [snaps, setSnaps] = useState<EcoSnap[]>([]);
  const [proofs, setProofs] = useState<DeliveryProof[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<CampaignHubTabId>("overview");

  const [approveOpen, setApproveOpen] = useState(false);
  const [approverName, setApproverName] = useState("");
  const [approving, setApproving] = useState(false);

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustMsg, setAdjustMsg] = useState("");
  const [adjustName, setAdjustName] = useState("");
  const [adjusting, setAdjusting] = useState(false);

  async function load() {
    if (!token) return;
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("get-shared-campaign-plan", { body: { token } });
    if (error || (data as any)?.error) {
      setErr((data as any)?.error ?? error?.message ?? "Erro");
    } else {
      setCamp((data as any).campaign);
      setAllocs((data as any).allocations ?? []);
      setSnaps((data as any).snapshots ?? []);
      setProofs((data as any).proofs ?? []);
      setErr(null);
    }
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token]);

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
      delta_plays: p.plays_24h ?? null,
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
      <div className="min-h-screen bg-background p-6 max-w-7xl mx-auto">
        <Skeleton className="h-8 w-64 mb-4" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (err || !camp || !snapshot) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-muted-foreground">Plano indisponível ou link inválido.</p>
        </div>
      </div>
    );
  }

  const isApproved = !!camp.client_approved_at;
  const isRejected = !!camp.client_rejected_at && !isApproved;
  const delivered = camp.total_delivered ?? 0;
  const lastUpdateAt = proofEvents[0]?.captured_at ?? camp.started_at;

  async function handleApprove() {
    if (approverName.trim().length < 2) { toast.error("Informe seu nome"); return; }
    setApproving(true);
    const { error } = await supabase.rpc("client_approve_campaign" as any, {
      p_token: token, p_approver_name: approverName.trim(), p_approver_ip: null,
    });
    setApproving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Campanha aprovada");
    setApproveOpen(false); setApproverName(""); load();
  }

  async function handleAdjust() {
    if (adjustMsg.trim().length < 3) { toast.error("Descreva o ajuste"); return; }
    setAdjusting(true);
    const { error } = await supabase.rpc("client_request_adjustment" as any, {
      p_token: token, p_message: adjustMsg.trim(), p_requester_name: adjustName.trim() || null,
    });
    setAdjusting(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Pedido de ajuste enviado");
    setAdjustOpen(false); setAdjustMsg(""); setAdjustName(""); load();
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto p-4 md:p-6">
        <div className="flex items-center justify-between mb-4 print:hidden">
          <NexEngineLogo variant="auto" className="h-7 w-auto" />
          <span className="text-[11px] text-muted-foreground">Portal do cliente · somente leitura</span>
        </div>

        {/* Banner contextual: aprovação pendente / ajuste pedido / aprovado */}
        {!isApproved && !isRejected && (
          <Card className="mb-4 border-primary/30 bg-primary/5 print:hidden">
            <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <div className="font-semibold">Orçamento da campanha</div>
                <div className="text-xs text-muted-foreground">
                  Revise abaixo. Quando aprovar, esta página vira o acompanhamento ao vivo — sem trocar de link.
                </div>
              </div>
              <div className="flex gap-2 w-full sm:w-auto">
                <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" className="flex-1 sm:flex-none">
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
            </CardContent>
          </Card>
        )}

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
          delivered={delivered}
          goal={snapshot.meta}
          daysElapsed={daysElapsed}
          daysTotal={snapshot.days}
          lastUpdateAt={lastUpdateAt}
          slots={{
            overview: (
              <div className="space-y-6">
                <ClientInvestmentCard
                  meta={snapshot.meta}
                  days={snapshot.days}
                  pricePerStreamSell={snapshot.pricePerStreamSell}
                  clientPriceTotal={snapshot.clientPriceTotal}
                />
                <OverviewTab
                  snapshot={snapshot}
                  delivered={delivered}
                  daysElapsed={daysElapsed}
                  showFinance={false}
                  allocations={allocs}
                  snapshots={snaps}
                  proofs={isApproved ? proofs.map(p => ({
                    id: p.id,
                    captured_at: p.captured_at,
                    playlist_name: p.playlist_name,
                    screenshot_url: p.screenshot_url,
                    delta_plays: p.plays_24h ?? null,
                  })) : []}
                  onJumpTab={(t) => setTab(t)}
                />

              </div>
            ),
            playlists: (
              <PlaylistsGrid
                allocations={allocs}
                snapshots={snaps}
                proofThumbs={proofs.map(p => ({
                  playlist_id: p.playlist_id,
                  screenshot_url: p.screenshot_url,
                  captured_at: p.captured_at,
                }))}
                positions={ecoPositionByAllocation}
                mode="client"
              />
            ),
            proofs: isApproved ? (
              <ProofsTimeline events={proofEvents} />
            ) : (
              <Card>
                <CardContent className="p-6 text-sm text-muted-foreground text-center">
                  As provas de entrega vão aparecer aqui assim que a campanha começar a rodar.
                </CardContent>
              </Card>
            ),
            curve: (
              <CampaignFullPlanCard
                snapshot={snapshot}
                startedAt={camp.started_at}
                allocations={allocs as any}
                engagementMultiplier={camp.engagement_multiplier ?? 30}
                showShare={false}
              />
            ),
          }}
        />

        <p className="text-[10px] text-muted-foreground mt-6 text-center">
          Plano e acompanhamento gerados pela NexEngine. Acesso somente leitura.
        </p>
      </div>
    </div>
  );
}
