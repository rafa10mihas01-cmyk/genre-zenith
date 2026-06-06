import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, ShieldCheck, Activity, Zap, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { CuratorialStateBadge, CooldownChip } from "@/components/playlist/CuratorialStateBadge";
import type { Diagnosis } from "../types";

const MODE_META: Record<string, { label: string; tone: string; Icon: any }> = {
  hold:       { label: "Não mexer",            tone: "border-primary/40 bg-primary/5 text-primary",                Icon: ShieldCheck },
  light:      { label: "Intervenção leve",     tone: "border-warning/40 bg-warning/5 text-warning",                Icon: Activity },
  moderate:   { label: "Intervenção moderada", tone: "border-warning/60 bg-warning/10 text-warning",               Icon: Zap },
  structural: { label: "Reciclagem estrutural", tone: "border-destructive/40 bg-destructive/5 text-destructive",   Icon: RotateCcw },
};

export function EditorialBanner({
  diag,
  onRediagnose,
  running,
}: {
  diag: Diagnosis;
  onRediagnose: () => void;
  running: boolean;
}) {
  const mode = diag.raw?.recommendation_mode ?? "light";
  const state = diag.raw?.curatorial_state;
  const justification = diag.raw?.editorial_justification ?? "";
  const caps = diag.raw?.applied_caps;
  const cooldowns = diag.raw?.active_cooldowns ?? [];
  const meta = MODE_META[mode] ?? MODE_META.light;
  const Icon = meta.Icon;

  return (
    <div className={cn(
      "rounded-xl border px-3 py-2.5",
      "flex flex-col items-center text-center gap-2",
      "md:flex-row md:items-center md:text-left md:gap-3",
      meta.tone,
    )}>
      <div className={cn("h-7 w-7 rounded-full border grid place-items-center shrink-0", meta.tone)}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="flex flex-col md:flex-row md:items-center md:gap-2 flex-1 min-w-0 gap-1">
        <div className="flex items-center justify-center md:justify-start gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Modo</span>
          <span className="text-xs font-semibold leading-none">{meta.label}</span>
        </div>
        {(state || (caps && mode !== "hold")) && (
          <div className="flex items-center justify-center md:justify-start gap-2 flex-wrap">
            {state && <CuratorialStateBadge state={state} compact />}
            {caps && mode !== "hold" && (
              <span className="text-[11px] text-muted-foreground tabular-nums">
                limite <span className="text-foreground font-semibold">{caps.max_changes}</span> ({caps.max_change_pct}%)
              </span>
            )}
          </div>
        )}
        {cooldowns.length > 0 && (
          <div className="flex flex-wrap justify-center md:justify-start gap-1">
            {cooldowns.map((c) => (
              <CooldownChip key={c.action_type} action={c.action_type} daysRemaining={c.days_remaining} />
            ))}
          </div>
        )}
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={onRediagnose}
        disabled={running}
        className="gap-1 h-7 px-2.5 rounded-full text-[11px] font-medium shrink-0"
        title={justification || "Reavaliar"}
      >
        {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
        Reavaliar
      </Button>
    </div>
  );
}
