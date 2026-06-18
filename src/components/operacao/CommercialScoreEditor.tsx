/* eslint-disable react-refresh/only-export-components -- co-located helpers/variants/hooks; split would force a large refactor with no runtime benefit (HMR only) */
import { cn } from "@/lib/utils";

export type CommercialScore = {
  responde_rapido?: number;
  aceita_divulgacao?: number;
  ticket_medio?: number;
  confiabilidade?: number;
  frequencia?: number;
};

const DIMENSIONS: { key: keyof CommercialScore; label: string; hint: string }[] = [
  { key: "responde_rapido",   label: "Responde rápido", hint: "Tempo médio de resposta" },
  { key: "aceita_divulgacao", label: "Aceita parceria", hint: "Abertura a divulgação paga/permuta" },
  { key: "ticket_medio",      label: "Ticket",          hint: "Faixa de valor cobrada" },
  { key: "confiabilidade",    label: "Confiabilidade",  hint: "Entrega o que promete" },
  { key: "frequencia",        label: "Frequência",      hint: "Periodicidade de updates na playlist" },
];

export function commercialScoreAverage(score: CommercialScore | null | undefined): number {
  if (!score) return 0;
  const vals = DIMENSIONS.map((d) => Number(score[d.key]) || 0).filter((v) => v > 0);
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export function CommercialScoreDots({
  score, className,
}: { score: CommercialScore | null | undefined; className?: string }) {
  const avg = commercialScoreAverage(score);
  if (avg === 0) {
    return <span className={cn("text-[10px] text-muted-foreground", className)}>Sem score</span>;
  }
  return (
    <div className={cn("inline-flex items-center gap-0.5", className)} title={`Score comercial: ${avg.toFixed(1)}/5`}>
      {[1,2,3,4,5].map((n) => (
        <span
          key={n}
          className={cn(
            "w-1.5 h-1.5 rounded-full",
            avg >= n ? "bg-primary" : "bg-border",
          )}
        />
      ))}
      <span className="ml-1 text-[10px] tabular-nums text-muted-foreground">{avg.toFixed(1)}</span>
    </div>
  );
}

export function CommercialScoreEditor({
  value, onChange,
}: {
  value: CommercialScore;
  onChange: (next: CommercialScore) => void;
}) {
  return (
    <div className="space-y-3">
      {DIMENSIONS.map((d) => {
        const v = Number(value[d.key]) || 0;
        return (
          <div key={d.key}>
            <div className="flex items-baseline justify-between mb-1">
              <div>
                <div className="text-xs font-medium text-foreground">{d.label}</div>
                <div className="text-[10.5px] text-muted-foreground">{d.hint}</div>
              </div>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {v > 0 ? `${v}/5` : "—"}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {[1,2,3,4,5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => onChange({ ...value, [d.key]: v === n ? 0 : n })}
                  className={cn(
                    "flex-1 h-7 rounded-md border text-[11px] font-medium transition-colors",
                    v >= n
                      ? "bg-primary/15 border-primary/40 text-primary"
                      : "bg-elevated border-border text-muted-foreground hover:border-primary/30",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}