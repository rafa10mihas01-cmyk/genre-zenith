import { Link } from "react-router-dom";
import { ListMusic, TrendingUp, TrendingDown, Minus, ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo } from "react";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useActiveManagedPlaylists } from "@/hooks/useActiveManagedPlaylists";
import { useRecentSnapshots } from "@/hooks/useRecentSnapshots";

type Decline = { id: string; name: string; delta: number; followers: number };

const STABLE_THRESHOLD = 5; // |delta| <= 5 = estável

/**
 * Fase 4B.1: consome hooks compartilhados (managed + snapshots).
 * Lógica de classificação preservada 1:1.
 */
export function CatalogHealthCard() {
  const { data: mgd = [] } = useActiveManagedPlaylists();
  const { data: snapsRes } = useRecentSnapshots(8, 8000);

  const d = useMemo(() => {
    if (!snapsRes) return null;
    const byPid = snapsRes.index;
    let crescendo = 0, estavel = 0, caindo = 0, followers7d = 0;
    const declines: Decline[] = [];
    for (const m of mgd) {
      if (!m.spotify_playlist_id) { estavel++; continue; }
      const s = byPid.get(m.spotify_playlist_id);
      if (!s || s.firstTs === s.lastTs) { estavel++; continue; }
      const delta = s.last - s.first;
      followers7d += delta;
      if (delta > STABLE_THRESHOLD) crescendo++;
      else if (delta < -STABLE_THRESHOLD) {
        caindo++;
        declines.push({ id: m.id, name: m.name ?? "Sem nome", delta, followers: m.followers ?? 0 });
      } else estavel++;
    }
    declines.sort((a, b) => a.delta - b.delta);
    return {
      total: mgd.length,
      crescendo,
      estavel,
      caindo,
      followers7d,
      declines: declines.slice(0, 5),
    };
  }, [mgd, snapsRes]);

  if (!d) {
    return <div className="nx-card p-4 lg:p-5 h-64 animate-pulse bg-muted/20" />;
  }

  return (
    <div className="nx-card p-4 lg:p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ListMusic className="h-4 w-4 text-muted-foreground" />
          <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
            Catálogo
          </span>
        </div>
        <Link to="/catalogo" className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1">
          ver tudo <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {/* 4 KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Total" value={d.total} icon={ListMusic} />
        <Kpi label="Crescendo" value={d.crescendo} icon={TrendingUp} tone="success" />
        <Kpi label="Estável" value={d.estavel} icon={Minus} />
        <Kpi label="Caindo" value={d.caindo} icon={TrendingDown} tone={d.caindo > 0 ? "destructive" : "default"} />
      </div>

      {/* Top declines */}
      {d.declines.length > 0 && (
        <div className="pt-2 border-t border-border/50">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
            Top 5 em queda (7d)
          </div>
          <ul className="divide-y divide-border/40">
            {d.declines.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{r.name}</div>
                  <div className="text-[11px] text-muted-foreground">{formatNumber(r.followers)} seguidores</div>
                </div>
                <span className="text-sm font-bold tabular-nums text-destructive shrink-0">
                  {formatNumber(r.delta)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Footer agregado */}
      <div className="pt-2 border-t border-border/50 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Seguidores nos últimos 7 dias</span>
        <span className={cn(
          "font-bold tabular-nums",
          d.followers7d > 0 ? "text-success" : d.followers7d < 0 ? "text-destructive" : "text-muted-foreground",
        )}>
          {d.followers7d > 0 ? "+" : ""}{formatNumber(d.followers7d)}
        </span>
      </div>
    </div>
  );
}

function Kpi({ label, value, icon: Icon, tone = "default" }: {
  label: string; value: number; icon: LucideIcon; tone?: "default" | "success" | "destructive";
}) {
  const color = tone === "success" ? "text-success" : tone === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <div className="rounded-lg border border-border/60 bg-muted/10 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className={cn("text-2xl font-bold tabular-nums mt-1", color)}>{formatNumber(value)}</div>
    </div>
  );
}
