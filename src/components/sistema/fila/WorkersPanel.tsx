// WorkersPanel — dashboard dos workers ativos (heartbeat).
import { useMemo } from "react";
import { Cpu, HardDrive, Server, Activity, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { KpiBig } from "@/components/KpiBig";
import { formatNumber } from "@/lib/format";
import { useJobsQueue, type Worker } from "@/hooks/useJobsQueue";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<Worker["status"], string> = {
  idle:     "text-muted-foreground",
  busy:     "text-primary",
  draining: "text-amber-400",
  offline:  "text-rose-400",
  error:    "text-rose-500",
};

function fmtUptime(sec: number | null): string {
  if (!sec) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtAgo(iso: string): string {
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}min`;
  return `${Math.floor(sec / 3600)}h`;
}

export function WorkersPanel() {
  const { workers, loading } = useJobsQueue({ limit: 50 });

  const stats = useMemo(() => {
    const online = workers.filter((w) => w.status !== "offline").length;
    const busy = workers.filter((w) => w.status === "busy").length;
    const completed = workers.reduce((sum, w) => sum + (w.jobs_completed ?? 0), 0);
    const failed = workers.reduce((sum, w) => sum + (w.jobs_failed ?? 0), 0);
    return { total: workers.length, online, busy, completed, failed };
  }, [workers]);

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiBig icon={Server} label="Workers ativos" value={formatNumber(stats.online)} hint={`${stats.total} registrados`} loading={loading} />
        <KpiBig icon={Activity} label="Ocupados" value={formatNumber(stats.busy)} tone="primary" hint="Processando agora" loading={loading} />
        <KpiBig icon={CheckCircle2} label="Jobs concluídos" value={formatNumber(stats.completed)} tone="success" hint="Sessão acumulada" loading={loading} />
        <KpiBig icon={XCircle} label="Falhas" value={formatNumber(stats.failed)} tone={stats.failed > 0 ? "danger" : "default"} hint="Sessão acumulada" loading={loading} />
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-4 w-4 text-primary" />
            Workers
          </CardTitle>
        </CardHeader>
        <CardContent>
          {workers.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              Nenhum worker registrado ainda. Configure o agente VPS para reportar heartbeat.
            </div>
          ) : (
            <ScrollArea className="h-[520px]">
              <div className="space-y-2">
                {workers.map((w) => (
                  <div key={w.id} className="rounded-xl border border-border bg-[hsl(var(--elevated))] p-3">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={cn("font-mono text-[13px] font-medium truncate", STATUS_TONE[w.status])}>
                            {w.worker_id}
                          </span>
                          <Badge variant="outline" className="text-[10px] uppercase">
                            {w.status}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">{w.worker_kind}</Badge>
                          {w.agent_version && (
                            <span className="text-[10px] text-muted-foreground">v{w.agent_version}</span>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground flex items-center gap-3 flex-wrap">
                          {w.hostname && <span>{w.hostname}{w.pid ? ` · pid ${w.pid}` : ""}</span>}
                          <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> visto há {fmtAgo(w.last_seen_at)}</span>
                          <span>uptime {fmtUptime(w.uptime_seconds)}</span>
                          {w.cpu_percent != null && (
                            <span className="inline-flex items-center gap-1"><Cpu className="h-3 w-3" /> {w.cpu_percent.toFixed(0)}%</span>
                          )}
                          {w.mem_percent != null && (
                            <span className="inline-flex items-center gap-1"><HardDrive className="h-3 w-3" /> {w.mem_percent.toFixed(0)}%</span>
                          )}
                        </div>
                        {w.current_job_id && (
                          <div className="text-[11px] text-primary/90">
                            executando <span className="font-mono">{w.current_job_type ?? "?"}</span>
                            {" · "}<span className="font-mono">{w.current_job_id.slice(0,8)}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-muted-foreground shrink-0">
                        <div className="text-center">
                          <div className="text-emerald-400 font-semibold">{formatNumber(w.jobs_completed)}</div>
                          <div>concluídos</div>
                        </div>
                        <div className="text-center">
                          <div className={cn("font-semibold", w.jobs_failed > 0 ? "text-rose-400" : "text-foreground/60")}>
                            {formatNumber(w.jobs_failed)}
                          </div>
                          <div>falhas</div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
