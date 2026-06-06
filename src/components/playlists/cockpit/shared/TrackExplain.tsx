// -------------------- TrackExplain --------------------
// Renderiza a hierarquia visual definida em 7A.3:
//   1. Motivo principal (texto, forte)
//   2. Motivos secundários (até 2, em chips com check)
//   3. Confiança (chip tonalizado)
//   4. Impacto esperado (chip neutro)
// Tudo SEM tooltip — visível em mobile.

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { CONFIDENCE_META, type TrackExplanation } from "./trackExplain";

export function TrackExplain({ data }: { data: TrackExplanation }) {
  const conf = CONFIDENCE_META[data.confidence];
  return (
    <div className="flex flex-col gap-1.5 mt-1">
      {/* motivo principal */}
      <div className="text-[11px] text-foreground/90 leading-snug">
        {data.primary}
      </div>

      {/* secundários + confiança + impacto */}
      <div className="flex flex-wrap items-center gap-1">
        {data.secondary.map((s, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-0.5 rounded border border-border bg-elevated/60 px-1.5 py-0.5 text-[10px] text-muted-foreground"
          >
            <Check className="h-2.5 w-2.5 text-primary/80" />
            <span className="truncate max-w-[140px]">{s}</span>
          </span>
        ))}

        <span
          className={cn(
            "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
            conf.tone,
          )}
        >
          {conf.label}
        </span>

        <span className="inline-flex items-center rounded border border-border bg-elevated/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
          Impacto: {data.impact}
        </span>
      </div>
    </div>
  );
}
