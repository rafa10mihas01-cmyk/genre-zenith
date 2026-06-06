// CockpitContext — evita prop-drilling entre PlaylistCockpit e os componentes
// das abas. Criado na Fase 2 / Commit 3.
// O Provider apenas re-empacota os retornos dos 3 hooks + as props da playlist
// + os controles de aba/navegação. Nenhuma lógica nova.
import { createContext, useContext, type ReactNode } from "react";
import type { Diagnosis } from "../types";
import type { useDiagnosisLoader } from "../hooks/useDiagnosisLoader";
import type { useDiagnosisActions } from "../hooks/useDiagnosisActions";
import type { useCockpitDerivations } from "../hooks/useCockpitDerivations";

type LoaderShape = ReturnType<typeof useDiagnosisLoader>;
type ActionsShape = ReturnType<typeof useDiagnosisActions>;
type DerivationsShape = ReturnType<typeof useCockpitDerivations>;

export type CockpitContextValue = {
  // identidade da playlist (vem das props originais do PlaylistCockpit)
  managedId: string;
  spotifyPlaylistId: string;
  spotifyUrl: string;
  playlistName: string;
  coverUrl: string | null;
  followers: number | null;
  genreName: string | null;
  canonicalPlaylistId: string | null;
  brainScore: number | null;
  // diagnostico
  diag: Diagnosis | null;
  setDiag: LoaderShape["setDiag"];
  loading: LoaderShape["loading"];
  loadLatest: LoaderShape["loadLatest"];
  // ações
  running: ActionsShape["running"];
  applying: ActionsShape["applying"];
  applyProgress: ActionsShape["applyProgress"];
  liveTracksCount: ActionsShape["liveTracksCount"];
  archiving: ActionsShape["archiving"];
  runDiagnose: ActionsShape["runDiagnose"];
  applyPlan: ActionsShape["applyPlan"];
  handleArchive: ActionsShape["handleArchive"];
  // derivações
  analysis: DerivationsShape["analysis"];
  suggestions: DerivationsShape["suggestions"];
  caps: DerivationsShape["caps"];
  buckets: DerivationsShape["buckets"];
  health: DerivationsShape["health"];
  market: DerivationsShape["market"];
  idealRange: DerivationsShape["idealRange"];
  currentTrackKeys: DerivationsShape["currentTrackKeys"];
  currentArtistKeys: DerivationsShape["currentArtistKeys"];
  suggestionByTitle: DerivationsShape["suggestionByTitle"];
  // navegação cross-tab
  activeTab: string;
  setActiveTab: (t: string) => void;
  jumpToPlanAdd: (trackId?: string) => void;
  onBack?: () => void;
};

const Ctx = createContext<CockpitContextValue | null>(null);

export function CockpitProvider({ value, children }: { value: CockpitContextValue; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCockpit(): CockpitContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCockpit deve ser chamado dentro de <CockpitProvider>");
  return v;
}
