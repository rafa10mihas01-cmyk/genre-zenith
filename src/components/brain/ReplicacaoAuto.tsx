// ReplicacaoAuto — painel de replicação automática (top N + distribuição em contas).
// Separado de Replicacao.tsx (que cuida de blueprints/templates manualmente).
// Aqui é one-click: "replicar top 5 agora" → executa fluxo completo via replicate-top.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2, Rocket, Users, Plus, ExternalLink, CheckCircle2, XCircle, Clock,
  Eye, AlertTriangle, RefreshCw, ChevronRight, Music2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatNumber, timeAgo } from "@/lib/format";

type Account = {
  id: string;
  spotify_user_id: string;
  display_name: string | null;
  email: string | null;
  status: string;
  max_playlists: number;
  current_playlists: number;
};

type Replication = {
  id: string;
  source_result_id: string | null;
  blueprint_id: string | null;
  template_id: string | null;
  account_id: string | null;
  spotify_playlist_id: string | null;
  spotify_url: string | null;
  selection_score: number;
  status: string;
  error_message: string | null;
  triggered_by: string;
  created_at: string;
  source_name?: string;
  account_name?: string;
};

const STATUS_META: Record<string, { label: string; cls: string; icon: any }> = {
  pending:    { label: "Pendente",   cls: "bg-muted/40 text-muted-foreground border-border", icon: Clock },
  generating: { label: "Gerando",    cls: "bg-warning/15 text-warning border-warning/30", icon: Loader2 },
  approved:   { label: "Aprovado",   cls: "bg-primary/15 text-primary border-primary/30", icon: CheckCircle2 },
  created:    { label: "Criado",     cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: CheckCircle2 },
  failed:     { label: "Falhou",     cls: "bg-destructive/15 text-destructive border-destructive/30", icon: XCircle },
  skipped:    { label: "Ignorado",   cls: "bg-muted/40 text-muted-foreground border-border", icon: XCircle },
};

