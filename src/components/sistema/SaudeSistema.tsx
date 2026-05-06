// SaudeSistema — visão de saúde geral: Apify, Spotify, cron, falhas recentes.
// Cards grandes coloridos pra bater o olho e entender se tá tudo OK.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  CheckCircle2, AlertTriangle, Loader2, Music2, Database, Activity,
  Clock, Brain, Zap, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { timeAgo, formatNumber } from "@/lib/format";
import { BotSaudeCard } from "./BotSaudeCard";
import { ThroughputCard } from "./ThroughputCard";

type Health = {
  apify: { ok: boolean; reason?: string };
  spotify: { ok: boolean; expires_at?: string };
  cron: { ok: boolean; last_run?: string };
  hoje: { playlists_criadas: number; capas_geradas: number; runs_autopilot: number };
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

    const [
      flagsRes, tokenRes, lastCron, todayPlaylists, todayCapas, todayRuns,
      failedAdjs, failedRuns,
    ] = await Promise.all([
      supabase.from("system_flags").select("apify_blocked, apify_blocked_reason").eq("singleton_key", "app").maybeSingle(),
      supabase.from("spotify_tokens").select("expires_at").eq("singleton_key", "app").maybeSingle(),
      supabase.from("learning_loop_runs").select("started_at, status").order("started_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("playlist_templates").select("id", { count: "exact", head: true }).gte("created_on_spotify_at", todayIso).not("spotify_playlist_id", "is", null),
      supabase.from("playlist_templates").select("id", { count: "exact", head: true }).gte("cover_generated_at", todayIso),
      supabase.from("autopilot_runs").select("id", { count: "exact", head: true }).gte("started_at", todayIso),
      supabase.from("playlist_adjustments").select("id, action_type, error_message, created_at").eq("status", "error").order("created_at", { ascending: false }).limit(5),
      supabase.from("autopilot_runs").select("id, error_message, started_at").eq("status", "error").order("started_at", { ascending: false }).limit(5),
    ]);

    const apifyBlocked = flagsRes.data?.apify_blocked ?? false;
    const tokenExpiry = tokenRes.data?.expires_at;
    const tokenOk = tokenExpiry ? new Date(tokenExpiry) > new Date() : false;
    const lastCronTime = lastCron.data?.started_at;
    const cronOk = lastCronTime ? Date.now() - new Date(lastCronTime).getTime() < 24 * 60 * 60 * 1000 : false;

    setHealth({
      apify: { ok: !apifyBlocked, reason: flagsRes.data?.apify_blocked_reason ?? undefined },
      spotify: { ok: tokenOk, expires_at: tokenExpiry },
      cron: { ok: cronOk, last_run: lastCronTime },
      hoje: {
        playlists_criadas: todayPlaylists.count ?? 0,
        capas_geradas: todayCapas.count ?? 0,
        runs_autopilot: todayRuns.count ?? 0,
      },
    });

    const allFailures: Failure[] = [];
    (failedAdjs.data ?? []).forEach((a: any) => {
      allFailures.push({
        id: `adj-${a.id}`,
        source: `Ajuste: ${a.action_type}`,
        message: a.error_message ?? "Erro desconhecido",
        created_at: a.created_at,
      });
    });
    (failedRuns.data ?? []).forEach((r: any) => {
      allFailures.push({
        id: `run-${r.id}`,
        source: "Cérebro (autopilot)",
        message: r.error_message ?? "Erro desconhecido",
        created_at: r.started_at,
      });
    });
    allFailures.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    setFailures(allFailures.slice(0, 10));
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

  return (
    <div className="space-y-4">
      {/* Botão refresh */}
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" onClick={load} className="h-7 gap-1.5 text-xs">
          <RefreshCw className="h-3.5 w-3.5" /> Atualizar
        </Button>
      </div>

      {/* Cards de saúde */}
      <div>
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-bold mb-2">Status dos serviços</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <HealthCard
            icon={Music2}
            label="Coletor Apify"
            ok={health.apify.ok}
            okText="Funcionando"
            errText="Bloqueado"
            detail={health.apify.ok ? "coletando playlists do Spotify" : health.apify.reason ?? "verifique configuração"}
          />
          <HealthCard
            icon={Database}
            label="Conexão Spotify"
            ok={health.spotify.ok}
            okText="Token válido"
            errText="Token expirado"
            detail={health.spotify.expires_at
              ? `expira em ${timeAgo(health.spotify.expires_at).replace(" atrás", "")}`
              : "sem token configurado"}
          />
          <HealthCard
            icon={Zap}
            label="Automações (cron)"
            ok={health.cron.ok}
            okText="Rodando"
            errText="Sem atividade"
            detail={health.cron.last_run ? `última execução ${timeAgo(health.cron.last_run)}` : "nunca executou"}
          />
        </div>
      </div>

      <BotSaudeCard />

      <ThroughputCard />

      <div>
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-bold mb-2">Hoje</h3>
        <div className="grid grid-cols-3 gap-3">
          <DayStat icon={Music2} label="Playlists criadas" value={health.hoje.playlists_criadas} />
          <DayStat icon={Activity} label="Capas geradas" value={health.hoje.capas_geradas} />
          <DayStat icon={Brain} label="Execuções do Cérebro" value={health.hoje.runs_autopilot} />
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
