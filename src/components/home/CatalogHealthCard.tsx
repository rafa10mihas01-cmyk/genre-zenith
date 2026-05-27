import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ListMusic, TrendingUp, TrendingDown, Minus, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

type Decline = { id: string; name: string; delta: number; followers: number };

type Data = {
  total: number;
  crescendo: number;
  estavel: number;
  caindo: number;
  followers7d: number;
  declines: Decline[];
};

const STABLE_THRESHOLD = 5; // |delta| <= 5 = estável

export function CatalogHealthCard() {
  const [d, setD] = useState<Data | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const sinceISO = new Date(Date.now() - 8 * 86400000).toISOString();

      const [mgdRes, snapsRes] = await Promise.all([
        supabase
          .from("managed_playlists")
          .select("id, name, followers, spotify_playlist_id")
          .is("archived_at", null),
        supabase
          .from("playlist_metrics_snapshots")
          .select("spotify_playlist_id, followers, collected_at")
          .gte("collected_at", sinceISO)
          .order("collected_at", { ascending: true })
          .limit(8000),
      ]);

      const mgd = (mgdRes.data ?? []) as any[];
      const snaps = (snapsRes.data ?? []) as any[];

      const byPid = new Map<string, { first: number; last: number; firstTs: number; lastTs: number }>();
      for (const r of snaps) {
        const ts = new Date(r.collected_at).getTime();
        const cur = byPid.get(r.spotify_playlist_id);
        if (!cur) {
          byPid.set(r.spotify_playlist_id, { first: r.followers, last: r.followers, firstTs: ts, lastTs: ts });
        } else {
          if (ts < cur.firstTs) { cur.first = r.followers; cur.firstTs = ts; }
          if (ts > cur.lastTs) { cur.last = r.followers; cur.lastTs = ts; }
        }
      }

      let crescendo = 0, estavel = 0, caindo = 0, followers7d = 0;
      const declines: Decline[] = [];

      for (const m of mgd) {
        const s = byPid.get(m.spotify_playlist_id);
        if (!s || s.firstTs === s.lastTs) { estavel++; continue; }
        const delta = s.last - s.first;
        followers7d += delta;
        if (delta > STABLE_THRESHOLD) crescendo++;
        else if (delta < -STABLE_THRESHOLD) {
          caindo++;
          declines.push({ id: m.id, name: m.name, delta, followers: m.followers });
        } else estavel++;
      }

      declines.sort((a, b) => a.delta - b.delta);

      if (!cancelled) {
        setD({
          total: mgd.length,
          crescendo,
          estavel,
          caindo,
          followers7d,
          declines: declines.slice(0, 5),
        });
      }
    }
    load();
    const i = setInterval(load, 60000);
    return () => { cancelled = true; clearInterval(i); };
  }, []);

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
  label: string; value: number; icon: any; tone?: "default" | "success" | "destructive";
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
