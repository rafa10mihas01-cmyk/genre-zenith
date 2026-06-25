import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { usePlaylistBrainGated, type LifecyclePhase, type RoadmapStep } from "@/hooks/usePlaylistBrain";
import {
  Sprout, TrendingUp, ShieldCheck, Scissors, AlertTriangle, CheckCircle2, Target, CalendarClock,
} from "lucide-react";

interface Props {
  playlistId: string;
  currentTracks?: number | null;
}

const PHASE_META: Record<LifecyclePhase, {
  label: string;
  icon: typeof Sprout;
  toneClass: string;
  badgeVariant: "default" | "secondary" | "destructive" | "outline";
  description: string;
}> = {
  seed:    { label: "Seed",    icon: Sprout,       toneClass: "text-primary",     badgeVariant: "default",     description: "Construção agressiva — adicionar até atingir 80 faixas." },
  growth:  { label: "Growth",  icon: TrendingUp,   toneClass: "text-primary",     badgeVariant: "default",     description: "Expansão estratégica — até 25% do benchmark por ciclo." },
  mature:  { label: "Mature",  icon: ShieldCheck,  toneClass: "text-foreground",  badgeVariant: "outline",     description: "Modo refinamento editorial — manutenção contínua." },
  bloated: { label: "Bloated", icon: Scissors,     toneClass: "text-warning",     badgeVariant: "secondary",   description: "Acima do benchmark — redução gradual até voltar à faixa saudável." },
  decline: { label: "Decline", icon: AlertTriangle,toneClass: "text-destructive", badgeVariant: "destructive", description: "Queda em 2+ ciclos — intervenção estrutural necessária." },
};

export function LifecycleRoadmapCard({ playlistId, currentTracks }: Props) {
  const { brain, isLoading } = usePlaylistBrainGated(playlistId);

  if (isLoading || !brain) return null;

  const phase = (brain.lifecycle_phase ?? "seed") as LifecyclePhase;
  const meta = PHASE_META[phase];
  const Icon = meta.icon;
  const benchmark = brain.benchmark_tracks;
  const current = currentTracks ?? brain.personality?.total_tracks ?? null;
  const ratio = brain.ratio_to_benchmark;
  const roadmap: RoadmapStep[] = Array.isArray(brain.growth_roadmap) ? brain.growth_roadmap : [];

  // Progress bar (0-100): para seed/growth = % do benchmark; para bloated = excesso restante invertido
  let progressPct = 0;
  if (benchmark && current != null) {
    if (phase === "bloated") progressPct = Math.min(100, Math.round((benchmark / current) * 100));
    else progressPct = Math.min(100, Math.round((current / benchmark) * 100));
  }
  const progressColor =
    phase === "bloated" ? "bg-warning" :
    phase === "decline" ? "bg-destructive" :
    phase === "mature"  ? "bg-foreground/40" : "bg-primary";

  return (
    <Card className="p-5 space-y-4">
      {/* Header: título + badge à esquerda, ícone */}
      <div className="flex items-start gap-3">
        <div className={cn("h-9 w-9 shrink-0 rounded-full grid place-items-center bg-muted", meta.toneClass)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-[15px] font-semibold leading-none">Plano de crescimento</h3>
            <Badge variant={meta.badgeVariant} className="text-[10px]">{meta.label}</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5 leading-snug">{meta.description}</p>
        </div>
      </div>

      {/* Progresso até o benchmark — barra única, rotulada */}
      {benchmark != null && current != null && (
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
            <span>
              Progresso até o benchmark
            </span>
            <span className="tabular-nums">
              <span className="text-foreground font-medium">{current}</span>
              <span> / {benchmark} faixas</span>
              {ratio != null && <span> · {(ratio * 100).toFixed(0)}%</span>}
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", progressColor)}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Mature: estado estável */}
      {phase === "mature" && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-primary" />
          Benchmark atingido — modo refinamento editorial ativo.
        </div>
      )}

      {/* Decline: alerta */}
      {phase === "decline" && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          Queda em 2+ ciclos consecutivos — recomendado intervir na capa, descrição e injeção de hits.
        </div>
      )}

      {/* Roadmap timeline */}
      {roadmap.length > 0 && (
        <ol className="relative pl-4 space-y-2">
          <span className="absolute left-[5px] top-2 bottom-2 w-px bg-border/60" aria-hidden />
          {roadmap.map((step, i) => {
            const isCurrent = i === 0;
            const willHitBenchmark = benchmark != null &&
              step.total >= benchmark * 0.80 && step.total <= benchmark * 1.20;
            const dotColor =
              step.action === "trim" ? "bg-warning" :
              isCurrent ? "bg-primary" : "bg-muted-foreground/40";
            return (
              <li key={step.cycle} className="relative grid grid-cols-[auto_1fr_auto] items-center gap-3 text-[13px]">
                <span
                  className={cn(
                    "absolute -left-[11px] top-1/2 -translate-y-1/2 h-2 w-2 rounded-full ring-2 ring-background",
                    dotColor,
                  )}
                  aria-hidden
                />
                <span className={cn("text-[11px] tabular-nums whitespace-nowrap", isCurrent ? "text-foreground font-medium" : "text-muted-foreground")}>
                  Ciclo {step.cycle}{isCurrent ? " · agora" : ""}
                </span>
                <span className={cn("truncate", isCurrent ? "text-foreground" : "text-muted-foreground")}>
                  {step.action === "build" ? "+" : ""}{step.delta} faixas → {step.total} total
                </span>
                <span className="text-[11px] tabular-nums whitespace-nowrap">
                  {willHitBenchmark && <Badge variant="outline" className="text-[10px]">benchmark</Badge>}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {roadmap.length === 0 && phase !== "mature" && phase !== "decline" && (
        <p className="text-xs text-muted-foreground">
          Sem benchmark de nicho disponível — roadmap será gerado quando o gênero tiver concorrentes mapeados.
        </p>
      )}

      {/* Fase 7A.2: próxima milestone explícita + próxima revisão sugerida.
          Usa apenas dados já carregados do Brain — sem queries novas. */}
      {(roadmap[0] || brain.last_calculated_at) && (
        <div className="pt-3 border-t border-border/60 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          {roadmap[0] && (
            <div className="flex items-start gap-2">
              <Target className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Próxima milestone
                </div>
                <div className="text-foreground">
                  {roadmap[0].action === "build" ? "+" : ""}{roadmap[0].delta} faixas
                  <span className="text-muted-foreground"> → {roadmap[0].total} total</span>
                </div>
              </div>
            </div>
          )}
          {brain.last_calculated_at && (() => {
            const nextRecalc = new Date(brain.last_calculated_at).getTime() + 7 * 86_400_000;
            const days = Math.ceil((nextRecalc - Date.now()) / 86_400_000);
            const label = days <= 0
              ? "Pronto pra reavaliar"
              : days === 1
                ? "Em 1 dia"
                : `Em ${days} dias`;
            return (
              <div className="flex items-start gap-2">
                <CalendarClock className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Próxima revisão
                  </div>
                  <div className={cn(days <= 0 ? "text-warning" : "text-foreground")}>
                    {label}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </Card>
  );
}