export function ReplicacaoAuto({ genreId }: { genreId?: string }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [reps, setReps] = useState<Replication[]>([]);
  const [loading, setLoading] = useState(true);
  const [topN, setTopN] = useState(5);
  const [running, setRunning] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [plan, setPlan] = useState<any[] | null>(null);

  const load = async () => {
    if (!genreId) return;
    setLoading(true);
    const [accRes, repRes] = await Promise.all([
      supabase.from("accounts").select("*").order("current_playlists", { ascending: true }),
      supabase
        .from("replications")
        .select("*")
        .eq("genre_id", genreId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    const accs = (accRes.data ?? []) as Account[];
    let repsData = (repRes.data ?? []) as Replication[];
    // Resolve nomes (source playlist + account) com 2 lookups baratos
    const sourceIds = [...new Set(repsData.map(r => r.source_result_id).filter(Boolean))] as string[];
    const accountIds = [...new Set(repsData.map(r => r.account_id).filter(Boolean))] as string[];
    const [sourcesQ, accsQ] = await Promise.all([
      sourceIds.length ? supabase.from("search_results").select("id,nome_playlist").in("id", sourceIds) : Promise.resolve({ data: [] as any[] }),
      accountIds.length ? supabase.from("accounts").select("id,display_name,spotify_user_id").in("id", accountIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    const sourceMap = new Map((sourcesQ.data ?? []).map((s: any) => [s.id, s.nome_playlist]));
    const accMap = new Map((accsQ.data ?? []).map((a: any) => [a.id, a.display_name ?? a.spotify_user_id]));
    repsData = repsData.map(r => ({
      ...r,
      source_name: r.source_result_id ? (sourceMap.get(r.source_result_id) as string) : undefined,
      account_name: r.account_id ? (accMap.get(r.account_id) as string) : undefined,
    }));
    setAccounts(accs);
    setReps(repsData);
    setLoading(false);
  };

  useEffect(() => { load(); }, [genreId]);

  const runDryRun = async () => {
    if (!genreId || previewing) return;
    setPreviewing(true);
    setPlan(null);
    try {
      const { data, error } = await supabase.functions.invoke("replicate-top", {
        body: { genre_id: genreId, top_n: topN, dry_run: true },
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data?.error ?? "Falha");
      setPlan(data?.plan ?? []);
      toast.success(`${data?.plan?.length ?? 0} candidatas selecionadas`);
    } catch (e: any) {
      toast.error("Erro ao gerar prévia", { description: e?.message });
    } finally {
      setPreviewing(false);
    }
  };

  const runReplicate = async () => {
    if (!genreId || running) return;
    if (!confirm(`Replicar TOP ${topN} agora? Vai criar ${topN} playlists reais nas contas conectadas.`)) return;
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("replicate-top", {
        body: { genre_id: genreId, top_n: topN, triggered_by: "manual" },
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data?.error ?? "Falha");
      toast.success(`${data?.succeeded ?? 0}/${data?.executed ?? 0} replicadas`, {
        description: data?.failed ? `${data.failed} falhas — ver histórico` : "Sucesso total",
      });
      setPlan(null);
      await load();
    } catch (e: any) {
      toast.error("Erro na replicação", { description: e?.message });
    } finally {
      setRunning(false);
    }
  };

  const totalCapacity = accounts.reduce((s, a) => s + (a.status === "active" ? a.max_playlists - a.current_playlists : 0), 0);
  const activeAccs = accounts.filter(a => a.status === "active");

  if (loading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="nx-card h-32 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header + status */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-bold flex items-center gap-2">
            <Rocket className="h-4 w-4 text-primary" />
            Replicação automática
          </h3>
          <p className="text-xs text-muted-foreground">
            Seleciona top playlists por score, gera variações e distribui nas contas. One-click.
          </p>
        </div>
      </div>

      {/* KPIs operacionais */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Contas ativas" value={String(activeAccs.length)} hint={`${accounts.length} total`} />
        <Kpi label="Capacidade livre" value={String(totalCapacity)} hint="Slots pra novas playlists" tone="primary" />
        <Kpi label="Replicadas (todas)" value={String(reps.filter(r => r.status === "created").length)} hint="Total no histórico" />
        <Kpi label="Falhas pendentes" value={String(reps.filter(r => r.status === "failed").length)} hint="Precisam atenção" tone={reps.some(r => r.status === "failed") ? "destructive" : undefined} />
      </section>

      {/* Bloqueios óbvios */}
      {activeAccs.length === 0 && (
        <div className="nx-card border-warning/30 bg-warning/5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
            <div className="flex-1 text-sm">
              <p className="font-medium">Nenhuma conta Spotify ativa</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Vá em <strong>Configurações → Spotify</strong> e conecte pelo menos uma conta antes de replicar.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Painel de execução */}
      <div className="nx-card">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Top</label>
            <Input
              type="number"
              min={1}
              max={20}
              value={topN}
              onChange={(e) => setTopN(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              className="w-20 h-9"
            />
            <span className="text-xs text-muted-foreground">playlists do gênero</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={runDryRun}
              disabled={previewing || !genreId}
            >
              {previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
              Pré-visualizar
            </Button>
            <Button
              size="sm"
              onClick={runReplicate}
              disabled={running || activeAccs.length === 0 || !genreId}
            >
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
              Replicar agora
            </Button>
          </div>
        </div>

        {plan && plan.length > 0 && (
          <div className="mt-4 border-t border-border pt-4 space-y-2">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Plano gerado ({plan.length} replicações)</div>
            <div className="space-y-1.5">
              {plan.map((p, i) => (
                <div key={i} className="flex items-center gap-3 text-xs p-2 rounded-md bg-elevated border border-border">
                  <span className="text-muted-foreground font-mono w-5 text-right">#{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{p.candidate.nome}</div>
                    <div className="text-muted-foreground text-[11px]">
                      {formatNumber(p.candidate.seguidores)} seguidores · tier {p.candidate.tier} · score {formatNumber(p.candidate.score)}
                    </div>
                  </div>
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                  <div className="text-right min-w-0">
                    <div className="font-medium truncate">{p.blueprint.name}</div>
                    <div className="text-muted-foreground text-[11px]">blueprint {p.blueprint.tier}</div>
                  </div>
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                  <div className="text-right min-w-0">
                    <div className="inline-flex items-center gap-1 text-primary font-medium">
                      <Users className="h-3 w-3" /> {p.account.display_name ?? p.account.spotify_user_id}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Contas */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-bold flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" /> Contas conectadas
          </h4>
        </div>
        {accounts.length === 0 ? (
          <div className="nx-card text-center py-8 space-y-2">
            <Users className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Nenhuma conta Spotify conectada ainda.
            </p>
            <p className="text-xs text-muted-foreground">
              Conecte em Configurações → Spotify. As contas aparecem aqui automaticamente.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {accounts.map(a => <AccountCard key={a.id} a={a} onChange={load} />)}
          </div>
        )}
      </section>

      {/* Histórico */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-bold flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-primary" /> Histórico de replicações
          </h4>
          <Button variant="ghost" size="sm" onClick={load} className="h-7 text-xs">
            <RefreshCw className="h-3 w-3" /> Atualizar
          </Button>
        </div>
        {reps.length === 0 ? (
          <div className="nx-card text-center py-8">
            <p className="text-sm text-muted-foreground">Nenhuma replicação executada ainda.</p>
          </div>
        ) : (
          <div className="nx-card !p-0 overflow-hidden">
            <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground font-bold border-b border-border">
              <div className="col-span-4">Origem → Destino</div>
              <div className="col-span-2">Conta</div>
              <div className="col-span-1 text-right">Score</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2">Quando</div>
              <div className="col-span-1 text-right">Link</div>
            </div>
            {reps.map(r => <ReplicationRow key={r.id} r={r} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function Kpi({ label, value, hint, tone }: {
  label: string; value: string; hint?: string;
  tone?: "primary" | "destructive" | "warning";
}) {
  const cls =
    tone === "primary" ? "text-primary"
    : tone === "destructive" ? "text-destructive"
    : tone === "warning" ? "text-warning"
    : "text-foreground";
  return (
    <div className="nx-card">
      <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-bold">{label}</div>
      <div className={cn("text-2xl font-bold mt-2 tabular-nums", cls)}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}

function AccountCard({ a, onChange }: { a: Account; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [maxP, setMaxP] = useState(a.max_playlists);
  const [status, setStatus] = useState(a.status);

  const save = async () => {
    const { error } = await supabase
      .from("accounts")
      .update({ max_playlists: maxP, status })
      .eq("id", a.id);
    if (error) { toast.error("Erro", { description: error.message }); return; }
    toast.success("Conta atualizada");
    setEditing(false);
    onChange();
  };

  const usagePct = a.max_playlists > 0 ? (a.current_playlists / a.max_playlists) * 100 : 0;
  const statusCls =
    a.status === "active" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
    : a.status === "paused" ? "bg-warning/15 text-warning border-warning/30"
    : "bg-destructive/15 text-destructive border-destructive/30";

  return (
    <div className="nx-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold truncate">{a.display_name ?? a.spotify_user_id}</div>
          <div className="text-[11px] text-muted-foreground truncate">{a.email ?? a.spotify_user_id}</div>
        </div>
        <span className={cn("text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border", statusCls)}>
          {a.status}
        </span>
      </div>
      <div className="mt-3 space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Uso</span>
          <span className="font-mono tabular-nums">{a.current_playlists}/{a.max_playlists}</span>
        </div>
        <div className="h-1.5 bg-elevated rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", usagePct > 80 ? "bg-destructive" : "bg-primary")}
            style={{ width: `${Math.min(100, usagePct)}%` }}
          />
        </div>
      </div>
      {editing ? (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-muted-foreground w-16">Max</label>
            <Input type="number" value={maxP} onChange={(e) => setMaxP(Number(e.target.value))} className="h-7 text-xs" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-muted-foreground w-16">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="h-7 text-xs flex-1 rounded-md border border-border bg-background px-2"
            >
              <option value="active">active</option>
              <option value="paused">paused</option>
              <option value="limited">limited</option>
              <option value="banned">banned</option>
            </select>
          </div>
          <div className="flex items-center gap-1.5 justify-end">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} className="h-7 text-xs">Cancelar</Button>
            <Button size="sm" onClick={save} className="h-7 text-xs">Salvar</Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)} className="mt-3 h-7 text-xs w-full">
          Editar limites
        </Button>
      )}
    </div>
  );
}

function ReplicationRow({ r }: { r: Replication }) {
  const meta = STATUS_META[r.status] ?? STATUS_META.pending;
  const Icon = meta.icon;
  return (
    <div className="grid grid-cols-12 gap-2 px-4 py-2.5 items-center border-b border-border last:border-0 hover:bg-elevated/40 transition-colors text-sm">
      <div className="col-span-4 min-w-0">
        <div className="font-medium truncate">{r.source_name ?? "—"}</div>
        {r.error_message && (
          <div className="text-[11px] text-destructive truncate flex items-center gap-1">
            <AlertTriangle className="h-2.5 w-2.5" /> {r.error_message}
          </div>
        )}
      </div>
      <div className="col-span-2 truncate text-xs">{r.account_name ?? "—"}</div>
      <div className="col-span-1 text-right text-xs tabular-nums">{formatNumber(r.selection_score)}</div>
      <div className="col-span-2">
        <span className={cn("inline-flex items-center gap-1 text-[11px] uppercase font-bold px-2 py-0.5 rounded border", meta.cls)}>
          <Icon className={cn("h-3 w-3", r.status === "generating" && "animate-spin")} /> {meta.label}
        </span>
      </div>
      <div className="col-span-2 text-xs text-muted-foreground">
        {timeAgo(r.created_at)} · <span className="opacity-70">{r.triggered_by}</span>
      </div>
      <div className="col-span-1 text-right">
        {r.spotify_url && (
          <a href={r.spotify_url} target="_blank" rel="noreferrer"
             className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300 text-xs">
            <Music2 className="h-3 w-3" /> <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </div>
    </div>
  );
}
