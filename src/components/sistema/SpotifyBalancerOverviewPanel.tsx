// Fase 16 — Painel canônico do Balanceador Spotify
// Lê exclusivamente a view `spotify_app_overview`. Não recalcula nada no client.
// Capacity Score e Health Score vêm separados do banco — UI só renderiza.
import { useQuery } from "@tanstack/react-query";
import { Activity, ShieldCheck, ShieldAlert, ShieldQuestion, Gauge, Heart, RefreshCw, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Row = {
  id: string;
  name: string;
  status: string;
  lifecycle_state: string;
  purpose: "write" | "hybrid";
  development_mode: boolean;
  extended_quota: boolean;
  blocked_reason: string | null;
  quarantined_until: string | null;
  removed_from_pool_at: string | null;
  accounts_count: number;
  max_accounts: number;
  active_playlists: number;
  total_playlists: number;
  max_playlists: number;
  calls_last_5m: number;
  calls_last_1h: number;
  calls_last_24h: number;
  calls_last_7d: number;
  cap_calls_per_minute: number;
  cap_calls_per_hour: number;
  error_403_last_hour: number;
  error_429_last_hour: number;
  retries_last_hour: number;
  average_latency_ms: number;
  circuit_breaker: string;
  capacity_score: number;
  health_score: number;
  soft_capacity_cap: number;
  min_health_score: number;
  pool_eligible: boolean;
};

const LIFECYCLE_META: Record<string, { label: string; cls: string; dot: string }> = {
  active:               { label: "Ativa",             cls: "border-primary/30 text-primary bg-primary/5",         dot: "bg-primary" },
  maintenance:          { label: "Manutenção",        cls: "border-warning/40 text-warning bg-warning/10",         dot: "bg-warning" },
  quarantined:          { label: "Quarentena",        cls: "border-warning/40 text-warning bg-warning/10",         dot: "bg-warning" },
  development_blocked:  { label: "Development Mode",  cls: "border-destructive/40 text-destructive bg-destructive/10", dot: "bg-destructive" },
  disabled:             { label: "Desativada",        cls: "border-border text-muted-foreground bg-elevated",      dot: "bg-muted-foreground" },
  retired:              { label: "Aposentada",        cls: "border-border text-muted-foreground bg-elevated",      dot: "bg-muted-foreground" },
};

const PURPOSE_META: Record<string, { label: string; cls: string }> = {
  write:  { label: "WRITE",  cls: "border-primary/30 text-primary bg-primary/5" },
  hybrid: { label: "HYBRID", cls: "border-muted-foreground/30 text-muted-foreground bg-elevated" },
};

function capacityColor(score: number, soft: number) {
  if (score >= 90) return "bg-destructive";
  if (score >= soft) return "bg-warning";
  if (score >= 60) return "bg-info";
  return "bg-primary";
}

function healthColor(score: number, min: number) {
  if (score < min) return "bg-destructive";
  if (score < 70) return "bg-warning";
  return "bg-primary";
}

function pct(n: number, total: number) {
  if (!total) return 0;
  return Math.min(100, Math.round((n / total) * 100));
}

function AppRow({ r }: { r: Row }) {
  const lf = LIFECYCLE_META[r.lifecycle_state] ?? LIFECYCLE_META.disabled;
  const pp = PURPOSE_META[r.purpose] ?? PURPOSE_META.hybrid;
  const removed = !!r.removed_from_pool_at || !r.pool_eligible;

  return (
    <div className="px-4 py-4 border-b border-border last:border-0 hover:bg-elevated/40 transition-colors">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex items-center gap-2.5">
          <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", lf.dot)} />
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{r.name}</div>
            <div className="flex items-center gap-1.5 mt-1">
              <span className={cn("inline-flex items-center px-1.5 h-5 rounded text-[10px] font-medium border", lf.cls)}>
                {lf.label}
              </span>
              <span className={cn("inline-flex items-center px-1.5 h-5 rounded text-[10px] font-medium border", pp.cls)}>
                {pp.label}
              </span>
              
              {removed && (
                <span className="inline-flex items-center px-1.5 h-5 rounded text-[10px] font-medium border border-destructive/40 text-destructive bg-destructive/10">
                  fora do pool
                </span>
              )}
              {r.circuit_breaker !== "closed" && (
                <span className="inline-flex items-center px-1.5 h-5 rounded text-[10px] font-medium border border-destructive/40 text-destructive bg-destructive/10">
                  CB {r.circuit_breaker}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Scores — barra inline pra controlar cor (Progress shadcn não expõe indicatorClassName) */}
      <div className="grid grid-cols-2 gap-4 mb-3">
        <div>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
            <span className="inline-flex items-center gap-1"><Gauge className="h-3 w-3" /> Capacity</span>
            <span className="tabular-nums font-medium text-foreground">{r.capacity_score}%</span>
          </div>
          <div className="h-1.5 rounded bg-elevated overflow-hidden">
            <div className={cn("h-full transition-all", capacityColor(r.capacity_score, r.soft_capacity_cap))} style={{ width: `${r.capacity_score}%` }} />
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
            <span className="inline-flex items-center gap-1"><Heart className="h-3 w-3" /> Health</span>
            <span className="tabular-nums font-medium text-foreground">{r.health_score}%</span>
          </div>
          <div className="h-1.5 rounded bg-elevated overflow-hidden">
            <div className={cn("h-full transition-all", healthColor(r.health_score, r.min_health_score))} style={{ width: `${r.health_score}%` }} />
          </div>
        </div>
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-4 gap-3 text-[11px]">
        <Metric label="Contas" value={`${r.accounts_count}/${r.max_accounts}`} pct={pct(r.accounts_count, r.max_accounts)} />
        <Metric label="Playlists" value={`${r.active_playlists}/${r.max_playlists}`} pct={pct(r.active_playlists, r.max_playlists)} />
        <Metric label="Calls/h" value={`${r.calls_last_1h}/${r.cap_calls_per_hour}`} pct={pct(r.calls_last_1h, r.cap_calls_per_hour)} />
        <Metric label="Latência" value={`${r.average_latency_ms} ms`} />
      </div>
      <div className="grid grid-cols-4 gap-3 text-[11px] mt-2">
        <Metric label="Calls 5m" value={String(r.calls_last_5m)} />
        <Metric label="Calls 24h" value={String(r.calls_last_24h)} />
        <Metric label="403/h" value={String(r.error_403_last_hour)} warn={r.error_403_last_hour >= 5} />
        <Metric label="429/h" value={String(r.error_429_last_hour)} warn={r.error_429_last_hour >= 10} />
      </div>

      {r.blocked_reason && (
        <div className="mt-3 text-[11px] text-muted-foreground">
          Motivo de bloqueio: <span className="text-foreground font-medium">{r.blocked_reason}</span>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, pct, warn }: { label: string; value: string; pct?: number; warn?: boolean }) {
  return (
    <div>
      <div className="text-muted-foreground text-[10px] uppercase tracking-wide">{label}</div>
      <div className={cn("tabular-nums font-medium", warn ? "text-destructive" : "text-foreground")}>{value}</div>
      {typeof pct === "number" && (
        <div className="mt-1 h-1 rounded bg-elevated overflow-hidden">
          <div className={cn("h-full", pct >= 90 ? "bg-destructive" : pct >= 80 ? "bg-warning" : "bg-primary")} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

export function SpotifyBalancerOverviewPanel() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["spotify_app_overview"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("spotify_app_overview" as any)
        .select("*")
        .order("capacity_score", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const rows = data ?? [];
  const active = rows.filter(r => r.lifecycle_state === "active");
  const blocked = rows.filter(r => r.lifecycle_state !== "active");

  return (
    <TooltipProvider>
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <div className="text-sm font-semibold">Balanceador Spotify</div>
            <span className="text-[11px] text-muted-foreground">fonte: spotify_app_overview</span>
          </div>
          <Button variant="ghost" size="sm" className="h-7" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        </div>

        {isLoading ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Carregando…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Nenhuma App cadastrada.</div>
        ) : (
          <>
            {active.length > 0 && (
              <div>
                <div className="px-4 py-2 text-[10px] uppercase tracking-wide text-muted-foreground bg-elevated/40 border-b border-border">
                  Ativas no pool ({active.length})
                </div>
                {active.map(r => <AppRow key={r.id} r={r} />)}
              </div>
            )}
            {blocked.length > 0 && (
              <div>
                <div className="px-4 py-2 text-[10px] uppercase tracking-wide text-muted-foreground bg-elevated/40 border-b border-t border-border">
                  Bloqueadas / fora do pool ({blocked.length})
                </div>
                {blocked.map(r => <AppRow key={r.id} r={r} />)}
              </div>
            )}
          </>
        )}
      </Card>
    </TooltipProvider>
  );
}
