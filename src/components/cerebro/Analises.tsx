import { useState } from "react";
import { Database, Lightbulb, Palette, LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { Base } from "@/components/cerebro/Base";
import { Insights } from "@/components/cerebro/Insights";
import { Visual } from "@/components/cerebro/Visual";
import { ResumoGenero } from "@/components/cerebro/ResumoGenero";

type SubTab = "resumo" | "insights" | "base" | "visual";

const SUBS: { id: SubTab; label: string; icon: typeof Database }[] = [
  { id: "resumo", label: "Resumo do mercado", icon: LayoutDashboard },
  { id: "insights", label: "O que aprendeu", icon: Lightbulb },
  { id: "base", label: "Playlists usadas", icon: Database },
  { id: "visual", label: "Capas do mercado", icon: Palette },
];

/**
 * Dados — consolida Resumo + Insights + Base + Visual em sub-abas.
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
  const [sub, setSub] = useState<SubTab>("resumo");

  return (
    <div className="space-y-4">
      <section className="nx-card p-5">
        <div className="flex items-center gap-2 text-muted-foreground mb-2">
          <Database className="h-4 w-4" />
          <span className="text-[11px] uppercase tracking-[0.18em] font-bold">Base externa</span>
        </div>
        <h2 className="text-lg font-bold leading-tight">Dados de mercado usados como referência</h2>
        <p className="text-sm text-muted-foreground mt-1.5 max-w-3xl leading-relaxed">
          Esta área não é das suas playlists. Aqui ficam as playlists, faixas, termos e capas que o cérebro puxou do mercado para comparar e criar a base do gênero.
        </p>
      </section>

      <div className="flex items-center gap-1 border-b border-border overflow-x-auto nx-scroll">
        {SUBS.map((s) => {
          const Icon = s.icon;
          const active = sub === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setSub(s.id)}
              className={cn(
                "h-9 px-3 inline-flex items-center gap-1.5 text-xs font-medium border-b-2 -mb-px transition-colors shrink-0 whitespace-nowrap",
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
        {sub === "resumo" && <ResumoGenero model={model} loading={loading} />}
        {sub === "insights" && <Insights model={model} loading={loading} onReload={onReload} />}
        {sub === "base" && <Base model={model} loading={loading} />}
        {sub === "visual" && (
          <Visual briefing={briefing} loading={loadingBriefing} onAnalyze={onAnalyzeDna} analyzing={analyzingDna} />
        )}
      </div>
    </div>
  );
}
