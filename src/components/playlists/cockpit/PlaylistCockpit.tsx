import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ArrowLeft, ExternalLink, Sparkles, Loader2, Music2, TrendingUp,
  Trash2, Activity, Users, Crown, Eye, Timer, ShieldCheck, ListMusic,
} from "lucide-react";

import { KpiBig } from "@/components/KpiBig";
import { GenrePicker } from "@/components/playlists/cockpit/GenrePicker";

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
  followers, tracksCount, genreName, brainScore, canonicalPlaylistId, onBack,
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
  const [activeTab, setActiveTab] = useState<string>("identidade");
  const [initialTabSet, setInitialTabSet] = useState(false);
  useEffect(() => {
    if (!initialTabSet && diag) {
      setActiveTab(diag.raw?.market_insights ? "mercado" : "identidade");
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
    followers, genreName: genreName ?? null, canonicalPlaylistId: canonicalPlaylistId ?? null,
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
      <header className="space-y-4 md:space-y-5 pt-1">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {onBack && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onBack}
                aria-label="Voltar"
                title="Voltar"
                className="h-9 w-9 -ml-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-elevated shrink-0"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            {coverUrl ? (
              <img
                src={coverUrl}
                alt={playlistName}
                className="w-10 h-10 rounded-md object-cover ring-1 ring-white/5 shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded-md bg-elevated grid place-items-center shrink-0">
                <Music2 className="h-4 w-4 text-muted-foreground/40" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="text-base md:text-lg font-semibold tracking-tight leading-tight truncate">
                {playlistName}
              </h1>
              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                <GenrePicker
                  managedId={managedId}
                  currentGenreName={genreName ?? null}
                />
                {diag?.raw?.niche_rank && (
                  <span className="text-muted-foreground/40 text-[10px]">·</span>
                )}

                {diag?.raw?.niche_rank && diag.raw.niche_total && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-primary font-medium">
                    <Crown className="h-3 w-3" /> #{diag.raw.niche_rank} de {diag.raw.niche_total}
                  </span>
                )}
                {diag && (() => {
                  const ageMs = Date.now() - new Date(diag.created_at).getTime();
                  const ageDays = Math.floor(ageMs / 86_400_000);
                  const stale = ageDays > 30;
                  const warn = ageDays > 7;
                  const cls = stale
                    ? "text-destructive"
                    : warn
                      ? "text-amber-500"
                      : "text-muted-foreground";
                  const label =
                    ageDays <= 0
                      ? "Análise de hoje"
                      : ageDays === 1
                        ? "Análise de 1 dia atrás"
                        : `Análise de ${ageDays} dias atrás`;
                  return (
                    <>
                      <span className="text-muted-foreground/40 text-[10px]">·</span>
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] tabular-nums ${cls}`}
                        title={new Date(diag.created_at).toLocaleString("pt-BR")}
                      >
                        <Timer className="h-3 w-3" />
                        {label}
                      </span>
                      {stale && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={runDiagnose}
                          disabled={running}
                          className="h-6 px-2 text-[10px] gap-1 border-destructive/40 text-destructive hover:bg-destructive/10"
                        >
                          {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                          Atualizar análise
                        </Button>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:flex gap-2 shrink-0 w-full sm:w-auto min-w-0">
            <Button onClick={runDiagnose} disabled={running} size="sm" className="gap-1.5 h-8 min-w-0 px-2 sm:px-3">
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              <span className="truncate">{diag ? "Rodar análise" : "Rodar análise"}</span>
            </Button>
            <Button variant="outline" size="sm" asChild className="h-8 min-w-0 px-2 sm:px-3">
              <a href={spotifyUrl} target="_blank" rel="noreferrer" className="gap-1.5 justify-center min-w-0">
                <ExternalLink className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">Spotify</span>
              </a>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleArchive}
              disabled={archiving}
              className="h-8 w-8 px-0 gap-1.5 text-muted-foreground hover:text-destructive hover:border-destructive/40"
              title="Mover para lixeira"
              aria-label="Mover para lixeira"
            >
              {archiving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">Lixeira</span>
            </Button>
          </div>
        </div>


        {/* KPI row — esconde Faixas e Saúde quando rolar; mantém Seguidores + Score curatorial */}
        <div className="grid gap-2 grid-cols-2 md:grid-cols-5">
          <KpiBig
            label="Seguidores"
            value={fmtNum(followers)}
            icon={Users}
            tier="hero"
            tone="primary"
            domain="playlists"
          />
          <KpiBig
            label="Faixas"
            value={fmtNum(liveTracksCount)}
            icon={Music2}
            domain="playlists"
            hint={idealRange ? `ideal ${idealRange[0]}–${idealRange[1]}` : undefined}
          />
          <KpiBig
            label="Score curatorial"
            value={brainScore != null ? `${brainScore}` : "—"}
            icon={ShieldCheck}
            tone={brainScore == null ? "default" : brainScore >= 75 ? "success" : brainScore >= 50 ? "primary" : "default"}
            hint={brainScore == null ? "sem análise" : "saúde editorial 0–100"}
          />
          <KpiBig
            label="Saúde"
            value={health.label}
            icon={health.Icon}
            tier="quiet"
            tone={
              (diag?.raw?.health_status ?? "saudavel") === "aquecido" ? "primary"
              : (diag?.raw?.health_status ?? "saudavel") === "frio" ? "destructive"
              : "default"
            }
          />
        </div>
      </header>

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
              {market && (
                <TabsTrigger value="mercado" className="h-9 gap-1.5 rounded-xl px-3 text-sm shrink-0 data-[state=active]:bg-background">
                  <TrendingUp className="h-3.5 w-3.5" /> Mercado
                </TabsTrigger>
              )}
              <TabsTrigger value="identidade" className="h-9 gap-1.5 rounded-xl px-3 text-sm shrink-0 data-[state=active]:bg-background">
                <Eye className="h-3.5 w-3.5" /> Identidade
              </TabsTrigger>
              <TabsTrigger value="plano" className="h-9 gap-1.5 rounded-xl px-3 text-sm shrink-0 data-[state=active]:bg-background">
                <Sparkles className="h-3.5 w-3.5" /> <span className="sm:hidden">Plano</span><span className="hidden sm:inline">Plano de ação</span>
                {(buckets.remove.length + buckets.demote.length + buckets.promote.length + buckets.add.length) > 0 && (
                  <Badge variant="outline" className="ml-1 h-4 px-1 text-[10px] tabular-nums">
                    {buckets.remove.length + buckets.demote.length + buckets.promote.length + buckets.add.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="estrategia" className="h-9 gap-1.5 rounded-xl px-3 text-sm shrink-0 data-[state=active]:bg-background">
                <Activity className="h-3.5 w-3.5" /> Estratégia
              </TabsTrigger>
              <TabsTrigger value="editor" className="h-9 gap-1.5 rounded-xl px-3 text-sm shrink-0 data-[state=active]:bg-background">
                <ListMusic className="h-3.5 w-3.5" /> <span className="sm:hidden">Editar</span><span className="hidden sm:inline">Editar manualmente</span>
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

