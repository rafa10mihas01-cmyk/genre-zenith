// SaudeSistema — visão de saúde do pipeline atual: Spotify → Execução (jobs).
// Cards grandes pra bater o olho e entender se tá tudo OK.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  CheckCircle2, AlertTriangle, Loader2, Music2, Database, Activity,
  Handshake, RefreshCw, Bell,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { timeAgo, formatNumber } from "@/lib/format";
import { BotSaudeCard } from "./BotSaudeCard";
import { humanizeError, humanizeFunctionName } from "@/lib/operationalCopy";

type Health = {
  spotify: { ok: boolean; expires_at?: string; expired?: boolean; last_verified?: string };
  execucao: { ok: boolean; pending: number; failed: number; waitingSpotify: number; lastDone?: string };
  alertas: { ok: boolean; critical: number; warning: number; lastAt?: string };
  hoje: { jobs_done: number; deals_ativos: number };
};

type Failure = {
  id: string;
  source: string;
  message: string;
  created_at: string;
};

export function SaudeSistema() {
  const [health, setHealth] = useState<Health | null>(null);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setRefreshing(true);
    try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayIso = today.toISOString();
    const twoHoursAgoIso = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const [
      tokenRes, lastVerified,
      pendingJobs, recentFailedJobsRaw, doneJobsToday, lastDoneJob,
      openBreakers,
      activeDeals,
      criticalUnread, warningUnread, lastNotif,
    ] = await Promise.all([
      supabase.rpc("get_spotify_token_status").maybeSingle(),
      supabase.from("search_results").select("followers_verified_at").not("followers_verified_at", "is", null).order("followers_verified_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("playlist_execution_jobs").select("id", { count: "exact", head: true }).in("status", ["pending", "claimed"]),
      // Falhas nas últimas 2h (filtragem attempts >= max_attempts feita em JS,
      // já que PostgREST não compara coluna com coluna).
      supabase.from("playlist_execution_jobs")
        .select("id, last_error, updated_at, job_type, attempts, max_attempts")
        .eq("status", "failed")
        .gte("updated_at", twoHoursAgoIso)
        .order("updated_at", { ascending: false })
        .limit(50),
      supabase.from("playlist_execution_jobs").select("id", { count: "exact", head: true }).eq("status", "done").gte("completed_at", todayIso),
      supabase.from("playlist_execution_jobs").select("completed_at").eq("status", "done").order("completed_at", { ascending: false }).limit(1).maybeSingle(),
      // Circuit breaker aberto AGORA (status='open' ou blocked_until > now).
      supabase.from("spotify_circuit_breaker")
        .select("app_id", { count: "exact", head: true })
        .or(`status.eq.open,blocked_until.gt.${new Date().toISOString()}`),
      supabase.from("curator_deals").select("id", { count: "exact", head: true }).is("closed_at", null),
      supabase.from("notifications").select("id", { count: "exact", head: true }).eq("read", false).eq("type", "critical"),
      supabase.from("notifications").select("id", { count: "exact", head: true }).eq("read", false).eq("type", "warning"),
      supabase.from("notifications").select("created_at").eq("read", false).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);

    // Falha "dura" = estourou as tentativas E NÃO é circuit-breaker já encerrado.
    const now = Date.now();
    const hardFailures = (recentFailedJobsRaw.data ?? []).filter((j) => {
      const attempts = Number(j.attempts ?? 0);
      const max = Number(j.max_attempts ?? 0);
      if (max <= 0 || attempts < max) return false; // ainda vai re-tentar
      const err = String(j.last_error ?? "");
      // SPOTIFY_CIRCUIT_OPEN: blocked_until=2026-06-09T23:57:21.834+00:00 retry_after=...
      const m = err.match(/SPOTIFY_CIRCUIT_OPEN.*blocked_until=([0-9T:.+\-Z]+)/);
      if (m) {
        const until = Date.parse(m[1]);
        if (Number.isFinite(until) && until <= now) return false; // breaker já fechou
      }
      return true;
    });
    const hardFailedCount = hardFailures.length;

    const tokenExpiry = tokenRes.data?.expires_at;
    const tokenExpired = tokenExpiry ? new Date(tokenExpiry) <= new Date() : true;
    const pendingCount = pendingJobs.count ?? 0;
    const openBreakerCount = openBreakers.count ?? 0;
    const critCount = criticalUnread.count ?? 0;
    const warnCount = warningUnread.count ?? 0;

    // Execução só é vermelha se existir falha dura recente.
    // Circuit breaker aberto = espera automática do Spotify, não intervenção manual.
    const execOk = hardFailedCount === 0;

    setHealth({
      spotify: { ok: !tokenExpired, expires_at: tokenExpiry, expired: tokenExpired, last_verified: (lastVerified.data as any)?.followers_verified_at ?? undefined },
      execucao: {
        ok: execOk,
        pending: pendingCount,
        failed: hardFailedCount,
        waitingSpotify: openBreakerCount,
        lastDone: lastDoneJob.data?.completed_at ?? undefined,
      },
      alertas: {
        ok: critCount === 0 && warnCount === 0,
        critical: critCount,
        warning: warnCount,
        lastAt: lastNotif.data?.created_at ?? undefined,
      },
      hoje: {
        jobs_done: doneJobsToday.count ?? 0,
        deals_ativos: activeDeals.count ?? 0,
      },
    });

    const allFailures: Failure[] = hardFailures.slice(0, 10).map((j) => ({
      id: `job-${j.id}`,
      source: humanizeFunctionName(j.job_type),
      message: humanizeError(j.last_error),
      created_at: j.updated_at,
    }));
    setFailures(allFailures);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  if (loading || !health) {
    return (
      <div className="nx-card p-6 flex items-center justify-center text-sm text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando saúde do sistema…
      </div>
    );
  }

  const spotifyDetail = health.spotify.expires_at
    ? health.spotify.expired
      ? `expirado ${timeAgo(health.spotify.expires_at)}`
      : `válido até ${new Date(health.spotify.expires_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
    : "sem token configurado";

  return (
    <div className="space-y-4">
      {/* === BLOCO 1: BOT SPOTIFY (já tem header + refresh próprio) === */}
      <BotSaudeCard />

      <div className="h-px bg-border/60" />

      {/* === BLOCO 2: SERVIÇOS DO PIPELINE === */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-bold">Status dos serviços</h3>
          <Button size="sm" variant="ghost" onClick={load} disabled={refreshing} className="h-6 gap-1 text-[11px]">
            <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} /> Atualizar
          </Button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <HealthCard
            icon={Music2}
            label="Verificação Spotify"
            ok={!!health.spotify.last_verified}
            okText={health.spotify.last_verified ? timeAgo(health.spotify.last_verified) : "Sem verificação"}
            errText="Sem verificação"
            detail="seguidores reais das playlists"
          />
          <HealthCard
            icon={Database}
            label="Conexão Spotify"
            ok={health.spotify.ok}
            okText="Token válido"
            errText="Token expirado"
            detail={spotifyDetail}
          />
          <HealthCard
            icon={Activity}
            label="Execução (jobs)"
            ok={health.execucao.ok}
            tone={health.execucao.waitingSpotify > 0 ? "warn" : undefined}
            okText={health.execucao.waitingSpotify > 0 ? `${health.execucao.waitingSpotify} aguardando Spotify` : health.execucao.pending > 0 ? `${health.execucao.pending} na fila` : "Sem fila"}
            errText={`${health.execucao.failed} com falha`}
            detail={health.execucao.lastDone ? `último job ${timeAgo(health.execucao.lastDone)}` : "nenhum job executado"}
          />
          <HealthCard
            icon={Bell}
            label="Alertas"
            ok={health.alertas.critical === 0}
            okText={health.alertas.warning > 0 ? `${health.alertas.warning} aviso(s)` : "Sem alertas"}
            errText={`${health.alertas.critical} crítico(s)`}
            detail={health.alertas.lastAt ? `último ${timeAgo(health.alertas.lastAt)}` : "nenhum não lido"}
          />
        </div>
      </div>

      {/* === BLOCO 3: HOJE === */}
      <div>
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-bold mb-2">Hoje</h3>
        <div className="grid grid-cols-2 gap-3">
          <DayStat icon={Activity} label="Jobs concluídos" value={health.hoje.jobs_done} />
          <DayStat icon={Handshake} label="Deals ativos" value={health.hoje.deals_ativos} />
        </div>
      </div>

      {/* Falhas recentes */}
      <div>
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-bold mb-2 flex items-center gap-1.5">
          <AlertTriangle className="h-3 w-3 text-warning" /> Últimas falhas
        </h3>
        {failures.length === 0 ? (
          <div className="nx-card border border-success/30 bg-success/5 p-4 text-center text-sm text-success flex items-center justify-center gap-2">
            <CheckCircle2 className="h-4 w-4" /> Nenhuma falha registrada — tudo certo!
          </div>
        ) : (
          <div className="space-y-1.5">
            {failures.map((f) => (
              <div key={f.id} className="nx-card border border-destructive/30 bg-destructive/5 p-3">
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <Badge variant="outline" className="border-destructive/40 text-destructive text-[10px]">
                    {f.source}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground tabular-nums">{timeAgo(f.created_at)}</span>
                </div>
                <p className="text-xs text-foreground/90 mt-1.5 break-words">{f.message}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function HealthCard({
  icon: Icon, label, ok, okText, errText, detail, tone,
}: {
  icon: LucideIcon; label: string; ok: boolean; okText: string; errText: string; detail: string; tone?: "ok" | "warn";
}) {
  const resolvedTone = ok ? tone ?? "ok" : "bad";
  return (
    <div className={cn(
      "nx-card border p-3",
      resolvedTone === "ok" ? "border-success/30 bg-success/5" : resolvedTone === "warn" ? "border-warning/40 bg-warning/5" : "border-destructive/40 bg-destructive/5",
    )}>
      <div className="flex items-start gap-2.5">
        <Icon className={cn("h-5 w-5 shrink-0 mt-0.5", resolvedTone === "ok" ? "text-success" : resolvedTone === "warn" ? "text-warning" : "text-destructive")} />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">{label}</p>
          <p className={cn("text-sm font-semibold leading-tight", resolvedTone === "ok" ? "text-success" : resolvedTone === "warn" ? "text-warning" : "text-destructive")}>
            {ok ? okText : errText}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{detail}</p>
        </div>
      </div>
    </div>
  );
}

function DayStat({ icon: Icon, label, value }: { icon: any; label: string; value: number }) {
  return (
    <div className="nx-card border border-border p-3 flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[10px] uppercase tracking-wider font-bold">{label}</span>
      </div>
      <span className="text-2xl font-bold tabular-nums text-foreground leading-none">{formatNumber(value)}</span>
    </div>
  );
}
