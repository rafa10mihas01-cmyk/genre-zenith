import { useEffect, useState, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible, CollapsibleTrigger, CollapsibleContent,
} from "@/components/ui/collapsible";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatNumber, timeAgo } from "@/lib/format";
import {
  Plus, RefreshCw, ExternalLink, Music2, Sparkles, Archive, ArchiveRestore,
  ListMusic, AlertCircle, Activity, Brain, ArrowUpRight, Target, TrendingUp,
  History, CheckCircle2, XCircle, Clock, Trash2, ChevronDown, ChevronRight, ArrowUpDown,
} from "lucide-react";
import { PlaylistScoreBadge, type PlaylistScoreRow } from "./PlaylistScoreBadge";
import { PlaylistTracksAnalysisCard } from "@/components/playlists/PlaylistTracksAnalysisCard";
import { CuratorialStateBadge, CooldownStack, type CuratorialState } from "@/components/playlist/CuratorialStateBadge";
import { useActiveCooldowns } from "@/hooks/useActiveCooldowns";

type ManagedPlaylist = {
  id: string;
  spotify_playlist_id: string;
  spotify_url: string;
  name: string;
  cover_url: string | null;
  followers: number;
  tracks_count: number;
  genre_id: string | null;
  archived_at: string | null;
  last_diagnosis_at: string | null;
  imported_at: string;
  canonical_playlist_id: string | null;
  curatorial_state?: CuratorialState | null;
  last_maintenance_at?: string | null;
  max_change_pct?: number | null;
  recommended_change_count?: number | null;
};

type Diagnosis = {
  id: string;
  name_score: number | null;
  name_current: string | null;
  name_suggestion: string | null;
  name_reasons: any;
  tracks_suggestions: any;
  cover_suggestion: any;
  created_at: string;
};

type Valuation = {
  spotify_playlist_id: string;
  valuation_score: number;
  recommendation: string;
  estimated_monthly_plays: number;
  risk_level: string;
};

type BrainRow = {
  playlist_id: string;
  capacity_total: number | null;
  capacity_ceiling: number | null;
  headroom_pct: number | null;
  confidence_score: number;
  signals: any;
};

type PlaylistStats = { avgHealth: number; topPerf: number; atRisk: number; inactive: number };

