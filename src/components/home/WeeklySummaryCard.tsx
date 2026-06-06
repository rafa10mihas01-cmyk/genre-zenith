import { useMemo } from "react";
import { Calendar, TrendingUp, TrendingDown } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useActiveManagedPlaylists } from "@/hooks/useActiveManagedPlaylists";
import { useRecentSnapshots } from "@/hooks/useRecentSnapshots";

type WeekSummary = {
  followersGained7d: number;
  followersGainedToday: number | null;
  best: { name: string; delta: number } | null;
  worst: { name: string; delta: number } | null;
  insufficient: boolean;
};

/**
 * Resumo da semana — Fase 4B.1: consome hooks compartilhados.
 * Lógica preservada 1:1 (7d agregado + delta hoje vs 24h atrás).
 */
export function WeeklySummaryCard() {
  const { data: mgd = [] } = useActiveManagedPlaylists();
  const { data: snapsRes, isLoading } = useRecentSnapshots(8, 8000);

  const s = useMemo<WeekSummary | null>(() => {
    if (!snapsRes) return null;
    const { snaps, index } = snapsRes;
    if (snaps.length === 0) {
      return {
        followersGained7d: 0,
        followersGainedToday: null,
        best: null,
        worst: null,
        insufficient: true,
      };
    }

    const nameByPid = new Map<string, string>();
    for (const m of mgd) {
      if (m.spotify_playlist_id) nameByPid.set(m.spotify_playlist_id, m.name ?? "Sem nome");
    }

    let total7d = 0;
    const deltas: Array<{ name: string; delta: number }> = [];
    for (const [pid, v] of index) {
      if (v.firstTs === v.lastTs) continue;
      if (!nameByPid.has(pid)) continue; // ignora playlists não-gerenciadas
      const delta = v.last - v.first;
      total7d += delta;
      deltas.push({ name: nameByPid.get(pid) || "Sem nome", delta });
    }

    // hoje (últimas 24h) = soma do delta do último ponto vs ponto mais próximo de 24h atrás
    const cutoff = Date.now() - 86400000;
    let today = 0;
    let touchedToday = false;
    const byPid = new Map<string, Array<{ ts: number; f: number }>>();
    for (const r of snaps) {
      const ts = new Date(r.collected_at).getTime();
      const arr = byPid.get(r.spotify_playlist_id) ?? [];
      arr.push({ ts, f: r.followers });
      byPid.set(r.spotify_playlist_id, arr);
    }
    for (const arr of byPid.values()) {
      arr.sort((a, b) => a.ts - b.ts);
      const last = arr[arr.length - 1];
      const prev = [...arr].reverse().find((x) => x.ts <= cutoff);
      if (prev && last.ts !== prev.ts) {
        today += last.f - prev.f;
        touchedToday = true;
      }
    }

    deltas.sort((a, b) => b.delta - a.delta);
    const best = deltas[0] ?? null;
    const worst = deltas.length > 1 ? deltas[deltas.length - 1] : null;

    return {
      followersGained7d: total7d,
      followersGainedToday: touchedToday ? today : null,
      best: best && best.delta > 0 ? best : null,
      worst: worst && worst.delta < 0 ? worst : null,
      insufficient: deltas.length === 0,
    };
  }, [mgd, snapsRes]);

  const loading = isLoading || !s;

  return (
    <div className="nx-card p-5 flex flex-col gap-4 h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
            Resumo da semana
          </span>
        </div>
      </div>

      {loading ? (
        <div className="h-24 rounded-md bg-muted/40 animate-pulse" />
      ) : s!.insufficient ? (
        <div className="text-xs text-muted-foreground py-4">
          Aguardando histórico suficiente para gerar resumo semanal.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 rounded-xl border border-border/60 bg-muted/10 overflow-hidden divide-x divide-border/60">
            <div className="flex flex-col items-center justify-center text-center py-5 px-3">
              <div className={cn(
                "text-2xl font-bold tabular-nums leading-none",
                (s!.followersGained7d ?? 0) >= 0 ? "text-primary" : "text-destructive",
              )}>
                {(s!.followersGained7d ?? 0) > 0 ? "+" : ""}{formatNumber(s!.followersGained7d)}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-2">7 dias</div>
            </div>
            <div className="flex flex-col items-center justify-center text-center py-5 px-3">
              <div className={cn(
                "text-2xl font-bold tabular-nums leading-none",
                s!.followersGainedToday === null ? "text-muted-foreground"
                  : s!.followersGainedToday >= 0 ? "text-foreground" : "text-destructive",
              )}>
                {s!.followersGainedToday === null
                  ? "—"
                  : `${s!.followersGainedToday > 0 ? "+" : ""}${formatNumber(s!.followersGainedToday)}`}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-2">Hoje</div>
            </div>
          </div>

          <div className="space-y-1.5 pt-1 border-t border-border/50">
            {s!.best && (
              <div className="flex items-center gap-2 text-xs">
                <TrendingUp className="h-3.5 w-3.5 text-success shrink-0" />
                <span className="text-muted-foreground shrink-0">Melhor:</span>
                <span className="truncate font-semibold">{s!.best.name}</span>
                <span className="ml-auto text-success tabular-nums font-semibold shrink-0">+{formatNumber(s!.best.delta)}</span>
              </div>
            )}
            {s!.worst && (
              <div className="flex items-center gap-2 text-xs">
                <TrendingDown className="h-3.5 w-3.5 text-destructive shrink-0" />
                <span className="text-muted-foreground shrink-0">Pior:</span>
                <span className="truncate font-semibold">{s!.worst.name}</span>
                <span className="ml-auto text-destructive tabular-nums font-semibold shrink-0">{formatNumber(s!.worst.delta)}</span>
              </div>
            )}
            {!s!.best && !s!.worst && (
              <div className="text-[11px] text-muted-foreground">Nenhuma variação relevante.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
