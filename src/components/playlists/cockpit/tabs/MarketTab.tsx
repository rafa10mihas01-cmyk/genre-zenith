// MarketTab — extraído 1:1 do PlaylistCockpit.tsx (Fase 2 / Commit 4).
import { MarketBlock } from "../shared/MarketBlock";
import { useCockpit } from "../context/CockpitContext";

export function MarketTab() {
  const {
    market, idealRange, currentTrackKeys, currentArtistKeys,
    suggestionByTitle, jumpToPlanAdd,
  } = useCockpit();
  if (!market) return null;
  return (
    <MarketBlock
      market={market}
      idealRange={idealRange}
      currentTrackKeys={currentTrackKeys}
      currentArtistKeys={currentArtistKeys}
      suggestionByTitle={suggestionByTitle}
      onJumpToAdd={jumpToPlanAdd}
    />
  );
}
