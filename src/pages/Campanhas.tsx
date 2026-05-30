import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDot } from "@/components/ui/status-dot";
import { Plus, RefreshCw, Target, ListChecks, Calculator, Megaphone, CheckCircle2, Percent, MoreHorizontal, Pause, Play, Archive, Trash2, Handshake, Link2, Copy, Check, Clock, MessageSquareWarning, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { PUBLIC_DOMAIN } from "@/lib/curatorPublicUrl";
import { Calculadora } from "@/components/operacao/calculadora/Calculadora";
import { KpiBig } from "@/components/KpiBig";
import { cn } from "@/lib/utils";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useCampaigns, type Campaign } from "@/hooks/useCampaigns";
import { CollectionSourceBadge } from "@/components/campanhas/CollectionSourceBadge";


const STATUS_TONE: Record<string, "success" | "warning" | "neutral" | "danger"> = {
  active: "success",
  draft: "neutral",
  paused: "warning",
  completed: "neutral",
  cancelled: "danger",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Ativa", draft: "Rascunho", paused: "Pausada", completed: "Concluída", cancelled: "Cancelada",
};

/**
 * Status efetivo (display-only) — corrige duas distorções do banco:
 *  1) NewCampaignDialog grava status='active' direto pelo toggle do form, antes dos portões.
 *     Enquanto plan_approved_at for null, a campanha ainda é rascunho operacional.
 *  2) Nenhum job fecha a campanha quando total_delivered >= goal_plays.
 *     Tratamos como Concluída pra não poluir a aba Ativas.
 * Não muta o banco — apenas como filtramos/rotulamos.
 */
function effectiveStatus(c: { status: string; total_delivered: number | null; goal_plays: number | null; client_approved_at: string | null; plan_approved_at: string | null; }): string {
  if (c.status === "cancelled" || c.status === "paused" || c.status === "completed") return c.status;
  const delivered = Number(c.total_delivered || 0);
  const goal = Number(c.goal_plays || 0);
  if (goal > 0 && delivered >= goal) return "completed";
  // Ainda em rascunho enquanto os portões internos não fecharam.
  if (!c.client_approved_at || !c.plan_approved_at) return "draft";
  return "active";
}

type PipelineFilter =
  | "all"
  | "awaiting_client"
  | "awaiting_internal"
  | "awaiting_baseline"
  | "running"
  | "completed";

const PIPELINE_LABEL: Record<PipelineFilter, string> = {
  all: "Todas",
  awaiting_client: "Aguardando cliente",
  awaiting_internal: "Aguardando você",
  awaiting_baseline: "Aguardando baseline",
  running: "Rodando",
  completed: "Concluída",
};

function pipelineStage(c: import("@/hooks/useCampaigns").Campaign): PipelineFilter {
  const eff = effectiveStatus(c);
  if (eff === "completed" || eff === "cancelled") return "completed";
  if (!c.client_approved_at) return "awaiting_client";
  if (!c.plan_approved_at) return "awaiting_internal";
  if (c.baseline_pending) return "awaiting_baseline";
  return "running";
}

