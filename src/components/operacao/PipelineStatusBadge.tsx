/* eslint-disable react-refresh/only-export-components -- co-located helpers/variants/hooks; split would force a large refactor with no runtime benefit (HMR only) */
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

export type PipelineStatus =
  | "novo" | "contatado" | "respondeu" | "negociando" | "fechado" | "sem_resposta" | "blacklist";

export const PIPELINE_STATUS_META: Record<PipelineStatus, {
  label: string;
  dot: string;
  border: string;
  pill: string;
}> = {
  novo:         { label: "Novo",         dot: "bg-muted-foreground",                        border: "border-l-muted-foreground/30",          pill: "bg-elevated text-muted-foreground border-border" },
  contatado:    { label: "Contatado",    dot: "bg-warning",                                  border: "border-l-warning/60",                   pill: "bg-warning/10 text-warning border-warning/30" },
  respondeu:    { label: "Respondeu",    dot: "bg-primary shadow-[0_0_8px_rgba(29,185,84,0.5)]", border: "border-l-primary/80",              pill: "bg-primary/15 text-primary border-primary/30" },
  negociando:   { label: "Negociando",   dot: "bg-blue-500",                                 border: "border-l-blue-500/70",                  pill: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  fechado:      { label: "Fechado",      dot: "bg-primary",                                  border: "border-l-primary",                      pill: "bg-primary/20 text-primary border-primary/50" },
  sem_resposta: { label: "Sem resposta", dot: "bg-destructive/60",                           border: "border-l-destructive/40",               pill: "bg-destructive/10 text-destructive/80 border-destructive/30" },
  blacklist:    { label: "Blacklist",    dot: "bg-destructive",                              border: "border-l-destructive",                  pill: "bg-destructive/15 text-destructive border-destructive/40" },
};

export const PIPELINE_STATUSES: PipelineStatus[] = [
  "novo","contatado","respondeu","negociando","fechado","sem_resposta","blacklist",
];

export function PipelineStatusBadge({
  status, onChange, size = "sm",
}: {
  status: PipelineStatus;
  onChange?: (next: PipelineStatus) => void;
  size?: "xs" | "sm";
}) {
  const meta = PIPELINE_STATUS_META[status] ?? PIPELINE_STATUS_META.novo;
  const heightCls = size === "xs" ? "h-5 text-[10px] px-1.5" : "h-6 text-[11px] px-2";
  if (!onChange) {
    return (
      <span className={cn("inline-flex items-center gap-1.5 rounded-md border font-medium", heightCls, meta.pill)}>
        <span className={cn("w-1.5 h-1.5 rounded-full", meta.dot)} />
        {meta.label}
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border font-medium transition-opacity hover:opacity-80",
            heightCls, meta.pill,
          )}
        >
          <span className={cn("w-1.5 h-1.5 rounded-full", meta.dot)} />
          {meta.label}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44 p-1 rounded-xl">
        {PIPELINE_STATUSES.map((s) => {
          const m = PIPELINE_STATUS_META[s];
          const active = s === status;
          return (
            <DropdownMenuItem
              key={s}
              onClick={(e) => { e.stopPropagation(); onChange(s); }}
              className="gap-2 rounded-lg text-xs"
            >
              <span className={cn("w-1.5 h-1.5 rounded-full", m.dot)} />
              <span className="flex-1">{m.label}</span>
              {active && <Check className="h-3.5 w-3.5 text-primary" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}