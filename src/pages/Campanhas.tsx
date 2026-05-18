import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDot } from "@/components/ui/status-dot";
import { Plus, RefreshCw, Target, ListChecks, Calculator, Megaphone, CheckCircle2, Percent, MoreHorizontal, Pause, Play, Archive, Trash2 } from "lucide-react";
import { NewCampaignDialog } from "@/components/campanhas/NewCampaignDialog";
import { toast } from "@/hooks/use-toast";
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

type Campaign = {
  id: string;
  track_name: string;
  artist: string | null;
  goal_plays: number;
  deadline: string;
  status: "draft" | "active" | "paused" | "completed" | "cancelled";
  total_allocated: number;
  total_delivered: number;
  created_at: string;
  snapshot_locked_at: string | null;
};

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

export default function Campanhas() {
  const [items, setItems] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "active" | "draft" | "completed">("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [recalcing, setRecalcing] = useState(false);
  const [tab, setTab] = useState<"lista" | "financeiro">("financeiro");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("campaigns")
      .select("id, track_name, artist, goal_plays, deadline, status, total_allocated, total_delivered, created_at, snapshot_locked_at")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast({ title: "Erro ao carregar campanhas", description: error.message, variant: "destructive" });
      return;
    }
    setItems((data ?? []) as Campaign[]);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(
    () => filter === "all" ? items : items.filter(i => i.status === filter),
    [items, filter]
  );

  const kpis = useMemo(() => {
    const active = items.filter(i => i.status === "active");
    const goal = active.reduce((s, i) => s + Number(i.goal_plays || 0), 0);
    const delivered = active.reduce((s, i) => s + Number(i.total_delivered || 0), 0);
    const allocated = active.reduce((s, i) => s + Number(i.total_allocated || 0), 0);
    const pct = goal > 0 ? Math.round((delivered / goal) * 100) : 0;
    return { activeCount: active.length, goal, delivered, allocated, pct };
  }, [items]);

  async function recalcAll() {
    setRecalcing(true);
    const { error } = await (supabase.rpc as any)("recalc_campaign_progress", { p_campaign_id: null });
    setRecalcing(false);
    if (error) toast({ title: "Erro no recálculo", description: error.message, variant: "destructive" });
    else { toast({ title: "Progresso recalculado" }); load(); }
  }

  return (
    <>
      <PageHeader
        kicker="Operação"
        icon={Target}
        title="Campanhas"
        subtitle="Planejar metas de plays e distribuir entre playlists próprias"
        actions={
          tab === "lista" ? (
            <>
              <Button variant="outline" onClick={recalcAll} disabled={recalcing}>
                <RefreshCw className={`h-4 w-4 mr-2 ${recalcing ? "animate-spin" : ""}`} />
                Recalcular
              </Button>
              <Button onClick={() => setDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" /> Nova campanha
              </Button>
            </>
          ) : null
        }
      />

      <PageContainer>
        {/* KPIs — padrão Comunidade/Operação (sempre acima das tabs) */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <KpiBig
            icon={Megaphone}
            label="Ativas"
            value={kpis.activeCount.toLocaleString("pt-BR")}
            tone="success"
            hint="Em execução agora"
            loading={loading}
          />
          <KpiBig
            icon={Target}
            label="Meta total"
            value={kpis.goal.toLocaleString("pt-BR")}
            hint="Plays planejados"
            loading={loading}
          />
          <KpiBig
            icon={CheckCircle2}
            label="Entregue"
            value={kpis.delivered.toLocaleString("pt-BR")}
            tone="primary"
            hint="Plays já contabilizados"
            loading={loading}
          />
          <KpiBig
            icon={Percent}
            label="Cumprimento médio"
            value={`${kpis.pct}%`}
            hint="Entregue ÷ meta"
            loading={loading}
          />
        </section>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-border mb-6">
          {([
            { id: "financeiro", label: "Planejamento Financeiro", icon: Calculator },
            { id: "lista", label: "Campanhas Ativas", icon: ListChecks },
          ] as const).map(t => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "px-4 h-10 inline-flex items-center gap-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        {tab === "lista" && (
          <>
            {/* Filtros */}
            <div className="flex flex-wrap gap-2 mb-4">
              {(["all", "active", "draft", "completed"] as const).map(f => (
                <Button
                  key={f}
                  variant={filter === f ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilter(f)}
                >
                  {f === "all" ? "Todas" : STATUS_LABEL[f]}
                </Button>
              ))}
            </div>

            {/* Lista */}
            {loading ? (
              <div className="grid gap-3">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="border border-border rounded-2xl p-12 text-center text-muted-foreground">
                Nenhuma campanha {filter !== "all" ? STATUS_LABEL[filter].toLowerCase() : ""} ainda. Crie a primeira.
              </div>
            ) : (
              <div className="grid gap-3">
                {filtered.map(c => <CampaignRow key={c.id} c={c} onChanged={load} />)}
              </div>
            )}
          </>
        )}

        {tab === "financeiro" && <Calculadora />}
      </PageContainer>

      <NewCampaignDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={() => load()}
      />
    </>
  );
}


function CampaignRow({ c }: { c: Campaign }) {
  const pct = c.goal_plays > 0 ? Math.min(100, Math.round((c.total_delivered / c.goal_plays) * 100)) : 0;
  const daysLeft = Math.ceil((new Date(c.deadline).getTime() - Date.now()) / 86400_000);
  const href = c.snapshot_locked_at ? `/campanhas/${c.id}/execucao` : `/campanhas/${c.id}`;
  return (
    <Link
      to={href}
      className="rounded-2xl border border-border bg-card hover:bg-accent/30 transition-colors p-5 flex flex-col md:flex-row md:items-center gap-4"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <StatusDot variant={STATUS_TONE[c.status]} />
          <span className="text-xs uppercase tracking-wider text-muted-foreground">{STATUS_LABEL[c.status]}</span>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground">
            {daysLeft > 0 ? `${daysLeft}d restantes` : daysLeft === 0 ? "Vence hoje" : `${Math.abs(daysLeft)}d em atraso`}
          </span>
        </div>
        <div className="font-semibold truncate">{c.track_name}</div>
        {c.artist && <div className="text-sm text-muted-foreground truncate">{c.artist}</div>}
      </div>
      <div className="flex items-center gap-6 md:gap-8 shrink-0">
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Meta</div>
          <div className="font-semibold tabular-nums">{c.goal_plays.toLocaleString()}</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Entregue</div>
          <div className="font-semibold tabular-nums">{c.total_delivered.toLocaleString()}</div>
        </div>
        <div className="w-32">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-muted-foreground">Progresso</span>
            <span className="tabular-nums font-medium">{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
    </Link>
  );
}