export default function Campanhas() {
  const navigate = useNavigate();
  const { items, loading, recalcAll } = useCampaigns();
  const [filter, setFilter] = useState<PipelineFilter>("all");
  const [tab, setTab] = useState<"lista" | "financeiro">("financeiro");

  const filtered = useMemo(
    () => filter === "all" ? items : items.filter(i => pipelineStage(i) === filter),
    [items, filter]
  );

  const stageCounts = useMemo(() => {
    const counts: Record<PipelineFilter, number> = {
      all: items.length,
      awaiting_client: 0,
      awaiting_internal: 0,
      awaiting_baseline: 0,
      running: 0,
      completed: 0,
    };
    for (const c of items) counts[pipelineStage(c)]++;
    return counts;
  }, [items]);

  const kpis = useMemo(() => {
    const active = items.filter(i => effectiveStatus(i) === "active");
    const goal = active.reduce((s, i) => s + Number(i.goal_plays || 0), 0);
    const delivered = active.reduce((s, i) => s + Number(i.total_delivered || 0), 0);
    const allocated = active.reduce((s, i) => s + Number(i.total_allocated || 0), 0);
    const pct = goal > 0 ? Math.round((delivered / goal) * 100) : 0;
    return { activeCount: active.length, goal, delivered, allocated, pct };
  }, [items]);

  async function doRecalcAll() {
    try {
      await recalcAll.mutateAsync();
      toast({ title: "Recalculado" });
    } catch (e) {
      toast({ title: "Erro no recálculo", description: (e as Error).message, variant: "destructive" });
    }
  }



  return (
    <>
      <PageHeader
        kicker="Operação"
        icon={Target}
        title="Campanhas"
        subtitle="Metas e distribuição"
        domain="campaigns"
        manualKey="campanhas"

        actions={
          tab === "lista" ? (
            <Button variant="outline" onClick={doRecalcAll} disabled={recalcAll.isPending}>
              <RefreshCw className={`h-4 w-4 mr-2 ${recalcAll.isPending ? "animate-spin" : ""}`} />
              Recalcular
            </Button>
          ) : undefined
        }



      />

      <PageContainer>
        {/* KPIs globais — sempre visíveis pra manter padrão entre abas */}
        <section className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <KpiBig
            tier="hero"
            icon={Target}
            label="Meta total"
            value={kpis.goal.toLocaleString("pt-BR")}
            hint="Plays planejados"
            domain="campaigns"
            loading={loading}
          />
          <KpiBig
            icon={Megaphone}
            label="Ativas"
            value={kpis.activeCount.toLocaleString("pt-BR")}
            hint="Em execução agora"
            domain="campaigns"
            loading={loading}
          />
          <KpiBig
            icon={CheckCircle2}
            label="Entregue"
            value={kpis.delivered.toLocaleString("pt-BR")}
            hint="Plays já contabilizados"
            domain="deals"
            loading={loading}
          />
          <KpiBig
            tier="quiet"
            icon={Percent}
            label="Cumprimento"
            value={`${kpis.pct}%`}
            hint="Entregue ÷ meta"
            domain="playlists"
            loading={loading}
          />

        </section>


        <div className="flex items-center gap-1 border-b border-border mb-6 overflow-x-auto overflow-y-hidden scrollbar-none -mx-4 px-4 lg:mx-0 lg:px-0 overscroll-x-contain overscroll-y-none touch-pan-x [-webkit-overflow-scrolling:auto]">
          {([
            { id: "financeiro", label: "Planejamento", labelLong: "Planejamento", icon: Calculator },
            { id: "lista", label: "Aprovação", labelLong: "Aprovação", icon: ListChecks },
            { id: "deals", label: "Negociações", labelLong: "Negociações", icon: Handshake },
          ] as const).map(t => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => {
                  if (t.id === "deals") navigate("/playlist-deals");
                  else setTab(t.id as "lista" | "financeiro");
                }}
                className={cn(
                  "px-3 lg:px-4 h-10 inline-flex items-center gap-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap shrink-0",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="lg:hidden">{t.label}</span>
                <span className="hidden lg:inline">{t.labelLong}</span>
              </button>
            );
          })}
        </div>

        {tab === "lista" && (
          <>
            {/* Filtros */}
            <div className="flex flex-wrap gap-2 mb-4">
              {(["all", "awaiting_client", "awaiting_internal", "awaiting_baseline", "running", "completed"] as const).map(f => {
                const count = stageCounts[f];
                return (
                  <Button
                    key={f}
                    variant={filter === f ? "default" : "outline"}
                    size="sm"
                    onClick={() => setFilter(f)}
                    disabled={f !== "all" && count === 0}
                  >
                    {PIPELINE_LABEL[f]}
                    <span className="ml-1.5 text-xs opacity-60 tabular-nums">{count}</span>
                  </Button>
                );
              })}
            </div>

            {/* Lista */}
            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-56 rounded-2xl" />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="border border-border rounded-2xl p-12 text-center text-muted-foreground">
                Sem campanhas {filter !== "all" ? PIPELINE_LABEL[filter].toLowerCase() : ""}.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {filtered.map(c => <CampaignRow key={c.id} c={c} />)}
              </div>
            )}
          </>

        )}

        {tab === "financeiro" && <Calculadora />}
      </PageContainer>
    </>
  );
}