export function MinhasPlaylists({ onStats }: { onStats?: (s: PlaylistStats) => void } = {}) {
  const [items, setItems] = useState<ManagedPlaylist[]>([]);
  const [scores, setScores] = useState<Record<string, PlaylistScoreRow>>({});
  const [valuations, setValuations] = useState<Record<string, Valuation>>({});
  const [brains, setBrains] = useState<Record<string, BrainRow>>({});
  const [recalcing, setRecalcing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [sortBy, setSortBy] = useState<"recent" | "valuation">("recent");
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [bulkImporting, setBulkImporting] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [logs, setLogs] = useState<Array<{ id: string; source: string; synced: number; failed: number; recalculated: number; errors: any; duration_ms: number | null; created_at: string }>>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  async function loadLogs() {
    setLogsLoading(true);
    const { data } = await supabase
      .from("sync_log")
      .select("id, source, synced, failed, recalculated, errors, duration_ms, created_at")
      .order("created_at", { ascending: false })
      .limit(30);
    setLogs((data ?? []) as any);
    setLogsLoading(false);
  }

  function openLogs() {
    setLogOpen(true);
    loadLogs();
  }

  async function handleBulkImport() {
    setBulkImporting(true);
    try {
      const { data, error } = await supabase.functions.invoke("import-account-playlists", {
        body: {},
      });
      if (error || !data?.ok) throw new Error(error?.message ?? data?.error ?? "Falhou");
      toast({
        title: "Importação concluída",
        description: `${data.imported} playlists da conta (${data.others_count} ignoradas por não serem suas)`,
      });
      load();
    } catch (e: any) {
      toast({ title: "Erro na importação em massa", description: e.message, variant: "destructive" });
    } finally {
      setBulkImporting(false);
    }
  }
  const [drawerPl, setDrawerPl] = useState<ManagedPlaylist | null>(null);
  const [applyingSuggestions, setApplyingSuggestions] = useState(false);

  const applySuggestions = useCallback(async (plId: string, count: number) => {
    setApplyingSuggestions(true);
    try {
      const { data, error } = await supabase.functions.invoke("apply-playlist-suggestions", {
        body: { playlist_id: plId, limit: count },
      });
      // Quando a função retorna não-2xx, o body fica em error.context (Response)
      let serverError: string | null = null;
      let serverStatus: number | null = null;
      if (error && (error as any).context) {
        try {
          const ctx = (error as any).context as Response;
          serverStatus = ctx.status ?? null;
          const body = await ctx.clone().json().catch(() => null);
          serverError = body?.error ?? null;
        } catch { /* ignore */ }
      }
      if (error || data?.ok === false) {
        const desc = serverError ?? data?.error ?? error?.message ?? "erro desconhecido";
        toast({
          title: serverStatus ? `Erro ${serverStatus} ao adicionar` : "Não foi possível adicionar",
          description: desc,
          variant: "destructive",
        });
      } else {
        toast({
          title: `${data?.inserted ?? count} faixas adicionadas no topo`,
          description: "Rodando novo diagnóstico em seguida…",
        });
        // dispara re-diagnóstico em background pra atualizar análise
        supabase.functions.invoke("diagnose-managed-playlist", { body: { playlist_id: plId } }).catch(() => {});
      }
    } finally {
      setApplyingSuggestions(false);
    }
  }, []);
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);

  const loadScores = useCallback(async (canonicalIds: string[]) => {
    if (!canonicalIds.length) { setScores({}); return; }
    const { data } = await supabase
      .from("playlist_scores")
      .select("playlist_id, health_score, delivery_score, capacity_score, risk_score, activity_score, calculated_at")
      .in("playlist_id", canonicalIds);
    const map: Record<string, PlaylistScoreRow> = {};
    (data ?? []).forEach((r: any) => { map[r.playlist_id] = r; });
    setScores(map);
  }, []);

  const loadValuations = useCallback(async (spotifyIds: string[]) => {
    if (!spotifyIds.length) { setValuations({}); return; }
    const { data, error } = await supabase.rpc("evaluate_playlists_batch", { p_spotify_ids: spotifyIds });
    if (error) return;
    const map: Record<string, Valuation> = {};
    (data ?? []).forEach((r: any) => { map[r.spotify_playlist_id] = r; });
    setValuations(map);
  }, []);

  const loadBrains = useCallback(async (canonicalIds: string[]) => {
    if (!canonicalIds.length) { setBrains({}); return; }
    const { data } = await supabase
      .from("playlist_brain")
      .select("playlist_id, capacity_total, capacity_ceiling, headroom_pct, confidence_score, signals")
      .in("playlist_id", canonicalIds);
    const map: Record<string, BrainRow> = {};
    (data ?? []).forEach((r: any) => { map[r.playlist_id] = r; });
    setBrains(map);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("managed_playlists")
      .select("*")
      .order("imported_at", { ascending: false });
    if (error) toast({ title: "Erro ao carregar", description: error.message, variant: "destructive" });
    const list = (data ?? []) as ManagedPlaylist[];
    setItems(list);
    setLoading(false);
    const canonicals = list.map(i => i.canonical_playlist_id).filter(Boolean) as string[];
    loadScores(canonicals);
    loadBrains(canonicals);
    loadValuations(list.map(i => i.spotify_playlist_id).filter(Boolean));
  }, [loadScores, loadValuations, loadBrains]);

  async function handleRecalc() {
    setRecalcing(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-managed-playlists", { body: {} });
      if (error || !data?.ok) throw new Error(error?.message ?? data?.error ?? "Falhou");
      toast({
        title: "Sincronizado",
        description: `${data.synced} playlists atualizadas · ${data.recalculated} scores recalculados${data.failed ? ` · ${data.failed} falharam` : ""}`,
      });
      await load();
    } catch (e: any) {
      toast({ title: "Erro ao sincronizar", description: e.message, variant: "destructive" });
    } finally {
      setRecalcing(false);
    }
  }

  useEffect(() => { load(); }, [load]);

  const [genres, setGenres] = useState<{ id: string; nome: string }[]>([]);
  const [filterMissingGenre, setFilterMissingGenre] = useState(false);
  const [savingGenre, setSavingGenre] = useState(false);

  useEffect(() => {
    supabase.from("genres").select("id, nome").order("nome").then(({ data }) => {
      setGenres((data ?? []) as any);
    });
  }, []);

  async function setPlaylistGenre(pl: ManagedPlaylist, genreId: string | null) {
    setSavingGenre(true);
    const { error } = await supabase
      .from("managed_playlists")
      .update({ genre_id: genreId })
      .eq("id", pl.id);
    setSavingGenre(false);
    if (error) {
      toast({ title: "Erro ao salvar gênero", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Gênero atualizado", description: "Recalculando perfil vivo…" });
    setItems((prev) => prev.map((x) => (x.id === pl.id ? { ...x, genre_id: genreId } : x)));
    setDrawerPl((prev) => (prev && prev.id === pl.id ? { ...prev, genre_id: genreId } : prev));
    if (pl.canonical_playlist_id) {
      supabase.functions.invoke("playlist-brain-calc", {
        body: { playlist_id: pl.canonical_playlist_id },
      }).then(() => load());
    }
  }

  const missingGenreCount = items.filter(i => !i.archived_at && !i.genre_id).length;

  const visible = items
    .filter((p) => (showArchived ? !!p.archived_at : !p.archived_at))
    .filter((p) => (filterMissingGenre ? !p.genre_id : true))
    .slice()
    .sort((a, b) => {
      if (sortBy !== "valuation") return 0;
      const va = valuations[a.spotify_playlist_id]?.valuation_score ?? -1;
      const vb = valuations[b.spotify_playlist_id]?.valuation_score ?? -1;
      return vb - va;
    });

  const visibleIds = useMemo(() => visible.map((p) => p.id), [visible]);
  const { byPlaylist: cooldownsByPlaylist } = useActiveCooldowns(visibleIds);

  async function handleImport() {
    if (!importUrl.trim()) return;
    setImporting(true);
    try {
      const { data, error } = await supabase.functions.invoke("import-managed-playlist", {
        body: { url: importUrl.trim() },
      });
      if (error || !data?.ok) throw new Error(error?.message ?? data?.error ?? "Falhou");
      toast({ title: "Playlist importada", description: data.playlist?.name });
      setImportOpen(false);
      setImportUrl("");
      load();
    } catch (e: any) {
      toast({ title: "Não consegui importar", description: e.message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  }

  async function openDiagnosis(pl: ManagedPlaylist) {
    setDrawerPl(pl);
    setDiagnosis(null);
    setDiagLoading(true);
    // Busca último diagnóstico
    const { data: last } = await supabase
      .from("playlist_diagnoses")
      .select("*")
      .eq("playlist_id", pl.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last) setDiagnosis(last as any);
    setDiagLoading(false);
  }

  async function runDiagnosis(pl: ManagedPlaylist) {
    setDiagLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("diagnose-managed-playlist", {
        body: { playlist_id: pl.id },
      });
      if (error || !data?.ok) throw new Error(error?.message ?? data?.error ?? "Falhou");
      setDiagnosis(data.diagnosis);
      toast({ title: "Diagnóstico atualizado" });
      load();
    } catch (e: any) {
      toast({ title: "Erro no diagnóstico", description: e.message, variant: "destructive" });
    } finally {
      setDiagLoading(false);
    }
  }

  async function archive(pl: ManagedPlaylist, restore = false) {
    const { error } = await supabase.functions.invoke("archive-managed-playlist", {
      body: { playlist_id: pl.id, restore },
    });
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: restore ? "Restaurada" : "Movida para lixeira" });
    setDrawerPl(null);
    load();
  }

  async function deletePermanent(pl: ManagedPlaylist) {
    if (!confirm(`Excluir permanentemente "${pl.name}"? Esta ação não pode ser desfeita.`)) return;
    const { data, error } = await supabase.functions.invoke("delete-managed-playlist", {
      body: { playlist_id: pl.id },
    });
    if (error || !(data as any)?.ok) {
      toast({ title: "Erro", description: error?.message || (data as any)?.error || "Falha ao excluir", variant: "destructive" });
      return;
    }
    toast({ title: "Excluída permanentemente" });
    setDrawerPl(null);
    load();
  }

  async function emptyTrash() {
    const archivedCount = items.filter(i => i.archived_at).length;
    if (archivedCount === 0) return;
    if (!confirm(`Esvaziar lixeira? ${archivedCount} playlist(s) serão excluídas permanentemente. Esta ação não pode ser desfeita.`)) return;
    const { data, error } = await supabase.functions.invoke("delete-managed-playlist", {
      body: { delete_all_archived: true },
    });
    if (error || !(data as any)?.ok) {
      toast({ title: "Erro", description: error?.message || (data as any)?.error || "Falha ao esvaziar", variant: "destructive" });
      return;
    }
    toast({ title: `${(data as any)?.deleted ?? 0} playlist(s) excluídas` });
    load();
  }

  // KPI agregados sobre as playlists visíveis (não-arquivadas)
  const activeItems = items.filter(i => !i.archived_at);
  const scoreRows = activeItems
    .map(i => i.canonical_playlist_id ? scores[i.canonical_playlist_id] : null)
    .filter(Boolean) as PlaylistScoreRow[];
  const avgHealth = scoreRows.length ? Math.round(scoreRows.reduce((a, s) => a + s.health_score, 0) / scoreRows.length) : 0;
  const atRisk = scoreRows.filter(s => s.risk_score >= 60).length;
  const inactive = scoreRows.filter(s => s.activity_score < 30).length;
  const topPerf = scoreRows.filter(s => s.health_score >= 70).length;

  useEffect(() => {
    onStats?.({ avgHealth, topPerf, atRisk, inactive });
  }, [avgHealth, topPerf, atRisk, inactive, onStats]);


  // ====== Match score: top oportunidades ======
  // Score = headroom_pct * (confidence/100), penaliza sinais e capacidade desconhecida.
  const opportunities = useMemo(() => {
    return activeItems
      .map((p) => {
        const cId = p.canonical_playlist_id;
        const b = cId ? brains[cId] : null;
        if (!b || b.headroom_pct === null || b.headroom_pct === undefined) return null;
        const sigCount = Array.isArray(b.signals) ? b.signals.length : 0;
        const sigPenalty = Math.min(0.4, sigCount * 0.08);
        const conf = (b.confidence_score ?? 50) / 100;
        const matchScore = Math.max(
          0,
          Math.round(Number(b.headroom_pct) * conf * (1 - sigPenalty)),
        );
        return { pl: p, brain: b, matchScore, sigCount };
      })
      .filter(Boolean)
      .sort((a, b) => (b!.matchScore - a!.matchScore))
      .slice(0, 6) as Array<{
      pl: ManagedPlaylist;
      brain: BrainRow;
      matchScore: number;
      sigCount: number;
    }>;
  }, [activeItems, brains]);

  return (
    <section className="space-y-4">



      {/* Top oportunidades — match score (colapsado por padrão) */}
      {opportunities.length > 0 && (
        <Collapsible className="nx-card !p-0 overflow-hidden">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="group w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-[hsl(var(--hover))] transition-colors text-left"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Target className="h-4 w-4 text-primary shrink-0" />
                <span className="text-[14px] font-semibold">Top oportunidades</span>
                <span className="text-[11px] text-muted-foreground truncate">
                  · onde alimentar primeiro
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {opportunities.length} sugest{opportunities.length === 1 ? "ão" : "ões"}
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
              </div>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-4 pb-4 pt-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {opportunities.map((o) => {
                const tone =
                  o.matchScore >= 60
                    ? "success"
                    : o.matchScore >= 30
                    ? "primary"
                    : "muted";
                return (
                  <Link
                    key={o.pl.id}
                    to={`/playlists/${o.pl.canonical_playlist_id}`}
                    className={cn(
                      "group rounded-xl border px-3 py-2.5 transition-all hover:-translate-y-[1px] hover:border-foreground/30",
                      tone === "success" && "border-success/30 bg-success/5",
                      tone === "primary" && "border-primary/30 bg-primary/5",
                      tone === "muted" && "border-border/40 bg-[hsl(var(--elevated))]",
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      {o.pl.cover_url ? (
                        <img
                          src={o.pl.cover_url}
                          alt=""
                          className="h-10 w-10 rounded-md object-cover shrink-0"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-md bg-muted shrink-0 flex items-center justify-center">
                          <ListMusic className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold truncate group-hover:text-primary transition-colors">
                          {o.pl.name}
                        </div>
                        <div className="text-[11px] text-muted-foreground tabular-nums flex items-center gap-1.5 flex-wrap mt-0.5">
                          <span className="inline-flex items-center gap-0.5">
                            <TrendingUp className="h-3 w-3" />
                            {Math.round(Number(o.brain.headroom_pct))}% headroom
                          </span>
                          {o.sigCount > 0 && (
                            <span className="text-warning">· {o.sigCount} sinal{o.sigCount > 1 ? "is" : ""}</span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div
                          className={cn(
                            "text-[18px] font-bold tabular-nums leading-none",
                            tone === "success" && "text-success",
                            tone === "primary" && "text-primary",
                            tone === "muted" && "text-muted-foreground",
                          )}
                        >
                          {o.matchScore}
                        </div>
                        <div className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">
                          match
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Toolbar — mobile: 2 linhas (ações + filtros). Desktop: 1 linha. */}
      <div className="flex flex-wrap items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="gap-1.5 h-9" disabled={bulkImporting}>
              <Plus className="h-4 w-4" />
              <span>{bulkImporting ? "Importando…" : "Importar"}</span>
              <ChevronDown className="h-3.5 w-3.5 opacity-70 -mr-0.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            <DropdownMenuItem onClick={() => setImportOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              <div className="flex flex-col">
                <span>Importar uma playlist</span>
                <span className="text-[11px] text-muted-foreground">Por URL ou ID do Spotify</span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleBulkImport} disabled={bulkImporting} className="gap-2">
              <RefreshCw className={cn("h-4 w-4", bulkImporting && "animate-spin")} />
              <div className="flex flex-col">
                <span>Importar tudo da conta</span>
                <span className="text-[11px] text-muted-foreground">Varre todas as playlists do Spotify</span>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRecalc}
          disabled={recalcing}
          className="gap-1.5 h-9 px-2.5 sm:px-3"
          title="Sincronizar com Spotify"
          aria-label="Sincronizar com Spotify"
        >
          <RefreshCw className={cn("h-4 w-4", recalcing && "animate-spin")} />
          <span className="hidden sm:inline">{recalcing ? "Sincronizando…" : "Sincronizar"}</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={openLogs}
          className="gap-1.5 h-9 px-2.5 sm:px-3"
          title="Diário"
          aria-label="Diário"
        >
          <History className="h-4 w-4" />
          <span className="hidden sm:inline">Diário</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSortBy(sortBy === "valuation" ? "recent" : "valuation")}
          className="gap-1.5 h-9 px-2.5 sm:px-3"
          title={sortBy === "valuation" ? "Ordem: valuation" : "Ordem: recente"}
          aria-label="Ordenação"
        >
          <ArrowUpDown className="h-4 w-4" />
          <span className="hidden sm:inline">{sortBy === "valuation" ? "Valuation" : "Recente"}</span>
        </Button>
        {missingGenreCount > 0 && (
          <Button
            variant={filterMissingGenre ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterMissingGenre(v => !v)}
            className="gap-1.5 h-9 px-2.5 sm:px-3"
            title={`Sem gênero (${missingGenreCount})`}
            aria-label="Filtrar sem gênero"
          >
            <AlertCircle className="h-4 w-4" />
            <span className="hidden sm:inline">Sem gênero ({missingGenreCount})</span>
            <span className="sm:hidden tabular-nums">{missingGenreCount}</span>
          </Button>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => setShowArchived(false)}
            className={cn(
              "h-9 px-3 rounded-full text-xs font-medium border transition-colors",
              !showArchived
                ? "bg-primary/15 border-primary/40 text-primary"
                : "bg-elevated border-border text-muted-foreground hover:text-foreground",
            )}
          >Ativas ({items.filter(i => !i.archived_at).length})</button>
          <button
            onClick={() => setShowArchived(true)}
            className={cn(
              "h-9 px-3 rounded-full text-xs font-medium border transition-colors",
              showArchived
                ? "bg-primary/15 border-primary/40 text-primary"
                : "bg-elevated border-border text-muted-foreground hover:text-foreground",
            )}
          >Lixeira ({items.filter(i => i.archived_at).length})</button>

          {showArchived && items.filter(i => i.archived_at).length > 0 && (
            <Button
              onClick={emptyTrash}
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" /> Esvaziar lixeira
            </Button>
          )}
        </div>
      </div>

      {/* Grid */}
      {loading && items.length === 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="nx-card !p-0 overflow-hidden">
              <Skeleton className="aspect-square w-full rounded-none bg-muted/40" />
              <div className="p-2.5 space-y-2">
                <Skeleton className="h-3.5 w-3/4 bg-muted/50" />
                <Skeleton className="h-3 w-1/2 bg-muted/40" />
              </div>
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="nx-card text-center py-12">
          <div className="h-12 w-12 rounded-full bg-elevated border border-border mx-auto flex items-center justify-center">
            <ListMusic className="h-5 w-5 text-muted-foreground" />
          </div>
          <h4 className="mt-3 font-semibold">
            {showArchived ? "Nenhuma playlist arquivada" : "Nenhuma playlist gerenciada"}
          </h4>
          <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
            {showArchived
              ? "Playlists que você arquivar ficam aqui (mantém histórico e métricas)."
              : "Cole a URL de uma playlist do Spotify para começar a operar com a inteligência do sistema."}
          </p>
          {!showArchived && (
            <Button onClick={() => setImportOpen(true)} className="mt-4 gap-1.5">
              <Plus className="h-4 w-4" /> Importar primeira playlist
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {visible.map((p) => (
            <Link
              key={p.id}
              to={p.canonical_playlist_id ? `/playlists/${p.canonical_playlist_id}` : "#"}
              onClick={(e) => {
                if (!p.canonical_playlist_id) {
                  e.preventDefault();
                  openDiagnosis(p);
                }
              }}
              className="nx-card !p-0 overflow-hidden text-left group hover:border-foreground/25 transition-colors flex flex-col"
            >
              <div className="relative aspect-square bg-elevated overflow-hidden">
                {p.cover_url ? (
                  <img src={p.cover_url} alt={p.name} loading="lazy"
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Music2 className="h-7 w-7 text-muted-foreground/40" />
                  </div>
                )}
                {p.last_diagnosis_at && (
                  <span className="absolute top-1.5 right-1.5 inline-flex items-center gap-1 px-2 h-6 rounded-full bg-primary/20 border border-primary/40 text-primary text-[10px] font-medium">
                    <Sparkles className="h-3 w-3" /> diag {timeAgo(p.last_diagnosis_at)}
                  </span>
                )}
                {valuations[p.spotify_playlist_id] && (
                  <span
                    title={`Valuation ${valuations[p.spotify_playlist_id].valuation_score}/100`}
                    className={cn(
                      "absolute top-1.5 left-1.5 inline-flex items-center px-2 h-6 rounded-full border text-[10px] font-bold tabular-nums",
                      valuations[p.spotify_playlist_id].recommendation === "buy" && "bg-primary/20 border-primary/40 text-primary",
                      valuations[p.spotify_playlist_id].recommendation === "maybe" && "bg-warning/15 border-warning/40 text-warning",
                      valuations[p.spotify_playlist_id].recommendation === "skip" && "bg-muted/30 border-border text-muted-foreground",
                    )}
                  >
                    V {Math.round(valuations[p.spotify_playlist_id].valuation_score)}
                  </span>
                )}
              </div>
              <div className="p-2.5 flex-1 flex flex-col gap-1.5">
                <div className="flex items-start gap-1.5">
                  <h4 className="flex-1 text-[13px] font-semibold leading-tight line-clamp-1" title={p.name}>{p.name}</h4>
                  <PlaylistScoreBadge scores={p.canonical_playlist_id ? scores[p.canonical_playlist_id] ?? null : null} />
                </div>
                <div className="flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
                  <span><span className="font-semibold text-foreground">{formatNumber(p.followers)}</span> seg.</span>
                  <span><span className="font-semibold text-foreground">{p.tracks_count || "—"}</span> fx</span>
                </div>
                {(p.curatorial_state || (cooldownsByPlaylist[p.id]?.length ?? 0) > 0) && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {p.curatorial_state && <CuratorialStateBadge state={p.curatorial_state} compact />}
                    <CooldownStack cooldowns={cooldownsByPlaylist[p.id] ?? []} max={2} />
                  </div>
                )}
                {(() => {
                  const b = p.canonical_playlist_id ? brains[p.canonical_playlist_id] : null;
                  if (!b) return null;
                  const sigCount = Array.isArray(b.signals) ? b.signals.length : 0;
                  const headroom = b.headroom_pct;
                  return (
                    <Link
                      to={`/playlists/${p.canonical_playlist_id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-1 -mx-2.5 -mb-2.5 px-2.5 py-1.5 border-t border-border bg-elevated/50 hover:bg-elevated text-[10px] flex items-center justify-between text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <span className="inline-flex items-center gap-1">
                        <Brain className="h-3 w-3 text-primary/70" />
                        {headroom !== null
                          ? <>headroom <span className="font-semibold text-foreground tabular-nums">{headroom}%</span></>
                          : <>perfil vivo</>}
                        {sigCount > 0 && <span className="ml-1">· {sigCount} sinais</span>}
                      </span>
                      <ArrowUpRight className="h-3 w-3" />
                    </Link>
                  );
                })()}
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Import dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Importar playlist</DialogTitle>
            <DialogDescription>
              Cole a URL pública da playlist no Spotify. O sistema puxa nome, capa e contagem.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
            placeholder="https://open.spotify.com/playlist/..."
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>Cancelar</Button>
            <Button onClick={handleImport} disabled={importing || !importUrl.trim()}>
              {importing ? "Importando..." : "Importar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diagnosis drawer */}
      <Sheet open={!!drawerPl} onOpenChange={(o) => !o && setDrawerPl(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {drawerPl && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-3">
                  {drawerPl.cover_url && (
                    <img src={drawerPl.cover_url} alt="" className="h-12 w-12 rounded-md object-cover" />
                  )}
                  <span className="truncate">{drawerPl.name}</span>
                </SheetTitle>
                <SheetDescription>
                  {formatNumber(drawerPl.followers)} seguidores · {drawerPl.tracks_count} faixas
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-4">
                {/* Genre tagger */}
                <div className="nx-card flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Gênero</div>
                    <div className="text-sm font-medium truncate">
                      {drawerPl.genre_id
                        ? genres.find(g => g.id === drawerPl.genre_id)?.nome ?? "—"
                        : <span className="text-warning">não definido</span>}
                    </div>
                  </div>
                  <select
                    value={drawerPl.genre_id ?? ""}
                    disabled={savingGenre}
                    onChange={(e) => setPlaylistGenre(drawerPl, e.target.value || null)}
                    className="h-9 px-2 rounded-md bg-elevated border border-border text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="">— sem gênero —</option>
                    {genres.map(g => (
                      <option key={g.id} value={g.id}>{g.nome}</option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => runDiagnosis(drawerPl)} disabled={diagLoading} className="gap-1.5">
                    <Sparkles className="h-4 w-4" />
                    {diagLoading ? "Analisando..." : diagnosis ? "Rodar novo diagnóstico" : "Diagnosticar agora"}
                  </Button>
                  {drawerPl.canonical_playlist_id && (
                    <>
                      <Button variant="outline" asChild className="gap-1.5">
                        <Link to={`/playlists/${drawerPl.canonical_playlist_id}`}>
                          <Brain className="h-4 w-4" /> Perfil vivo
                        </Link>
                      </Button>
                      <Button variant="outline" asChild className="gap-1.5">
                        <Link to={`/playlists/${drawerPl.canonical_playlist_id}?tab=faixas`}>
                          <Music2 className="h-4 w-4" /> Editar faixas
                        </Link>
                      </Button>
                    </>
                  )}
                  <Button variant="outline" asChild>
                    <a href={drawerPl.spotify_url} target="_blank" rel="noreferrer" className="gap-1.5">
                      <ExternalLink className="h-4 w-4" /> Abrir no Spotify
                    </a>
                  </Button>
                  {drawerPl.archived_at ? (
                    <>
                      <Button variant="outline" onClick={() => archive(drawerPl, true)} className="gap-1.5">
                        <ArchiveRestore className="h-4 w-4" /> Restaurar
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => deletePermanent(drawerPl)}
                        className="gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" /> Excluir permanentemente
                      </Button>
                    </>
                  ) : (
                    <Button variant="outline" onClick={() => archive(drawerPl)} className="gap-1.5">
                      <Archive className="h-4 w-4" /> Mover para lixeira
                    </Button>
                  )}
                </div>

                {!diagnosis && !diagLoading && (
                  <div className="nx-card text-center py-8 text-sm text-muted-foreground">
                    Sem diagnóstico ainda. Clique em <strong>Diagnosticar agora</strong> para gerar sugestões.
                  </div>
                )}

                {diagnosis && (
                  <>
                    <div className="nx-card space-y-3">
                      <div className="flex items-center justify-between">
                        <h5 className="font-semibold text-sm">Nome</h5>
                        {diagnosis.name_score !== null && (
                          <span className={cn(
                            "text-xs font-medium px-2 h-6 inline-flex items-center rounded-full border",
                            diagnosis.name_score >= 70
                              ? "bg-primary/15 border-primary/40 text-primary"
                              : "bg-warning/10 border-warning/30 text-warning",
                          )}>Score {diagnosis.name_score}</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">Atual</div>
                      <div className="text-sm">{diagnosis.name_current}</div>
                      {diagnosis.name_suggestion && (
                        <>
                          <div className="text-xs text-muted-foreground mt-2">Sugestão</div>
                          <div className="text-sm font-medium text-primary">{diagnosis.name_suggestion}</div>
                          <div className="flex items-center gap-2 pt-2">
                            <Button size="sm" disabled className="gap-1.5">
                              Aplicar nome no Spotify
                            </Button>
                            <span className="text-[11px] text-muted-foreground">em breve</span>
                          </div>
                        </>
                      )}
                      {Array.isArray(diagnosis.name_reasons) && diagnosis.name_reasons.length > 0 && (
                        <div className="text-xs text-muted-foreground">
                          Faltando: {diagnosis.name_reasons.map((r: any) => r.value).join(", ")}
                        </div>
                      )}
                    </div>

                    {Array.isArray(diagnosis.tracks_suggestions) && diagnosis.tracks_suggestions.length > 0 && (
                      <div className="nx-card space-y-2">
                        <div className="flex items-center justify-between">
                          <h5 className="font-semibold text-sm">Faixas para adicionar</h5>
                          <span className="text-[11px] text-muted-foreground">
                            {diagnosis.tracks_suggestions.length} sugestões · já com posição
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          Faixas do nicho que você não tem. Marcadas com{" "}
                          <span className="text-warning font-medium">★</span> são de artistas faltando.
                        </p>
                        <ul className="space-y-1.5">
                          {diagnosis.tracks_suggestions.slice(0, 15).map((t: any, i: number) => {
                            const nome = t?.nome ?? t?.name ?? t?.title ?? t?.track_name ?? "—";
                            const artista = t?.artista ?? t?.artist ?? t?.artists ?? "—";
                            const count = t?.count ?? t?.recorrencia ?? null;
                            const pos = t?.suggested_position ?? i + 1;
                            const missing = !!t?.from_missing_artist;
                            return (
                              <li key={i} className="flex items-start gap-2 text-xs">
                                <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-primary/10 text-primary text-[10px] font-semibold tabular-nums shrink-0">
                                  #{pos}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className="text-foreground/90 font-medium truncate flex items-center gap-1">
                                    {missing && <span className="text-warning" title="Artista faltando">★</span>}
                                    {nome}
                                  </div>
                                  <div className="text-muted-foreground truncate">{artista}</div>
                                </div>
                                {count != null && (
                                  <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                                    {count}× no nicho
                                  </span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                        <div className="flex items-center gap-2 pt-1">
                          <Button
                            size="sm"
                            className="gap-1.5"
                            disabled={applyingSuggestions}
                            onClick={() => applySuggestions(drawerPl.id, Math.min(diagnosis.tracks_suggestions.length, 15))}
                          >
                            {applyingSuggestions ? "Adicionando…" : `Adicionar ${Math.min(diagnosis.tracks_suggestions.length, 15)} no Spotify`}
                          </Button>
                          <span className="text-[11px] text-muted-foreground">
                            insere no topo, nas posições mostradas
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Análise faixa-a-faixa (keep/remove/promote/demote) */}
                    <PlaylistTracksAnalysisCard managedId={drawerPl.id} />

                    <div className="nx-card text-xs text-muted-foreground flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>Sugestões geradas pelo cérebro do gênero. Aplicação no Spotify ainda é manual: copie e cole no app.</span>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Diário de sincronização */}
      <Sheet open={logOpen} onOpenChange={setLogOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <History className="h-4 w-4" /> Diário de sincronização
            </SheetTitle>
            <SheetDescription>
              Histórico das últimas execuções (cron diário às 06:00 UTC + manuais).
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {logsLoading ? (
              <div className="text-sm text-muted-foreground">Carregando…</div>
            ) : logs.length === 0 ? (
              <div className="nx-card text-sm text-muted-foreground text-center py-6">
                Nenhuma execução registrada ainda.
              </div>
            ) : (
              logs.map((l) => {
                const errs = Array.isArray(l.errors) ? l.errors : [];
                const ok = l.failed === 0 && errs.length === 0;
                return (
                  <div key={l.id} className="nx-card !p-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {ok ? (
                          <CheckCircle2 className="h-4 w-4 text-success" />
                        ) : (
                          <XCircle className="h-4 w-4 text-destructive" />
                        )}
                        <span className="text-[11px] uppercase tracking-wider font-semibold">
                          {l.source}
                        </span>
                      </div>
                      <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {timeAgo(l.created_at)}
                      </span>
                    </div>
                    <div className="text-[12px] tabular-nums flex flex-wrap gap-x-3 gap-y-0.5">
                      <span><b className="text-foreground">{l.synced}</b> <span className="text-muted-foreground">sincronizadas</span></span>
                      <span><b className="text-foreground">{l.recalculated}</b> <span className="text-muted-foreground">scores</span></span>
                      {l.failed > 0 && (
                        <span className="text-destructive"><b>{l.failed}</b> falharam</span>
                      )}
                      {l.duration_ms != null && (
                        <span className="text-muted-foreground ml-auto">{(l.duration_ms / 1000).toFixed(1)}s</span>
                      )}
                    </div>
                    {errs.length > 0 && (
                      <div className="text-[11px] text-destructive/80 space-y-0.5 pt-1 border-t border-border/40">
                        {errs.slice(0, 3).map((e: string, i: number) => (
                          <div key={i} className="truncate">· {e}</div>
                        ))}
                        {errs.length > 3 && (
                          <div className="text-muted-foreground">+ {errs.length - 3} outros</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
