import { useState } from "react";
import { Database, Lightbulb, Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import { Base } from "@/components/cerebro/Base";
import { Insights } from "@/components/cerebro/Insights";
import { Visual } from "@/components/cerebro/Visual";

type SubTab = "insights" | "base" | "visual";

const SUBS: { id: SubTab; label: string; icon: typeof Database }[] = [
  { id: "insights", label: "Insights", icon: Lightbulb },
  { id: "base", label: "Base de dados", icon: Database },
  { id: "visual", label: "DNA visual", icon: Palette },
];

/**
 * Análises — consolida Insights + Base + Visual em sub-abas.
 * Filosofia: humano interpreta, IA fornece dados.
 */
export function Analises({
  model,
  loading,
  briefing,
  loadingBriefing,
  onReload,
  onAnalyzeDna,
  analyzingDna,
}: {
  model: any;
  loading: boolean;
  briefing: any;
  loadingBriefing: boolean;
  onReload: () => void;
  onAnalyzeDna: () => Promise<any>;
  analyzingDna: boolean;
}) {
  const [sub, setSub] = useState<SubTab>("insights");

  return (
    <div className="space-y-4">
      {/* Sub-abas — visual mais leve que tabs principais */}
      <div className="flex items-center gap-1 border-b border-border">
        {SUBS.map((s) => {
          const Icon = s.icon;
          const active = sub === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setSub(s.id)}
              className={cn(
                "h-9 px-3 inline-flex items-center gap-1.5 text-xs font-medium border-b-2 -mb-px transition-colors",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {s.label}
            </button>
          );
        })}
      </div>

      <div className="animate-tab-in">
        {sub === "insights" && <Insights model={model} loading={loading} onReload={onReload} />}
        {sub === "base" && <Base model={model} loading={loading} />}
        {sub === "visual" && (
          <Visual briefing={briefing} loading={loadingBriefing} onAnalyze={onAnalyzeDna} analyzing={analyzingDna} />
        )}
      </div>
    </div>
  );
}
