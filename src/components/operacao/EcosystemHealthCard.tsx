import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, Archive, Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";

/**
 * Card de resumo executivo do ecossistema — mostra composição
 * (ativas / arquivadas / elegíveis) num único bloco compacto.
 * Mesma altura do KpiBig hero, pensado pra ocupar 2 colunas ao lado
 * de "Salvamentos totais".
 *
 * Regras visuais:
 *  - Ativas e Arquivadas: tom neutro (informativo).
 *  - Elegíveis para retorno: âmbar quando >0 (ação possível),
 *    cinza quando 0.
 */
export function EcosystemHealthCard() {
  const [counts, setCounts] = useState<{ active: number; archived: number; eligible: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [activeRes, archivedRes, eligibleRes] = await Promise.all([
        supabase
          .from("managed_playlists")
          .select("id", { count: "exact", head: true })
          .is("archived_at", null),
        supabase
          .from("managed_playlists")
          .select("id", { count: "exact", head: true })
          .not("archived_at", "is", null),
        supabase
          .from("managed_playlists")
          .select("id", { count: "exact", head: true })
          .not("archived_at", "is", null)
          .not("reactivation_eligible_at", "is", null),
      ]);
      if (cancelled) return;
      setCounts({
        active: activeRes.count ?? 0,
        archived: archivedRes.count ?? 0,
        eligible: eligibleRes.count ?? 0,
      });
    }
    load();
    const i = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(i);
    };
  }, []);

  const loading = !counts;
  const active = counts?.active ?? 0;
  const archived = counts?.archived ?? 0;
  const eligible = counts?.eligible ?? 0;
  const total = active + archived;
  const hasEligible = eligible > 0;

  return (
    <div className="nx-card text-card-foreground flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
          Saúde do ecossistema
        </span>
        <Activity className="h-3.5 w-3.5 text-muted-foreground/70" />
      </div>

      <div className="flex flex-col gap-2 flex-1">
        <Row
          to="/catalogo"
          icon={<span className="h-2 w-2 rounded-full bg-success" />}
          label="Ativas"
          value={loading ? "—" : formatNumber(active)}
          tone="neutral"
        />
        <Row
          to="/catalogo?arquivadas=1"
          icon={<Archive className="h-3.5 w-3.5 text-muted-foreground" />}
          label="Arquivadas"
          value={loading ? "—" : formatNumber(archived)}
          tone="neutral"
        />
        <Row
          to="/catalogo?arquivadas=1&elegiveis=1"
          icon={
            <Bell
              className={cn(
                "h-3.5 w-3.5",
                hasEligible ? "text-warning" : "text-muted-foreground",
              )}
            />
          }
          label="Elegíveis para retorno"
          value={loading ? "—" : formatNumber(eligible)}
          tone={hasEligible ? "warning" : "neutral"}
        />
      </div>

      <div className="mt-3 pt-2.5 border-t border-border/60">
        <span className="text-[11px] text-muted-foreground">
          Total monitorado:{" "}
          <span className="text-foreground/80 font-medium tabular-nums">
            {loading ? "—" : `${formatNumber(total)} playlists`}
          </span>
        </span>
      </div>
    </div>
  );
}

interface RowProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "neutral" | "warning";
}

function Row({ to, icon, label, value, tone }: RowProps) {
  return (
    <Link
      to={to}
      className={cn(
        "group flex items-center justify-between gap-2 rounded-md px-2 py-1.5 -mx-2 transition-colors",
        "hover:bg-elevated",
      )}
    >
      <span className="flex items-center gap-2 min-w-0">
        <span className="flex h-4 w-4 items-center justify-center shrink-0">{icon}</span>
        <span
          className={cn(
            "text-[13px] truncate",
            tone === "warning"
              ? "text-warning group-hover:text-warning"
              : "text-foreground/85 group-hover:text-foreground",
          )}
        >
          {label}
        </span>
      </span>
      <span
        className={cn(
          "text-[15px] font-semibold tabular-nums shrink-0",
          tone === "warning" ? "text-warning" : "text-foreground",
        )}
      >
        {value}
      </span>
    </Link>
  );
}
