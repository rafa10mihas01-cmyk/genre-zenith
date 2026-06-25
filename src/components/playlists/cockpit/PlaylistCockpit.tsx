import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  Sparkles, Loader2, TrendingUp, Activity, Eye, ListMusic,
} from "lucide-react";

// Header sticky com capa/título/KPIs (Commit 6 — cleanup final).
import { CockpitHeader } from "./shared/CockpitHeader";
import { SpotifyAppBlockedBanner } from "./shared/SpotifyAppBlockedBanner";
import { SnapshotStatusBanner } from "./shared/SnapshotStatusBanner";

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
      <div className="mx-auto w-full max-w-[1600px] px-2 md:px-3 lg:px-4 pt-4 md:pt-5 pb-[calc(88px+env(safe-area-inset-bottom,0px))] md:pb-8 space-y-4">
      {/* ============ 1. HEADER ============ */}
      <CockpitHeader />
      <SpotifyAppBlockedBanner managedId={managedId} />
      <SnapshotStatusBanner playlistId={canonicalPlaylistId ?? null} />




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
            <div className="sticky top-0 z-30 -mx-2 md:-mx-3 lg:-mx-4 px-2 md:px-3 lg:px-4 py-3 bg-background/95 supports-[backdrop-filter]:bg-background/80 backdrop-blur-md border-b border-border">
            <TabsList
              className={cn(
                "grid w-full bg-transparent p-0 h-auto gap-2",
                market ? "grid-cols-5" : "grid-cols-4",
              )}
            >
              <TabsTrigger
                value="plano"
                className="flex flex-col items-center justify-center gap-1 rounded-xl border border-border bg-card data-[state=active]:border-primary/60 data-[state=active]:bg-primary/10 data-[state=active]:text-primary text-muted-foreground h-[68px] px-1 min-w-0 transition-colors"
              >
                <Sparkles className="h-4 w-4 shrink-0" />
                <span className="text-[12px] font-medium truncate leading-none">Plano</span>
                <span className="text-[11px] font-bold tabular-nums leading-none">
                  {buckets.remove.length + buckets.demote.length + buckets.promote.length + buckets.add.length}
                </span>
              </TabsTrigger>
              {market && (
                <TabsTrigger
                  value="mercado"
                  className="flex flex-col items-center justify-center gap-1 rounded-xl border border-border bg-card data-[state=active]:border-primary/60 data-[state=active]:bg-primary/10 data-[state=active]:text-primary text-muted-foreground h-[68px] px-1 min-w-0 transition-colors"
                >
                  <TrendingUp className="h-4 w-4 shrink-0" />
                  <span className="text-[12px] font-medium truncate leading-none">Mercado</span>
                </TabsTrigger>
              )}
              <TabsTrigger
                value="editor"
                className="flex flex-col items-center justify-center gap-1 rounded-xl border border-border bg-card data-[state=active]:border-primary/60 data-[state=active]:bg-primary/10 data-[state=active]:text-primary text-muted-foreground h-[68px] px-1 min-w-0 transition-colors"
              >
                <ListMusic className="h-4 w-4 shrink-0" />
                <span className="text-[12px] font-medium truncate leading-none">Editar</span>
              </TabsTrigger>
              <TabsTrigger
                value="identidade"
                className="flex flex-col items-center justify-center gap-1 rounded-xl border border-border bg-card data-[state=active]:border-primary/60 data-[state=active]:bg-primary/10 data-[state=active]:text-primary text-muted-foreground h-[68px] px-1 min-w-0 transition-colors"
              >
                <Eye className="h-4 w-4 shrink-0" />
                <span className="text-[12px] font-medium truncate leading-none">Identidade</span>
              </TabsTrigger>
              <TabsTrigger
                value="estrategia"
                className="flex flex-col items-center justify-center gap-1 rounded-xl border border-border bg-card data-[state=active]:border-primary/60 data-[state=active]:bg-primary/10 data-[state=active]:text-primary text-muted-foreground h-[68px] px-1 min-w-0 transition-colors"
              >
                <Activity className="h-4 w-4 shrink-0" />
                <span className="text-[12px] font-medium truncate leading-none">Estratégia</span>
              </TabsTrigger>
            </TabsList>
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

