// SincronizacaoSaudePanel — visão única do estado da sincronização de playlists.
// Reutiliza somente tabelas existentes:
//   - playlist_operation_queue (AUTO_SYNC) → jobs hoje, backlog, taxa de sucesso, tempo médio
//   - cron_run_log                         → última execução por cron
//   - managed_playlists                    → distribuição Operacional vs Catálogo (playlists sync hoje)
import { useQuery } from "@tanstack/react-query";
import { Activity, CheckCircle2, AlertTriangle, Clock3, Timer, ListChecks, Server } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

type QueueRow = {
  playlist_id: string;
  status: string;
  priority: number;
  created_at: string;
  claimed_at: string | null;
  completed_at: string | null;
};

type CronRow = {
  cron_name: string;
  started_at: string;
  finished_at: string | null;
  success: boolean | null;
  duration_ms: number | null;
};

function startOfTodayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function SincronizacaoSaudePanel() {
  const todayISO = startOfTodayISO();

  // 1) Fila AUTO_SYNC: últimas 24h (pra hoje + tempo médio) e backlog atual (pending/processing)
  const queueQuery = useQuery({
    queryKey: ["sync-saude-queue"],
    staleTime: 30_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: recent } = await supabase
        .from("playlist_operation_queue")
        .select("playlist_id, status, priority, created_at, claimed_at, completed_at")
        .eq("operation_type", "AUTO_SYNC")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(2000);
      const { data: backlog } = await supabase
        .from("playlist_operation_queue")
        .select("playlist_id, status, priority, created_at, claimed_at, completed_at")
        .eq("operation_type", "AUTO_SYNC")
        .in("status", ["pending", "processing"])
        .order("priority", { ascending: true })
        .limit(2000);
      return {
        recent: (recent ?? []) as QueueRow[],
        backlog: (backlog ?? []) as QueueRow[],
      };
    },
  });

  // 2) Cron run log: última execução por cron (limita a relevantes pra sync)
  const cronQuery = useQuery({
    queryKey: ["sync-saude-cron"],
    staleTime: 30_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("cron_run_log")
        .select("cron_name, started_at, finished_at, success, duration_ms")
        .gte("started_at", since)
        .order("started_at", { ascending: false })
        .limit(500);
      return (data ?? []) as CronRow[];
    },
  });

  // 3) Distribuição Operacional vs Catálogo entre playlists que sincronizaram hoje
  const distribQuery = useQuery({
    queryKey: ["sync-saude-distrib", todayISO],
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("managed_playlists")
        .select("id, is_catalog, last_metrics_at")
        .gte("last_metrics_at", todayISO)
        .limit(5000);
      const list = data ?? [];
      let catalog = 0, operacional = 0;
      for (const r of list as any[]) {
        if (r.is_catalog) catalog++; else operacional++;
      }
      return { total: list.length, catalog, operacional };
    },
  });

  const loading = queueQuery.isPending || cronQuery.isPending || distribQuery.isPending;

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
    );
  }

  const recent = queueQuery.data?.recent ?? [];
  const backlog = queueQuery.data?.backlog ?? [];
  const crons = cronQuery.data ?? [];
  const distrib = distribQuery.data ?? { total: 0, catalog: 0, operacional: 0 };

  const done = recent.filter((r) => r.status === "done").length;
  const failed = recent.filter((r) => r.status === "failed").length;
  const finished = done + failed;
  const successRate = finished > 0 ? Math.round((done / finished) * 100) : null;

  const durations = recent
    .filter((r) => r.status === "done" && r.claimed_at && r.completed_at)
    .map((r) => new Date(r.completed_at!).getTime() - new Date(r.claimed_at!).getTime())
    .filter((ms) => ms > 0 && ms < 30 * 60 * 1000);
  const avgMs = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

  const backlogByPrio = [1, 2, 3].map((p) => ({
    priority: p,
    count: backlog.filter((r) => r.priority === p).length,
  }));

  // Última execução por cron_name (mais recente)
  const lastByCron = new Map<string, CronRow>();
  for (const c of crons) {
    if (!lastByCron.has(c.cron_name)) lastByCron.set(c.cron_name, c);
  }
  const lastCrons = Array.from(lastByCron.values()).slice(0, 8);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi
          icon={ListChecks}
          label="Jobs processados (24h)"
          value={String(finished)}
          sub={`${done} ok · ${failed} falha`}
        />
        <Kpi
          icon={CheckCircle2}
          label="Taxa de sucesso"
          value={successRate !== null ? `${successRate}%` : "—"}
          sub={finished ? `de ${finished} jobs` : "sem jobs ainda"}
          tone={successRate === null ? "muted" : successRate >= 95 ? "success" : successRate >= 80 ? "warning" : "danger"}
        />
        <Kpi
          icon={Timer}
          label="Tempo médio"
          value={avgMs !== null ? formatDuration(avgMs) : "—"}
          sub={durations.length ? `${durations.length} amostras` : "—"}
        />
        <Kpi
          icon={Clock3}
          label="Backlog atual"
          value={String(backlog.length)}
          sub={`P1 ${backlogByPrio[0].count} · P2 ${backlogByPrio[1].count} · P3 ${backlogByPrio[2].count}`}
          tone={backlog.length > 100 ? "warning" : "muted"}
        />
        <Kpi
          icon={AlertTriangle}
          label="Falhas (24h)"
          value={String(failed)}
          tone={failed === 0 ? "success" : failed < 10 ? "warning" : "danger"}
        />
        <Kpi
          icon={Activity}
          label="Playlists sync hoje"
          value={String(distrib.total)}
          sub={`${distrib.operacional} operacional · ${distrib.catalog} catálogo`}
        />
        <Kpi
          icon={Server}
          label="Distribuição"
          value={distrib.total ? `${Math.round((distrib.operacional / distrib.total) * 100)}% op` : "—"}
          sub={distrib.total ? `${Math.round((distrib.catalog / distrib.total) * 100)}% catálogo` : "—"}
        />
        <Kpi
          icon={Activity}
          label="Crons ativos (24h)"
          value={String(lastByCron.size)}
          sub="último ciclo registrado"
        />
      </div>

      <Card className="p-4">
        <h4 className="text-sm font-semibold mb-3 inline-flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" /> Última execução dos crons
        </h4>
        {lastCrons.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma execução de cron nas últimas 24h.</p>
        ) : (
          <div className="divide-y divide-border">
            {lastCrons.map((c) => {
              const ok = c.success === true;
              const fail = c.success === false;
              return (
                <div key={c.cron_name} className="flex items-center justify-between py-2 text-[12.5px]">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full shrink-0",
                        ok ? "bg-success" : fail ? "bg-destructive" : "bg-muted-foreground/50",
                      )}
                    />
                    <span className="font-mono text-foreground truncate" title={c.cron_name}>
                      {c.cron_name}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-muted-foreground tabular-nums shrink-0">
                    {c.duration_ms != null && <span>{formatDuration(c.duration_ms)}</span>}
                    <span>{timeAgo(c.started_at)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = s / 60;
  return `${m.toFixed(1)}min`;
}

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
  tone = "muted",
}: {
  icon: any;
  label: string;
  value: string;
  sub?: string;
  tone?: "muted" | "success" | "warning" | "danger";
}) {
  const toneClass =
    tone === "success" ? "text-success" :
    tone === "warning" ? "text-warning" :
    tone === "danger" ? "text-destructive" :
    "text-foreground";
  return (
    <Card className="p-3.5">
      <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", toneClass)}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </Card>
  );
}
