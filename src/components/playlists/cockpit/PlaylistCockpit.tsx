import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, ExternalLink, Sparkles, Loader2, Music2, TrendingUp,
  Trash2, ChevronDown, Activity, Users, Crown, Check,
  Eye, Timer, ShieldCheck, AlertTriangle, ListMusic,
} from "lucide-react";

import { PlaylistEditorTab } from "@/components/playlists/PlaylistEditorTab";
import { KpiBig } from "@/components/KpiBig";
import { ProjecaoFaixa } from "@/components/operacao/SimuladorEntrega";
import { AdjustmentTimeline } from "@/components/playlists/cockpit/AdjustmentTimeline";
import { OnboardingChecklist } from "@/components/playlists/cockpit/OnboardingChecklist";
import { SeoExperimentCard } from "@/components/playlists/cockpit/SeoExperimentCard";
import { GenrePicker } from "@/components/playlists/cockpit/GenrePicker";
import { GenreAffinityCard } from "@/components/playlists/cockpit/GenreAffinityCard";
import { LifecycleRoadmapCard } from "@/components/playlists/cockpit/LifecycleRoadmapCard";

// Subcomponentes extraídos no Commit 2 da Fase 2 — sem mudança de JSX/lógica.
import { SectionTitle } from "./shared/SectionTitle";
import { IdentityField } from "./shared/IdentityField";
import { CoverCard } from "./shared/CoverCard";
import { ActionCard } from "./shared/ActionCard";
import { BucketRemove } from "./shared/BucketRemove";
import { BucketReorder } from "./shared/BucketReorder";
import { BucketAdd } from "./shared/BucketAdd";
import { MarketBlock } from "./shared/MarketBlock";
import { EditorialBanner } from "./shared/EditorialBanner";

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
              {/* ===== 1. VISÃO GERAL ===== */}
              <section className="space-y-3">
                <SectionTitle>Visão geral</SectionTitle>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <ActionCard kind="remove" count={buckets.remove.length} detected={buckets.detected.remove} hrefId="bucket-remove" />
                  <ActionCard kind="demote" count={buckets.demote.length} detected={buckets.detected.demote} hrefId="bucket-demote" />
                  <ActionCard kind="promote" count={buckets.promote.length} detected={buckets.detected.promote} hrefId="bucket-promote" />
                  <ActionCard kind="add" count={buckets.add.length} detected={buckets.detected.add} hrefId="bucket-add" />
                </div>
              </section>

              {/* ===== 2. DIAGNÓSTICO ===== */}
              <section className="space-y-3">
                <SectionTitle>Diagnóstico</SectionTitle>
                <EditorialBanner diag={diag} onRediagnose={runDiagnose} running={running} />
                {(() => {
                  const mode = diag.raw?.recommendation_mode ?? "light";
                  const total = buckets.remove.length + buckets.demote.length + buckets.promote.length + buckets.add.length;
                  const detectedTotal = buckets.detected.remove + buckets.detected.demote + buckets.detected.promote + buckets.detected.add;
                  if (mode === "hold") {
                    return (
                      <Card className="p-5 border-primary/30 bg-primary/5">
                        <div className="flex items-start gap-3">
                          <ShieldCheck className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                          <div className="space-y-1 min-w-0">
                            <div className="text-sm font-semibold">Não mexer agora</div>
                            <div className="text-xs text-muted-foreground leading-relaxed">
                              O cérebro analisou essa playlist e decidiu que ela está performando bem — qualquer mexida agora atrapalha mais do que ajuda.
                              {detectedTotal > 0 && <> Existem <span className="text-foreground font-semibold">{detectedTotal}</span> ajustes possíveis, mas estão segurados nesse ciclo.</>}
                              {" "}Volte depois de 7 dias ou clique em <strong className="text-foreground">Reavaliar</strong> se algo mudou.
                            </div>
                          </div>
                        </div>
                      </Card>
                    );
                  }
                  if (total === 0 && detectedTotal === 0) {
                    return (
                      <Card className="p-5">
                        <div className="flex items-start gap-3">
                          <ShieldCheck className="h-5 w-5 text-success shrink-0 mt-0.5" />
                          <div className="space-y-1 min-w-0">
                            <div className="text-sm font-semibold">Nada a fazer</div>
                            <div className="text-xs text-muted-foreground">Nenhuma faixa fora do padrão nem sugestão pra adicionar agora.</div>
                          </div>
                        </div>
                      </Card>
                    );
                  }
                  return null;
                })()}
              </section>

              {/* ===== 3. EXECUTAR PLANO ===== */}
              {(buckets.remove.length + buckets.demote.length + buckets.promote.length + buckets.add.length) > 0 && (
                <Card className="p-4 md:p-5 bg-primary/5 border-primary/30 flex flex-col items-center text-center gap-3 md:flex-row md:items-center md:text-left md:justify-between">
                  <div className="space-y-0.5 min-w-0">
                    <div className="text-sm font-semibold">Executar plano</div>
                    <div className="text-[11px] text-muted-foreground">
                      Aplica tudo via API.
                    </div>
                  </div>
                  <Button
                    onClick={() => applyPlan("all")}
                    disabled={applying !== null}
                    size="sm"
                    className="gap-1.5 h-9 px-5 rounded-full text-sm font-medium shrink-0"
                  >
                    {applying === "all" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    Aprovar e executar
                  </Button>
                </Card>
              )}

              <section className="space-y-3">

                {applyProgress && (
                  <Card className={cn(
                    "p-4 space-y-2 border",
                    applyProgress.status === "failed"
                      ? "bg-destructive/5 border-destructive/40"
                      : "bg-primary/5 border-primary/30",
                  )}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        {applyProgress.status === "failed" ? (
                          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                        ) : applyProgress.status === "done" || applyProgress.status === "skipped" ? (
                          <Check className="h-4 w-4 text-primary shrink-0" />
                        ) : (
                          <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">
                            {applyProgress.description}
                          </div>
                          {applyProgress.error && (
                            <div className="text-xs text-destructive mt-0.5 truncate">
                              {applyProgress.error}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="text-xs font-mono text-muted-foreground shrink-0">
                        {applyProgress.index} / {applyProgress.total}
                      </div>
                    </div>
                    {applyProgress.total > 0 && (
                      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className={cn(
                            "h-full transition-all duration-300",
                            applyProgress.status === "failed" ? "bg-destructive" : "bg-primary",
                          )}
                          style={{ width: `${Math.min(100, (applyProgress.index / applyProgress.total) * 100)}%` }}
                        />
                      </div>
                    )}
                  </Card>
                )}
              </section>

              {/* ===== 3. AÇÕES (sequência canônica) ===== */}
              <section className="space-y-3">
                <SectionTitle>Ações na ordem</SectionTitle>
                <BucketRemove
                  items={buckets.remove}
                  applying={applying === "remove" || applying === "all"}
                  onApplyAll={() => applyPlan("remove")}
                />
                <BucketReorder
                  kind="demote"
                  items={buckets.demote}
                  totalTracks={liveTracksCount}
                  applying={applying === "demote" || applying === "all"}
                  onApplyAll={() => applyPlan("demote")}
                />
                <BucketReorder
                  kind="promote"
                  items={buckets.promote}
                  totalTracks={liveTracksCount}
                  applying={applying === "promote" || applying === "all"}
                  onApplyAll={() => applyPlan("promote")}
                />
                {/* Projeção de plays — contexto pra decidir posição das novas faixas. Colapsado. */}
                {buckets.add.length > 0 && (
                  <Collapsible>
                    <CollapsibleTrigger className="text-xs text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1.5 px-2 py-1.5 rounded border border-border hover:border-primary/40">
                      <ChevronDown className="h-3 w-3" /> Ver projeção de plays por posição
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-3">
                      <ProjecaoFaixa
                        playlist={{
                          id: managedId,
                          name: playlistName,
                          cover_url: coverUrl,
                          followers: followers ?? 0,
                          tracks_count: liveTracksCount,
                        }}
                      />
                    </CollapsibleContent>
                  </Collapsible>
                )}
                <BucketAdd
                  items={buckets.add}
                  applying={applying === "add" || applying === "all"}
                  onApplyAll={() => applyPlan("add")}
                />
              </section>

              {/* ===== 4. HISTÓRICO ===== */}
              <section className="space-y-3">
                <SectionTitle>Histórico</SectionTitle>
                <AdjustmentTimeline playlistId={managedId} />
              </section>
            </TabsContent>

            {/* ============ IDENTIDADE ============ */}
            <TabsContent value="identidade" className="space-y-4 mt-0">
              <OnboardingChecklist managedId={managedId} />
              <CoverCard
                managedId={managedId}
                currentCover={coverUrl}
                genreName={genreName ?? null}
                references={(diag.raw?.market_insights?.top_recurring_tracks ?? [])
                  .filter((t: any) => t?.cover_url)
                  .map((t: any) => ({
                    id: t.spotify_track_id,
                    name: t.title ?? "—",
                    subtitle: t.artist ?? "",
                    cover_url: t.cover_url,
                    external_url: t.spotify_track_id ? `https://open.spotify.com/track/${t.spotify_track_id}` : null,
                  }))}
                spotifyPlaylistId={spotifyPlaylistId}
              />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <IdentityField
                  label="Nome"
                  field="name"
                  managedId={managedId}
                  current={diag.name_current ?? playlistName}
                  suggestion={diag.name_suggestion}
                  score={diag.name_score}
                  onApplied={runDiagnose}
                />
                <IdentityField
                  label="Descrição"
                  field="description"
                  managedId={managedId}
                  current={diag.raw?.description_current || ""}
                  suggestion={diag.raw?.suggested_description ?? null}
                  onApplied={runDiagnose}
                />
              </div>
              {(diag.raw?.missing_keywords?.length ?? 0) > 0 && (
                <Card className="p-5">
                  <div className="flex items-center justify-between mb-3 pb-3 border-b border-border/60">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                      Palavras fortes do nicho que faltam
                    </div>
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px] tabular-nums text-muted-foreground">
                      {diag.raw!.missing_keywords!.length}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {[...diag.raw!.missing_keywords!]
                      .sort((a, b) => a.localeCompare(b, "pt-BR"))
                      .map((k) => (
                        <Badge
                          key={k}
                          variant="outline"
                          className="h-6 px-2.5 rounded-full text-[11px] font-medium border-warning/40 text-warning bg-warning/5 hover:bg-warning/10 transition-colors"
                        >
                          {k}
                        </Badge>
                      ))}
                  </div>
                </Card>
              )}
            </TabsContent>


            {/* ============ MERCADO ============ */}
            {market && (
              <TabsContent value="mercado" className="space-y-4 mt-0">
                <MarketBlock
                  market={market}
                  idealRange={idealRange}
                  currentTrackKeys={currentTrackKeys}
                  currentArtistKeys={currentArtistKeys}
                  suggestionByTitle={suggestionByTitle}
                  onJumpToAdd={jumpToPlanAdd}
                />

              </TabsContent>
            )}

            {/* ============ ESTRATÉGIA ============ */}
            <TabsContent value="estrategia" className="space-y-4 mt-0">
              {canonicalPlaylistId && (
                <LifecycleRoadmapCard
                  playlistId={canonicalPlaylistId}
                  currentTracks={liveTracksCount}
                />
              )}
              <GenreAffinityCard managedId={managedId} />
              <SeoExperimentCard managedId={managedId} />
            </TabsContent>

            {/* ============ EDITOR (drag-and-drop) ============ */}
            <TabsContent value="editor" className="space-y-3 mt-0">
              <Card className="p-3 border-warning/30 bg-warning/5">
                <div className="text-xs text-foreground/80">
                  Use esta aba para editar as faixas diretamente, sem seguir o Plano.
                </div>
              </Card>
              <PlaylistEditorTab playlistId={managedId} />
            </TabsContent>
          </Tabs>
        </>
      )}
      </div>
    </div>
    </CockpitProvider>
  );
}

