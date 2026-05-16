import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { TrendingDown, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatNumber } from "@/lib/format";

type Row = {
  id: string;
  name: string;
  followers: number;
  delta: number;
};

/**
 * Top 5 das minhas playlists com pior delta de seguidores nos últimos 7d.
 * Baseado em playlist_metrics_snapshots + managed_playlists.
 */
export function PlaylistsInDeclineCard() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    (async () => {
      const sinceISO = new Date(Date.now() - 8 * 86400000).toISOString();

      // Snapshots dos últimos 8 dias
      const { data: snaps } = await supabase
        .from("playlist_metrics_snapshots")
        .select("spotify_playlist_id, followers, collected_at")
        .gte("collected_at", sinceISO)
        .order("collected_at", { ascending: true })
        .limit(5000);

      if (!snaps || snaps.length === 0) {
        setRows([]);
        return;
      }

      // primeiro x último por playlist
      const map = new Map<string, { first: number; last: number }>();
      for (const r of snaps as any[]) {
        const cur = map.get(r.spotify_playlist_id);
        if (!cur) {
          map.set(r.spotify_playlist_id, { first: r.followers, last: r.followers });
        } else {
          cur.last = r.followers;
        }
      }

      const pids = Array.from(map.keys());
      if (pids.length === 0) {
        setRows([]);
        return;
      }

      // só managed_playlists ativas
      const { data: mgd } = await supabase
        .from("managed_playlists")
        .select("id, name, followers, spotify_playlist_id")
        .in("spotify_playlist_id", pids)
        .is("archived_at", null);

      const list: Row[] = ((mgd ?? []) as any[])
        .map((m) => {
          const s = map.get(m.spotify_playlist_id);
          if (!s) return null;
          const delta = s.last - s.first;
          return { id: m.id, name: m.name, followers: m.followers, delta };
        })
        .filter((x): x is Row => !!x && x.delta < 0)
        .sort((a, b) => a.delta - b.delta)
        .slice(0, 5);

      setRows(list);
    })();
  }, []);

  return (
    <div className="nx-card-hover p-5 flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingDown className="h-4 w-4 text-destructive" />
          <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
            Playlists em queda
          </span>
        </div>
        <Link
          to="/catalogo"
          className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          ver tudo <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {rows === null ? (
        <div className="h-32 rounded-md bg-muted/40 animate-pulse" />
      ) : rows.length === 0 ? (
        <div className="text-xs text-muted-foreground py-6 text-center">
          Nenhuma playlist em queda nos últimos 7 dias.
        </div>
      ) : (
        <ul className="divide-y divide-border/50">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold truncate">{r.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {formatNumber(r.followers)} seguidores
                </div>
              </div>
              <span className="text-sm font-bold tabular-nums text-destructive shrink-0">
                {formatNumber(r.delta)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
