import { useEffect, useState } from "react";
import { Activity, CheckCircle2, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";

type Health = {
  spotifyOk: boolean;
  lastCollectAt: string | null;
  errors24h: number;
  loading: boolean;
};

/**
 * Saúde operacional — três sinais críticos do backend.
 * Mostra só o essencial: Spotify conectado, última coleta, erros 24h.
 */
export function OperationalHealthCard() {
  const [h, setH] = useState<Health>({
    spotifyOk: false, lastCollectAt: null, errors24h: 0, loading: true,
  });

  useEffect(() => {
    (async () => {
      const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const [acc, lastCol, errs] = await Promise.all([
        supabase.from("accounts").select("*", { count: "exact", head: true }).eq("status", "active"),
        supabase.from("collection_logs").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("collection_logs").select("*", { count: "exact", head: true }).eq("status", "erro").gte("created_at", since24h),
      ]);
      setH({
        spotifyOk: (acc.count ?? 0) > 0,
        lastCollectAt: (lastCol.data as { created_at: string } | null)?.created_at ?? null,
        errors24h: errs.count ?? 0,
        loading: false,
      });
    })();
  }, []);

  const collectStale = h.lastCollectAt
    ? Date.now() - new Date(h.lastCollectAt).getTime() > 6 * 3600 * 1000
    : true;

  const overallTone =
    !h.spotifyOk || h.errors24h > 5 ? "destructive"
    : collectStale || h.errors24h > 0 ? "warning"
    : "success";

  return (
    <div className="nx-card p-5 flex flex-col gap-4 h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className={cn(
            "h-4 w-4",
            overallTone === "success" && "text-success",
            overallTone === "warning" && "text-warning",
            overallTone === "destructive" && "text-destructive",
          )} />
          <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
            Saúde operacional
          </span>
        </div>
      </div>

      {h.loading ? (
        <div className="h-20 rounded-md bg-muted/40 animate-pulse" />
      ) : (
        <ul className="space-y-2.5">
          <SignalRow
            label="Spotify conectado"
            ok={h.spotifyOk}
            okText="Conta ativa"
            badText="Nenhuma conta ativa"
          />
          <SignalRow
            label="Coleta de métricas"
            ok={!collectStale}
            okText={h.lastCollectAt ? `há ${timeAgo(h.lastCollectAt)}` : "—"}
            badText={h.lastCollectAt ? `Sem rodar há ${timeAgo(h.lastCollectAt)}` : "Nunca rodou"}
          />
          <SignalRow
            label="Erros 24h"
            ok={h.errors24h === 0}
            okText="Nenhum"
            badText={`${h.errors24h} erro${h.errors24h > 1 ? "s" : ""}`}
          />
        </ul>
      )}

      {!h.loading && (h.errors24h > 0 || !h.spotifyOk) && (
        <Link
          to="/configuracoes"
          className="text-[11px] text-primary hover:underline self-start"
        >
          Abrir configurações →
        </Link>
      )}
    </div>
  );
}

function SignalRow({
  label, ok, okText, badText,
}: { label: string; ok: boolean; okText: string; badText: string }) {
  const Icon = ok ? CheckCircle2 : AlertTriangle;
  return (
    <li className="flex items-center gap-2.5">
      <Icon className={cn("h-3.5 w-3.5 shrink-0", ok ? "text-success" : "text-warning")} />
      <span className="text-xs flex-1 min-w-0 truncate">{label}</span>
      <span className={cn("text-[11px] tabular-nums shrink-0", ok ? "text-muted-foreground" : "text-warning font-semibold")}>
        {ok ? okText : badText}
      </span>
    </li>
  );
}
