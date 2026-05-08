// ControlePanel — métricas reais do servidor + ações operacionais.
import { useState } from "react";
import { useServerMetrics } from "@/hooks/useServerMetrics";
import { Cpu, MemoryStick, HardDrive, Clock, Server, Loader2, AlertTriangle, RefreshCw, Power, Trash2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export function ControlePanel() {
  const { metrics, loading, stale } = useServerMetrics();
  const [busy, setBusy] = useState<string | null>(null);

  const exec = async (action: string, label: string, requireConfirm = false, payload: any = {}) => {
    if (requireConfirm && !window.confirm(`Confirma "${label}"?`)) return;
    setBusy(action);
    try {
      const { data, error } = await supabase.functions.invoke("ops-action-execute", {
        body: { action, payload, confirmed: requireConfirm },
      });
      if (error) throw error;
      toast({ title: label, description: data?.message ?? "Executado" });
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      {/* Status do agente */}
      <div className={cn(
        "nx-card border p-3 flex items-center gap-3",
        !metrics ? "border-warning/40 bg-warning/5" :
        stale ? "border-destructive/40 bg-destructive/5" :
        "border-success/30 bg-success/5",
      )}>
        <Server className={cn("h-5 w-5", !metrics ? "text-warning" : stale ? "text-destructive" : "text-success")} />
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wider font-bold text-muted-foreground">Agente VPS</p>
          {loading ? (
            <p className="text-sm">Carregando…</p>
          ) : !metrics ? (
            <p className="text-sm text-warning">Nenhuma métrica recebida. Configure o agente VPS.</p>
          ) : (
            <p className={cn("text-sm font-semibold", stale ? "text-destructive" : "text-success")}>
              {metrics.hostname ?? metrics.bot_name} — última métrica {timeAgo(metrics.created_at)}
              {metrics.agent_version && <span className="text-muted-foreground font-normal ml-2">v{metrics.agent_version}</span>}
            </p>
          )}
        </div>
      </div>

      {/* Métricas */}
      {metrics && (
        <div>
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-bold mb-2">Recursos</h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricCard icon={Cpu} label="CPU" value={metrics.cpu_percent} suffix="%" />
            <MetricCard icon={MemoryStick} label="Memória" value={metrics.mem_percent} suffix="%"
              detail={metrics.mem_used_mb && metrics.mem_total_mb ? `${(metrics.mem_used_mb/1024).toFixed(1)}/${(metrics.mem_total_mb/1024).toFixed(1)} GB` : undefined} />
            <MetricCard icon={HardDrive} label="Disco" value={metrics.disk_percent} suffix="%"
              detail={metrics.disk_used_gb && metrics.disk_total_gb ? `${metrics.disk_used_gb.toFixed(1)}/${metrics.disk_total_gb.toFixed(1)} GB` : undefined} />
            <MetricCard icon={Clock} label="Uptime" value={metrics.uptime_seconds ? formatUptime(metrics.uptime_seconds) : null} />
          </div>
        </div>
      )}

      {/* PM2 */}
      {Array.isArray(metrics?.pm2_processes) && metrics.pm2_processes.length > 0 && (
        <div>
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-bold mb-2">Processos PM2</h3>
          <div className="nx-card divide-y divide-border">
            {metrics.pm2_processes.map((p: any, i: number) => (
              <div key={i} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                <span className={cn(
                  "h-2 w-2 rounded-full shrink-0",
                  p.status === "online" ? "bg-success" : "bg-destructive",
                )} />
                <span className="font-mono truncate flex-1">{p.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">cpu {p.cpu ?? 0}%</span>
                <span className="text-xs text-muted-foreground tabular-nums">{p.memory ? `${Math.round(p.memory/1024/1024)}MB` : "—"}</span>
                <span className="text-xs text-muted-foreground tabular-nums">restarts {p.restarts ?? 0}</span>
                <Button size="sm" variant="ghost" disabled={busy === `pm2_restart_${i}`}
                  onClick={() => exec("pm2_restart", `Reiniciar ${p.name}`, true, { process: p.name })}>
                  <RotateCw className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ações operacionais */}
      <div>
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-bold mb-2">Ações</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <ActionCard
            icon={RefreshCw} title="Atualizar métricas" description="Pede ao agente uma leitura imediata de CPU/RAM/Disco/PM2."
            onClick={() => exec("refresh_server_metrics", "Atualizar métricas")}
            busy={busy === "refresh_server_metrics"} />
          <ActionCard
            icon={Trash2} title="Limpar fila do robô" description="Reseta músicas travadas em 'queued' para 'idle'."
            onClick={() => exec("clear_bot_queue", "Limpar fila", true)}
            busy={busy === "clear_bot_queue"} variant="warning" />
          <ActionCard
            icon={Power} title="Reiniciar bot Spotify" description="Restart do processo PM2 'spotify-bot' na VPS."
            onClick={() => exec("restart_spotify_bot", "Reiniciar bot Spotify", true)}
            busy={busy === "restart_spotify_bot"} variant="warning" />
        </div>
      </div>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, suffix, detail }: { icon: any; label: string; value: any; suffix?: string; detail?: string }) {
  const num = typeof value === "number" ? value : null;
  const danger = num != null && num > 85;
  const warn = num != null && num > 70 && num <= 85;
  return (
    <div className="nx-card border border-border p-4">
      <div className="flex items-center gap-2 text-muted-foreground mb-2">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[10px] uppercase tracking-wider font-bold">{label}</span>
      </div>
      <div className={cn("text-2xl font-bold tabular-nums leading-none",
        danger ? "text-destructive" : warn ? "text-warning" : "text-foreground",
      )}>
        {value == null ? "—" : typeof value === "number" ? `${value.toFixed(0)}${suffix ?? ""}` : value}
      </div>
      {detail && <p className="text-[11px] text-muted-foreground mt-1.5">{detail}</p>}
    </div>
  );
}

function ActionCard({ icon: Icon, title, description, onClick, busy, variant }: {
  icon: any; title: string; description: string; onClick: () => void; busy: boolean; variant?: "warning";
}) {
  return (
    <div className="nx-card border border-border p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4", variant === "warning" ? "text-warning" : "text-primary")} />
        <p className="text-sm font-semibold">{title}</p>
      </div>
      <p className="text-xs text-muted-foreground flex-1">{description}</p>
      <Button size="sm" variant={variant === "warning" ? "outline" : "default"}
        onClick={onClick} disabled={busy} className="mt-1">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Executar"}
      </Button>
    </div>
  );
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
