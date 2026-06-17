import { useCallback, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBackOrFallback } from "@/hooks/useBackOrFallback";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Target, Copy, CheckCircle2, MessageSquareWarning, Clock } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { PUBLIC_DOMAIN } from "@/lib/curatorPublicUrl";
import { Kpi } from "@/components/ui/kpi";
import { CampaignClosureReportCard } from "@/components/campanhas/CampaignClosureReportCard";

type Campaign = {
  id: string; track_name: string; artist: string | null;
  goal_plays: number; deadline: string; started_at: string;
  status: "draft" | "active" | "paused" | "completed" | "cancelled";
  total_allocated: number; total_delivered: number; notes: string | null;
  public_plan_token: string | null;
  roadmap_token: string | null;
  client_approved_at: string | null;
  client_approved_by: string | null;
  client_rejected_at: string | null;
  client_adjustment_request: string | null;
  campaign_type: "ecosystem" | "external" | "hybrid" | null;
  plan_approved_at: string | null;
  plan_approved_by: string | null;
  auto_deal_created: boolean | null;
  deal_id: string | null;
  final_report_url: string | null;
  final_report_requested_at: string | null;
  client_decision_round: number | null;
};

// Allocation type removido na Fase 2.A.2 — campaign_allocations aposentada.

const STATUS_LABEL: Record<string, string> = {
  active: "Ativa", draft: "Rascunho", paused: "Pausada", completed: "Concluída", cancelled: "Cancelada",
};

const CAMPAIGN_TYPE_LABEL: Record<string, string> = {
  ecosystem: "Ecossistema", external: "Externa", hybrid: "Híbrida",
};

