// PlanResultCard — Fase 8.5
// Mostra o resultado da última execução avaliada (previsto × realizado).
// Somente leitura da tabela plan_execution_snapshots.
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { SectionTitle } from "./SectionTitle";
import { CheckCircle2, AlertCircle, BarChart3 } from "lucide-react";
import type { PlanExecutionSnapshot } from "../hooks/useLastPlanResult";

type AccuracyEntry = { label: string; projected: number | null; measured: number | null; accuracy: number | null };

const METRIC_MAP: { key: string; label: string }[] = [
  { key: "benchmark", label: "Benchmark" },
  { key: "coverage", label: "Cobertura do nicho" },
  { key: "saturation", label: "Saturação" },
  { key: "artist", label: "Artistas dominantes" },
  { key: "concentration", label: "Concentração" },
  { key: "size", label: "Tamanho" },
  { key: "headroom", label: "Headroom" },
];

function gradeBadgeTone(grade: string | null): string {
  switch (grade) {
    case "Excelente": return "bg-primary/15 text-primary border-primary/30";
    case "Bom": return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "Regular": return "bg-warning/15 text-warning border-warning/30";
    case "Ruim": return "bg-destructive/15 text-destructive border-destructive/30";
    default: return "bg-muted text-muted-foreground border-border";
  }
}

function formatDelta(val: number | null, unit: "pp" | "int" = "int"): string {
  if (val == null) return "—";
  const rounded = unit === "pp" ? Math.round(val * 10) / 10 : Math.round(val);
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  const suffix = unit === "pp" ? " pp" : "";
  return `${sign}${Math.abs(rounded)}${suffix}`;
}

export function PlanResultCard({ snapshot }: { snapshot: PlanExecutionSnapshot | null | undefined }) {
  if (!snapshot) {
    return (
      <section className="space-y-3">
        <SectionTitle>Resultado da última execução</SectionTitle>
        <Card className="p-4 md:p-5 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground">
            Esta playlist ainda não possui execuções avaliadas.
          </div>
        </Card>
      </section>
    );
  }

  if (snapshot.accuracy_overall == null) {
    return (
      <section className="space-y-3">
        <SectionTitle>Resultado da última execução</SectionTitle>
        <Card className="p-4 md:p-5 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground">
            Dados insuficientes para comparação.
          </div>
        </Card>
      </section>
    );
  }

  const byMetric = (snapshot.accuracy_by_metric ?? {}) as Record<string, number | null>;

  const rows: AccuracyEntry[] = METRIC_MAP.map(({ key, label }) => {
    const projected = (snapshot as any)[`projected_${key}_delta`] ?? (snapshot as any)[`projected_${key}_delta_pp`] ?? null;
    const measured = (snapshot as any)[`measured_${key}_delta`] ?? (snapshot as any)[`measured_${key}_delta_pp`] ?? null;
    return {
      label,
      projected,
      measured,
      accuracy: byMetric[key] ?? null,
    };
  }).filter((r) => r.projected != null || r.measured != null);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <SectionTitle>Resultado da última execução</SectionTitle>
        <Badge variant="outline" className={cn("h-6 px-2 text-[11px] font-medium", gradeBadgeTone(snapshot.accuracy_grade))}>
          {snapshot.accuracy_grade ?? "Sem nota"}
        </Badge>
      </div>

      <Card className="p-4 md:p-5 space-y-4">
        {/* Resumo */}
        <div className="flex items-center gap-3">
          <div className={cn("flex items-center justify-center h-9 w-9 rounded-full", gradeBadgeTone(snapshot.accuracy_grade))}>
            <BarChart3 className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-medium">
              Precisão geral: <span className="tabular-nums">{Math.round(snapshot.accuracy_overall)}%</span>
            </div>
            <div className="text-[11px] text-muted-foreground">
              Executado em {new Date(snapshot.executed_at).toLocaleDateString("pt-BR")}
              {snapshot.evaluated_at && (
                <> · Avaliado em {new Date(snapshot.evaluated_at).toLocaleDateString("pt-BR")}</>
              )}
            </div>
          </div>
        </div>

        {/* Métricas */}
        {rows.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {rows.map((row) => {
              const hasAccuracy = row.accuracy != null;
              const unit = row.label === "Saturação" || row.label === "Concentração" || row.label === "Cobertura do nicho" || row.label === "Headroom" ? "pp" : "int";
              return (
                <div key={row.label} className="rounded-xl border border-border bg-card/60 p-3 flex flex-col gap-2 min-w-0">
                  <div className="text-[11px] text-muted-foreground truncate">{row.label}</div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-col">
                      <span className="text-[10px] text-subtle-foreground">Previsto</span>
                      <span className="text-sm font-semibold tabular-nums">{formatDelta(row.projected, unit)}</span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[10px] text-subtle-foreground">Real</span>
                      <span className="text-sm font-semibold tabular-nums">{formatDelta(row.measured, unit)}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-border/40">
                    <span className="text-[10px] text-subtle-foreground">Precisão</span>
                    {hasAccuracy ? (
                      <span className="text-xs font-medium tabular-nums text-primary">{Math.round(row.accuracy!)}%</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </section>
  );
}
