import { Loader2, CheckCircle2, AlertTriangle, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAnalysisSnapshot } from "@/hooks/useAnalysisSnapshot";
import { cn } from "@/lib/utils";

interface Props {
  playlistId: string | null;
}

function fmtRelative(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

/**
 * Phase 4 — Banner unificado do Analysis Snapshot.
 * Mostra o estado oficial do pipeline (PROCESSANDO / PRONTO / FALHOU)
 * para que a UI nunca apresente dados inconsistentes em silêncio.
 */
export function SnapshotStatusBanner({ playlistId }: Props) {
  const { data, isLoading } = useAnalysisSnapshot(playlistId);

  if (isLoading || !data?.latest) return null;

  const { latest, ready } = data;
  const isProcessing =
    latest.status === "pending" || latest.status === "processing";
  const isFailed = latest.status === "failed";
  const showingStale = isProcessing && ready && ready.id !== latest.id;

  if (latest.status === "ready") {
    return (
      <Card
        className={cn(
          "flex items-center gap-3 px-3 py-2 border-l-2 border-l-primary/60 bg-card",
        )}
      >
        <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
        <span className="text-xs text-muted-foreground">
          Snapshot pronto · {fmtRelative(latest.ready_at)}
        </span>
        {latest.dna_version && (
          <Badge variant="outline" className="text-[10px] ml-auto">
            v{latest.dna_version.slice(0, 8)}
          </Badge>
        )}
      </Card>
    );
  }

  if (isProcessing) {
    return (
      <Card className="flex items-center gap-3 px-3 py-2 border-l-2 border-l-amber-500/60 bg-card">
        <Loader2 className="h-4 w-4 animate-spin text-amber-500 shrink-0" />
        <div className="flex flex-col">
          <span className="text-xs font-medium">
            Recalculando análise…
          </span>
          {showingStale ? (
            <span className="text-[11px] text-muted-foreground">
              Exibindo snapshot anterior ({fmtRelative(ready!.ready_at)}). Atualiza automaticamente.
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              Primeiro snapshot em geração — aguarde alguns segundos.
            </span>
          )}
        </div>
        <Clock className="h-3.5 w-3.5 text-muted-foreground ml-auto" />
      </Card>
    );
  }

  if (isFailed) {
    return (
      <Card className="flex items-center gap-3 px-3 py-2 border-l-2 border-l-destructive/60 bg-card">
        <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
        <div className="flex flex-col">
          <span className="text-xs font-medium">
            Última análise falhou
          </span>
          <span className="text-[11px] text-muted-foreground">
            {latest.failure_reason ?? "Erro desconhecido"} ·{" "}
            {fmtRelative(latest.failed_at)}
          </span>
        </div>
        {ready && (
          <Badge variant="outline" className="text-[10px] ml-auto">
            usando snapshot {fmtRelative(ready.ready_at)}
          </Badge>
        )}
      </Card>
    );
  }

  return null;
}