export default function CampanhaDetalhe() {
  const { id } = useParams<{ id: string }>();
  const goBack = useBackOrFallback("/campanhas");
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const detailKey = ["campaign_detail", id] as const;

  // Fonte oficial da entrega: vw_campaign_playlist_growth (Growth Engine).
  // Família B (campaign_allocations) aposentada na Fase 2.A.2 — a listagem de
  // playlists da campanha vive agora no fluxo de execução (campaign_eco_allocations).
  const detailQuery = useQuery({
    queryKey: detailKey,
    enabled: !!id,
    queryFn: async () => {
      const [c, g] = await Promise.all([
        supabase.from("campaigns").select("*").eq("id", id!).maybeSingle(),
        supabase.from("vw_campaign_playlist_growth")
          .select("attributed_to, delta")
          .eq("campaign_id", id!),
      ]);
      if (c.error) throw c.error;
      const campData = (c.data as any) ?? null;
      if (campData && Array.isArray(g.data)) {
        const deliveredFromView = (g.data as Array<{ attributed_to: string | null; delta: number | null }>).reduce((acc, r) => {
          const at = r.attributed_to ?? "";
          if (at === "organic") return acc;
          if (at === "ecosystem" || at.startsWith("curator:")) return acc + Number(r.delta ?? 0);
          return acc;
        }, 0);
        campData.total_delivered = deliveredFromView;
      }
      return { camp: campData as Campaign | null };
    },
  });

  const camp = detailQuery.data?.camp ?? null;
  const loading = detailQuery.isLoading && !detailQuery.data;

  const load = useCallback(
    () => qc.invalidateQueries({ queryKey: detailKey }),
    [qc, detailKey],
  );

  const setCamp = useCallback(
    (updater: (c: Campaign | null) => Campaign | null) => {
      qc.setQueryData(detailKey, (old: any) =>
        old ? { ...old, camp: updater(old.camp) } : old,
      );
    },
    [qc, detailKey],
  );

  async function updateStatus(newStatus: string) {
    if (!id) return;
    const { error } = await supabase.from("campaigns").update({ status: newStatus }).eq("id", id);
    if (error) toast({ title: "Erro", description: error.message, variant: "destructive" });
    else load();
  }

  async function approvePlan() {
    if (!id) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("approve-campaign-plan", {
      body: { campaign_id: id },
    });
    setBusy(false);
    if (error) {
      toast({ title: "Erro ao aprovar plano", description: error.message, variant: "destructive" });
      return;
    }
    const res = data as { ok: boolean; deal_created?: boolean; reason?: string; deal_id?: string; already_approved?: boolean };
    if (!res?.ok) {
      toast({ title: "Não foi possível aprovar", description: res?.reason ?? "", variant: "destructive" });
      return;
    }
    toast({
      title: res.already_approved ? "Plano já estava aprovado" : "Plano aprovado",
      description: res.deal_created ? "Deal criado automaticamente." : (res.reason === "flag_disabled" ? "Criação automática de deal está desativada." : undefined),
    });
    load();
  }


  if (loading) {
    return (
      <>
        <PageHeader
        domain="campaigns" kicker="Operação" title="Carregando…" subtitle="Detalhe da campanha" icon={Target} />
        <PageContainer><Skeleton className="h-64" /></PageContainer>
      </>
    );
  }

  if (!camp) {
    return (
      <>
        <PageHeader kicker="Operação" title="Campanha não encontrada" subtitle="Voltar para a lista" icon={Target} />
        <PageContainer>
          <button type="button" onClick={goBack} className="text-primary inline-flex items-center"><ArrowLeft className="inline h-4 w-4 mr-1" /> Voltar</button>
        </PageContainer>
      </>
    );
  }

  const pct = camp.goal_plays > 0 ? Math.min(100, Math.round((camp.total_delivered / camp.goal_plays) * 100)) : 0;
  const daysLeft = Math.ceil((new Date(camp.deadline).getTime() - Date.now()) / 86400_000);

  return (
    <>
      <PageHeader
        kicker="Operação"
        icon={Target}
        title={camp.track_name}
        subtitle={camp.artist ? `Ver entrega de ${camp.artist}` : "Ver entrega da campanha"}
        actions={
          <>
            {!camp.plan_approved_at && (
              <Button onClick={approvePlan} disabled={busy}>
                <CheckCircle2 className="h-4 w-4 mr-2" /> Aprovar plano
              </Button>
            )}
            <Select value={camp.status} onValueChange={updateStatus}>
              <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_LABEL).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </>
        }
      />

      <PageContainer>
        <button type="button" onClick={goBack} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
        </button>

        {/* Resumo */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Kpi label="Meta" value={camp.goal_plays.toLocaleString()} />
          <Kpi label="Entregue" value={camp.total_delivered.toLocaleString()} hint={`${pct}%`} />
          <Kpi label="Alocado" value={camp.total_allocated.toLocaleString()} />
          <Kpi label="Prazo" value={camp.deadline} hint={daysLeft > 0 ? `${daysLeft}d restantes` : daysLeft === 0 ? "Hoje" : `${Math.abs(daysLeft)}d atraso`} />
        </div>

        {/* Tipo + aprovação do plano */}
        <div className="mb-8 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border border-border bg-card px-2.5 py-1 font-medium text-foreground">
            Tipo: {CAMPAIGN_TYPE_LABEL[camp.campaign_type ?? "hybrid"]}
          </span>
          {camp.plan_approved_at ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 font-medium text-primary">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Plano aprovado em {new Date(camp.plan_approved_at).toLocaleDateString("pt-BR")}
              {camp.auto_deal_created && camp.deal_id && (
                <Link to={`/playlist-deals/${camp.deal_id}`} className="ml-1 underline">deal vinculado</Link>
              )}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/30 px-2.5 py-1 font-medium text-muted-foreground">
              <Clock className="h-3.5 w-3.5" /> Plano pendente de aprovação
            </span>
          )}
        </div>

        {/* Aprovação do cliente + link compartilhável */}
        <ClientApprovalCard camp={camp} />

        {/* Mapa de Entrega público — link separado, sem login (Notion-style) */}
        <RoadmapShareCard camp={camp} onTokenRotated={(t) => setCamp((c) => c ? { ...c, roadmap_token: t } : c)} />

        {/* Relatório de fechamento (lazy quando completed) */}
        <CampaignClosureReportCard
          campaignId={camp.id}
          status={camp.status}
          finalReportUrl={camp.final_report_url}
          finalReportRequestedAt={camp.final_report_requested_at}
          onGenerated={(url) => setCamp((c) => (c ? { ...c, final_report_url: url } : c))}
        />




        {/* Barra de progresso */}
        <div className="mb-8 rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-muted-foreground">Progresso geral</span>
            <span className="font-semibold tabular-nums">{pct}%</span>
          </div>
          <div className="h-3 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* Lista de playlists removida na Fase 2.A.2 — campaign_allocations aposentada.
            A listagem operacional vive em /campanhas/:id/execucao (CampanhaExecucao),
            consumindo campaign_eco_allocations + Growth Engine. */}

        {camp.notes && (
          <div className="mt-8 rounded-2xl border border-border bg-card p-5">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Notas</div>
            <p className="text-sm whitespace-pre-wrap">{camp.notes}</p>
          </div>
        )}
      </PageContainer>
    </>
  );
}

// Kpi consolidado em @/components/ui/kpi


