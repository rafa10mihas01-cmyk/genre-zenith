import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Sparkles, Loader2, TrendingUp, Activity, Eye, ListMusic,
} from "lucide-react";

// Header sticky com capa/título/KPIs (Commit 6 — cleanup final).
import { CockpitHeader } from "./shared/CockpitHeader";
import { SpotifyAppBlockedBanner } from "./shared/SpotifyAppBlockedBanner";

// Tabs (Commits 4 e 5 da Fase 2) — cada aba consome o CockpitContext.
import { PlanTab } from "./tabs/PlanTab";
import { IdentityTab } from "./tabs/IdentityTab";
import { MarketTab } from "./tabs/MarketTab";
import { StrategyTab } from "./tabs/StrategyTab";
import { EditorTab } from "./tabs/EditorTab";

// Tipos / helpers / hooks / context — extraídos nos Commits 1 e 3 da Fase 2.
import type { Props } from "./types";
import { fmtNum } from "./helpers";
import { useDiagnosisLoader } from "./hooks/useDiagnosisLoader";
import { useDiagnosisActions } from "./hooks/useDiagnosisActions";
import { useCockpitDerivations } from "./hooks/useCockpitDerivations";
import { CockpitProvider, type CockpitContextValue } from "./context/CockpitContext";


// -------------------- main --------------------
export function PlaylistCockpit({
  managedId, spotifyPlaylistId, spotifyUrl, playlistName, coverUrl,
  followers, tracksCount, genreId, genreName, brainScore, canonicalPlaylistId, onBack,
}: Props) {
  // 1) Loader: diag + loading + loadLatest (efeito de mount embutido).
  const { diag, setDiag, loading, loadLatest } = useDiagnosisLoader(managedId);

  // 2) Ações: runDiagnose, applyPlan, archive, contadores de progresso.
  const {
    running, applying, applyProgress, liveTracksCount,
    archiving, runDiagnose, applyPlan, handleArchive,
  } = useDiagnosisActions({ managedId, playlistName, tracksCount, setDiag, onBack });

  // 3) Derivações (useMemos): buckets, market, health, cross-tab keys.
  const derivations = useCockpitDerivations(diag);
  const {
    analysis, suggestions, caps,
    buckets, health, market, idealRange,
    currentTrackKeys, currentArtistKeys, suggestionByTitle,
  } = derivations;

  // 4) Estado puramente local de aba (coordena Mercado → Plano).
  // Default = "plano" (Fase 7A.2): operador chega direto na decisão.
  const [activeTab, setActiveTab] = useState<string>("plano");
  const [initialTabSet, setInitialTabSet] = useState(false);
  useEffect(() => {
    if (!initialTabSet && diag) {
      setActiveTab("plano");
      setInitialTabSet(true);
    }
  }, [diag, initialTabSet]);

  // Pula da aba Mercado pro card correspondente no Plano de ação.
  const jumpToPlanAdd = useCallback((trackId?: string) => {
    setActiveTab("plano");
    setTimeout(() => {
      const target = trackId
        ? document.querySelector(`[data-add-track-id="${trackId}"]`)
        : document.getElementById("bucket-add");
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (trackId && target) {
        target.classList.add("ring-2", "ring-primary/60");
        setTimeout(() => target.classList.remove("ring-2", "ring-primary/60"), 1800);
      }
    }, 80);
  }, []);

  // Monta o valor do contexto que será consumido pelas abas (Commits 4 e 5).
  const ctxValue: CockpitContextValue = {
    managedId, spotifyPlaylistId, spotifyUrl, playlistName, coverUrl,
    followers, genreId: genreId ?? null, genreName: genreName ?? null,
    canonicalPlaylistId: canonicalPlaylistId ?? null,
    brainScore: brainScore ?? null,
    diag, setDiag, loading, loadLatest,
    running, applying, applyProgress, liveTracksCount, archiving,
    runDiagnose, applyPlan, handleArchive,
    analysis, suggestions, caps,
    buckets, health, market, idealRange,
    currentTrackKeys, currentArtistKeys, suggestionByTitle,
    activeTab, setActiveTab, jumpToPlanAdd, onBack,
  };

  return (
    <CockpitProvider value={ctxValue}>
    <div className="h-full min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain nx-scroll">
      <div className="mx-auto w-full max-w-[1600px] px-4 md:px-8 pt-4 md:pt-5 pb-[calc(88px+env(safe-area-inset-bottom,0px))] md:pb-8 space-y-4">
      {/* ============ 1. HEADER ============ */}
      <CockpitHeader />
      <SpotifyAppBlockedBanner managedId={managedId} />


      {loading ? (
        <Card className="p-10 grid place-items-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </Card>
      ) : !diag ? (
        <Card className="p-10 text-center space-y-3">
          <Sparkles className="h-8 w-8 text-primary/60 mx-auto" />
          <h3 className="font-semibold">Sem diagnóstico ainda</h3>
          <p className="text-sm text-muted-foreground">Clique em <strong>Rodar análise</strong> para gerar o cockpit.</p>
        </Card>
      ) : (
        <>






          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <div className="sticky top-0 z-30 -mx-4 md:-mx-8 px-4 md:px-8 py-3 bg-background/95 supports-[backdrop-filter]:bg-background/80 backdrop-blur-md border-b border-border">
            <div className="overflow-x-auto nx-scroll -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <TabsList className="inline-flex w-max items-center justify-start gap-1 h-auto rounded-2xl bg-elevated/80 p-1.5 text-muted-foreground whitespace-nowrap">
              <TabsTrigger value="plano" className="h-9 gap-1.5 rounded-xl px-3 text-sm shrink-0 data-[state=active]:bg-background">
                <Sparkles className="h-3.5 w-3.5" /> <span className="sm:hidden">Plano</span><span className="hidden sm:inline">Plano de ação</span>
                {(buckets.remove.length + buckets.demote.length + buckets.promote.length + buckets.add.length) > 0 && (
                  <Badge variant="outline" className="ml-1 h-4 px-1 text-[10px] tabular-nums">
                    {buckets.remove.length + buckets.demote.length + buckets.promote.length + buckets.add.length}
                  </Badge>
                )}
              </TabsTrigger>
              {market && (
                <TabsTrigger value="mercado" className="h-9 gap-1.5 rounded-xl px-3 text-sm shrink-0 data-[state=active]:bg-background">
                  <TrendingUp className="h-3.5 w-3.5" /> Mercado
                </TabsTrigger>
              )}
              <TabsTrigger value="editor" className="h-9 gap-1.5 rounded-xl px-3 text-sm shrink-0 data-[state=active]:bg-background">
                <ListMusic className="h-3.5 w-3.5" /> <span className="sm:hidden">Editar</span><span className="hidden sm:inline">Editar manualmente</span>
              </TabsTrigger>
              <TabsTrigger value="identidade" className="h-9 gap-1.5 rounded-xl px-3 text-sm shrink-0 data-[state=active]:bg-background">
                <Eye className="h-3.5 w-3.5" /> Identidade
              </TabsTrigger>
              <TabsTrigger value="estrategia" className="h-9 gap-1.5 rounded-xl px-3 text-sm shrink-0 data-[state=active]:bg-background">
                <Activity className="h-3.5 w-3.5" /> Estratégia
              </TabsTrigger>
            </TabsList>
            </div>
            </div>

            {/* ============ PLANO DE AÇÃO ============ */}
            <TabsContent value="plano" className="space-y-6 mt-0">
              <PlanTab />
            </TabsContent>

            {/* ============ IDENTIDADE ============ */}
            <TabsContent value="identidade" className="space-y-4 mt-0">
              <IdentityTab />
            </TabsContent>


            {/* ============ MERCADO ============ */}
            {market && (
              <TabsContent value="mercado" className="space-y-4 mt-0">
                <MarketTab />
              </TabsContent>
            )}

            {/* ============ ESTRATÉGIA ============ */}
            <TabsContent value="estrategia" className="space-y-4 mt-0">
              <StrategyTab />
            </TabsContent>

            {/* ============ EDITOR (drag-and-drop) ============ */}
            <TabsContent value="editor" className="space-y-3 mt-0">
              <EditorTab />
            </TabsContent>
          </Tabs>
        </>
      )}
      </div>
    </div>
    </CockpitProvider>
  );
}

