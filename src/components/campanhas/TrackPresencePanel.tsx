// TrackPresencePanel — mostra em quais managed_playlists ativas a música já está
// (com posição) e quais não têm (sugestão de adicionar). Usado em NewCampaignDialog
// e Calculadora antes de gerar o plano.
import { useState } from "react";
import { CheckCircle2, ArrowUp, Plus, Music, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTrackPresence, type TrackPresenceRow } from "@/hooks/useTrackPresence";

type Props = {
  spotifyTrackId: string | null | undefined;
  className?: string;
};

const STATUS_META = {
  top: {
    label: "Topo",
    icon: CheckCircle2,
    chipClass: "text-primary bg-primary/10 border-primary/30",
  },
  middle: {
    label: "Meio",
    icon: Music,
    chipClass: "text-foreground bg-elevated border-border",
  },
  tail: {
    label: "Cauda",
    icon: Music,
    chipClass: "text-muted-foreground bg-elevated border-border",
  },
  absent: {
    label: "Fora",
    icon: Music,
    chipClass: "text-subtle-foreground bg-elevated border-border",
  },
} as const;

function Row({ row }: { row: TrackPresenceRow }) {
  const meta = STATUS_META[row.status];
  const Icon = meta.icon;
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-elevated/40 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-foreground truncate">{row.playlist_name}</div>
        <div className="text-[11px] text-muted-foreground truncate">
          {row.genre_name ?? "—"}
          {row.followers != null && (
            <span className="text-subtle-foreground"> · {row.followers.toLocaleString("pt-BR")} seguidores</span>
          )}
        </div>
      </div>
      <div className="text-right tabular-nums text-sm font-medium text-foreground w-12 shrink-0">
        {row.position != null ? `#${row.position}` : "—"}
      </div>
      <div
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium w-[105px] justify-center shrink-0",
          meta.chipClass,
        )}
      >
        <Icon className="h-3 w-3" />
        {meta.label}
      </div>
    </div>
  );
}

export function TrackPresencePanel({ spotifyTrackId, className }: Props) {
  const { rows, summary, loading, error } = useTrackPresence(spotifyTrackId);
  const [showAbsent, setShowAbsent] = useState(false);
  const [collapsed, setCollapsed] = useState(true);

  if (!spotifyTrackId) return null;

  if (loading) {
    return (
      <div className={cn("rounded-2xl border border-border bg-card p-4 flex items-center gap-2 text-sm text-muted-foreground", className)}>
        <Loader2 className="h-4 w-4 animate-spin" />
        Verificando presença nas suas playlists...
      </div>
    );
  }
  if (error) {
    return (
      <div className={cn("rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-xs text-amber-500", className)}>
        Não foi possível verificar presença: {error}
      </div>
    );
  }
  if (rows.length === 0) {
    return null;
  }

  const present = rows.filter((r) => r.status !== "absent");
  const absent = rows.filter((r) => r.status === "absent");

  return (
    <div className={cn("rounded-2xl border border-border bg-card overflow-hidden", className)}>
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className={cn(
          "w-full flex items-center justify-between px-4 py-3 hover:bg-elevated/40 transition-colors text-left",
          !collapsed && "border-b border-border",
        )}
        aria-expanded={!collapsed}
      >
        <div className="flex items-center gap-2">
          <Music className="h-4 w-4 text-muted-foreground" />
          <h4 className="text-sm font-semibold text-foreground">Presença nas suas playlists</h4>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {summary.present} com a música · {summary.absent} sem
          </span>
          {collapsed ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronUp className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>

      {!collapsed && (
        <>
          {present.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <div className="text-sm text-foreground mb-1">Música ainda não está em nenhuma playlist do ecossistema</div>
              <div className="text-xs text-muted-foreground">
                Posição atual: fora de todas as {rows.length} playlists ativas.
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border max-h-[360px] overflow-y-auto">
              {present.map((r) => (
                <Row key={r.playlist_id} row={r} />
              ))}
            </div>
          )}

          {absent.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowAbsent((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-2.5 border-t border-border bg-elevated/20 hover:bg-elevated/40 transition-colors text-xs text-muted-foreground"
              >
                <span>
                  {showAbsent ? "Ocultar" : "Ver"} {absent.length} playlist
                  {absent.length === 1 ? "" : "s"} sem a música
                </span>
                {showAbsent ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
              {showAbsent && (
                <div className="divide-y divide-border max-h-[280px] overflow-y-auto">
                  {absent.map((r) => (
                    <Row key={r.playlist_id} row={r} />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
