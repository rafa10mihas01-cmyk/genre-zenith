// BrainObserver — radar cultural vivo do mercado musical BR.
// Container que organiza as 6 visões da observabilidade evolutiva +
// mantém o painel atual do Genre Brain como "Estado atual".
import { useState } from "react";
import { Activity, Clock, ShuffleIcon, Map, Type, TrendingUp, Brain } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { GenreBrainPanel } from "../GenreBrainPanel";
import { BrainOverviewTab } from "./BrainOverviewTab";
import { CulturalTimelineTab } from "./CulturalTimelineTab";
import { DriftVisualTab } from "./DriftVisualTab";
import { MarketHeatmapTab } from "./MarketHeatmapTab";
import { SemanticEvolutionTab } from "./SemanticEvolutionTab";
import { LeadershipEvolutionTab } from "./LeadershipEvolutionTab";

type Tab = "overview" | "timeline" | "heatmap" | "drift" | "semantic" | "leadership" | "snapshot";

const TABS: Array<{ id: Tab; label: string; icon: LucideIcon }> = [
  { id: "overview", label: "Radar", icon: Activity },
  { id: "timeline", label: "Timeline", icon: Clock },
  { id: "heatmap", label: "Heatmap", icon: Map },
  { id: "drift", label: "Drift visual", icon: ShuffleIcon },
  { id: "semantic", label: "Semântica", icon: Type },
  { id: "leadership", label: "Liderança", icon: TrendingUp },
  { id: "snapshot", label: "Estado atual", icon: Brain },
];

export function BrainObserver() {
  const [tab, setTab] = useState<Tab>("overview");

  return (
    <section className="space-y-5">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h2 className="text-[15px] font-semibold">Observatório do nicho</h2>
        </div>
        <p className="text-[12px] text-muted-foreground">
          radar cultural vivo · evolução temporal do cérebro e do mercado
        </p>
      </header>

      <nav className="flex items-center gap-1 border-b border-border overflow-x-auto">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium border-b-2 transition-colors whitespace-nowrap",
              tab === id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </nav>

      <div>
        {tab === "overview" && <BrainOverviewTab />}
        {tab === "timeline" && <CulturalTimelineTab />}
        {tab === "heatmap" && <MarketHeatmapTab />}
        {tab === "drift" && <DriftVisualTab />}
        {tab === "semantic" && <SemanticEvolutionTab />}
        {tab === "leadership" && <LeadershipEvolutionTab />}
        {tab === "snapshot" && <GenreBrainPanel />}
      </div>
    </section>
  );
}
