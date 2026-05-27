import { useEffect, useState, useCallback, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuSeparator, DropdownMenuLabel,
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
  History, CheckCircle2, XCircle, Clock, Trash2, ChevronDown, ChevronRight, ArrowUpDown, Link2Off, Link2, Filter, Check, CalendarDays,
} from "lucide-react";
import { MaintenanceCalendarDialog } from "./MaintenanceCalendarDialog";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { PlaylistScoreBadge, type PlaylistScoreRow } from "./PlaylistScoreBadge";
import { PlaylistTracksAnalysisCard } from "@/components/playlists/PlaylistTracksAnalysisCard";
import { CuratorialStateBadge, CooldownStack, type CuratorialState } from "@/components/playlist/CuratorialStateBadge";
import { IconBadge } from "@/components/playlist/IconBadge";
import { GraduationCap } from "lucide-react";
import { useActiveCooldowns } from "@/hooks/useActiveCooldowns";
import { CapacityMatrixTab } from "./CapacityMatrixTab";

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
  account_id: string | null;
  curatorial_state?: CuratorialState | null;
  last_maintenance_at?: string | null;
  max_change_pct?: number | null;
  recommended_change_count?: number | null;
  lifecycle_stage?: "onboarding" | "testing" | "mature" | null;
  lifecycle_phase?: string | null;
  suggested_genre_id?: string | null;
  suggestion_confidence?: number | null;
  suggestion_reason?: string | null;
  suggested_at?: string | null;
};

// Slim row usado nas queries de contagem (catálogo inteiro) — sem payload pesado.
type CountRow = {
  id: string;
  followers: number | null;
  genre_id: string | null;
  archived_at: string | null;
  lifecycle_phase: string | null;
};

const PAGE_SIZE = 50;

type SpotifyAccountLite = { id: string; spotify_user_id: string | null; display_name: string | null; email: string | null; is_default: boolean | null };


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

type PlaylistStats = {
  avgHealth: number;
  topPerf: number;
  atRisk: number;
  inactive: number;
  filteredFollowers: number;
  filteredCount: number;
  filterLabel: string | null;
};

