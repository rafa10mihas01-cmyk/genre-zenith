// PlanImpactCard — Fase 8.1
// Mostra o impacto projetado do plano ANTES do CTA "Aprovar e executar".
// Não dispara nenhuma chamada de rede. Tudo derivado de Diagnosis + buckets + brain.
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, Minus, ShieldCheck, Target } from "lucide-react";
import { useCockpit } from "../context/CockpitContext";
import { usePlaylistBrainGated } from "@/hooks/usePlaylistBrain";
import { computePlanImpact, type ImpactDelta } from "./computePlanImpact";
import { SectionTitle } from "./SectionTitle";

function formatDelta(d: ImpactDelta): string {
  if (d.value == null) return "—";
  const abs = Math.abs(d.value);
  const rounded = d.unit === "pp" ? Math.round(abs * 10) / 10 : Math.round(abs);
  const sign = d.value > 0 ? "+" : d.value < 0 ? "−" : "";
  const unit = d.unit === "pp" ? " pp" : "";
  return `${sign}${rounded}${unit}`;
}

function deltaTone(d: ImpactDelta): "primary" | "destructive" | "muted" {
  if (d.value == null || Math.abs(d.value) < 0.5) return "muted";
  const isGood = d.direction === "positive" ? d.value > 0 : d.value < 0;
  return isGood ? "primary" : "destructive";
}

const TONE_CLASS: Record<"primary" | "destructive" | "muted", string> = {
  primary: "text-primary",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
};

function ConfidencePill({ level }: { level: "Baixa" | "Média" | "Alta" }) {
  const dots = level === "Alta" ? 3 : level === "Média" ? 2 : 1;
  const tone = level === "Alta" ? "text-primary" : level === "Média" ? "text-warning" : "text-muted-foreground";
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <ShieldCheck className={cn("h-3.5 w-3.5", tone)} />
      <span className="text-muted-foreground">Confiança</span>
      <span className={cn("font-medium", tone)}>{level}</span>
      <span className="flex items-center gap-0.5 ml-0.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              i < dots ? (level === "Alta" ? "bg-primary" : level === "Média" ? "bg-warning" : "bg-muted-foreground") : "bg-muted",
            )}
          />
        ))}
      </span>
    </div>
  );
}

export function PlanImpactCard() {
  const { diag, buckets, liveTracksCount, canonicalPlaylistId } = useCockpit();
  const { brain } = usePlaylistBrainGated(canonicalPlaylistId ?? undefined);

  const total = buckets.remove.length + buckets.demote.length + buckets.promote.length + buckets.add.length;
  if (!diag || total === 0) return null;

  const impact = computePlanImpact(diag, buckets, brain ?? null, liveTracksCount);

  // Se nenhum delta é material e não temos benchmark/top-artists, esconder pra não ocupar espaço.
  const visibleDeltas = impact.deltas.filter((d) => d.value != null);
  if (visibleDeltas.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <SectionTitle>Impacto esperado</SectionTitle>
        <ConfidencePill level={impact.confidence.level} />
      </div>

      <Card className="p-4 md:p-5">
        {!impact.hasMaterial ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <Target className="h-3.5 w-3.5" />
            Sem impacto material projetado nos indicadores do nicho.
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {visibleDeltas.map((d) => {
              const tone = deltaTone(d);
              const Icon = d.value == null || Math.abs(d.value) < 0.5
                ? Minus
                : (d.direction === "positive" ? d.value > 0 : d.value < 0)
                  ? ArrowUp
                  : ArrowDown;
              return (
                <div
                  key={d.key}
                  className="rounded-xl border border-border bg-card/60 p-3 flex flex-col gap-1 min-w-0"
                >
                  <div className="flex items-center gap-1.5">
                    <Icon className={cn("h-3.5 w-3.5", TONE_CLASS[tone])} />
                    <span className={cn("text-base font-semibold tabular-nums leading-none", TONE_CLASS[tone])}>
                      {formatDelta(d)}
                    </span>
                  </div>
                  <div className="text-[11px] text-foreground/80 leading-tight truncate">{d.label}</div>
                  {d.hint && (
                    <div className="text-[10px] text-subtle-foreground leading-tight truncate">{d.hint}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-3 pt-3 border-t border-border/60 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[10px] text-subtle-foreground leading-snug">
            Projeção baseada em benchmark do nicho, top artists e saturação por faixa. Não considera plays futuros.
          </div>
          {impact.ageDays != null && (
            <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-muted-foreground font-normal shrink-0">
              análise há {impact.ageDays === 0 ? "<1d" : `${impact.ageDays}d`}
            </Badge>
          )}
        </div>
      </Card>
    </section>
  );
}