function ClientApprovalCard({ camp }: { camp: Campaign }) {
  const token = camp.public_plan_token;
  const url = token ? `${PUBLIC_DOMAIN}/p/plano/${token}` : null;
  const isApproved = !!camp.client_approved_at;
  const isRejected = !!camp.client_rejected_at && !isApproved;

  async function copyLink() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copiado", description: "Cole no WhatsApp ou e-mail pro cliente." });
    } catch {
      toast({ title: "Não consegui copiar", description: url, variant: "destructive" });
    }
  }

  return (
    <div className="mb-8 rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          {isApproved ? (
            <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
          ) : isRejected ? (
            <MessageSquareWarning className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
          ) : (
            <Clock className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
          )}
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              Aprovação do cliente
              {(camp.client_decision_round ?? 1) > 1 && (
                <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">
                  Rodada {camp.client_decision_round}
                </span>
              )}
            </div>
            {isApproved ? (
              <>
                <div className="font-semibold mt-1">Aprovada por {camp.client_approved_by}</div>
                <div className="text-xs text-muted-foreground">em {new Date(camp.client_approved_at!).toLocaleString("pt-BR")}</div>
              </>
            ) : isRejected ? (
              <>
                <div className="font-semibold mt-1">Cliente pediu ajuste</div>
                <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap max-w-xl">{camp.client_adjustment_request}</p>
                <div className="text-xs text-muted-foreground mt-1">em {new Date(camp.client_rejected_at!).toLocaleString("pt-BR")}</div>
              </>
            ) : (
              <>
                <div className="font-semibold mt-1">Aguardando cliente</div>
                <div className="text-xs text-muted-foreground">Envie o link abaixo. A aprovação interna fica bloqueada até o cliente confirmar.</div>
              </>
            )}
          </div>
        </div>
        {url && (
          <div className="flex items-center gap-2 w-full md:w-auto">
            <code className="text-xs bg-muted px-2 py-1.5 rounded truncate max-w-xs flex-1">{url}</code>
            <Button size="sm" variant="outline" onClick={copyLink}>
              <Copy className="h-3.5 w-3.5 mr-1.5" /> Copiar
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function RoadmapShareCard({
  camp,
  onTokenRotated,
}: {
  camp: Campaign;
  onTokenRotated: (newToken: string) => void;
}) {
  const [rotating, setRotating] = useState(false);
  const token = camp.roadmap_token;
  const url = token ? `${PUBLIC_DOMAIN}/mapa/${token}` : null;

  async function copyLink() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast({
        title: "Link do mapa copiado",
        description: "Quem abrir vê só o cronograma e o plano — sem login.",
      });
    } catch {
      toast({ title: "Não consegui copiar", description: url, variant: "destructive" });
    }
  }

  async function rotate() {
    if (!camp.id) return;
    if (!confirm("Regerar o link do Mapa? O link atual deixa de funcionar imediatamente. Isso não afeta o portal do cliente.")) return;
    setRotating(true);
    const { data, error } = await supabase.functions.invoke("regenerate-campaign-roadmap-token", {
      body: { campaign_id: camp.id },
    });
    setRotating(false);
    const payload = data as { ok?: boolean; roadmap_token?: string; error?: string } | null;
    if (error || !payload?.ok || !payload?.roadmap_token) {
      toast({
        title: "Falha ao regenerar",
        description: payload?.error ?? error?.message ?? "tente novamente",
        variant: "destructive",
      });
      return;
    }
    onTokenRotated(payload.roadmap_token);
    toast({ title: "Link regenerado", description: "O link anterior foi invalidado." });
  }

  return (
    <div className="mb-8 rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <Target className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Mapa de Entrega · link público
            </div>
            <div className="font-semibold mt-1">Compartilhe com gestor, equipe ou parceiros</div>
            <div className="text-xs text-muted-foreground mt-1 max-w-xl">
              Acesso direto, sem login nem código. Mostra só cronograma, plano e evolução —
              não expõe financeiro, contratos, aprovações ou dados do cliente.
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 w-full md:w-auto">
          {url ? (
            <>
              <code className="text-xs bg-muted px-2 py-1.5 rounded truncate max-w-xs flex-1">{url}</code>
              <Button size="sm" variant="outline" onClick={copyLink}>
                <Copy className="h-3.5 w-3.5 mr-1.5" /> Copiar
              </Button>
              <Button size="sm" variant="ghost" onClick={rotate} disabled={rotating} title="Invalida o link atual e gera um novo">
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${rotating ? "animate-spin" : ""}`} /> Regerar
              </Button>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">Token ainda não disponível</span>
          )}
        </div>
      </div>
    </div>
  );
}
