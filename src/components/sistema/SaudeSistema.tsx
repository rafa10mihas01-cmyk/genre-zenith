// SaudeSistema — visão de saúde do pipeline atual: Spotify → Execução (jobs).
// Cards grandes pra bater o olho e entender se tá tudo OK.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  CheckCircle2, AlertTriangle, Loader2, Music2, Database, Activity,
  Handshake, RefreshCw, Bell,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { timeAgo, formatNumber } from "@/lib/format";
import { BotSaudeCard } from "./BotSaudeCard";

type Health = {
  spotify: { ok: boolean; expires_at?: string; expired?: boolean; last_verified?: string };
  execucao: { ok: boolean; pending: number; failed: number; lastDone?: string };
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

  const load = async () => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayIso = today.toISOString();
    const dayAgoIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [
      tokenRes, lastVerified,
      pendingJobs, failedJobs, doneJobsToday, lastDoneJob, recentFailedJobs,
      activeDeals,
    ] = await Promise.all([
      supabase.from("spotify_tokens").select("expires_at").eq("singleton_key", "app").maybeSingle(),
      supabase.from("search_results").select("followers_verified_at").not("followers_verified_at", "is", null).order("followers_verified_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("playlist_execution_jobs").select("id", { count: "exact", head: true }).in("status", ["pending", "claimed"]),
      supabase.from("playlist_execution_jobs").select("id", { count: "exact", head: true }).eq("status", "failed").gte("updated_at", dayAgoIso),
      supabase.from("playlist_execution_jobs").select("id", { count: "exact", head: true }).eq("status", "done").gte("completed_at", todayIso),
      supabase.from("playlist_execution_jobs").select("completed_at").eq("status", "done").order("completed_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("playlist_execution_jobs").select("id, last_error, updated_at, job_type").eq("status", "failed").gte("updated_at", dayAgoIso).order("updated_at", { ascending: false }).limit(10),
      supabase.from("curator_deals").select("id", { count: "exact", head: true }).is("closed_at", null),
    ]);

    const tokenExpiry = tokenRes.data?.expires_at;
    const tokenExpired = tokenExpiry ? new Date(tokenExpiry) <= new Date() : true;
    const pendingCount = pendingJobs.count ?? 0;
    const failedCount = failedJobs.count ?? 0;

    setHealth({
      spotify: { ok: !tokenExpired, expires_at: tokenExpiry, expired: tokenExpired, last_verified: (lastVerified.data as any)?.followers_verified_at ?? undefined },
      execucao: {
        ok: failedCount === 0,
        pending: pendingCount,
        failed: failedCount,
        lastDone: lastDoneJob.data?.completed_at ?? undefined,
      },
      hoje: {
        jobs_done: doneJobsToday.count ?? 0,
        deals_ativos: activeDeals.count ?? 0,
      },
    });

    const allFailures: Failure[] = (recentFailedJobs.data ?? []).map((j: any) => ({
      id: `job-${j.id}`,
      source: `Execução: ${j.job_type}`,
      message: j.last_error ?? "Erro desconhecido",
      created_at: j.updated_at,
    }));
    setFailures(allFailures);
    setLoading(false);
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
      {/* Botão refresh */}
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" onClick={load} className="h-7 gap-1.5 text-xs">
          <RefreshCw className="h-3.5 w-3.5" /> Atualizar
        </Button>
      </div>

      {/* === BLOCO 1: BOT SPOTIFY === */}
      <div>
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-bold mb-2">Bot Spotify</h3>
        <div className="space-y-3">
          <BotSaudeCard />
        </div>
      </div>

      <div className="h-px bg-border/60" />

      {/* === BLOCO 2: SERVIÇOS DO PIPELINE === */}
      <div>
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-bold mb-2">Status dos serviços</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
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
            okText={health.execucao.pending > 0 ? `${health.execucao.pending} na fila` : "Sem fila"}
            errText={`${health.execucao.failed} com falha`}
            detail={health.execucao.lastDone ? `último job ${timeAgo(health.execucao.lastDone)}` : "nenhum job executado"}
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
  icon: Icon, label, ok, okText, errText, detail,
}: {
  icon: any; label: string; ok: boolean; okText: string; errText: string; detail: string;
}) {
  return (
    <div className={cn(
      "nx-card border p-3",
      ok ? "border-success/30 bg-success/5" : "border-destructive/40 bg-destructive/5",
    )}>
      <div className="flex items-start gap-2.5">
        <Icon className={cn("h-5 w-5 shrink-0 mt-0.5", ok ? "text-success" : "text-destructive")} />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">{label}</p>
          <p className={cn("text-sm font-semibold leading-tight", ok ? "text-success" : "text-destructive")}>
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
