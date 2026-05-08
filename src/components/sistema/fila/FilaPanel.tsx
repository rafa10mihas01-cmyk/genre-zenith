// FilaPanel — visão operacional da fila de jobs.
import { useMemo, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Clock, Loader2, RotateCcw, Layers, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { KpiBig } from "@/components/KpiBig";
import { formatNumber } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { useJobsQueue, type Job, type JobStatus } from "@/hooks/useJobsQueue";
import { SchedulerCard } from "./SchedulerCard";
import { cn } from "@/lib/utils";

const STATUS_META: Record<JobStatus, { label: string; tone: string; icon: typeof Clock }> = {
  pending:    { label: "Pendente",    tone: "text-muted-foreground", icon: Clock },
  retry:      { label: "Retry",       tone: "text-amber-400",        icon: RotateCcw },
  processing: { label: "Processando", tone: "text-primary",          icon: Loader2 },
  completed:  { label: "Concluído",   tone: "text-emerald-400",      icon: CheckCircle2 },
  failed:     { label: "Falhou",      tone: "text-rose-400",         icon: XCircle },
  cancelled:  { label: "Cancelado",   tone: "text-muted-foreground", icon: XCircle },
};

function fmtAgo(iso: string | null): string {
  if (!iso) return "—";
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return `${sec}s atrás`;
  if (sec < 3600) return `${Math.floor(sec / 60)}min atrás`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h atrás`;
  return `${Math.floor(sec / 86400)}d atrás`;
}

function fmtDuration(ms: number | null): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}min`;
}

export function FilaPanel() {
  const { jobs, loading, reload, stats } = useJobsQueue({ limit: 300 });
  const [filterStatus, setFilterStatus] = useState<JobStatus | "all">("all");
  const [filterType, setFilterType]     = useState<string>("all");
  const [search, setSearch]             = useState("");
  const [busyId, setBusyId]             = useState<string | null>(null);

  const types = useMemo(() => {
    const s = new Set<string>();
    jobs.forEach((j) => s.add(j.job_type));
    return Array.from(s).sort();
  }, [jobs]);

  const filtered = useMemo(() => {
    return jobs.filter((j) => {
      if (filterStatus !== "all" && j.status !== filterStatus) return false;
      if (filterType !== "all" && j.job_type !== filterType) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${j.job_type} ${j.worker_id ?? ""} ${j.error ?? ""} ${JSON.stringify(j.payload)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [jobs, filterStatus, filterType, search]);

  const handleRequeue = async (job: Job) => {
    setBusyId(job.id);
    try {
      const { error } = await supabase
        .from("jobs_queue")
        .update({
          status: "pending",
          worker_id: null,
          reserved_at: null,
          scheduled_for: new Date().toISOString(),
          error: null,
        })
        .eq("id", job.id);
      if (error) throw error;
      toast.success("Job devolvido à fila");
      reload();
    } catch (e) {
      console.error(e);
      toast.error("Falha ao reenfileirar");
    } finally { setBusyId(null); }
  };

  const handleCancel = async (job: Job) => {
    setBusyId(job.id);
    try {
      const { error } = await supabase.from("jobs_queue")
        .update({ status: "cancelled", finished_at: new Date().toISOString() })
        .eq("id", job.id);
      if (error) throw error;
      toast.success("Job cancelado");
      reload();
    } catch (e) {
      console.error(e); toast.error("Falha ao cancelar");
    } finally { setBusyId(null); }
  };

  const handleDelete = async (job: Job) => {
    if (!confirm(`Excluir job ${job.id.slice(0,8)} permanentemente?`)) return;
    setBusyId(job.id);
    try {
      const { error } = await supabase.from("jobs_queue").delete().eq("id", job.id);
      if (error) throw error;
      reload();
    } catch (e) {
      console.error(e); toast.error("Falha ao excluir");
    } finally { setBusyId(null); }
  };

  const handleMaintenance = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("jobs-maintenance", { body: {} });
      if (error) throw error;
      toast.success(`Manutenção: ${data?.requeued ?? 0} jobs requeue, ${data?.workers_offline ?? 0} workers offline`);
      reload();
    } catch (e) {
      console.error(e); toast.error("Falha na manutenção");
    }
  };

  const handlePurge = async () => {
    if (!confirm("Limpar todos os jobs concluídos com mais de 24h?")) return;
    try {
      const cutoff = new Date(Date.now() - 86_400_000).toISOString();
      const { error } = await supabase.from("jobs_queue")
        .delete()
        .eq("status", "completed")
        .lt("finished_at", cutoff);
      if (error) throw error;
      toast.success("Histórico limpo");
      reload();
    } catch (e) {
      console.error(e); toast.error("Falha ao limpar");
    }
  };

  return (
    <div className="space-y-6">
      <SchedulerCard stats={stats} onRan={reload} />

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiBig icon={Clock} label="Pendentes" value={formatNumber(stats.by.pending + stats.by.retry)} hint={`${stats.by.retry} em retry`} loading={loading} />
        <KpiBig icon={Activity} label="Processando" value={formatNumber(stats.by.processing)} tone="primary" hint="Em execução" loading={loading} />
        <KpiBig icon={CheckCircle2} label="Concluídos" value={formatNumber(stats.by.completed)} tone="success" hint={`média ${fmtDuration(stats.avgMs)}`} loading={loading} />
        <KpiBig icon={XCircle} label="Falharam" value={formatNumber(stats.by.failed)} tone={stats.by.failed > 0 ? "destructive" : "default"} hint={`crash ${stats.crashRate.toFixed(1)}%`} loading={loading} />
      </section>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 flex-wrap">
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            Fila operacional
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              placeholder="Buscar por tipo, worker, erro…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-[220px]"
            />
            <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as JobStatus | "all")}>
              <SelectTrigger className="h-9 w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos status</SelectItem>
                {(Object.keys(STATUS_META) as JobStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="h-9 w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos tipos</SelectItem>
                {types.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={handleMaintenance} className="h-9 gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" /> Manutenção
            </Button>
            <Button size="sm" variant="outline" onClick={handlePurge} className="h-9 gap-1.5">
              <Trash2 className="h-3.5 w-3.5" /> Limpar antigos
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[520px]">
            <div className="space-y-2">
              {filtered.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  Nenhum job encontrado.
                </div>
              ) : filtered.map((j) => {
                const meta = STATUS_META[j.status];
                const Icon = meta.icon;
                return (
                  <div
                    key={j.id}
                    className="rounded-xl border border-border bg-[hsl(var(--elevated))] p-3 flex items-start gap-3"
                  >
                    <div className={cn("mt-0.5 shrink-0", meta.tone)}>
                      <Icon className={cn("h-4 w-4", j.status === "processing" && "animate-spin")} />
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-[12px] text-foreground/90 truncate">{j.job_type}</span>
                        <Badge variant="outline" className="text-[10px] uppercase tracking-wide">{meta.label}</Badge>
                        {j.attempts > 1 && (
                          <Badge variant="outline" className="text-[10px]">tent. {j.attempts}/{j.max_attempts}</Badge>
                        )}
                        {j.priority !== 100 && <Badge variant="outline" className="text-[10px]">p{j.priority}</Badge>}
                      </div>
                      <div className="text-[11px] text-muted-foreground flex items-center gap-3 flex-wrap">
                        <span>id {j.id.slice(0, 8)}</span>
                        {j.worker_id && <span>worker {j.worker_id}</span>}
                        <span>criado {fmtAgo(j.created_at)}</span>
                        {j.duration_ms != null && <span>dur {fmtDuration(j.duration_ms)}</span>}
                      </div>
                      {j.error && (
                        <div className="text-[11px] text-rose-400 bg-rose-500/5 border border-rose-500/20 rounded-md px-2 py-1 font-mono whitespace-pre-wrap break-all">
                          {j.error}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {(j.status === "failed" || j.status === "cancelled") && (
                        <Button size="sm" variant="ghost" disabled={busyId === j.id} onClick={() => handleRequeue(j)} title="Reenfileirar">
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {(j.status === "pending" || j.status === "retry" || j.status === "processing") && (
                        <Button size="sm" variant="ghost" disabled={busyId === j.id} onClick={() => handleCancel(j)} title="Cancelar">
                          <XCircle className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" disabled={busyId === j.id} onClick={() => handleDelete(j)} title="Excluir">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {stats.failuresByType.size > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[13px]">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              Falhas por tipo de job
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {Array.from(stats.failuresByType.entries()).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                <div key={type} className="flex items-center justify-between rounded-lg border border-border bg-[hsl(var(--elevated))] px-3 py-2">
                  <span className="font-mono text-[12px] truncate">{type}</span>
                  <Badge variant="outline" className="text-rose-400 border-rose-500/30">{count}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
