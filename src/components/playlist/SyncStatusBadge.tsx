// SyncStatusBadge — chip compacto pra mostrar status de sync em card de playlist.
// Reutiliza PlaylistSyncInfo do hook useSyncStatusBatch (sem schema novo).
import { CheckCircle2, Loader2, Clock3, AlertTriangle, MinusCircle, KeyRound, Server } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PlaylistSyncInfo } from "@/hooks/useSyncStatusBatch";

type Props = {
  info: PlaylistSyncInfo | undefined;
  lastSyncAt: string | null;       // managed_playlists.last_metrics_at
  isCatalog?: boolean;
  compact?: boolean;
};

const STATUS_META = {
  processing: { label: "Processando", tone: "info", Icon: Loader2, spin: true },
  pending: { label: "Em fila", tone: "warning", Icon: Clock3, spin: false },
  failed: { label: "Erro", tone: "danger", Icon: AlertTriangle, spin: false },
  done: { label: "Sincronizada", tone: "success", Icon: CheckCircle2, spin: false },
  idle: { label: "Sem sync recente", tone: "muted", Icon: MinusCircle, spin: false },
} as const;

const TONE_CLASS: Record<string, string> = {
  success: "border-success/40 bg-success/10 text-success",
  warning: "border-warning/40 bg-warning/10 text-warning",
  danger: "border-destructive/40 bg-destructive/10 text-destructive",
  info: "border-primary/40 bg-primary/10 text-primary",
  muted: "border-border bg-card text-muted-foreground",
};

export function SyncStatusBadge({ info, lastSyncAt, isCatalog, compact = true }: Props) {
  const status = info?.status ?? "idle";
  const meta = STATUS_META[status];
  const { Icon } = meta;
  const tokenLabel = info?.tokenSource === "oauth" ? "OAuth" : info?.tokenSource === "app" ? "App" : "—";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
          aria-label={`Status de sincronização: ${meta.label}`}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium shrink-0",
            TONE_CLASS[meta.tone],
          )}
        >
          <Icon className={cn("h-2.5 w-2.5", meta.spin && "animate-spin")} />
          {!compact && <span>{meta.label}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 p-3 text-[11.5px] space-y-2"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
      >
        <div className="flex items-center justify-between">
          <span className="font-semibold text-foreground">{meta.label}</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {isCatalog ? "Catálogo" : "Operacional"}
          </span>
        </div>
        <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-muted-foreground">
          <span>Última sync</span>
          <span className="text-foreground tabular-nums">
            {lastSyncAt ? timeAgo(lastSyncAt) : "—"}
          </span>
          <span>Próxima</span>
          <span className="text-foreground tabular-nums">
            {info?.nextSyncAt ? timeAgo(info.nextSyncAt) : "—"}
          </span>
          <span className="inline-flex items-center gap-1">
            <KeyRound className="h-3 w-3" /> Token
          </span>
          <span className="inline-flex items-center gap-1 text-foreground">
            {info?.tokenSource === "app" ? <Server className="h-3 w-3" /> : null}
            {tokenLabel}
            {info?.lastCallAt && (
              <span className="text-[10px] text-muted-foreground">· {timeAgo(info.lastCallAt)}</span>
            )}
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
