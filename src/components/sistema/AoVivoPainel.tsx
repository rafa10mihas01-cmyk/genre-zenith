// AoVivoPainel — visão ao vivo do sistema atual: Spotify + fila de execução.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Activity,
  RefreshCw,
  Eye,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  ListChecks,
  Music2,
  Database,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { timeAgo, formatNumber } from "@/lib/format";
import { FluxoVisual } from "@/components/sistema/fluxo/FluxoVisual";
import { AoVivoFeed } from "@/components/sistema/AoVivoFeed";

type LiveState = {
  botOnline: boolean;
  botStatus: string | null;
  botMessage: string | null;
  lastHeartbeat: string | null;
  spotifySessionValid: boolean;
  pending: number;
  claimed: number;
  doneToday: number;
  failed24h: number;
  lastJobAt: string | null;
  lastVerifiedAt: string | null;
};

export function AoVivoPainel() {
  const [state, setState] = useState<LiveState | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayIso = today.toISOString();
    const dayAgoIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [heartbeat, pendingJobs, claimedJobs, doneJobs, failedJobs, lastJob, lastVerified] = await Promise.all([
      supabase
        .from("bot_heartbeats")
        .select("created_at, status, spotify_session_valid, message")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("playlist_execution_jobs").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("playlist_execution_jobs").select("id", { count: "exact", head: true }).eq("status", "claimed"),
      supabase.from("playlist_execution_jobs").select("id", { count: "exact", head: true }).eq("status", "done").gte("completed_at", todayIso),
      supabase.from("playlist_execution_jobs").select("id", { count: "exact", head: true }).eq("status", "failed").gte("updated_at", dayAgoIso),
      supabase
        .from("playlist_execution_jobs")
        .select("created_at, updated_at, completed_at")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("search_results")
        .select("followers_verified_at")
        .not("followers_verified_at", "is", null)
        .order("followers_verified_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const hbAt = heartbeat.data?.created_at ?? null;
    const hbFresh = hbAt ? Date.now() - new Date(hbAt).getTime() < 5 * 60_000 : false;
    const job = lastJob.data as any;

    setState({
      botOnline: hbFresh,
      botStatus: heartbeat.data?.status ?? null,
      botMessage: heartbeat.data?.message ?? null,
      lastHeartbeat: hbAt,
      spotifySessionValid: heartbeat.data?.spotify_session_valid ?? false,
      pending: pendingJobs.count ?? 0,
      claimed: claimedJobs.count ?? 0,
      doneToday: doneJobs.count ?? 0,
      failed24h: failedJobs.count ?? 0,
      lastJobAt: job?.updated_at ?? job?.completed_at ?? job?.created_at ?? null,
      lastVerifiedAt: (lastVerified.data as any)?.followers_verified_at ?? null,
    });
    setLoading(false);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("aovivo-atual")
      .on("postgres_changes", { event: "*", schema: "public", table: "playlist_execution_jobs" }, () => load())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "bot_heartbeats" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "search_results" }, () => load())
      .subscribe();
    // Polling de fallback raro — realtime cobre o tempo real
    const t = setInterval(load, 60_000);
    return () => { supabase.removeChannel(ch); clearInterval(t); };
  }, []);

  if (loading || !state) {
    return (
      <div className="nx-card p-12 flex items-center justify-center text-sm text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando painel ao vivo…
      </div>
    );
  }

  const hasFailure = state.failed24h > 0;
  const isRunning = state.claimed > 0;
  const healthy = state.botOnline && state.spotifySessionValid && !hasFailure;

  return (
    <div className="space-y-4">
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border-2 p-4 sm:p-5",
          "bg-gradient-to-br from-card via-card to-elevated/40",
          hasFailure && "border-destructive/60 fluxo-error-glow",
          isRunning && !hasFailure && "border-warning/50 fluxo-active-glow",
          healthy && "border-success/30 fluxo-success-glow",
          !healthy && !hasFailure && !isRunning && "border-border",
        )}
      >
        <div className="relative flex flex-col lg:flex-row lg:items-center gap-4 lg:gap-6">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div
              className={cn(
                "h-12 w-12 rounded-xl flex items-center justify-center shrink-0",
                hasFailure && "bg-destructive/15",
                isRunning && !hasFailure && "bg-warning/15",
                healthy && "bg-success/15",
                !healthy && !hasFailure && !isRunning && "bg-elevated",
              )}
            >
              {hasFailure ? (
                <AlertCircle className="h-6 w-6 text-destructive" />
              ) : healthy ? (
                <CheckCircle2 className="h-6 w-6 text-success" />
              ) : (
                <Activity className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    hasFailure && "bg-destructive",
                    isRunning && !hasFailure && "bg-warning animate-pulse",
                    healthy && "bg-success",
                    !healthy && !hasFailure && !isRunning && "bg-muted-foreground/50",
                  )}
                />
                <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
                  {isRunning ? "Sistema ativo · executando" : healthy ? "Sistema ativo · ocioso" : "Sistema sem execução agora"}
                </span>
              </div>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mt-0.5">
                <h2 className="text-lg sm:text-xl font-bold text-foreground leading-tight">Spotify + Execução</h2>
                <span className="text-xs text-muted-foreground tabular-nums">
                  · {state.lastHeartbeat ? `bot ${timeAgo(state.lastHeartbeat)}` : "sem heartbeat"}
                </span>
              </div>
              {state.botMessage && <p className="text-xs text-muted-foreground mt-1">{state.botMessage}</p>}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={load}>
              <RefreshCw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Atualizar</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-9 gap-1.5"
              onClick={() => document.querySelector("#feed-ao-vivo")?.scrollIntoView({ behavior: "smooth", block: "start" })}
            >
              <Eye className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Logs completos</span>
            </Button>
          </div>
        </div>
      </div>

      <FluxoVisual />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={ListChecks} label="Pendentes" value={state.pending} hint="fila atual" color={state.pending > 0 ? "warning" : "primary"} />
        <KpiCard icon={Activity} label="Executando" value={state.claimed} hint="agora" color={state.claimed > 0 ? "success" : "primary"} />
        <KpiCard icon={CheckCircle2} label="Concluídos hoje" value={state.doneToday} hint={state.lastJobAt ? `último job ${timeAgo(state.lastJobAt)}` : "sem job recente"} color="success" />
        <KpiCard icon={Music2} label="Spotify verificado" value={state.lastVerifiedAt ? timeAgo(state.lastVerifiedAt) : "—"} hint="seguidores reais" color={state.spotifySessionValid ? "success" : "destructive"} />
      </div>

      <div id="feed-ao-vivo" className="scroll-mt-4">
        <AoVivoFeed />
      </div>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  color,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  hint?: string;
  color: "primary" | "success" | "warning" | "destructive";
}) {
  const colorMap = {
    primary: { bg: "bg-primary/10", border: "border-primary/20", icon: "text-primary", value: "text-foreground" },
    success: { bg: "bg-success/10", border: "border-success/20", icon: "text-success", value: "text-foreground" },
    warning: { bg: "bg-warning/10", border: "border-warning/20", icon: "text-warning", value: "text-foreground" },
    destructive: { bg: "bg-destructive/10", border: "border-destructive/20", icon: "text-destructive", value: "text-foreground" },
  };
  const c = colorMap[color];
  const displayValue = typeof value === "number" ? formatNumber(value) : value;
  return (
    <div className={cn(
      "fluxo-node-hover relative overflow-hidden rounded-xl border p-4",
      "bg-gradient-to-br from-card to-elevated/30",
      c.border,
    )}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center", c.bg)}>
          <Icon className={cn("h-4 w-4", c.icon)} />
        </div>
      </div>
      <p className={cn("text-2xl font-bold tabular-nums leading-none", c.value)}>{displayValue}</p>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mt-2">{label}</p>
      {hint && <p className="text-[10px] text-muted-foreground/70 mt-0.5">{hint}</p>}
    </div>
  );
}
