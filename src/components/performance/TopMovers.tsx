import { TrendingUp, TrendingDown, ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import type { DatasetRow } from "./types";

/**
 * Top 5 que cresceram + Top 5 que caíram.
 * Foco em decisão: mostrar quem precisa de atenção e quem replicar.
 */
export function TopMovers({ dataset }: { dataset: DatasetRow[] }) {
  const withData = dataset.filter(r => (r.followers_now ?? 0) > 0);

  const top = [...withData]
    .filter(r => (r.crescimento_absoluto ?? 0) > 0)
    .sort((a, b) => (b.crescimento_absoluto ?? 0) - (a.crescimento_absoluto ?? 0))
    .slice(0, 5);

  const bottom = [...withData]
    .filter(r => (r.crescimento_absoluto ?? 0) < 0)
    .sort((a, b) => (a.crescimento_absoluto ?? 0) - (b.crescimento_absoluto ?? 0))
    .slice(0, 5);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">
      <MoversCard
        title="Top 5 crescendo"
        icon={TrendingUp}
        tone="success"
        rows={top}
        empty="Nenhuma playlist crescendo no período."
      />
      <MoversCard
        title="Top 5 em queda"
        icon={TrendingDown}
        tone="destructive"
        rows={bottom}
        empty="Nenhuma queda registrada. Catálogo estável."
      />
    </div>
  );
}

function MoversCard({
  title, icon: Icon, tone, rows, empty,
}: {
  title: string;
  icon: LucideIcon;
  tone: "success" | "destructive";
  rows: DatasetRow[];
  empty: string;
}) {
  const toneText = tone === "success" ? "text-success" : "text-destructive";
  return (
    <Card className="p-4 md:p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon className={cn("h-4 w-4", toneText)} />
          <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
            {title}
          </span>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="text-xs text-muted-foreground py-6 text-center">{empty}</div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map(r => (
            <li key={r.template_id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold truncate leading-tight">{r.nome}</div>
                <div className="text-[11px] text-muted-foreground tabular-nums">
                  {formatNumber(r.followers_now)} seguidores
                </div>
              </div>
              <div className={cn("text-sm font-bold tabular-nums shrink-0", toneText)}>
                {(r.crescimento_absoluto ?? 0) > 0 ? "+" : ""}{formatNumber(r.crescimento_absoluto)}
              </div>
              {r.spotify_url && (
                <a
                  href={r.spotify_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted-foreground hover:text-foreground shrink-0"
                  onClick={e => e.stopPropagation()}
                >
                  <ArrowRight className="h-3.5 w-3.5" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
