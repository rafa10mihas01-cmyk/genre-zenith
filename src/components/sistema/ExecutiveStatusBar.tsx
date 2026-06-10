// Nível 1 — visão executiva do sistema.
// Um cartão único que responde: tudo OK? Atenção? Ação urgente?
// Sem detalhes técnicos.
import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, AlertOctagon, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { deriveExecutiveStatus, EXEC_LABEL, type ExecutiveStatus } from "@/lib/operationalCopy";

type Summary = {
  status: ExecutiveStatus;
  criticalOpen: number;
  warningOpen: number;
  spotifyBlocked: number;
  vpsOffline: number;
};

const ICONS: Record<ExecutiveStatus, typeof CheckCircle2> = {
  ok: CheckCircle2,
  attention: AlertTriangle,
  urgent: AlertOctagon,
};

const TONE: Record<ExecutiveStatus, string> = {
  ok: "border-success/40 bg-success/5 text-success",
  attention: "border-warning/40 bg-warning/5 text-warning",
  urgent: "border-destructive/40 bg-destructive/5 text-destructive",
};

export function ExecutiveStatusBar() {
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const [crit, warn, vps] = await Promise.all([
        supabase.from("notifications").select("id", { count: "exact", head: true }).eq("status", "open").eq("type", "critical"),
        supabase.from("notifications").select("id", { count: "exact", head: true }).eq("status", "open").eq("type", "warning"),
        supabase.from("vps_nodes").select("last_heartbeat_at, status"),
      ]);
      const vpsRows = (vps.data ?? []) as Array<{ last_heartbeat_at: string | null; status: string }>;
      const vpsOffline = vpsRows.filter((v) => v.status === "active" && (!v.last_heartbeat_at || v.last_heartbeat_at < fifteenMinAgo)).length;
      // spotify_circuit_breaker pode não estar acessível por RLS — tentamos best-effort
      let spotifyBlocked = 0;
      try {
        const cb = await supabase.from("spotify_circuit_breaker").select("blocked_until").gt("blocked_until", new Date().toISOString());
        spotifyBlocked = cb.data?.length ?? 0;
      } catch { /* ok */ }

      const criticalOpen = crit.count ?? 0;
      const warningOpen = warn.count ?? 0;
      const status = deriveExecutiveStatus({ criticalOpen, warningOpen, spotifyBlocked, vpsOffline });

      if (!cancelled) setSummary({ status, criticalOpen, warningOpen, spotifyBlocked, vpsOffline });
    };
    load();
    const t = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  if (!summary) {
    return (
      <div className="nx-card p-5 flex items-center gap-3 text-sm text-muted-foreground border border-border">
        <Loader2 className="h-4 w-4 animate-spin" /> Avaliando o sistema…
      </div>
    );
  }

  const meta = EXEC_LABEL[summary.status];
  const Icon = ICONS[summary.status];

  return (
    <div className={cn("nx-card border-2 p-5 flex items-center gap-4", TONE[summary.status])}>
      <Icon className="h-8 w-8 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xl" aria-hidden>{meta.emoji}</span>
          <h2 className="text-base font-semibold leading-tight text-foreground">{meta.title}</h2>
        </div>
        <p className="text-sm text-muted-foreground mt-0.5">{meta.subtitle}</p>
      </div>
      {summary.status !== "ok" && (
        <div className="hidden sm:flex flex-col items-end text-right shrink-0">
          {summary.criticalOpen > 0 && (
            <span className="text-xs text-destructive font-medium">
              {summary.criticalOpen} crítico{summary.criticalOpen === 1 ? "" : "s"}
            </span>
          )}
          {summary.warningOpen > 0 && (
            <span className="text-xs text-warning font-medium">
              {summary.warningOpen} aviso{summary.warningOpen === 1 ? "" : "s"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
