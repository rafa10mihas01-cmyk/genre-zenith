import { cn } from "@/lib/utils";
import { Activity, AlertTriangle, Eye, Heart, RotateCcw, Timer, Zap } from "lucide-react";

export type CuratorialState =
  | "saudavel"
  | "observacao"
  | "leve"
  | "moderada"
  | "estrutural"
  | "cooldown";

const STATE_META: Record<CuratorialState, { label: string; cls: string; Icon: typeof Heart }> = {
  saudavel:   { label: "Saudável",     cls: "bg-primary/15 text-primary border-primary/30",         Icon: Heart },
  observacao: { label: "Observação",   cls: "bg-muted/40 text-foreground border-border",            Icon: Eye },
  leve:       { label: "Interv. leve", cls: "bg-warning/15 text-warning border-warning/30",         Icon: Activity },
  moderada:   { label: "Interv. mod.", cls: "bg-warning/25 text-warning border-warning/50",         Icon: Zap },
  estrutural: { label: "Reciclagem",   cls: "bg-destructive/15 text-destructive border-destructive/40", Icon: RotateCcw },
  cooldown:   { label: "Cooldown",     cls: "bg-elevated text-muted-foreground border-border",      Icon: Timer },
};

export function CuratorialStateBadge({
  state,
  className,
  compact = false,
}: {
  state: CuratorialState | null | undefined;
  className?: string;
  compact?: boolean;
}) {
  if (!state) return null;
  const meta = STATE_META[state] ?? STATE_META.saudavel;
  const Icon = meta.Icon;
  // Estado saudável vira só o ícone de coração (maior), pra dar respiro na régua de badges.
  const iconOnly = state === "saudavel";
  return (
    <span
      title={`Estado curatorial: ${meta.label}`}
      aria-label={meta.label}
      className={cn(
        "inline-flex items-center justify-center rounded-full border tabular-nums font-medium",
        iconOnly
          ? (compact ? "w-5 h-5" : "w-6 h-6")
          : (compact ? "px-1.5 h-5 text-[10px] gap-1" : "px-2 h-6 text-[11px] gap-1"),
        meta.cls,
        className,
      )}
    >
      <Icon
        className={cn(
          iconOnly
            ? (compact ? "h-3 w-3" : "h-3.5 w-3.5")
            : (compact ? "h-2.5 w-2.5" : "h-3 w-3"),
        )}
        {...(iconOnly ? { fill: "currentColor" } : {})}
      />
      {!iconOnly && meta.label}
    </span>
  );
}

const ACTION_LABEL: Record<string, string> = {
  cover: "capa",
  description: "descrição",
  tracks_light: "ajuste leve",
  tracks_recycle: "reciclagem",
  structural: "estrutural",
};

export function CooldownChip({
  action,
  daysRemaining,
  className,
}: {
  action: string;
  daysRemaining: number;
  className?: string;
}) {
  const days = Math.max(0, Math.ceil(daysRemaining));
  return (
    <span
      title={`Cooldown ${ACTION_LABEL[action] ?? action}: ${days}d restantes`}
      className={cn(
        "inline-flex items-center gap-1 px-1.5 h-5 rounded-full border text-[10px] font-medium bg-elevated text-muted-foreground border-border",
        className,
      )}
    >
      <Timer className="h-2.5 w-2.5" />
      {ACTION_LABEL[action] ?? action} {days}d
    </span>
  );
}

export function CooldownStack({
  cooldowns,
  max = 2,
}: {
  cooldowns: Array<{ action_type: string; days_remaining: number }>;
  max?: number;
}) {
  if (!cooldowns?.length) return null;
  const shown = cooldowns.slice(0, max);
  const extra = cooldowns.length - shown.length;
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {shown.map((c) => (
        <CooldownChip key={c.action_type} action={c.action_type} daysRemaining={c.days_remaining} />
      ))}
      {extra > 0 && (
        <span className="inline-flex items-center px-1.5 h-5 rounded-full border border-border bg-elevated text-muted-foreground text-[10px] font-medium">
          +{extra}
        </span>
      )}
    </div>
  );
}

/** Painel completo para detalhe da playlist */
export function CuratorialCycleCard({
  state,
  cooldowns,
  lastMaintenanceAt,
  maxChangePct,
  recommendedChangeCount,
}: {
  state: CuratorialState | null | undefined;
  cooldowns: Array<{ action_type: string; days_remaining: number; cooldown_until: string }>;
  lastMaintenanceAt: string | null;
  maxChangePct: number | null;
  recommendedChangeCount: number | null;
}) {
  const blocks = cooldowns?.length ?? 0;
  return (
    <div className="nx-card space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Ciclo curatorial</h3>
        <CuratorialStateBadge state={state} />
      </div>

      <div className="grid grid-cols-2 gap-3 text-[12px]">
        <div>
          <div className="text-muted-foreground text-[10px] uppercase tracking-wide mb-0.5">Última manutenção</div>
          <div className="font-medium">
            {lastMaintenanceAt ? new Date(lastMaintenanceAt).toLocaleDateString("pt-BR") : "—"}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground text-[10px] uppercase tracking-wide mb-0.5">Limite por ciclo</div>
          <div className="font-medium tabular-nums">
            {maxChangePct ?? 5}%
            {recommendedChangeCount ? ` · ${recommendedChangeCount} faixas` : ""}
          </div>
        </div>
      </div>

      <div>
        <div className="text-muted-foreground text-[10px] uppercase tracking-wide mb-1.5">
          Cooldowns ativos {blocks > 0 && <span className="text-foreground">({blocks})</span>}
        </div>
        {blocks === 0 ? (
          <div className="text-[12px] text-muted-foreground">Nenhum bloqueio. Todas as ações estão liberadas.</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {cooldowns.map((c) => (
              <CooldownChip key={c.action_type} action={c.action_type} daysRemaining={c.days_remaining} />
            ))}
          </div>
        )}
      </div>

      {state === "saudavel" && blocks === 0 && (
        <div className="flex items-start gap-2 text-[12px] text-muted-foreground border-t border-border pt-3">
          <Heart className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" />
          <span>Playlist estável. <span className="text-foreground font-medium">Nenhuma alteração recomendada</span> no momento.</span>
        </div>
      )}
      {state === "cooldown" && (
        <div className="flex items-start gap-2 text-[12px] text-muted-foreground border-t border-border pt-3">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-warning shrink-0" />
          <span>Janela de observação ativa. Aguardando maturação para sugerir próxima intervenção.</span>
        </div>
      )}
    </div>
  );
}
