// PlanStatusBand — banda compacta de status no topo do Plano.
// UI-only: consome dados JÁ EXISTENTES no Cockpit (diag.created_at) e no
// hook usePlaylistBrain (já usado em outros pontos — React Query cacheia).
// Não dispara queries novas, não toca regras, não escreve nada.
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  ShieldCheck, TrendingUp, TrendingDown, Minus, Sparkles, AlertTriangle, Timer, Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePlaylistBrainGated, type PlaylistBrain } from "@/hooks/usePlaylistBrain";
import { useCockpit } from "../context/CockpitContext";

function ageLabel(iso?: string | null) {
  if (!iso) return null;
  const ageMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ageMs / 86_400_000);
  const hours = Math.floor(ageMs / 3_600_000);
  if (days >= 1) return days === 1 ? "1 dia" : `${days} dias`;
  if (hours >= 1) return hours === 1 ? "1 hora" : `${hours} horas`;
  const mins = Math.max(1, Math.floor(ageMs / 60_000));
  return `${mins} min`;
}

function trendMeta(t: PlaylistBrain["health_trend"]) {
  switch (t) {
    case "crescendo": return { label: "Crescendo", Icon: TrendingUp, tone: "text-primary" };
    case "encolhendo": return { label: "Encolhendo", Icon: TrendingDown, tone: "text-destructive" };
    case "estavel": return { label: "Estável", Icon: Minus, tone: "text-muted-foreground" };
    case "novo": return { label: "Recente", Icon: Sparkles, tone: "text-muted-foreground" };
    default: return { label: "Sem dados", Icon: Minus, tone: "text-muted-foreground/60" };
  }
}

function confidenceTone(c: number) {
  if (c >= 75) return "text-primary";
  if (c >= 50) return "text-foreground";
  if (c >= 25) return "text-warning";
  return "text-destructive";
}

export function PlanStatusBand() {
  const { canonicalPlaylistId, diag } = useCockpit();
  const { brain } = usePlaylistBrainGated(canonicalPlaylistId ?? undefined);

  // Sem brain: ainda mostramos a idade da análise se houver diag.
  const confidence = brain?.confidence_score ?? null;
  const trend = brain?.health_trend ?? "sem_dados";
  const tMeta = trendMeta(trend);
  const TIcon = tMeta.Icon;
  const age = ageLabel(diag?.created_at);
  const highSignals = (brain?.signals ?? []).filter((s) => s.severity === "high");
  const medSignals = (brain?.signals ?? []).filter((s) => s.severity === "medium");
  const visibleSignals = [...highSignals, ...medSignals].slice(0, 4);
  const remainingSignals = (brain?.signals?.length ?? 0) - visibleSignals.length;

  // Nada útil pra mostrar — não renderiza pra não poluir.
  if (!brain && !diag) return null;

  return (
    <Card className="p-3 md:p-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {/* Confiança */}
        {confidence != null && (
          <div className="flex items-center gap-1.5 text-xs">
            <ShieldCheck className={cn("h-3.5 w-3.5", confidenceTone(confidence))} />
            <span className="text-muted-foreground">Confiança</span>
            <span className={cn("tabular-nums font-medium", confidenceTone(confidence))}>
              {Math.round(confidence)}%
            </span>
          </div>
        )}

        {/* Tendência */}
        <div className="flex items-center gap-1.5 text-xs">
          <TIcon className={cn("h-3.5 w-3.5", tMeta.tone)} />
          <span className="text-muted-foreground">Tendência</span>
          <span className={cn("font-medium", tMeta.tone)}>{tMeta.label}</span>
        </div>

        {/* Última análise (diag.created_at — único timestamp confiável já carregado) */}
        {age && (
          <div className="flex items-center gap-1.5 text-xs">
            <Timer className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Última análise</span>
            <span className="font-medium text-foreground">{age} atrás</span>
          </div>
        )}

        {/* Sinais ativos */}
        {visibleSignals.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <Activity className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Sinais</span>
            <div className="flex flex-wrap gap-1">
              {visibleSignals.map((s) => (
                <Badge
                  key={s.code}
                  variant="outline"
                  title={s.message}
                  className={cn(
                    "h-5 px-1.5 text-[10px] font-medium gap-1",
                    s.severity === "high"
                      ? "border-destructive/40 text-destructive bg-destructive/5"
                      : "border-warning/40 text-warning bg-warning/5",
                  )}
                >
                  {s.severity === "high" && <AlertTriangle className="h-2.5 w-2.5" />}
                  {s.message}
                </Badge>
              ))}
              {remainingSignals > 0 && (
                <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-muted-foreground">
                  +{remainingSignals}
                </Badge>
              )}
            </div>
          </div>
        )}

        {/* Estado limpo quando nada acontece */}
        {visibleSignals.length === 0 && brain && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            Sem alertas
          </div>
        )}
      </div>
    </Card>
  );
}
