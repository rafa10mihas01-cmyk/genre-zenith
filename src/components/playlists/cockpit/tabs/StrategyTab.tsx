// StrategyTab — refatorado Fase 7D / D6.
// Aplica TabShell: Banner → KPIs (fase, benchmark, próxima milestone) → Primary (Roadmap) → Secondary (Afinidade + SEO).
import { LifecycleRoadmapCard } from "@/components/playlists/cockpit/LifecycleRoadmapCard";
import { GenreAffinityCard } from "@/components/playlists/cockpit/GenreAffinityCard";
import { SeoExperimentCard } from "@/components/playlists/cockpit/SeoExperimentCard";
import { TabShell } from "../shared/ds/TabShell";
import { TabContextBanner } from "../shared/ds/TabContextBanner";
import { TabKpiStrip } from "../shared/ds/TabKpiStrip";
import { KpiCard } from "../shared/ds/KpiCard";
import { SecondarySection } from "../shared/ds/SecondarySection";
import { useCockpit } from "../context/CockpitContext";
import { usePlaylistBrainGated } from "@/hooks/usePlaylistBrain";

const PHASE_LABEL: Record<string, { label: string; tone: "primary" | "default" | "warning" | "destructive" | "muted" }> = {
  seed:    { label: "Seed",    tone: "primary" },
  growth:  { label: "Growth",  tone: "primary" },
  mature:  { label: "Mature",  tone: "default" },
  bloated: { label: "Bloated", tone: "warning" },
  decline: { label: "Decline", tone: "destructive" },
};

export function StrategyTab() {
  const { canonicalPlaylistId, liveTracksCount, managedId } = useCockpit();
  const { brain } = usePlaylistBrainGated(canonicalPlaylistId ?? undefined);

  const phase = brain?.lifecycle_phase ?? null;
  const phaseMeta = phase ? PHASE_LABEL[phase] : null;
  const benchmark = brain?.benchmark_tracks ?? null;
  const ratio = brain?.ratio_to_benchmark ?? null;
  const roadmap = Array.isArray(brain?.growth_roadmap) ? brain!.growth_roadmap : [];
  const nextStep = roadmap.find((s) => s.cycle === 1) ?? roadmap[0] ?? null;

  const nextActionLabel = nextStep
    ? `${nextStep.action === "build" ? "Adicionar" : "Remover"} ${Math.abs(nextStep.delta)}`
    : "—";
  const nextActionHint = nextStep ? `até ${nextStep.total} faixas` : "sem próximos passos";

  return (
    <TabShell
      banner={
        <TabContextBanner
          title="Estratégia de crescimento"
          subtitle="Onde a playlist está no ciclo e qual o próximo movimento para chegar ao benchmark do nicho."
        />
      }
      kpis={
        <TabKpiStrip>
          <KpiCard
            label="Fase atual"
            value={phaseMeta?.label ?? "—"}
            hint="ciclo de vida"
            tone={(phaseMeta?.tone ?? "muted") as any}
          />
          <KpiCard
            label="Tamanho atual"
            value={liveTracksCount ?? "—"}
            hint={benchmark ? `benchmark: ${benchmark}` : "sem benchmark"}
          />
          <KpiCard
            label="Cobertura do benchmark"
            value={ratio != null ? `${Math.round(ratio * 100)}%` : "—"}
            hint={ratio == null ? "—" : ratio >= 1 ? "acima do ideal" : "abaixo do ideal"}
            tone={ratio == null ? "muted" : ratio >= 1 ? "warning" : "primary"}
          />
          <KpiCard
            label="Próxima milestone"
            value={nextActionLabel}
            hint={nextActionHint}
            tone={nextStep ? "primary" : "muted"}
          />
        </TabKpiStrip>
      }
      primary={
        canonicalPlaylistId ? (
          <LifecycleRoadmapCard
            playlistId={canonicalPlaylistId}
            currentTracks={liveTracksCount}
          />
        ) : (
          <div className="text-sm text-muted-foreground p-4 border border-dashed border-border/60 rounded-xl">
            Roadmap indisponível — playlist sem ID canônico.
          </div>
        )
      }
      secondary={
        <>
          <SecondarySection title="Afinidade com o gênero" defaultOpen={false}>
            <GenreAffinityCard managedId={managedId} />
          </SecondarySection>
          <SecondarySection title="Experimentos de SEO" defaultOpen={false}>
            <SeoExperimentCard managedId={managedId} />
          </SecondarySection>
        </>
      }
    />
  );
}
