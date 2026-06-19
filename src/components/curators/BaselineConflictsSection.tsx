import { AlertTriangle, ExternalLink, RefreshCcw, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type BaselineConflict = {
  playlist_id: string;
  playlist_url: string;
  playlist_name: string | null;
  registered_at: string | null;
  baseline_conflict_at: string | null;
  baseline_captured_at: string | null;
  baseline_reference_date?: string | null;
  baseline_plays_7d: number | null;
  reason: string;
  resolved: boolean;
};

export type CuratorSubmissionsSummary = {
  total: number;
  valid: number;
  baseline_conflict: number;
  pending_substitution: number;
  resolved: number;
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    });
  } catch {
    return "—";
  }
}

function fmtNumber(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("pt-BR").format(n);
}

export function CuratorSubmissionsKpis({
  summary,
}: {
  summary: CuratorSubmissionsSummary;
}) {
  if (!summary || summary.total === 0) return null;
  const small: Array<{ label: string; value: number; tone?: "warning" | "success" | "default" }> = [
    { label: "Válidas", value: summary.valid, tone: "success" },
    { label: "Conflitos baseline", value: summary.baseline_conflict, tone: summary.baseline_conflict > 0 ? "warning" : "default" },
    { label: "Conflitos resolvidos", value: summary.resolved, tone: summary.resolved > 0 ? "success" : "default" },
    { label: "Pendentes de substituição", value: summary.pending_substitution, tone: summary.pending_substitution > 0 ? "warning" : "default" },
  ];
  const validPct = summary.total > 0 ? Math.round((summary.valid / summary.total) * 100) : 0;
  return (
    <div className="space-y-2">
      {/* Hero — Enviadas (total declarado pelo curador) */}
      <div className="nx-card p-5 flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-[10px] uppercase tracking-wide text-subtle-foreground">
            Enviadas
          </span>
          <span className="text-4xl font-semibold tabular-nums leading-none text-foreground">
            {summary.total}
          </span>
          <span className="text-[11px] text-muted-foreground mt-1">
            playlists declaradas nesta campanha
          </span>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-[10px] uppercase tracking-wide text-subtle-foreground">
            Aproveitamento
          </span>
          <span className="text-2xl font-semibold tabular-nums leading-none text-primary">
            {validPct}%
          </span>
          <span className="text-[11px] text-muted-foreground">
            {summary.valid} válidas
          </span>
        </div>
      </div>

      {/* 4 cards menores embaixo — sem buraco */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {small.map((it) => (
          <div
            key={it.label}
            className="nx-card p-3 flex flex-col gap-1"
          >
            <span className="text-[10px] uppercase tracking-wide text-subtle-foreground">
              {it.label}
            </span>
            <span
              className={cn(
                "text-xl font-semibold tabular-nums",
                it.tone === "warning" && it.value > 0 && "text-warning",
                it.tone === "success" && it.value > 0 && "text-primary",
              )}
            >
              {it.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BaselineConflictsSection({
  conflicts,
  onSubstitute,
}: {
  conflicts: BaselineConflict[];
  onSubstitute?: () => void;
}) {
  if (!conflicts?.length) return null;

  return (
    <section className="nx-card p-4 md:p-5 space-y-3">
      <header className="flex items-center gap-2.5">
        <div className="p-1.5 rounded-md bg-warning/10 border border-warning/30 shrink-0">
          <AlertTriangle className="h-4 w-4 text-warning" />
        </div>
        <h2 className="text-sm font-semibold text-foreground">
          Conflitos de baseline
          <span className="ml-2 text-[11px] font-normal text-muted-foreground tabular-nums">
            ({conflicts.length})
          </span>
        </h2>
      </header>


      <div className="divide-y divide-border border border-border rounded-lg overflow-hidden">
        {conflicts.map((c) => (
          <div
            key={c.playlist_id}
            className="p-3 flex flex-col md:flex-row md:items-center gap-3 bg-card hover:bg-elevated/40 transition-colors"
          >
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <a
                  href={c.playlist_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-foreground hover:text-primary inline-flex items-center gap-1.5 truncate"
                >
                  <span className="truncate">{c.playlist_name ?? c.playlist_id}</span>
                  <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                </a>
                {c.resolved && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium border bg-primary/10 text-primary border-primary/30">
                    <CheckCircle2 className="h-2.5 w-2.5" />
                    RESOLVIDO
                  </span>
                )}
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-2.5 w-2.5" />
                      CONFLITO DE BASELINE
                    </>
                  )}
                </span>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                <span>
                  <span className="text-subtle-foreground">Detectado: </span>
                  <span className="text-foreground tabular-nums">
                    {fmtDate(c.baseline_conflict_at ?? c.registered_at)}
                  </span>
                </span>
                <span>
                  <span className="text-subtle-foreground">Baseline de: </span>
                  <span className="text-foreground tabular-nums">
                    {c.baseline_reference_date
                      ? fmtDate(c.baseline_reference_date + "T00:00:00")
                      : fmtDate(c.baseline_captured_at)}
                  </span>
                </span>
                {c.baseline_plays_7d !== null && (
                  <span>
                    <span className="text-subtle-foreground">Plays/7d na baseline: </span>
                    <span className="text-foreground tabular-nums">
                      {fmtNumber(c.baseline_plays_7d)}
                    </span>
                  </span>
                )}
              </div>

            </div>

            <div className="flex-shrink-0">
              {!c.resolved && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={onSubstitute}
                >
                  <RefreshCcw className="h-3.5 w-3.5" />
                  Substituir playlist
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
