import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDot } from "@/components/ui/status-dot";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, RefreshCw, Target, Trash2, Copy, CheckCircle2, MessageSquareWarning, Clock } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { PUBLIC_DOMAIN } from "@/lib/curatorPublicUrl";

type Campaign = {
  id: string; track_name: string; artist: string | null;
  goal_plays: number; deadline: string; started_at: string;
  status: "draft" | "active" | "paused" | "completed" | "cancelled";
  total_allocated: number; total_delivered: number; notes: string | null;
  public_plan_token: string | null;
  client_approved_at: string | null;
  client_approved_by: string | null;
  client_rejected_at: string | null;
  client_adjustment_request: string | null;
};

type Allocation = {
  id: string;
  playlist_id: string;
  target_plays: number;
  delivered_plays: number;
  status: string;
  position: number;
  playlists?: { name: string; followers: number | null; cover_url: string | null } | null;
};

const STATUS_LABEL: Record<string, string> = {
  active: "Ativa", draft: "Rascunho", paused: "Pausada", completed: "Concluída", cancelled: "Cancelada",
};

export default function CampanhaDetalhe() {
  const { id } = useParams<{ id: string }>();
  const [camp, setCamp] = useState<Campaign | null>(null);
  const [allocs, setAllocs] = useState<Allocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [c, a] = await Promise.all([
      supabase.from("campaigns").select("*").eq("id", id).maybeSingle(),
      supabase.from("campaign_allocations")
        .select("id, playlist_id, target_plays, delivered_plays, status, position, playlists(name, followers, cover_url)")
        .eq("campaign_id", id)
        .order("position"),
    ]);
    setLoading(false);
    if (c.error) toast({ title: "Erro", description: c.error.message, variant: "destructive" });
    setCamp((c.data as any) ?? null);
    setAllocs((a.data as any) ?? []);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function recalc() {
    if (!id) return;
    setBusy(true);
    const { error } = await (supabase.rpc as any)("recalc_campaign_progress", { p_campaign_id: id });
    setBusy(false);
    if (error) toast({ title: "Erro", description: error.message, variant: "destructive" });
    else { toast({ title: "Atualizado" }); load(); }
  }

  async function updateStatus(newStatus: string) {
    if (!id) return;
    const { error } = await supabase.from("campaigns").update({ status: newStatus }).eq("id", id);
    if (error) toast({ title: "Erro", description: error.message, variant: "destructive" });
    else load();
  }

  async function removeAlloc(allocId: string) {
    if (!confirm("Remover esta playlist da campanha?")) return;
    const { error } = await supabase.from("campaign_allocations").delete().eq("id", allocId);
    if (error) toast({ title: "Erro", description: error.message, variant: "destructive" });
    else load();
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
          <Link to="/campanhas" className="text-primary"><ArrowLeft className="inline h-4 w-4 mr-1" /> Voltar</Link>
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
            <Button variant="outline" onClick={recalc} disabled={busy}>
              <RefreshCw className={`h-4 w-4 mr-2 ${busy ? "animate-spin" : ""}`} /> Recalcular
            </Button>
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
        <Link to="/campanhas" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft className="h-4 w-4 mr-1" /> Todas as campanhas
        </Link>

        {/* Resumo */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Kpi label="Meta" value={camp.goal_plays.toLocaleString()} />
          <Kpi label="Entregue" value={camp.total_delivered.toLocaleString()} sub={`${pct}%`} />
          <Kpi label="Alocado" value={camp.total_allocated.toLocaleString()} />
          <Kpi label="Prazo" value={camp.deadline} sub={daysLeft > 0 ? `${daysLeft}d restantes` : daysLeft === 0 ? "Hoje" : `${Math.abs(daysLeft)}d atraso`} />
        </div>

        {/* Aprovação do cliente + link compartilhável */}
        <ClientApprovalCard camp={camp} />



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

        {/* Allocations */}
        <h2 className="text-lg font-semibold mb-3">Playlists ({allocs.length})</h2>
        <div className="border border-border rounded-2xl overflow-hidden bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left">Playlist</th>
                <th className="px-4 py-3 text-right">Meta</th>
                <th className="px-4 py-3 text-right">Entregue</th>
                <th className="px-4 py-3 text-right">%</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {allocs.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Sem playlists alocadas.</td></tr>
              ) : allocs.map(a => {
                const ap = a.target_plays > 0 ? Math.min(100, Math.round((a.delivered_plays / a.target_plays) * 100)) : 0;
                return (
                  <tr key={a.id} className="border-t border-border">
                    <td className="px-4 py-3">
                      <div className="font-medium truncate max-w-[280px]">{a.playlists?.name ?? a.playlist_id.slice(0, 8)}</div>
                      <div className="text-xs text-muted-foreground">{(a.playlists?.followers ?? 0).toLocaleString()} seguidores</div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{a.target_plays.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{a.delivered_plays.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{ap}%</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <StatusDot variant={a.status === "active" || a.status === "approved" ? "success" : a.status === "paused" ? "warning" : "neutral"} />
                        <span className="text-xs">{a.status}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button size="icon" variant="ghost" onClick={() => removeAlloc(a.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

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

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

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
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Aprovação do cliente</div>
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
