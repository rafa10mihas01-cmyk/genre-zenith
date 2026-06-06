// StrategyTab — extraído 1:1 do PlaylistCockpit.tsx (Fase 2 / Commit 4).
import { LifecycleRoadmapCard } from "@/components/playlists/cockpit/LifecycleRoadmapCard";
import { GenreAffinityCard } from "@/components/playlists/cockpit/GenreAffinityCard";
import { SeoExperimentCard } from "@/components/playlists/cockpit/SeoExperimentCard";
import { useCockpit } from "../context/CockpitContext";

export function StrategyTab() {
  const { canonicalPlaylistId, liveTracksCount, managedId } = useCockpit();
  return (
    <>
      {canonicalPlaylistId && (
        <LifecycleRoadmapCard
          playlistId={canonicalPlaylistId}
          currentTracks={liveTracksCount}
        />
      )}
      <GenreAffinityCard managedId={managedId} />
      <SeoExperimentCard managedId={managedId} />
    </>
  );
}
