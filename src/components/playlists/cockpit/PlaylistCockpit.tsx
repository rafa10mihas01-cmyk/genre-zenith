import { useEffect, useState, useCallback, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, ExternalLink, Sparkles, Loader2, Music2, TrendingUp,
  TrendingDown, ArrowUp, ArrowDown, Trash2, Plus, ChevronDown,
  Flame, Snowflake, Activity, Users, Crown, Target, Check,
  Heart, Eye, RotateCcw, Timer, Zap, ShieldCheck, AlertTriangle, ListMusic,
} from "lucide-react";

import { PlaylistEditorTab } from "@/components/playlists/PlaylistEditorTab";
import { KpiBig } from "@/components/KpiBig";
import { ProjecaoFaixa } from "@/components/operacao/SimuladorEntrega";
import { CuratorialStateBadge, CooldownChip } from "@/components/playlist/CuratorialStateBadge";
import { AdjustmentTimeline } from "@/components/playlists/cockpit/AdjustmentTimeline";
import { OnboardingChecklist } from "@/components/playlists/cockpit/OnboardingChecklist";
import { SeoExperimentCard } from "@/components/playlists/cockpit/SeoExperimentCard";
import { GenrePicker } from "@/components/playlists/cockpit/GenrePicker";
import { GenreAffinityCard } from "@/components/playlists/cockpit/GenreAffinityCard";
import { LifecycleRoadmapCard } from "@/components/playlists/cockpit/LifecycleRoadmapCard";


// -------------------- types & helpers --------------------
// Tipos e helpers puros agora vivem em ./types e ./helpers (extraídos
// no Commit 1 da Fase 2 — modularização; comportamento idêntico).
import type { AnalysisTrack, Zone, Suggestion, Diagnosis, Props } from "./types";
import {
  fmtNum,
  HEALTH_META,
  ZONE_LABELS,
  ZONE_CAPS,
  zoneFromPos,
  roleLabel,
  ZONE_RANGE_LABEL,
  shortReason,
  norm,
} from "./helpers";