function CampaignRow({ c }: { c: Campaign }) {
  const { updateStatus, removeCampaign, approve } = useCampaigns();
  const pct = c.goal_plays > 0 ? Math.min(100, Math.round((c.total_delivered / c.goal_plays) * 100)) : 0;
  const daysLeft = Math.ceil((new Date(c.deadline).getTime() - Date.now()) / 86400_000);
  const href = c.snapshot_locked_at ? `/campanhas/${c.id}/execucao` : `/campanhas/${c.id}`;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);
  const busy = updateStatus.isPending || removeCampaign.isPending || approve.isPending;

  const clientUrl = c.public_plan_token
    ? `${PUBLIC_DOMAIN}/p/plano/${c.public_plan_token}`
    : null;
  const clientApproved = !!c.client_approved_at;
  const clientPendingAdjust = !!c.client_rejected_at && !clientApproved;

  async function copyClientLink(e?: React.MouseEvent) {
    e?.preventDefault();
    e?.stopPropagation();
    if (!clientUrl) return;
    try {
      await navigator.clipboard.writeText(clientUrl);
      setCopied(true);
      toast({ title: "Link do cliente copiado", description: "Cole no WhatsApp ou e-mail." });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Não consegui copiar", description: clientUrl, variant: "destructive" });
    }
  }

  async function doUpdateStatus(status: Campaign["status"], label: string) {
    try {
      await updateStatus.mutateAsync({ id: c.id, status });
      toast({ title: label });
    } catch (e) {
      toast({ title: "Erro", description: (e as Error).message, variant: "destructive" });
    }
  }

  async function approveCampaign() {
    if (!c.curator_id) {
      toast({ title: "Sem curador", description: "Edite a campanha e selecione o curador dono das playlists.", variant: "destructive" });
      return;
    }
    try {
      const data = await approve.mutateAsync(c.id);
      toast({ title: "Campanha aprovada", description: "Deal real criado e enviado para a fila de coleta." });
      return data;
    } catch (e) {
      const raw = (e as Error).message ?? "";
      const map: Record<string, { title: string; description: string }> = {
        client_approval_required: {
          title: "Aguardando aprovação do cliente",
          description: "Copie o link público do plano e mande pro cliente. Quando ele aprovar, este botão libera.",
        },
        curator_required: {
          title: "Sem curador",
          description: "Edite a campanha e selecione o curador dono das playlists.",
        },
        campaign_not_in_approvable_state: {
          title: "Campanha já aprovada",
          description: "Esta campanha não está em rascunho — não precisa aprovar de novo.",
        },
        campaign_not_found: {
          title: "Campanha não encontrada",
          description: "Talvez tenha sido excluída. Recarregue a página.",
        },
      };
      const key = Object.keys(map).find((k) => raw.includes(k));
      const t = key ? map[key] : { title: "Erro ao aprovar", description: raw };
      toast({ title: t.title, description: t.description, variant: "destructive" });
    }
  }

  async function doDelete() {
    try {
      await removeCampaign.mutateAsync(c.id);
      toast({ title: "Campanha excluída" });
    } catch (e) {
      toast({ title: "Erro ao excluir", description: (e as Error).message, variant: "destructive" });
    } finally {
      setConfirmDelete(false);
    }
  }


  const isDraftReady = c.status === "draft" && !!c.curator_id;

  const stop = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); };

  return (
    <div className="relative">
      <Link
        to={href}
        className="rounded-2xl border border-border border-l-2 border-l-domain-campaigns/60 bg-card hover:bg-accent/30 hover:border-l-domain-campaigns transition-colors p-5 flex flex-col gap-4 h-full"
      >
        <div className="min-w-0 pr-8">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {(() => {
              const eff = effectiveStatus(c as any);
              return (
                <>
                  <StatusDot variant={STATUS_TONE[eff]} />
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">{STATUS_LABEL[eff]}</span>
                </>
              );
            })()}
            <CollectionSourceBadge collectionMode={(c as any).collection_mode} />
            {c.plan_approved_at && !c.baseline_pending && c.baseline_captured_at && (
              <span className="text-[10px] uppercase tracking-wider rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-primary">
                Baseline ok
              </span>
            )}
            {c.plan_approved_at && c.baseline_pending && (
              <span className="text-[10px] uppercase tracking-wider rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-amber-500">
                Aguardando baseline
              </span>
            )}
            {c.plan_approved_at && !c.baseline_pending && !c.baseline_captured_at && (
              <span className="text-[10px] uppercase tracking-wider rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-primary">
                Plano aprovado
              </span>
            )}
            {(c.client_decision_round ?? 1) > 1 && (
              <span className="text-[10px] uppercase tracking-wider rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-amber-500">
                Rodada {c.client_decision_round}
              </span>
            )}
          </div>
          <div className="font-semibold truncate">{c.track_name}</div>
          {c.artist && <div className="text-sm text-muted-foreground truncate">{c.artist}</div>}
          <div className="text-xs text-muted-foreground mt-1">
            {daysLeft > 0 ? `${daysLeft}d restantes` : daysLeft === 0 ? "Vence hoje" : `${Math.abs(daysLeft)}d em atraso`}
          </div>
        </div>
        <div className="mt-auto space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-muted-foreground">Meta</div>
              <div className="font-semibold tabular-nums">{c.goal_plays.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Entregue</div>
              <div className="font-semibold tabular-nums">{c.total_delivered.toLocaleString()}</div>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-muted-foreground">Progresso</span>
              <span className="tabular-nums font-medium">{pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
            </div>
          </div>

          {/* Aprovação do cliente — visível em rascunho e ativa */}
          {clientUrl && (c.status === "draft" || c.status === "active") && (
            <div
              className={cn(
                "rounded-lg border px-2.5 py-2 flex items-center justify-between gap-2",
                clientApproved
                  ? "border-primary/30 bg-primary/5"
                  : clientPendingAdjust
                    ? "border-amber-500/30 bg-amber-500/5"
                    : "border-border/60 bg-muted/20",
              )}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                {clientApproved ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                ) : clientPendingAdjust ? (
                  <MessageSquareWarning className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                ) : (
                  <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                )}
                <span className="text-[11px] truncate">
                  {clientApproved
                    ? `Aprovado por ${c.client_approved_by ?? "cliente"}`
                    : clientPendingAdjust
                      ? "Cliente pediu ajuste"
                      : "Aguardando cliente"}
                </span>
              </div>
              <button
                type="button"
                onClick={copyClientLink}
                className="shrink-0 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                title="Copiar link de aprovação do cliente"
              >
                {copied ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
                {copied ? "Copiado" : "Copiar link"}
              </button>
            </div>
          )}
        </div>
      </Link>

      <div className="absolute top-3 right-3" onClick={stop}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              disabled={busy}
              onClick={stop}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={stop}>
            {clientUrl && (
              <>
                <DropdownMenuItem onSelect={() => copyClientLink()}>
                  <Link2 className="h-4 w-4 mr-2" /> Copiar link do cliente
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {isDraftReady && (
              <>
                <DropdownMenuItem onSelect={() => approveCampaign()}>
                  <CheckCircle2 className="h-4 w-4 mr-2 text-primary" /> Aprovar e disparar
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {c.status === "paused" ? (
              <DropdownMenuItem onSelect={() => doUpdateStatus("active", "Campanha retomada")}>
                <Play className="h-4 w-4 mr-2" /> Retomar
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                disabled={c.status === "completed" || c.status === "cancelled" || c.status === "draft"}
                onSelect={() => doUpdateStatus("paused", "Campanha pausada")}
              >
                <Pause className="h-4 w-4 mr-2" /> Pausar
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              disabled={c.status === "cancelled"}
              onSelect={() => doUpdateStatus("cancelled", "Campanha arquivada")}
            >
              <Archive className="h-4 w-4 mr-2" /> Arquivar
            </DropdownMenuItem>

            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" /> Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          {(() => {
            const blocked = c.status === "active" || (c.total_delivered ?? 0) > 0;
            return blocked ? (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle>Não é possível excluir</AlertDialogTitle>
                  <AlertDialogDescription>
                    Campanhas ativas ou com entrega registrada não podem ser excluídas. Use <strong>Arquivar</strong> para encerrar a campanha sem perder o histórico.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={busy}>Fechar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => { e.preventDefault(); setConfirmDelete(false); doUpdateStatus("cancelled", "Campanha arquivada"); }}
                    disabled={busy || c.status === "cancelled"}
                  >
                    Arquivar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </>
            ) : (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle>Excluir campanha "{c.track_name}"?</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-2">
                      <p>Esta ação apagará permanentemente:</p>
                      <ul className="list-disc pl-5 text-[13px] space-y-1">
                        <li>O deal vinculado a esta campanha</li>
                        <li>Todas as playlists do curador deste deal</li>
                        <li>Prints coletados e snapshots</li>
                        <li>Provas de entrega</li>
                        <li>Pagamentos registrados</li>
                      </ul>
                      <p className="font-medium text-destructive pt-1">Esta ação não pode ser desfeita.</p>
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={doDelete}
                    disabled={busy}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Excluir tudo
                  </AlertDialogAction>
                </AlertDialogFooter>
              </>
            );
          })()}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