export function MinhasPlaylists({ onStats }: { onStats?: (s: PlaylistStats) => void } = {}) {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // Filtros vivem na URL — sobrevivem navegação (voltar do detalhe preserva contexto).
  const filterMissingGenre = searchParams.get("sem_genero") === "1";
  const filterGenreId = searchParams.get("genero");
  const filterSize = (searchParams.get("tamanho") as "all" | "pequena" | "media" | "grande" | "top") || "all";
  const filterFase = (searchParams.get("fase") as "all" | "prontas" | "crescendo" | "novas" | "atencao") || "all";
  const showArchived = searchParams.get("arquivadas") === "1";
  const showCapacity = searchParams.get("aba") === "capacidade";
  const sortBy = (searchParams.get("sort") as "recent" | "valuation") || "recent";

  const updateParam = useCallback((key: string, val: string | null) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (val == null || val === "" || val === "all" || val === "recent") next.delete(key);
      else next.set(key, val);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setFilterMissingGenre = (v: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof v === "function" ? (v as any)(filterMissingGenre) : v;
    updateParam("sem_genero", next ? "1" : null);
  };
  const setFilterGenreId = (v: string | null) => updateParam("genero", v);
  const setFilterSize = (v: "all" | "pequena" | "media" | "grande" | "top") => updateParam("tamanho", v);
  const setFilterFase = (v: "all" | "prontas" | "crescendo" | "novas" | "atencao") => updateParam("fase", v);
  const setShowArchived = (v: boolean) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (v) { next.set("arquivadas", "1"); next.delete("aba"); }
      else next.delete("arquivadas");
      return next;
    }, { replace: true });
  };
  const setShowCapacity = (v: boolean) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (v) { next.set("aba", "capacidade"); next.delete("arquivadas"); }
      else next.delete("aba");
      return next;
    }, { replace: true });
  };
  const setSortBy = (v: "recent" | "valuation") => updateParam("sort", v);

  // Paginação server-side: começa com 50, "Carregar mais" cresce em +50.
  // Mantém uma fonte só (sem useInfiniteQuery) — queryKey muda quando
  // loadedCount cresce, e os updates locais (setItems) seguem o key atual.
  const [loadedCount, setLoadedCount] = useState(PAGE_SIZE);

  // Reset paginação ao trocar de aba — evita carregar 500 itens de "all"
  // e mostrar só os que sobrarem ao filtrar uma fase.
  useEffect(() => {
    setLoadedCount(PAGE_SIZE);
  }, [filterFase, showArchived]);

  const itemsQuery = useQuery({
    queryKey: ["managed-playlists", loadedCount, filterFase, showArchived],
    queryFn: async () => {
      let q = supabase
        .from("managed_playlists")
        .select("*")
        .order("imported_at", { ascending: false });
      // Arquivadas vs ativas server-side (combina com o filtro client em `visible`)
      if (showArchived) q = q.not("archived_at", "is", null);
      else q = q.is("archived_at", null);
      // Fase server-side — usa lifecycle_phase + followers
      if (filterFase === "prontas") {
        q = q.gte("followers", 100).not("genre_id", "is", null).in("lifecycle_phase", ["mature", "growth"]);
      } else if (filterFase === "crescendo") {
        q = q.or("and(followers.gte.10,followers.lt.100),lifecycle_phase.eq.seed");
      } else if (filterFase === "novas") {
        q = q.lt("followers", 10);
      } else if (filterFase === "atencao") {
        q = q.in("lifecycle_phase", ["bloated", "decline"]);
      }
      const { data, error } = await q.range(0, loadedCount - 1);
      if (error) throw error;
      return (data ?? []) as ManagedPlaylist[];
    },
    placeholderData: (prev) => prev,
  });
  const items = itemsQuery.data ?? [];
  const loading = itemsQuery.isPending;
  const setItems = useCallback(
    (updater: ManagedPlaylist[] | ((prev: ManagedPlaylist[]) => ManagedPlaylist[])) => {
      queryClient.setQueryData<ManagedPlaylist[]>(["managed-playlists", loadedCount, filterFase, showArchived], (prev) => {
        const base = prev ?? [];
        return typeof updater === "function" ? (updater as (p: ManagedPlaylist[]) => ManagedPlaylist[])(base) : updater;
      });
    },
    [queryClient, loadedCount, filterFase, showArchived],
  );

  // Contagens reais do catálogo inteiro (5 colunas, payload mínimo).
  const countsQuery = useQuery({
    queryKey: ["managed-playlists-counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("managed_playlists")
        .select("id, followers, genre_id, archived_at, lifecycle_phase")
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as CountRow[];
    },
    staleTime: 60_000,
  });
  const countRows = countsQuery.data ?? [];
  const totalActiveCount = countRows.filter((r) => !r.archived_at).length;
  const totalArchivedCount = countRows.filter((r) => r.archived_at).length;

  // Contagens por fase (catálogo ativo inteiro).
  const activeRows = useMemo(() => countRows.filter((r) => !r.archived_at), [countRows]);
  const faseCounts = useMemo(() => {
    const inPhase = (r: CountRow, phases: string[]) => !!r.lifecycle_phase && phases.includes(r.lifecycle_phase);
    return {
      all: activeRows.length,
      prontas: activeRows.filter((r) => (r.followers ?? 0) >= 100 && r.genre_id && inPhase(r, ["mature", "growth"])).length,
      crescendo: activeRows.filter((r) => {
        const f = r.followers ?? 0;
        return (f >= 10 && f < 100) || r.lifecycle_phase === "seed";
      }).length,
      novas: activeRows.filter((r) => (r.followers ?? 0) < 10).length,
      atencao: activeRows.filter((r) => inPhase(r, ["bloated", "decline"])).length,
    };
  }, [activeRows]);

  const totalLoadedTarget = showArchived
    ? totalArchivedCount
    : filterFase === "all"
      ? totalActiveCount
      : faseCounts[filterFase];
  const canLoadMore = items.length < loadedCount
    ? false // ainda chegando do servidor
    : items.length < totalLoadedTarget;


  const [scores, setScores] = useState<Record<string, PlaylistScoreRow>>({});
  const [valuations, setValuations] = useState<Record<string, Valuation>>({});
  const [brains, setBrains] = useState<Record<string, BrainRow>>({});
  const [recalcing, setRecalcing] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [bulkImporting, setBulkImporting] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [logs, setLogs] = useState<Array<{ id: string; source: string; synced: number; failed: number; recalculated: number; errors: any; duration_ms: number | null; created_at: string }>>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [accounts, setAccounts] = useState<SpotifyAccountLite[]>([]);
  const [assigningId, setAssigningId] = useState<string | null>(null);

  async function loadAccounts() {
    const { data } = await supabase
      .from("spotify_user_tokens")
      .select("id, spotify_user_id, display_name, email, is_default")
      .order("is_default", { ascending: false })
      .order("display_name", { ascending: true, nullsFirst: false });
    setAccounts((data ?? []) as SpotifyAccountLite[]);
  }


  async function assignAccount(playlistId: string, accountId: string | null) {
    setAssigningId(playlistId);
    const { error } = await supabase
      .from("managed_playlists")
      .update({ account_id: accountId })
      .eq("id", playlistId);
    setAssigningId(null);
    if (error) {
      toast({ title: "Erro ao vincular conta", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: accountId ? "Conta vinculada" : "Vínculo removido" });
    setItems(prev => prev.map(p => p.id === playlistId ? { ...p, account_id: accountId } : p));
  }


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

  async function handleBulkImport(spotifyUserId?: string, accountLabel?: string) {
    setBulkImporting(true);
    try {
      const { data, error } = await supabase.functions.invoke("import-account-playlists", {
        body: spotifyUserId ? { spotify_user_id: spotifyUserId } : {},
      });
      if (error || !data?.ok) throw new Error(error?.message ?? data?.error ?? "Falhou");
      toast({
        title: "Importação concluída",
        description: `${data.imported} playlists${accountLabel ? ` de ${accountLabel}` : ""} (${data.others_count} ignoradas por não serem dessa conta)`,
      });
      load();
    } catch (e: any) {
      toast({ title: "Erro na importação", description: e.message, variant: "destructive" });
    } finally {
      setBulkImporting(false);
    }
  }

  // Contas a IGNORAR na sincronização global (já importadas e congeladas)
  const EXCLUDED_SPOTIFY_USER_IDS = new Set<string>([
    "31kxavlirmnk4nm63bozv6z4pgri", // Top Hits Brasil 🇧🇷 (rafa10mihas01@gmail.com) — não re-sincronizar
  ]);

  async function handleBulkImportAllAccounts() {
    setBulkImporting(true);
    try {
      const { data: tokens, error: tokErr } = await supabase
        .from("spotify_user_tokens")
        .select("spotify_user_id, display_name, email");
      if (tokErr) throw new Error(tokErr.message);

      const targets = (tokens ?? []).filter(
        (t) => t.spotify_user_id && !EXCLUDED_SPOTIFY_USER_IDS.has(t.spotify_user_id),
      );
      if (targets.length === 0) {
        toast({ title: "Nenhuma conta para sincronizar" });
        return;
      }

      toast({
        title: `Sincronizando ${targets.length} contas…`,
        description: "Isso pode levar alguns segundos.",
      });

      let totalImported = 0;
      const failures: string[] = [];
      for (const t of targets) {
        try {
          const { data, error } = await supabase.functions.invoke("import-account-playlists", {
            body: { spotify_user_id: t.spotify_user_id },
          });
          if (error || !data?.ok) {
            failures.push(`${t.display_name ?? t.email ?? t.spotify_user_id}: ${error?.message ?? data?.error ?? "falhou"}`);
          } else {
            totalImported += data.imported ?? 0;
          }
        } catch (e: any) {
          failures.push(`${t.display_name ?? t.spotify_user_id}: ${e.message}`);
        }
      }

      toast({
        title: "Sincronização concluída",
        description: `${totalImported} playlists importadas de ${targets.length - failures.length}/${targets.length} contas${failures.length ? ` — falhas: ${failures.slice(0, 2).join("; ")}` : ""}`,
        variant: failures.length ? "destructive" : "default",
      });
      load();
    } catch (e: any) {
      toast({ title: "Erro na sincronização global", description: e.message, variant: "destructive" });
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
    const result = await itemsQuery.refetch();
    const list = result.data ?? [];
    const canonicals = list.map(i => i.canonical_playlist_id).filter(Boolean) as string[];
    loadScores(canonicals);
    loadBrains(canonicals);
    loadValuations(list.map(i => i.spotify_playlist_id).filter(Boolean));
  }, [itemsQuery, loadScores, loadValuations, loadBrains]);

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

  // Dispara loads derivados sempre que items chega/muda (incluindo hidratação do cache).
  useEffect(() => {
    if (!items.length) { setScores({}); setBrains({}); setValuations({}); return; }
    const canonicals = items.map(i => i.canonical_playlist_id).filter(Boolean) as string[];
    loadScores(canonicals);
    loadBrains(canonicals);
    loadValuations(items.map(i => i.spotify_playlist_id).filter(Boolean));
  }, [items, loadScores, loadBrains, loadValuations]);

  const [genres, setGenres] = useState<{ id: string; nome: string }[]>([]);
  const [savingGenre, setSavingGenre] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestProgress, setSuggestProgress] = useState<{ done: number; total: number } | null>(null);
  const pendingSuggestionCount = items.filter(i => !i.archived_at && !i.genre_id && i.suggested_genre_id).length;


  async function runGenreSuggest() {
    setSuggesting(true);
    setSuggestProgress(null);
    try {
      // 1) Busca IDs das playlists sem gênero (controle do lote fica no cliente)
      const { data: pending, error: pendErr } = await supabase
        .from("managed_playlists")
        .select("id")
        .is("genre_id", null)
        .is("archived_at", null);
      if (pendErr) throw pendErr;
      const ids = (pending ?? []).map((p) => p.id);
      if (!ids.length) {
        toast({ title: "Nada a sugerir", description: "Todas as playlists já têm gênero." });
        return;
      }

      // 2) Fila sequencial — lotes de 5 (cada chamada ~5-10s, bem dentro do timeout)
      const BATCH = 5;
      let okTotal = 0;
      let failTotal = 0;
      setSuggestProgress({ done: 0, total: ids.length });

      for (let i = 0; i < ids.length; i += BATCH) {
        const slice = ids.slice(i, i + BATCH);
        try {
          const { data, error } = await supabase.functions.invoke("classify-playlist-genre", {
            body: { playlist_ids: slice, only_missing: true },
          });
          if (error) throw error;
          okTotal += data?.ok ?? 0;
          failTotal += data?.failed ?? 0;
        } catch (e: any) {
          failTotal += slice.length;
          console.error("[classify batch]", e?.message ?? e);
        }
        setSuggestProgress({ done: Math.min(i + BATCH, ids.length), total: ids.length });
        // pequena pausa entre lotes pra aliviar rate limit do Gemini
        if (i + BATCH < ids.length) await new Promise((r) => setTimeout(r, 800));
      }

      toast({
        title: "Sugestões geradas",
        description: `${okTotal} de ${ids.length} classificadas${failTotal ? ` · ${failTotal} falharam` : ""}. Abrindo Sem gênero para revisar.`,
      });
      await load();
      setFilterGenreId(null);
      setFilterMissingGenre(true);
    } catch (e: any) {
      toast({ title: "Falha ao sugerir gêneros", description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setSuggesting(false);
      setSuggestProgress(null);
    }
  }

  async function acceptSuggestion(pl: ManagedPlaylist) {
    if (!pl.suggested_genre_id) return;
    const { error } = await supabase
      .from("managed_playlists")
      .update({
        genre_id: pl.suggested_genre_id,
        suggested_genre_id: null,
        suggestion_confidence: null,
        suggestion_reason: null,
        suggested_at: null,
      })
      .eq("id", pl.id);
    if (error) {
      toast({ title: "Erro ao aplicar gênero", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Gênero aplicado" });
    setItems((prev) => prev.map((x) => x.id === pl.id ? { ...x, genre_id: pl.suggested_genre_id!, suggested_genre_id: null, suggestion_confidence: null, suggestion_reason: null, suggested_at: null } : x));
  }

  async function dismissSuggestion(pl: ManagedPlaylist) {
    await supabase
      .from("managed_playlists")
      .update({ suggested_genre_id: null, suggestion_confidence: null, suggestion_reason: null, suggested_at: null })
      .eq("id", pl.id);
    setItems((prev) => prev.map((x) => x.id === pl.id ? { ...x, suggested_genre_id: null, suggestion_confidence: null, suggestion_reason: null, suggested_at: null } : x));
  }

  useEffect(() => {
    supabase.from("genres").select("id, nome").order("nome").then(({ data }) => {
      const PRIORITY = ["funk", "trap", "sertanejo", "samba", "pagode", "piseiro"];
      const norm = (s: string) => s.toLowerCase().trim();
      const list = (data ?? []) as { id: string; nome: string }[];
      const sorted = [...list].sort((a, b) => {
        const ia = PRIORITY.indexOf(norm(a.nome));
        const ib = PRIORITY.indexOf(norm(b.nome));
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return a.nome.localeCompare(b.nome, "pt-BR");
      });
      setGenres(sorted as any);
    });
    loadAccounts();
    // Auto-vincula conta Spotify pelo dono da playlist
    supabase.functions.invoke("link-managed-playlist-accounts").then(({ data }) => {
      if (data?.linked > 0) {
        load();
      }
    }).catch(() => {});
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

  // Conta sempre o catálogo inteiro (countsQuery), não apenas a página carregada.
  const missingGenreCount = countRows.filter((r) => !r.archived_at && !r.genre_id).length;

  const visible = items
    .filter((p) => (showArchived ? !!p.archived_at : !p.archived_at))
    .filter((p) => (filterMissingGenre ? !p.genre_id : true))
    .filter((p) => (filterGenreId ? p.genre_id === filterGenreId : true))
    .filter((p) => {
      if (filterSize === "all") return true;
      const f = p.followers ?? 0;
      if (filterSize === "pequena") return f < 1000;
      if (filterSize === "media") return f >= 1000 && f < 10000;
      if (filterSize === "grande") return f >= 10000 && f < 100000;
      if (filterSize === "top") return f >= 100000;
      return true;
    })
    .slice()
    .sort((a, b) => {
      // Ao filtrar por gênero, ordena pelas maiores (followers desc)
      if (filterGenreId) {
        return (b.followers ?? 0) - (a.followers ?? 0);
      }
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
      toast({ title: "Diagnóstico pronto" });
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
    toast({ title: "Excluída" });
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

  // Reflete filtros de gênero nos KPIs do topo
  const visibleActive = visible.filter(p => !p.archived_at);
  const filteredFollowers = visibleActive.reduce((s, p) => s + (p.followers ?? 0), 0);
  const filteredCount = visibleActive.length;
  const filterLabel = filterMissingGenre
    ? "Sem gênero"
    : (filterGenreId ? (genres.find(g => g.id === filterGenreId)?.nome ?? null) : null);

  useEffect(() => {
    onStats?.({ avgHealth, topPerf, atRisk, inactive, filteredFollowers, filteredCount, filterLabel });
  }, [avgHealth, topPerf, atRisk, inactive, filteredFollowers, filteredCount, filterLabel, onStats]);


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
                            {Math.round(Number(o.brain.headroom_pct))}% de folga
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

      {/* Banner: playlists sem gênero — atalho para classificar */}
      {!showArchived && !showCapacity && missingGenreCount > 0 && !filterMissingGenre && (
        <div className="nx-card !p-3 flex items-center gap-3 border-warning/40 bg-warning/10">
          <div className="h-8 w-8 rounded-full bg-warning/20 flex items-center justify-center shrink-0">
            <AlertCircle className="h-4 w-4 text-warning" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-foreground">
              {missingGenreCount} {missingGenreCount === 1 ? "playlist sem gênero" : "playlists sem gênero"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              Classifique agora para liberar match com clientes e relatórios por gênero.
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 border-warning/40 text-warning hover:bg-warning/15 hover:text-warning shrink-0"
            onClick={() => { setFilterFase("all"); setFilterMissingGenre(true); }}
          >
            Classificar agora
          </Button>
        </div>
      )}

      {/* Abas por fase — padrão underline+ícone (igual /financeiro) */}
      {!showArchived && !showCapacity && (
        <div className="flex items-center gap-1 border-b border-border overflow-x-auto scrollbar-none -mx-4 px-4 lg:mx-0 lg:px-0">
          {([
            { key: "all",       label: "Todas",     count: faseCounts.all,       icon: ListMusic,    tip: "Todas as playlists ativas" },
            { key: "prontas",   label: "Prontas",   count: faseCounts.prontas,   icon: CheckCircle2, tip: "≥100 seguidores · com gênero · maturidade ou crescimento" },
            { key: "crescendo", label: "Crescendo", count: faseCounts.crescendo, icon: TrendingUp,   tip: "10–99 seguidores ou em fase inicial" },
            { key: "novas",     label: "Novas",     count: faseCounts.novas,     icon: Sparkles,     tip: "<10 seguidores" },
            { key: "atencao",   label: "Atenção",   count: faseCounts.atencao,   icon: AlertCircle,  tip: "Saturadas ou em declínio" },
          ] as const).map((t) => {
            const Icon = t.icon;
            const active = filterFase === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setFilterFase(t.key)}
                title={t.tip}
                className={cn(
                  "px-3 lg:px-4 h-10 inline-flex items-center gap-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap shrink-0",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
                <span className="text-[11px] tabular-nums opacity-70">({t.count})</span>
              </button>
            );
          })}
        </div>
      )}



      {/* Toolbar — 1 linha no mobile (textos só no desktop) */}
      <div className="flex flex-nowrap sm:flex-wrap items-center gap-1.5 sm:gap-2 overflow-x-auto -mx-1 px-1 sm:mx-0 sm:px-0 sm:overflow-visible">

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="gap-1 h-9 px-2.5 sm:px-3 shrink-0" disabled={bulkImporting}>
              <Plus className="h-4 w-4" />
              <span>{bulkImporting ? "Importando…" : "Importar"}</span>
              <ChevronDown className="h-3.5 w-3.5 opacity-70 -mr-0.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Importar do Spotify
            </DropdownMenuLabel>
            <DropdownMenuItem onClick={() => setImportOpen(true)} className="gap-2 items-start py-2">
              <Plus className="h-4 w-4 mt-0.5" />
              <div className="flex flex-col">
                <span>Uma playlist específica</span>
                <span className="text-[11px] text-muted-foreground">Cola a URL ou ID — importa só aquela</span>
              </div>
            </DropdownMenuItem>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="gap-2 items-start py-2">
                <RefreshCw className={cn("h-4 w-4 mt-0.5", bulkImporting && "animate-spin")} />
                <div className="flex flex-col">
                  <span>Todas as playlists de uma conta</span>
                  <span className="text-[11px] text-muted-foreground">Escolhe qual conta varrer</span>
                </div>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-64 max-h-80 overflow-y-auto">
                {accounts.length === 0 ? (
                  <DropdownMenuItem disabled className="text-[11px]">
                    Nenhuma conta Spotify conectada
                  </DropdownMenuItem>
                ) : (
                  accounts.map((acc) => (
                    <DropdownMenuItem
                      key={acc.id}
                      disabled={bulkImporting || !acc.spotify_user_id}
                      onClick={() =>
                        handleBulkImport(
                          acc.spotify_user_id ?? undefined,
                          acc.display_name ?? acc.email ?? "conta",
                        )
                      }
                      className="gap-2 items-start py-2"
                    >
                      <div className="flex flex-col">
                        <span>{acc.display_name ?? acc.email ?? "Conta sem nome"}</span>
                        {acc.email && acc.display_name && (
                          <span className="text-[11px] text-muted-foreground">{acc.email}</span>
                        )}
                      </div>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => handleBulkImportAllAccounts()}
              disabled={bulkImporting}
              className="gap-2 items-start py-2"
            >
              <RefreshCw className={cn("h-4 w-4 mt-0.5", bulkImporting && "animate-spin")} />
              <div className="flex flex-col">
                <span>Todas as contas de uma vez</span>
                <span className="text-[11px] text-muted-foreground">
                  Varre todas as contas conectadas (exceto Top Hits Brasil)
                </span>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSortBy(sortBy === "valuation" ? "recent" : "valuation")}
          className="gap-1.5 h-9 w-9 sm:w-auto px-0 sm:px-3 shrink-0"
          title={sortBy === "valuation" ? "Ordem: valuation" : "Ordem: recente"}
          aria-label="Ordenação"
        >
          <ArrowUpDown className="h-4 w-4" />
          <span className="hidden sm:inline">{sortBy === "valuation" ? "Valuation" : "Recente"}</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant={filterGenreId ? "default" : "outline"}
              size="sm"
              className="gap-1.5 h-9 w-9 sm:w-auto px-0 sm:px-3 shrink-0"
              title="Filtrar por gênero"
              aria-label="Filtrar por gênero"
            >
              <Filter className="h-4 w-4" />
              <span className="hidden sm:inline max-w-[120px] truncate">
                {filterGenreId
                  ? genres.find(g => g.id === filterGenreId)?.nome ?? "Gênero"
                  : "Gênero"}
              </span>
              <ChevronDown className="h-3.5 w-3.5 opacity-70 -mr-0.5 hidden sm:inline" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56 max-h-80 overflow-y-auto">
            <DropdownMenuItem onClick={() => setFilterGenreId(null)} className="gap-2">
              {!filterGenreId ? <Check className="h-4 w-4 text-primary" /> : <span className="w-4" />}
              <span>Todos os gêneros</span>
            </DropdownMenuItem>
            {genres.map((g) => (
              <DropdownMenuItem
                key={g.id}
                onClick={() => setFilterGenreId(g.id)}
                className="gap-2"
              >
                {filterGenreId === g.id ? <Check className="h-4 w-4 text-primary" /> : <span className="w-4" />}
                <span className="truncate">{g.nome}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant={filterSize !== "all" ? "default" : "outline"}
              size="sm"
              className="gap-1.5 h-9 w-9 sm:w-auto px-0 sm:px-3 shrink-0"
              title="Filtrar por tamanho"
              aria-label="Filtrar por tamanho"
            >
              <Filter className="h-4 w-4" />
              <span className="hidden sm:inline max-w-[120px] truncate">
                {filterSize === "all" ? "Tamanho"
                  : filterSize === "pequena" ? "Pequenas"
                  : filterSize === "media" ? "Médias"
                  : filterSize === "grande" ? "Grandes" : "Top"}
              </span>
              <ChevronDown className="h-3.5 w-3.5 opacity-70 -mr-0.5 hidden sm:inline" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onClick={() => setFilterSize("all")} className="gap-2">
              {filterSize === "all" ? <Check className="h-4 w-4 text-primary" /> : <span className="w-4" />}
              <span>Todos os tamanhos</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setFilterSize("pequena")} className="gap-2">
              {filterSize === "pequena" ? <Check className="h-4 w-4 text-primary" /> : <span className="w-4" />}
              <span>Pequenas (&lt; 1K)</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setFilterSize("media")} className="gap-2">
              {filterSize === "media" ? <Check className="h-4 w-4 text-primary" /> : <span className="w-4" />}
              <span>Médias (1K–10K)</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setFilterSize("grande")} className="gap-2">
              {filterSize === "grande" ? <Check className="h-4 w-4 text-primary" /> : <span className="w-4" />}
              <span>Grandes (10K–100K)</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setFilterSize("top")} className="gap-2">
              {filterSize === "top" ? <Check className="h-4 w-4 text-primary" /> : <span className="w-4" />}
              <span>Top (100K+)</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCalendarOpen(true)}
          className="gap-1.5 h-9 w-9 sm:w-auto px-0 sm:px-3 shrink-0"
          title="Calendário de manutenção"
          aria-label="Calendário de manutenção"
        >
          <CalendarDays className="h-4 w-4" />
          <span className="hidden sm:inline">Manutenção</span>
        </Button>
        {missingGenreCount > 0 && (
          <Button
            variant={filterMissingGenre ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterMissingGenre(v => !v)}
            className="gap-1.5 h-9 px-2 sm:px-3 shrink-0"
            title={`Sem gênero (${missingGenreCount})${pendingSuggestionCount ? ` · ${pendingSuggestionCount} com sugestão` : ""}`}
            aria-label="Filtrar sem gênero"
          >
            <AlertCircle className="h-4 w-4" />
            <span className="hidden sm:inline">
              Sem gênero ({missingGenreCount}{pendingSuggestionCount ? ` · ${pendingSuggestionCount} sugeridas` : ""})
            </span>
            <span className="sm:hidden tabular-nums text-[11px]">{missingGenreCount}</span>
          </Button>
        )}
        {missingGenreCount > 0 && (
          <Button
            variant={pendingSuggestionCount ? "default" : "outline"}
            size="sm"
            onClick={() => {
              if (pendingSuggestionCount && !suggesting) {
                setFilterGenreId(null);
                setFilterMissingGenre(true);
                return;
              }
              runGenreSuggest();
            }}
            disabled={suggesting}
            className="gap-1.5 h-9 px-2 sm:px-3 shrink-0"
            title={pendingSuggestionCount ? "Revisar sugestões pendentes" : "Sugerir gêneros via IA"}
            aria-label={pendingSuggestionCount ? "Revisar sugestões pendentes" : "Sugerir gêneros via IA"}
          >
            <Sparkles className={cn("h-4 w-4", suggesting && "animate-pulse")} />
            <span className="hidden sm:inline">
              {suggesting
                ? (suggestProgress ? `Sugerindo… ${suggestProgress.done}/${suggestProgress.total}` : "Sugerindo…")
                : pendingSuggestionCount
                  ? `Revisar sugestões (${pendingSuggestionCount})`
                  : `Sugerir gêneros (${missingGenreCount})`}
            </span>
          </Button>
        )}
        <div className="sm:ml-auto flex items-center gap-1.5 shrink-0">
          <Link
            to="/catalogo"
            replace
            className={cn(
              "h-9 px-3 rounded-full text-[11px] sm:text-xs font-medium border transition-colors tabular-nums shrink-0 inline-flex items-center",
              !showArchived && !showCapacity
                ? "bg-primary/15 border-primary/40 text-primary"
                : "bg-elevated border-border text-muted-foreground hover:text-foreground",
            )}
          >Ativas ({totalActiveCount})</Link>
          <Link
            to="/catalogo?arquivadas=1"
            replace
            className={cn(
              "h-9 px-3 rounded-full text-[11px] sm:text-xs font-medium border transition-colors tabular-nums shrink-0 inline-flex items-center",
              showArchived
                ? "bg-primary/15 border-primary/40 text-primary"
                : "bg-elevated border-border text-muted-foreground hover:text-foreground",
            )}
          >Lixeira ({totalArchivedCount})</Link>
          <Link
            to="/catalogo?aba=capacidade"
            replace
            className={cn(
              "h-9 px-3 rounded-full text-[11px] sm:text-xs font-medium border transition-colors shrink-0 inline-flex items-center",
              showCapacity
                ? "bg-primary/15 border-primary/40 text-primary"
                : "bg-elevated border-border text-muted-foreground hover:text-foreground",
            )}
          >Capacidade</Link>




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

      {/* Grid ou Matriz de Capacidade */}
      {showCapacity ? (
        <div
          ref={(el) => {
            if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        >
          <CapacityMatrixTab />
        </div>
      ) : loading && items.length === 0 ? (
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
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2.5">
          {visible.map((p) => (
            <Link
              key={p.id}
              to={`/playlists/${p.canonical_playlist_id ?? p.id}`}
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
              </div>

              <div className="p-2 flex-1 flex flex-col gap-1">
                <div className="flex items-start gap-1.5">
                  <h4 className="flex-1 text-[12.5px] font-semibold leading-tight line-clamp-1" title={p.name}>{p.name}</h4>
                </div>
                {(p.followers ?? 0) >= 100 && p.genre_id && (
                  <div
                    className="inline-flex items-center gap-1 self-start rounded-full border border-success/40 bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success"
                    title="Tem público mínimo e gênero classificado — pode entrar em campanha"
                  >
                    <CheckCircle2 className="h-2.5 w-2.5" />
                    Pronta para campanha
                  </div>
                )}
                <div className="flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
                  <span><span className="font-semibold text-foreground">{formatNumber(p.followers)}</span> seg.</span>
                  <span><span className="font-semibold text-foreground">{p.tracks_count || "—"}</span> fx</span>
                </div>
                {!p.genre_id && p.suggested_genre_id && (
                  <div
                    className="flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-1 text-[10.5px]"
                    onClick={(e) => e.preventDefault()}
                    title={p.suggestion_reason ?? ""}
                  >
                    <Sparkles className="h-3 w-3 text-primary shrink-0" />
                    <span className="flex-1 truncate text-primary capitalize">
                      {genres.find(g => g.id === p.suggested_genre_id)?.nome ?? "—"}
                      <span className="text-muted-foreground ml-1 tabular-nums">{p.suggestion_confidence ?? 0}%</span>
                    </span>
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); acceptSuggestion(p); }}
                      className="h-4 w-4 inline-flex items-center justify-center rounded hover:bg-primary/20 text-primary"
                      title="Aceitar sugestão"
                      aria-label="Aceitar sugestão"
                    >
                      <Check className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); dismissSuggestion(p); }}
                      className="h-4 w-4 inline-flex items-center justify-center rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
                      title="Descartar sugestão"
                      aria-label="Descartar sugestão"
                    >
                      <XCircle className="h-3 w-3" />
                    </button>
                  </div>
                )}
                {/* Régua única — ícones à esquerda, números à direita, distribuídos */}
                {(valuations[p.spotify_playlist_id] || p.last_diagnosis_at || p.account_id || !p.account_id || p.curatorial_state || p.lifecycle_stage === "onboarding" || (cooldownsByPlaylist[p.id]?.length ?? 0) > 0 || (p.canonical_playlist_id && scores[p.canonical_playlist_id])) && (
                  <div className="flex items-center justify-between flex-wrap gap-y-1 mt-0.5">
                    {/* === ÍCONES (esquerda) === */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {p.lifecycle_stage === "onboarding" && (
                        <IconBadge
                          title="Em onboarding"
                          description="Playlist ainda passando pela padronização inicial. Precisa concluir o onboarding antes de receber deals de clientes."
                          icon={GraduationCap}
                          tone="primary"
                        />
                      )}
                      {p.account_id && (() => {
                        const acc = accounts.find(a => a.id === p.account_id);
                        const label = acc?.display_name || acc?.email || "conta";
                        return (
                          <IconBadge
                            title="Conta Spotify vinculada"
                            description={
                              <>
                                Esta playlist está conectada à conta <span className="text-foreground font-medium">{label}</span>
                                {acc?.email && acc?.display_name ? <> ({acc.email})</> : null}.
                                As ações de manutenção e diagnóstico usam essa conta.
                              </>
                            }
                            icon={Link2}
                            tone="primary"
                          />
                        );
                      })()}
                      {p.curatorial_state && <CuratorialStateBadge state={p.curatorial_state} compact />}
                      {p.last_diagnosis_at && (
                        <IconBadge
                          title="Último diagnóstico"
                          description={
                            <>
                              Análise mais recente realizada <span className="text-foreground font-medium">{timeAgo(p.last_diagnosis_at)}</span>.
                              Quanto mais antiga, mais vale rodar um novo diagnóstico para atualizar as recomendações.
                            </>
                          }
                          icon={Sparkles}
                          tone="primary"
                        />
                      )}
                      {!p.account_id && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                              title="Sem conta Spotify vinculada — clique para vincular"
                              aria-label="Sem conta vinculada"
                              className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-warning/20 border border-warning/50 text-warning hover:bg-warning/30 transition-colors shrink-0"
                            >
                              <Link2Off className="h-2.5 w-2.5" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent
                            align="start"
                            className="w-64 p-2"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                          >
                            <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                              Vincular esta playlist a uma conta Spotify:
                            </div>
                            {accounts.length === 0 ? (
                              <div className="px-2 py-3 text-[12px] text-muted-foreground">
                                Nenhuma conta cadastrada. Cadastre em Ajustes → Contas.
                              </div>
                            ) : (
                              <div className="max-h-64 overflow-y-auto flex flex-col">
                                {accounts.map((acc) => (
                                  <button
                                    key={acc.id}
                                    type="button"
                                    disabled={assigningId === p.id}
                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); assignAccount(p.id, acc.id); }}
                                    className="text-left px-2 py-2 rounded-md hover:bg-[hsl(var(--hover))] flex items-center gap-2 disabled:opacity-50"
                                  >
                                    <Link2 className="h-3.5 w-3.5 text-primary shrink-0" />
                                    <div className="flex-1 min-w-0">
                                      <div className="text-[12px] font-medium truncate">
                                        {acc.display_name || acc.email || "Conta sem nome"}
                                      </div>
                                      {acc.email && acc.display_name && (
                                        <div className="text-[10px] text-muted-foreground truncate">{acc.email}</div>
                                      )}
                                    </div>
                                    {acc.is_default && (
                                      <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded text-primary bg-primary/10">
                                        padrão
                                      </span>
                                    )}
                                  </button>
                                ))}
                              </div>
                            )}
                          </PopoverContent>
                        </Popover>
                      )}
                      <CooldownStack cooldowns={cooldownsByPlaylist[p.id] ?? []} max={2} />
                    </div>

                    {/* === NÚMEROS (direita): health score + valuation === */}
                    <div className="flex items-center gap-1.5">
                      <PlaylistScoreBadge scores={p.canonical_playlist_id ? scores[p.canonical_playlist_id] ?? null : null} />
                      {valuations[p.spotify_playlist_id] && (() => {
                        const v = valuations[p.spotify_playlist_id];
                        const score = Math.round(v.valuation_score);
                        const recLabel =
                          v.recommendation === "buy" ? "Recomendado comprar" :
                          v.recommendation === "maybe" ? "Avaliar com cautela" :
                          "Não recomendado";
                        const tone =
                          v.recommendation === "buy" ? "primary" :
                          v.recommendation === "maybe" ? "warning" : "muted";
                        return (
                          <IconBadge
                            title={`Valuation ${score}/100`}
                            description={
                              <>
                                Pontuação de valor de aquisição da playlist baseada em performance, audiência e contexto.
                                <span className="block mt-1 text-foreground font-medium">{recLabel}.</span>
                              </>
                            }
                            label={`V${score}`}
                            tone={tone as any}
                          />
                        );
                      })()}
                    </div>
                  </div>
                )}
                {(() => {
                  const b = p.canonical_playlist_id ? brains[p.canonical_playlist_id] : null;
                  if (!b) return null;
                  const sigCount = Array.isArray(b.signals) ? b.signals.length : 0;
                  const headroom = b.headroom_pct;
                  return (
                    <div className="mt-1 -mx-2.5 -mb-2.5 px-2.5 py-1.5 border-t border-border bg-elevated/50 text-[10px] flex items-center justify-between text-muted-foreground transition-colors">
                      <span className="inline-flex items-center gap-1">
                        <Brain className="h-3 w-3 text-primary/70" />
                        {headroom !== null
                          ? <>folga <span className="font-semibold text-foreground tabular-nums">{headroom}%</span></>
                          : <>perfil vivo</>}
                        {sigCount > 0 && <span className="ml-1">· {sigCount} {sigCount === 1 ? "sinal" : "sinais"}</span>}
                      </span>
                      <ArrowUpRight className="h-3 w-3" />
                    </div>
                  );
                })()}
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Rodapé: Carregar mais — só aparece fora da matriz de capacidade e quando há mais no servidor */}
      {!showCapacity && !loading && items.length > 0 && (
        <div className="flex flex-col items-center gap-2 pt-2">
          <p className="text-[11px] text-muted-foreground tabular-nums">
            Exibindo <span className="font-semibold text-foreground">{items.length}</span> de{" "}
            <span className="font-semibold text-foreground">{totalLoadedTarget}</span>{" "}
            {showArchived ? "arquivadas" : "ativas"}
          </p>
          {canLoadMore && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLoadedCount((n) => n + PAGE_SIZE)}
              disabled={itemsQuery.isFetching}
              className="gap-2 h-9"
            >
              {itemsQuery.isFetching ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  Carregando…
                </>
              ) : (
                <>Carregar mais {PAGE_SIZE}</>
              )}
            </Button>
          )}
        </div>
      )}

      {/* Import dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Importar playlist</DialogTitle>
            <DialogDescription>Cole a URL pública do Spotify.</DialogDescription>
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
      <Dialog open={!!drawerPl} onOpenChange={(o) => !o && setDrawerPl(null)}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto p-0">
          {drawerPl && (
            <>
              <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
                <DialogTitle className="flex items-center gap-3 text-left">
                  {drawerPl.cover_url && (
                    <img src={drawerPl.cover_url} alt="" className="h-14 w-14 rounded-md object-cover shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-semibold">{drawerPl.name}</div>
                    <div className="text-xs font-normal text-muted-foreground mt-1">
                      {formatNumber(drawerPl.followers)} seguidores · {drawerPl.tracks_count} faixas
                    </div>
                  </div>
                </DialogTitle>
                <DialogDescription className="sr-only">Detalhes e diagnóstico da playlist</DialogDescription>
              </DialogHeader>

              <div className="px-6 py-5 space-y-4">
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

                {/* Ações primárias */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <Button onClick={() => runDiagnosis(drawerPl)} disabled={diagLoading} className="gap-1.5 justify-center">
                    <Sparkles className="h-4 w-4" />
                    {diagLoading ? "Analisando..." : diagnosis ? "Novo diagnóstico" : "Diagnosticar"}
                  </Button>
                  {drawerPl.canonical_playlist_id && (
                    <>
                      <Button variant="outline" asChild className="gap-1.5 justify-center">
                        <Link to={`/playlists/${drawerPl.canonical_playlist_id}`}>
                          <Brain className="h-4 w-4" /> Perfil vivo
                        </Link>
                      </Button>
                      <Button variant="outline" asChild className="gap-1.5 justify-center">
                        <Link to={`/playlists/${drawerPl.canonical_playlist_id}?tab=faixas`}>
                          <Music2 className="h-4 w-4" /> Editar faixas
                        </Link>
                      </Button>
                    </>
                  )}
                  <Button variant="outline" asChild className="justify-center">
                    <a href={drawerPl.spotify_url} target="_blank" rel="noreferrer" className="gap-1.5">
                      <ExternalLink className="h-4 w-4" /> Abrir no Spotify
                    </a>
                  </Button>
                </div>

                {/* Ações de arquivo (separadas, secundárias) */}
                <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                  {drawerPl.archived_at ? (
                    <>
                      <Button variant="outline" size="sm" onClick={() => archive(drawerPl, true)} className="gap-1.5">
                        <ArchiveRestore className="h-4 w-4" /> Restaurar
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => deletePermanent(drawerPl)}
                        className="gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" /> Excluir permanentemente
                      </Button>
                    </>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => archive(drawerPl)} className="gap-1.5">
                      <Archive className="h-4 w-4" /> Mover para lixeira
                    </Button>
                  )}
                </div>

                {!diagnosis && !diagLoading && (
                  <div className="nx-card text-center py-8 text-sm text-muted-foreground">
                    Sem diagnóstico ainda. Clique em <strong>Diagnosticar</strong> para gerar sugestões.
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
                          )}>Nota {diagnosis.name_score}</span>
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
        </DialogContent>
      </Dialog>

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
      <MaintenanceCalendarDialog
        open={calendarOpen}
        onOpenChange={setCalendarOpen}
        items={items}
        genres={genres}
      />
    </section>
  );
}
