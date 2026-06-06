import { useMemo } from "react";
import { Link } from "react-router-dom";
import { TrendingDown, ArrowRight } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { useActiveManagedPlaylists } from "@/hooks/useActiveManagedPlaylists";
import { useRecentSnapshots } from "@/hooks/useRecentSnapshots";

type Row = {
  id: string;
  name: string;
  followers: number;
  delta: number;
};

/**
 * Top 5 das minhas playlists com pior delta de seguidores nos últimos 7d.
 * Fase 4B.1: consome hooks compartilhados.
 *
 * Nota: o cálculo de delta usa first/last do índice compartilhado
 * (último ponto - primeiro ponto no período), idêntico à versão original
 * que só mantinha {first,last} sem distinguir timestamps.
 */
export function PlaylistsInDeclineCard() {
  const { data: mgd = [] } = useActiveManagedPlaylists();
  const { data: snapsRes, isLoading } = useRecentSnapshots(8, 8000);

  const rows = useMemo<Row[] | null>(() => {
    if (!snapsRes) return null;
    const { index } = snapsRes;
    const list: Row[] = mgd
      .map((m) => {
        if (!m.spotify_playlist_id) return null;
        const s = index.get(m.spotify_playlist_id);
        if (!s) return null;
        const delta = s.last - s.first;
        return { id: m.id, name: m.name ?? "Sem nome", followers: m.followers ?? 0, delta };
      })
      .filter((x): x is Row => !!x && x.delta < 0)
      .sort((a, b) => a.delta - b.delta)
      .slice(0, 5);
    return list;
  }, [mgd, snapsRes]);

  const loading = isLoading || rows === null;

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

      {loading ? (
        <div className="h-32 rounded-md bg-muted/40 animate-pulse" />
      ) : rows!.length === 0 ? (
        <div className="text-xs text-muted-foreground py-6 text-center">
          Nenhuma playlist em queda nos últimos 7 dias.
        </div>
      ) : (
        <ul className="divide-y divide-border/50">
          {rows!.map((r) => (
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
