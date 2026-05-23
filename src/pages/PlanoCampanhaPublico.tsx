import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { CampaignFullPlanCard } from "@/components/campanhas/CampaignFullPlanCard";
import { ClientInvestmentCard } from "@/components/campanhas/ClientInvestmentCard";
import type { CampaignSnapshot } from "@/lib/campaignSnapshot";
import { Printer, ExternalLink, CheckCircle2, MessageSquareWarning, Loader2 } from "lucide-react";
import { NexEngineLogo } from "@/components/NexEngineLogo";
import { toast } from "sonner";

type Camp = {
  id: string;
  track_name: string;
  artist: string | null;
  cover_url: string | null;
  spotify_track_url: string | null;
  spotify_track_id: string | null;
  started_at: string;
  deadline: string | null;
  simulation_snapshot: CampaignSnapshot | null;
  engagement_multiplier: number | null;
  client_approved_at: string | null;
  client_approved_by: string | null;
  client_rejected_at: string | null;
  client_adjustment_request: string | null;
};

type Alloc = {
  id: string;
  planned_streams: number;
  start_day: number;
  managed_playlists?: { name: string; cover_url: string | null; followers: number } | null;
};

export default function PlanoCampanhaPublico() {
  const { token } = useParams<{ token: string }>();
  const [camp, setCamp] = useState<Camp | null>(null);
  const [allocs, setAllocs] = useState<Alloc[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

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
      setErr(null);
    }
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token]);

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

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-6 max-w-7xl mx-auto">
        <Skeleton className="h-8 w-64 mb-4" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (err || !camp || !camp.simulation_snapshot) {
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

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6 print:hidden">
          <NexEngineLogo variant="auto" className="h-7 w-auto" />
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-1.5" /> Imprimir / PDF
          </Button>
        </div>

        <div className="mb-4 flex items-center gap-4">
          {camp.cover_url && <img src={camp.cover_url} alt="" className="w-16 h-16 rounded object-cover" />}
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              {camp.spotify_track_url ? (
                <a href={camp.spotify_track_url} target="_blank" rel="noopener noreferrer" className="hover:text-primary inline-flex items-center gap-1.5">
                  {camp.track_name}<ExternalLink className="h-4 w-4 opacity-60" />
                </a>
              ) : camp.track_name}
            </h1>
            {camp.artist && <p className="text-muted-foreground">{camp.artist}</p>}
            <p className="text-xs text-muted-foreground mt-1">
              Início {new Date(camp.started_at).toLocaleDateString("pt-BR")}
              {camp.deadline && ` · Prazo ${new Date(camp.deadline).toLocaleDateString("pt-BR")}`}
              {` · ${camp.simulation_snapshot.days} dias`}
            </p>
          </div>
        </div>

        {isApproved ? (
          <div className="rounded-2xl border border-primary/40 bg-primary/5 p-4 mb-6 flex items-start gap-3 print:hidden">
            <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold">Aprovado por {camp.client_approved_by}</div>
              <div className="text-xs text-muted-foreground">em {new Date(camp.client_approved_at!).toLocaleString("pt-BR")}</div>
            </div>
          </div>
        ) : isRejected ? (
          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4 mb-6 print:hidden">
            <div className="flex items-start gap-3">
              <MessageSquareWarning className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
              <div className="flex-1">
                <div className="font-semibold">Ajuste solicitado</div>
                <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{camp.client_adjustment_request}</p>
                <div className="text-xs text-muted-foreground mt-2">
                  em {new Date(camp.client_rejected_at!).toLocaleString("pt-BR")} — aguardando NexEngine revisar
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-card p-4 mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 print:hidden">
            <div>
              <div className="font-semibold">Aguardando sua aprovação</div>
              <div className="text-xs text-muted-foreground">Revise o plano abaixo e aprove ou peça ajuste.</div>
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
          </div>
        )}

        <CampaignFullPlanCard
          snapshot={camp.simulation_snapshot}
          startedAt={camp.started_at}
          allocations={allocs as any}
          engagementMultiplier={camp.engagement_multiplier ?? 30}
          showShare={false}
        />

        <p className="text-[10px] text-muted-foreground mt-6 text-center">
          Plano gerado pela NexEngine. Acesso somente leitura.
        </p>
      </div>
    </div>
  );
}
