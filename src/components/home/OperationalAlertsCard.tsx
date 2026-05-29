import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, CheckCircle2, Activity, Stethoscope } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Stats = {
  staleDiagnosisCount: number;
  lastCollectionAt: string | null;
};

/**
 * Card de alertas operacionais no Cockpit.
 * Sinaliza dois sintomas de pipeline parado:
 *   - playlists sem diagnóstico há > 7 dias
 *   - última entrada em collection_logs há > 4 horas (bot sem coleta)
 */
export function OperationalAlertsCard() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const [diagRes, collectRes] = await Promise.all([
        supabase
          .from("managed_playlists")
          .select("id", { count: "exact", head: true })
          .is("archived_at", null)
          .or(`last_diagnosis_at.is.null,last_diagnosis_at.lt.${sevenDaysAgo}`),
        supabase
          .from("collection_logs")
          .select("created_at")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (cancelled) return;
      setStats({
        staleDiagnosisCount: diagRes.count ?? 0,
        lastCollectionAt: collectRes.data?.created_at ?? null,
      });
    }
    load();
    const i = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(i);
    };
  }, []);

  if (!stats) return null;

  const fourHoursMs = 4 * 60 * 60 * 1000;
  const botSilentMs = stats.lastCollectionAt
    ? Date.now() - new Date(stats.lastCollectionAt).getTime()
    : Number.POSITIVE_INFINITY;
  const botSilent = botSilentMs > fourHoursMs;
  const diagStale = stats.staleDiagnosisCount > 0;
  const anyAlert = botSilent || diagStale;

  // Caminho mais relevante quando o operador clicar no card.
  const ctaHref = diagStale ? "/catalogo" : "/sistema?tab=saude";

  const botSilentLabel = (() => {
    if (!stats.lastCollectionAt) return "sem registros";
    const hours = Math.floor(botSilentMs / (60 * 60 * 1000));
    if (hours < 24) return `${hours}h sem coleta`;
    const days = Math.floor(hours / 24);
    return `${days}d sem coleta`;
  })();

  return (
    <Link
      to={ctaHref}
      className={cn(
        "nx-card-hover p-4 lg:p-5 group flex flex-col gap-3",
        anyAlert && "border-warning/40",
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle
            className={cn("h-4 w-4", anyAlert ? "text-warning" : "text-muted-foreground")}
          />
          <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
            Saúde operacional
          </span>
        </div>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      {!anyAlert ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-success" /> Diagnósticos em dia, bot ativo
        </div>
      ) : (
        <div className="space-y-2">
          {diagStale && (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2 text-foreground-body">
                <Stethoscope className="h-4 w-4 text-warning" />
                Playlists sem diagnóstico &gt;7d
              </span>
              <span className="font-semibold tabular-nums text-warning">
                {stats.staleDiagnosisCount}
              </span>
            </div>
          )}
          {botSilent && (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2 text-foreground-body">
                <Activity className="h-4 w-4 text-warning" />
                Bot sem coleta
              </span>
              <span className="font-semibold tabular-nums text-warning">{botSilentLabel}</span>
            </div>
          )}
        </div>
      )}
    </Link>
  );
}
