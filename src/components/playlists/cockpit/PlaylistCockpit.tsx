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

// -------------------- types & helpers --------------------
// Tipos e helpers puros agora vivem em ./types e ./helpers (extraídos
// no Commit 1 da Fase 2 — modularização; comportamento idêntico).
import type { Diagnosis, Props, Suggestion, Zone } from "./types";
import { fmtNum, HEALTH_META, ZONE_CAPS, zoneFromPos } from "./helpers";




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