// -------------------- main --------------------
export function PlaylistCockpit({
  managedId, spotifyPlaylistId, spotifyUrl, playlistName, coverUrl,
  followers, tracksCount, genreName, brainScore, canonicalPlaylistId, onBack,
}: Props) {
  const [diag, setDiag] = useState<Diagnosis | null>(null);
  const [liveTracksCount, setLiveTracksCount] = useState(tracksCount);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState<null | "remove" | "demote" | "promote" | "add" | "all">(null);
  const [applyProgress, setApplyProgress] = useState<null | {
    index: number;
    total: number;
    description: string;
    status: "running" | "done" | "skipped" | "failed";
    error?: string;
  }>(null);
  const [activeTab, setActiveTab] = useState<string>("identidade");
  const [archiving, setArchiving] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();


  async function handleArchive() {
    if (!confirm(`Mover "${playlistName}" para a lixeira?`)) return;
    setArchiving(true);
    const { error } = await supabase.functions.invoke("archive-managed-playlist", {
      body: { playlist_id: managedId, restore: false },
    });
    setArchiving(false);
    if (error) {
      toast({ title: "Erro ao arquivar", description: error.message, variant: "destructive" });
      return;
    }
    // Atualiza cache local imediatamente (otimista) + invalida pra refetch ao chegar em /catalogo.
    queryClient.setQueryData<any[]>(["managed-playlists"], (prev) =>
      (prev ?? []).map((p) => (p.id === managedId ? { ...p, archived_at: new Date().toISOString() } : p)),
    );
    queryClient.invalidateQueries({ queryKey: ["managed-playlists"] });
    toast({ title: "Movida para lixeira", description: "Você pode restaurar em Catálogo › Lixeira." });
    if (onBack) onBack(); else navigate("/catalogo");
  }

  useEffect(() => { setLiveTracksCount(tracksCount); }, [tracksCount]);

  const loadLatest = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("playlist_diagnoses")
      .select("id, created_at, name_current, name_suggestion, name_score, tracks_analysis, tracks_suggestions, tracks_summary, raw")
      .eq("playlist_id", managedId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setDiag((data as any) ?? null);
    setLoading(false);
  }, [managedId]);

  useEffect(() => { loadLatest(); }, [loadLatest]);

  // Quando o diagnóstico chega, escolhe a aba inicial uma única vez.
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

  async function runDiagnose() {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("diagnose-managed-playlist", {
        body: { playlist_id: managedId },
      });
      if (error || !data?.ok) throw new Error(error?.message ?? data?.error ?? "Falha");
      setDiag(data.diagnosis);
      toast({ title: "Diagnóstico pronto" });
    } catch (e: any) {
      toast({ title: "Erro no diagnóstico", description: e.message, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  }

  async function applyPlan(action: "remove" | "demote" | "promote" | "add" | "all") {
    setApplying(action);
    setApplyProgress(null);
    let completed: any = null;
    let lastError: string | null = null;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/apply-playlist-plan`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ playlist_id: managedId, action, stream: true }),
      });

      if (!resp.ok || !resp.body) {
        const txt = await resp.text().catch(() => "");
        let parsed: any = null;
        try { parsed = JSON.parse(txt); } catch { /* */ }
        toast({
          title: `Erro ${resp.status}`,
          description: parsed?.error ?? txt ?? "falha ao iniciar execução",
          variant: "destructive",
        });
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";
        for (const block of lines) {
          const line = block.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          let evt: any;
          try { evt = JSON.parse(line.slice(6)); } catch { continue; }
          if (evt.type === "start") {
            setApplyProgress({
              index: 0,
              total: evt.total ?? 0,
              description: evt.total ? `Iniciando ${evt.total} ações…` : "Sem ações a executar",
              status: "running",
            });
          } else if (evt.type === "step") {
            setApplyProgress({
              index: evt.index,
              total: evt.total,
              description: evt.description ?? `Executando ${evt.index} de ${evt.total}`,
              status: evt.status,
              error: evt.error,
            });
            if (evt.status === "failed") {
              lastError = `Falhou em ${evt.index}/${evt.total}: ${evt.description ?? evt.kind} — ${evt.error ?? "erro"}`;
            }
          } else if (evt.type === "complete") {
            completed = evt;
          }
        }
      }

      if (typeof completed?.current_tracks_count === "number") {
        setLiveTracksCount(completed.current_tracks_count);
      }

      if (completed?.ok === false || lastError) {
        toast({
          title: "Plano interrompido",
          description: lastError ?? completed?.error ?? "erro durante execução",
          variant: "destructive",
        });
      } else {
        const executed = completed?.executed ?? 0;
        const total = completed?.total ?? 0;
        toast({
          title: action === "all" ? "Plano executado" : "Bucket aplicado",
          description: total === 0 ? "sem alterações necessárias" : `${executed}/${total} ações concluídas`,
        });
      }

      if (action === "all") {
        runDiagnose();
      } else {
        setDiag((prev) => {
          if (!prev) return prev;
          const next: any = { ...prev };
          if (action === "remove" || action === "demote" || action === "promote") {
            next.tracks_analysis = (prev.tracks_analysis ?? []).filter(
              (t: any) => t.status !== action,
            );
          }
          if (action === "add") {
            next.tracks_suggestions = [];
          }
          return next;
        });
      }
    } catch (e: any) {
      toast({
        title: "Falha ao aplicar",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
    } finally {
      setApplying(null);
      // mantém o progresso visível por 2.5s pra usuário ver o estado final
      setTimeout(() => setApplyProgress(null), 2500);
    }
  }

  // ---- buckets ----
  const analysis = diag?.tracks_analysis ?? [];
  const suggestions = diag?.tracks_suggestions ?? [];
  const caps = diag?.raw?.applied_caps;
  const buckets = useMemo(() => {
    const removeAll = analysis.filter((t) => t.status === "remove")
      .sort((a, b) => a.position - b.position);
    const demoteAll = analysis.filter((t) => t.status === "demote")
      .sort((a, b) => a.position - b.position);
    const promoteAll = analysis.filter((t) => t.status === "promote")
      .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));

    // Aplica o cap recomendado pelo cérebro — detecta tudo, executa só o que
    // cabe neste ciclo. UI mostra "X detectadas · Y recomendadas".
    const recRemove = caps?.recommended_remove ?? removeAll.length;
    const recDemote = caps?.recommended_demote ?? demoteAll.length;
    const recPromote = caps?.recommended_promote ?? promoteAll.length;

    // Adicionar: respeita capped_suggestions do backend e ainda aplica
    // cap por zona pra não empilhar 6 faixas brigando por posição 0/1.
    // Excedente "desce" pra próxima zona com vaga (anchor → premium → support → tail).
    const addAfterBackendCap = caps?.capped_suggestions != null
      ? suggestions.slice(0, caps.capped_suggestions)
      : suggestions;
    const ZONE_ORDER: Zone[] = ["anchor", "premium", "support", "tail"];
    function zoneStart(z: Zone): number {
      return z === "anchor" ? 0 : z === "premium" ? 2 : z === "support" ? 6 : 12;
    }
    const zoneCount: Record<Zone, number> = { anchor: 0, premium: 0, support: 0, tail: 0 };
    const addFinal: Array<Suggestion & { _zone: Zone }> = [];
    for (const s of addAfterBackendCap) {
      const original = (s.target_zone ?? zoneFromPos(s.suggested_position ?? 99)) as Zone;
      let z: Zone = original;
      const startIdx = ZONE_ORDER.indexOf(original);
      for (let k = startIdx; k < ZONE_ORDER.length; k++) {
        if (zoneCount[ZONE_ORDER[k]] < ZONE_CAPS[ZONE_ORDER[k]]) { z = ZONE_ORDER[k]; break; }
      }
      if (zoneCount[z] >= ZONE_CAPS[z]) continue;
      zoneCount[z]++;
      // Posição sempre derivada do contador da zona — garante slots únicos
      // no batch (#13, #14, #15... em vez de #14, #14, #15, #15 repetidos).
      // O `suggested_position` do backend é só uma dica da zona, não do slot.
      const pos = zoneStart(z) + zoneCount[z] - 1;
      addFinal.push({ ...s, _zone: z, suggested_position: pos });
    }


    return {
      remove: removeAll.slice(0, recRemove),
      demote: demoteAll.slice(0, recDemote),
      promote: promoteAll.slice(0, recPromote),
      add: addFinal,
      detected: {
        remove: removeAll.length,
        demote: demoteAll.length,
        promote: promoteAll.length,
        add: suggestions.length,
      },
    };
  }, [analysis, suggestions, caps]);


  const health = HEALTH_META[diag?.raw?.health_status ?? "saudavel"];
  const market = diag?.raw?.market_insights;
  const idealRange = market?.ideal_track_count_range;
  // Sets pra cruzar Mercado ↔ Plano: o que já está, o que está sugerido.
  const currentTrackKeys = useMemo(() => new Set(analysis.map((t) => norm(t.track_name))), [analysis]);
  const currentArtistKeys = useMemo(() => new Set(analysis.map((t) => norm(t.artist_name))), [analysis]);
  const suggestionByTitle = useMemo(() => {
    const m = new Map<string, string>(); // norm(title) → spotify_track_id
    for (const s of buckets.add) m.set(norm(s.nome), s.spotify_track_id);
    return m;
  }, [buckets.add]);

  return (
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
  );
}

// -------------------- subcomponents --------------------
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 pt-2">
      <h2 className="text-[11px] uppercase tracking-[0.2em] font-semibold text-muted-foreground">
        {children}
      </h2>
      <div className="flex-1 h-px bg-border/60" />
    </div>
  );
}

function Stat({ label, value, accent, muted }: { label: string; value: string; accent?: boolean; muted?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn(
        "font-semibold tabular-nums",
        accent && "text-primary text-lg",
        muted && "text-xs text-muted-foreground font-normal",
        !accent && !muted && "text-base",
      )}>{value}</span>
    </div>
  );
}

function IdentityField({ label, field, managedId, current, suggestion, score, onApplied }: {
  label: string;
  field: "name" | "description";
  managedId: string;
  current: string;
  suggestion: string | null;
  score?: number | null;
  onApplied?: () => void;
}) {
  const [applying, setApplying] = useState(false);
  const hasSugg = !!suggestion && suggestion.trim() !== current.trim();

  async function apply() {
    if (!suggestion) return;
    setApplying(true);
    try {
      const { data, error } = await supabase.functions.invoke("apply-playlist-identity", {
        body: { playlist_id: managedId, [field]: suggestion },
      });
      let serverError: string | null = null;
      let status: number | null = null;
      if (error && (error as any).context) {
        try {
          const ctx = (error as any).context as Response;
          status = ctx.status ?? null;
          const b = await ctx.clone().json().catch(() => null);
          serverError = b?.error ?? null;
        } catch { /* */ }
      }
      if (error || data?.ok === false) {
        toast({
          title: status ? `Erro ${status}` : "Falha ao aplicar",
          description: serverError ?? data?.error ?? error?.message ?? "erro desconhecido",
          variant: "destructive",
        });
        return;
      }
      toast({ title: `${label} atualizado no Spotify` });
      onApplied?.();
    } finally {
      setApplying(false);
    }
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</span>
        {score != null && (
          <span
            title="SEO — quanto o nome combina com termos do nicho"
            className={cn(
              "text-xs font-semibold tabular-nums cursor-help",
              score >= 60 ? "text-primary" : score >= 30 ? "text-warning" : "text-destructive",
            )}
          >{score}/100</span>
        )}
      </div>
      <div className="space-y-2">
        <div>
          <div className="text-[10px] text-muted-foreground mb-1">Atual</div>
          <div className="text-sm bg-elevated/60 rounded-md px-3 py-2 text-foreground/80">{current || "— vazio —"}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-primary" /> Sugestão da IA
          </div>
          <div className={cn(
            "text-sm rounded-md px-3 py-2",
            hasSugg ? "bg-primary/10 border border-primary/30 text-foreground" : "bg-elevated/40 text-muted-foreground italic",
          )}>
            {suggestion || "sem ajuste sugerido"}
          </div>
        </div>
      </div>
      {hasSugg && (
        <div className="flex justify-between items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              navigator.clipboard.writeText(suggestion!);
              toast({ title: "Copiado", description: "Cole onde quiser." });
            }}
            className="h-7 text-xs text-muted-foreground gap-1"
          >
            Copiar
          </Button>
          <Button
            size="sm"
            onClick={apply}
            disabled={applying}
            className="gap-1.5 h-7"
          >
            {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            Aplicar no Spotify
          </Button>
        </div>
      )}
    </Card>
  );
}

type CoverReference = {
  id: string;
  name: string;
  subtitle?: string;
  cover_url: string | null;
  external_url?: string | null;
};

function CoverCard({ managedId, currentCover, references, spotifyPlaylistId, genreName }: {
  managedId: string;
  currentCover: string | null;
  references: CoverReference[];
  spotifyPlaylistId: string;
  genreName: string | null;
}) {
  const [uploading, setUploading] = useState(false);
  const [applyingLeader, setApplyingLeader] = useState<string | null>(null);
  const [localCover, setLocalCover] = useState<string | null>(currentCover);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [selectedLeader, setSelectedLeader] = useState<CoverReference | null>(null);
  const [hasDnaVisual, setHasDnaVisual] = useState(false);

  useEffect(() => { setLocalCover(currentCover); }, [currentCover]);

  // Gap 21: verifica se o gênero tem DNA visual analisado (genre_models.insights.ln)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: mp } = await supabase
        .from("managed_playlists")
        .select("genre_id")
        .eq("id", managedId)
        .maybeSingle();
      const genreId = (mp as any)?.genre_id;
      if (!genreId) { if (!cancelled) setHasDnaVisual(false); return; }
      const { data: gm } = await supabase
        .from("genre_models")
        .select("insights")
        .eq("genre_id", genreId)
        .maybeSingle();
      if (cancelled) return;
      const ln = (gm as any)?.insights?.ln;
      setHasDnaVisual(Boolean(ln && (ln.estilo_dominante || ln.atmosfera || ln.capas_analisadas?.length)));
    })();
    return () => { cancelled = true; };
  }, [managedId]);

  const applyLeaderCover = async (ref: CoverReference) => {
    if (!ref.cover_url) return;
    setApplyingLeader(ref.id);
    try {
      const { data, error } = await supabase.functions.invoke("apply-managed-cover", {
        body: { playlist_id: managedId, image_url: ref.cover_url },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "falha ao aplicar capa");
      setLocalCover(data.cover_url ?? ref.cover_url);
      setSelectedLeader(null);
      toast({
        title: data.unchanged ? "Capa já aplicada" : data.confirmed ? "Capa aplicada no Spotify" : "Capa enviada ao Spotify",
        description: data.unchanged ? "Essa referência já é visualmente igual à capa atual." : data.confirmed ? `Usando a capa de "${ref.name}".` : "O Spotify aceitou a capa, mas a CDN ainda pode levar alguns segundos para exibir.",
      });
    } catch (e: any) {
      toast({ title: "Erro ao aplicar capa", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setApplyingLeader(null);
    }
  };

  const selectFile = (file: File) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
      toast({ title: "Formato inválido", description: "Use PNG, JPG ou WEBP.", variant: "destructive" });
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast({ title: "Arquivo grande", description: "Máximo 8MB (será comprimido).", variant: "destructive" });
      return;
    }
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setSelectedLeader(null);
    setPendingFile(file);
    setPendingPreview(URL.createObjectURL(file));
  };

  const clearPending = () => {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingFile(null);
    setPendingPreview(null);
    setSelectedLeader(null);
  };

  const selectLeaderCover = (ref: CoverReference) => {
    if (!ref.cover_url) return;
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingFile(null);
    setPendingPreview(null);
    setSelectedLeader(ref);
  };

  const applyPending = async () => {
    if (!pendingFile) return;
    setUploading(true);
    try {
      const ext = pendingFile.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${managedId}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("playlist-covers")
        .upload(path, pendingFile, { contentType: pendingFile.type, upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("playlist-covers").getPublicUrl(path);
      const imageUrl = pub.publicUrl;

      const { data, error } = await supabase.functions.invoke("apply-managed-cover", {
        body: { playlist_id: managedId, image_url: imageUrl },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "falha ao aplicar capa");
      setLocalCover(data.cover_url ?? imageUrl);
      clearPending();
      toast({
        title: data.unchanged ? "Capa já aplicada" : data.confirmed ? "Capa aplicada no Spotify" : "Capa enviada ao Spotify",
        description: data.unchanged ? "A imagem enviada já é visualmente igual à capa atual." : data.confirmed ? "A nova capa já foi confirmada no Spotify." : "O Spotify aceitou a capa, mas a CDN ainda pode levar alguns segundos para exibir.",
      });
    } catch (e: any) {
      toast({ title: "Erro ao enviar capa", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const isCoverApplying = uploading || applyingLeader !== null;
  const selectedCoverPreview = pendingPreview ?? selectedLeader?.cover_url ?? null;
  const selectedCoverName = pendingFile?.name ?? selectedLeader?.name ?? "";
  const selectedCoverHint = pendingFile ? "Imagem escolhida do seu computador." : "Capa selecionada das faixas do nicho.";

  return (
    <Card className="p-6 md:p-8">
      <div className="flex flex-col items-center text-center gap-5">
        {/* Capa atual — herói centralizado */}
        <div className="relative">
          {localCover ? (
            <img
              src={localCover}
              alt="capa atual"
              className="w-32 h-32 md:w-36 md:h-36 rounded-2xl object-cover ring-1 ring-border shadow-lg"
            />
          ) : (
            <div className="w-32 h-32 md:w-36 md:h-36 rounded-2xl bg-elevated grid place-items-center ring-1 ring-border">
              <Music2 className="h-8 w-8 text-muted-foreground/40" />
            </div>
          )}
        </div>

        {/* Ações principais — centralizadas, sem rótulos extras */}
        <div className="flex items-center gap-2">
          <label className={cn(
            "inline-flex items-center gap-1.5 h-9 px-4 text-sm rounded-full cursor-pointer",
            "bg-primary text-primary-foreground hover:bg-primary/90 font-medium transition-colors",
            isCoverApplying && "opacity-60 pointer-events-none",
          )}>
            <Plus className="h-3.5 w-3.5" />
            Trocar capa
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              disabled={isCoverApplying}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) selectFile(f); e.currentTarget.value = ""; }}
            />
          </label>
          <Button asChild size="sm" variant="ghost" className="h-9 px-3 rounded-full text-sm gap-1.5 text-muted-foreground hover:text-foreground">
            <a href={`https://open.spotify.com/playlist/${spotifyPlaylistId}`} target="_blank" rel="noreferrer" aria-label="Abrir no Spotify" title="Abrir no Spotify">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      </div>

      {/* Preview seleção pendente */}
      {selectedCoverPreview && (pendingFile || selectedLeader) && (
        <div className="mt-5 flex items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 p-3">
          <img src={selectedCoverPreview} alt="capa selecionada" className="w-14 h-14 rounded-md object-cover ring-1 ring-border shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium truncate">{selectedCoverName}</div>
            <div className="text-[10px] text-muted-foreground truncate">{selectedCoverHint}</div>
          </div>
          <Button size="sm" variant="ghost" onClick={clearPending} disabled={isCoverApplying} className="h-7 text-xs shrink-0">
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={() => pendingFile ? applyPending() : selectedLeader && applyLeaderCover(selectedLeader)}
            disabled={isCoverApplying}
            className="h-7 text-xs gap-1.5 shrink-0"
          >
            {isCoverApplying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            {isCoverApplying ? "Aplicando..." : "Aplicar"}
          </Button>
        </div>
      )}

      {/* Referências do nicho — discretas, centralizadas */}
      {references.length > 0 && (
        <div className="mt-6 pt-5 border-t border-border/60 flex flex-col items-center gap-3">
          <div className="text-[10px] uppercase tracking-wider text-subtle-foreground font-medium">
            Referências do nicho
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {references.slice(0, 8).map((l) => {
              const busy = applyingLeader === l.id;
              return (
                <button
                  key={l.id}
                  type="button"
                  disabled={!l.cover_url || isCoverApplying}
                  onClick={() => selectLeaderCover(l)}
                  title={`Usar capa de "${l.name}"`}
                  className="relative group rounded-md overflow-hidden ring-1 ring-border hover:ring-primary/60 transition-all disabled:opacity-50"
                >
                  {l.cover_url ? (
                    <img src={l.cover_url} alt={l.name} className="w-14 h-14 object-cover" />
                  ) : (
                    <div className="w-14 h-14 bg-elevated" />
                  )}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity grid place-items-center">
                    {busy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                    ) : (
                      <Plus className="h-4 w-4 text-primary-foreground" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          {hasDnaVisual && genreName && (
            <div className="text-[10px] text-subtle-foreground italic">
              Baseado no DNA visual do gênero {genreName}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}


const ACTION_META = {
  remove: { label: "Remover", Icon: Trash2, tone: "border-destructive/40 bg-destructive/10 text-destructive", hint: "Faixas sem tração ou saturadas" },
  demote: { label: "Mover pra baixo", Icon: ArrowDown, tone: "border-warning/40 bg-warning/10 text-warning", hint: "Na vitrine sem performance" },
  promote: { label: "Mover pro topo", Icon: ArrowUp, tone: "border-primary/40 bg-primary/10 text-primary", hint: "Mercado já reconheceu" },
  add: { label: "Adicionar", Icon: Plus, tone: "border-primary/50 bg-primary/15 text-primary", hint: "Faixas dominando o nicho" },
} as const;

function ActionCard({ kind, count, detected, hrefId }: { kind: keyof typeof ACTION_META; count: number; detected?: number; hrefId: string }) {
  const m = ACTION_META[kind];
  const disabled = count === 0 && (detected ?? 0) === 0;
  const hasMore = detected != null && detected > count;
  return (
    <a
      href={`#${hrefId}`}
      onClick={(e) => {
        if (disabled) { e.preventDefault(); return; }
        e.preventDefault();
        document.getElementById(hrefId)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }}
      className={cn(
        "rounded-2xl border p-4 transition-all",
        m.tone,
        disabled ? "opacity-40 cursor-not-allowed" : "hover:scale-[1.02] cursor-pointer",
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <m.Icon className="h-4 w-4" />
        <span className="text-[10px] uppercase tracking-wider font-bold">{m.label}</span>
      </div>
      <div className="text-3xl font-bold tabular-nums leading-none">{count}</div>
      {hasMore ? (
        <div className="text-[11px] opacity-80 mt-1.5 leading-snug">
          de {detected} detectadas · limite deste ciclo
        </div>
      ) : (
        <div className="text-[11px] opacity-80 mt-1.5 leading-snug">{m.hint}</div>
      )}
    </a>
  );
}


// -------- buckets --------
function BucketShell({
  id, kind, count, headerRight, children,
}: { id: string; kind: keyof typeof ACTION_META; count: number; headerRight?: React.ReactNode; children: React.ReactNode }) {
  const m = ACTION_META[kind];
  if (count === 0) return null;
  return (
    <Card id={id} className="overflow-hidden scroll-mt-20">
      <div className={cn("flex items-center justify-between gap-2 px-3 py-2.5 border-b min-w-0", m.tone, "bg-opacity-40")}>
        <div className="flex items-center gap-1.5 min-w-0">
          <m.Icon className="h-3.5 w-3.5 shrink-0" />
          <span className="text-[11px] font-bold uppercase tracking-wider truncate">{m.label}</span>
          <span className="text-[11px] opacity-70 tabular-nums shrink-0">· {count}</span>
        </div>
        <div className="shrink-0">{headerRight}</div>
      </div>
      <div className="divide-y divide-border/40 max-h-[440px] overflow-y-auto">{children}</div>
    </Card>
  );
}

function PositionBadge({ from, to }: { from: number; to: number | null }) {
  return (
    <div className="flex items-center gap-1 text-[11px] font-mono tabular-nums shrink-0 w-20">
      <span className="text-muted-foreground">#{from}</span>
      <span className="text-muted-foreground/50">→</span>
      <span className={cn("font-semibold", to == null ? "text-destructive" : "text-primary")}>
        {to == null ? "—" : `#${to}`}
      </span>
    </div>
  );
}

function TrackLine({
  position, target, title, artist, reason, action,
}: { position: number; target: number | null; title: string; artist: string; reason: string; action: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 hover:bg-elevated/40 transition-colors">
      <PositionBadge from={position} to={target} />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">{title}</div>
        <div className="text-[11px] text-muted-foreground truncate">{artist} · {reason}</div>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

function BucketRemove({ items, applying, onApplyAll }: {
  items: AnalysisTrack[]; applying: boolean; onApplyAll: () => void;
}) {
  return (
    <BucketShell
      id="bucket-remove"
      kind="remove"
      count={items.length}
      headerRight={
        items.length > 0 && (
          <Button
            size="sm"
            variant="destructive"
            onClick={onApplyAll}
            disabled={applying}
            className="h-7 text-xs gap-1"
          >
            {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            Aplicar ({items.length})
          </Button>
        )
      }
    >
      {items.map((t) => (
        <TrackLine
          key={t.spotify_track_id}
          position={t.position + 1}
          target={null}
          title={t.track_name ?? "—"}
          artist={t.artist_name ?? "—"}
          reason={shortReason(t, "remove")}
          action={<span className="text-[10px] text-muted-foreground uppercase tracking-wider">Remover</span>}
        />
      ))}
    </BucketShell>
  );
}

function BucketReorder({ kind, items, totalTracks, applying, onApplyAll }: {
  kind: "promote" | "demote";
  items: AnalysisTrack[];
  totalTracks: number;
  applying: boolean;
  onApplyAll: () => void;
}) {
  return (
    <BucketShell
      id={`bucket-${kind}`}
      kind={kind}
      count={items.length}
      headerRight={
        items.length > 0 && (
          <Button
            size="sm"
            onClick={onApplyAll}
            disabled={applying}
            variant={kind === "promote" ? "default" : "outline"}
            className="h-7 text-xs gap-1"
          >
            {applying ? <Loader2 className="h-3 w-3 animate-spin" /> :
              kind === "promote" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
            Aplicar ({items.length})
          </Button>
        )
      }
    >
      {items.map((t) => {
        // target_position vem 0-based do diagnose; UI sempre 1-based humano.
        const target0 = t.target_position ?? (kind === "promote" ? 4 : Math.max(29, totalTracks - 11));
        return (
          <TrackLine
            key={t.spotify_track_id}
            position={t.position + 1}
            target={target0 + 1}
            title={t.track_name ?? "—"}
            artist={t.artist_name ?? "—"}
            reason={shortReason(t, kind)}
            action={
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                {kind === "promote" ? "Topo" : "Baixo"}
              </span>
            }
          />
        );
      })}
    </BucketShell>
  );
}

function NewTrackTarget({ zone, pos }: { zone: Zone; pos: number }) {
  return (
    <div className="flex items-center gap-1 shrink-0 w-20" title={`Nova faixa · ${ZONE_LABELS[zone]} #${pos + 1}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" aria-label="nova" />
      <span className="text-[11px] font-mono tabular-nums font-semibold text-primary truncate">
        {ZONE_LABELS[zone].slice(0, 3)}#{pos + 1}
      </span>
    </div>
  );
}

function BucketAdd({ items, applying, onApplyAll }: {
  items: Array<Suggestion & { _zone: Zone }>; applying: boolean; onApplyAll: () => void;
}) {
  return (
    <BucketShell
      id="bucket-add"
      kind="add"
      count={items.length}
      headerRight={
        items.length > 0 && (
          <Button
            size="sm"
            onClick={onApplyAll}
            disabled={applying}
            className="h-7 text-xs gap-1"
          >
            {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Aplicar ({items.length})
          </Button>
        )
      }
    >
      {items.map((t) => {
        const zoneLabel = ZONE_LABELS[t._zone];
        const role = roleLabel(t);
        const range = ZONE_RANGE_LABEL[t._zone];
        const rec = (t.count ?? 0) >= 2 ? `recorrência ${t.count}×` : null;
        const pop = (t.popularity != null) ? `pop ${t.popularity}` : null;
        const editorial = [`${zoneLabel} · ${role}`, range, rec, pop].filter(Boolean).join(" · ");
        return (
          <div
            key={t.spotify_track_id}
            data-add-track-id={t.spotify_track_id}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-elevated/40 transition-colors rounded"
          >
            <NewTrackTarget zone={t._zone} pos={t.suggested_position} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{t.nome || "—"}</div>
              <div
                className="text-xs text-muted-foreground truncate cursor-help"
                title="Fachada = posições 1-2 · Premium = 3-5 · Sustentação = 6-10 · Cauda = 11+"
              >
                {t.artista || "—"} · {editorial}
              </div>
            </div>
            <div className="shrink-0">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Adicionar
              </span>
            </div>
          </div>
        );
      })}

    </BucketShell>
  );
}

// -------- mercado --------
function MarketBlock({
  market, idealRange, currentTrackKeys, currentArtistKeys, suggestionByTitle, onJumpToAdd,
}: {
  market: any;
  idealRange: any;
  currentTrackKeys: Set<string>;
  currentArtistKeys: Set<string>;
  suggestionByTitle: Map<string, string>;
  onJumpToAdd: (trackId?: string) => void;
}) {
  const sampleSize = market.niche_playlist_count ?? 0;
  const benchmarkReady = Array.isArray(idealRange) && idealRange[0] != null && idealRange[1] != null;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {(market.leader_playlists?.length ?? 0) > 0 && (
        <Card className="p-4 space-y-2 lg:col-span-3">
          <div className="flex items-center gap-2">
            <Crown className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Playlists líderes do nicho</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            {market.leader_playlists.slice(0, 6).map((p: any) => (
              <a
                key={p.spotify_playlist_id}
                href={`https://open.spotify.com/playlist/${p.spotify_playlist_id}`}
                target="_blank" rel="noreferrer"
                className="flex items-center gap-2 p-2 rounded-lg border border-border hover:border-primary/40 transition-colors"
              >
                {p.cover_url && <img src={p.cover_url} alt="" className="w-8 h-8 rounded object-cover shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium truncate">{p.name}</div>
                  <div className="text-[10px] text-muted-foreground tabular-nums">{fmtNum(p.followers)} seg.</div>
                </div>
              </a>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Tamanho ideal</span>
        </div>
        {benchmarkReady ? (
          <>
            <div className="text-2xl font-bold tabular-nums">
              {idealRange[0]}<span className="text-muted-foreground mx-1">–</span>{idealRange[1]}
              <span className="text-xs text-muted-foreground ml-1 font-normal">faixas</span>
            </div>
            <div className="text-[11px] text-muted-foreground">
              Saturação do nicho: <strong className="text-foreground">{market.avg_saturation_pct ?? "—"}%</strong>
              <span className="block text-[10px] text-muted-foreground/80">quanto o nicho repete as mesmas faixas</span>
            </div>
            <div className="text-[11px] text-muted-foreground">
              Baseado em <strong className="text-foreground">{sampleSize}</strong> playlists analisadas
            </div>
          </>
        ) : (
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground bg-muted/30 border border-border px-2 py-1 rounded">
              {sampleSize > 0 ? "Benchmark sem faixa ideal ainda" : "Sem dados do nicho ainda"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {sampleSize > 0
                ? `${sampleSize} playlists analisadas · próximo recálculo automático às 03:00`
                : "Cron diário roda às 03:00 — inclua concorrentes monitorados neste nicho"}
            </div>
          </div>
        )}
      </Card>


      <Card className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Artistas dominando</span>
        </div>
        <ul className="space-y-1">
          {(market.top_artists ?? []).slice(0, 6).map((a: any, i: number) => {
            const present = currentArtistKeys.has(norm(a.name));
            return (
              <li key={i} className="flex justify-between items-center text-xs gap-2">
                <span className="truncate flex-1 flex items-center gap-1.5">
                  {present ? (
                    <Check className="h-3 w-3 text-primary shrink-0" />
                  ) : (
                    <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70 bg-muted/40 px-1 py-0.5 rounded shrink-0">
                      fora
                    </span>
                  )}
                  <span className="truncate">{a.name}</span>
                </span>
                <span className="text-muted-foreground tabular-nums shrink-0">{a.plays_in_niche}×</span>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Faixas mais recorrentes</span>
        </div>
        <ul className="space-y-1.5">
          {(market.top_recurring_tracks ?? []).slice(0, 5).map((t: any, i: number) => {
            const key = norm(t.title);
            const isInPlaylist = currentTrackKeys.has(key);
            const suggestedId = suggestionByTitle.get(key);
            return (
              <li key={i} className="text-xs">
                <div className="font-medium truncate flex items-center gap-1.5">
                  {isInPlaylist && <Check className="h-3 w-3 text-primary shrink-0" />}
                  <span className="truncate">{t.title ?? "—"}</span>
                </div>
                <div className="text-muted-foreground truncate flex justify-between items-center gap-2">
                  <span className="truncate">{t.artist ?? "—"}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isInPlaylist ? (
                      <span className="text-[9px] uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                        Na playlist
                      </span>
                    ) : suggestedId ? (
                      <button
                        onClick={() => onJumpToAdd(suggestedId)}
                        className="text-[9px] uppercase tracking-wider text-primary bg-primary/15 hover:bg-primary/25 px-1.5 py-0.5 rounded transition-colors"
                      >
                        Sugerida
                      </button>
                    ) : (
                      <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 px-1.5 py-0.5">
                        Fora do plano
                      </span>
                    )}
                    <span className="tabular-nums">{t.niche_playlists_count}×</span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

// -------------------- EditorialBanner --------------------
const MODE_META: Record<string, { label: string; tone: string; Icon: any }> = {
  hold:       { label: "Não mexer",            tone: "border-primary/40 bg-primary/5 text-primary",                Icon: ShieldCheck },
  light:      { label: "Intervenção leve",     tone: "border-warning/40 bg-warning/5 text-warning",                Icon: Activity },
  moderate:   { label: "Intervenção moderada", tone: "border-warning/60 bg-warning/10 text-warning",               Icon: Zap },
  structural: { label: "Reciclagem estrutural", tone: "border-destructive/40 bg-destructive/5 text-destructive",   Icon: RotateCcw },
};

function EditorialBanner({
  diag,
  onRediagnose,
  running,
}: {
  diag: Diagnosis;
  onRediagnose: () => void;
  running: boolean;
}) {
  const mode = diag.raw?.recommendation_mode ?? "light";
  const state = diag.raw?.curatorial_state;
  const justification = diag.raw?.editorial_justification ?? "";
  const caps = diag.raw?.applied_caps;
  const cooldowns = diag.raw?.active_cooldowns ?? [];
  const meta = MODE_META[mode] ?? MODE_META.light;
  const Icon = meta.Icon;

  return (
    <div className={cn(
      "rounded-xl border px-3 py-2.5",
      "flex flex-col items-center text-center gap-2",
      "md:flex-row md:items-center md:text-left md:gap-3",
      meta.tone,
    )}>
      <div className={cn("h-7 w-7 rounded-full border grid place-items-center shrink-0", meta.tone)}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="flex flex-col md:flex-row md:items-center md:gap-2 flex-1 min-w-0 gap-1">
        <div className="flex items-center justify-center md:justify-start gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Modo</span>
          <span className="text-xs font-semibold leading-none">{meta.label}</span>
        </div>
        {(state || (caps && mode !== "hold")) && (
          <div className="flex items-center justify-center md:justify-start gap-2 flex-wrap">
            {state && <CuratorialStateBadge state={state} compact />}
            {caps && mode !== "hold" && (
              <span className="text-[11px] text-muted-foreground tabular-nums">
                limite <span className="text-foreground font-semibold">{caps.max_changes}</span> ({caps.max_change_pct}%)
              </span>
            )}
          </div>
        )}
        {cooldowns.length > 0 && (
          <div className="flex flex-wrap justify-center md:justify-start gap-1">
            {cooldowns.map((c) => (
              <CooldownChip key={c.action_type} action={c.action_type} daysRemaining={c.days_remaining} />
            ))}
          </div>
        )}
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={onRediagnose}
        disabled={running}
        className="gap-1 h-7 px-2.5 rounded-full text-[11px] font-medium shrink-0"
        title={justification || "Reavaliar"}
      >
        {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
        Reavaliar
      </Button>
    </div>
  );
}

