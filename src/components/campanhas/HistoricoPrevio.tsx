import { History, Sparkles, AlertTriangle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Badge âmbar "HISTÓRICO PRÉVIO".
 * Usado em playlists onde `baseline_plays > 0` (música já tinha atividade
 * antes da campanha). Não é erro, não é bloqueio — apenas sinalização visual.
 */
export function HistoricoPrevioBadge({ className }: { className?: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-semibold uppercase tracking-wide border border-warning/40 bg-warning/10 text-warning cursor-help",
              className,
            )}
          >
            <History className="h-2.5 w-2.5" />
            Histórico prévio
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[280px] text-[11px] leading-relaxed">
          Esta música já possuía atividade nesta playlist antes da campanha.
          A entrega continua sendo contabilizada normalmente.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Microcopy de recomendação operacional, exibida ao lado/abaixo do badge.
 * Texto curto e neutro — não acusa, apenas orienta.
 */
export function HistoricoPrevioRecommendation({
  variant = "short",
  className,
}: {
  variant?: "short" | "long";
  className?: string;
}) {
  const text = variant === "long"
    ? "Subir posição da música para validar ganho incremental."
    : "Recomendação: promover posição da faixa.";
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10.5px] text-muted-foreground", className)}>
      <Sparkles className="h-2.5 w-2.5 text-warning/70" />
      {text}
    </span>
  );
}

/**
 * Alerta destacado para o portal do curador.
 * Card âmbar com instrução clara de promoção da faixa.
 */
export function HistoricoPrevioAlert({
  count,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border-2 border-warning/50 bg-warning/10 p-4 flex items-start gap-3 text-[12.5px] leading-relaxed",
        className,
      )}
    >
      <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
      <div className="space-y-1.5 min-w-0">
        <p className="font-semibold text-warning text-[13px] uppercase tracking-wide">
          {count && count > 0
            ? `${count} ${count === 1 ? "playlist precisa" : "playlists precisam"} de ação: subir posição`
            : "Atenção: subir posição"}
        </p>
        <p className="text-foreground/90">
          A música já estava nestas playlists antes da campanha começar.
          <strong className="text-warning"> Promova a faixa para uma posição superior</strong> —
          se a posição não subir, o ganho pode não ser contabilizado como entrega.
        </p>
      </div>
    </div>
  );
}

/**
 * Contador compacto para dashboard do curador: "Playlists com histórico prévio: X".
 * Quando `count > 0`, fica clicável (se onClick for passado).
 */
export function HistoricoPrevioCounter({
  count,
  onClick,
  className,
}: {
  count: number;
  onClick?: () => void;
  className?: string;
}) {
  if (count === 0) return null;
  const isClickable = !!onClick;
  const Component = isClickable ? "button" : "div";
  return (
    <Component
      onClick={onClick}
      className={cn(
        "w-full rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5 flex items-center justify-between gap-3 text-left transition-colors",
        isClickable && "hover:bg-warning/10 cursor-pointer",
        className,
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <History className="h-3.5 w-3.5 text-warning shrink-0" />
        <span className="text-[12px] text-foreground">
          Playlists com histórico prévio
        </span>
      </div>
      <span className="text-base font-semibold tabular-nums text-warning">{count}</span>
    </Component>
  );
}
