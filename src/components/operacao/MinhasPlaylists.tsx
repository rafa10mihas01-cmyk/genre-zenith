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
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
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
  History, CheckCircle2, XCircle, Clock, Trash2, ChevronDown, ChevronRight, ArrowUpDown, Link2Off, Link2, Filter, Check, CalendarDays, Bell,
} from "lucide-react";
import { MaintenanceCalendarDialog } from "./MaintenanceCalendarDialog";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { PlaylistScoreBadge, type PlaylistScoreRow } from "./PlaylistScoreBadge";
import { PlaylistTracksAnalysisCard } from "@/components/playlists/PlaylistTracksAnalysisCard";
import { CuratorialStateBadge, CooldownStack, type CuratorialState } from "@/components/playlist/CuratorialStateBadge";
import { IconBadge } from "@/components/playlist/IconBadge";
import { GraduationCap } from "lucide-react";
import { useActiveCooldowns } from "@/hooks/useActiveCooldowns";
import { useBlockedPlaylistIds } from "@/hooks/useSpotifyAppsStatus";
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
  archived_reason?: string | null;
  archived_followers?: number | null;
  reactivation_eligible_at?: string | null;
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
  archived_reason: string | null;
  reactivation_eligible_at: string | null;
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
  const filterAppBlocked = searchParams.get("app") === "bloqueado";
  const showArchived = searchParams.get("arquivadas") === "1";
  const showCapacity = searchParams.get("aba") === "capacidade";
  const sortBy = (searchParams.get("sort") as "followers" | "recent" | "valuation") || "followers";

  // Apps Spotify bloqueados pelo circuit breaker — usado pelo chip "Apps bloqueados".
  const { data: blockedRows = [] } = useBlockedPlaylistIds();
  const blockedSet = useMemo(() => new Set(blockedRows.map(r => r.playlist_id)), [blockedRows]);
  const blockedAppName = blockedRows[0]?.app_name ?? null;
  const blockedUntil = blockedRows[0]?.blocked_until ?? null;
  const setFilterAppBlocked = (v: boolean) => updateParam("app", v ? "bloqueado" : null);

  const updateParam = useCallback((key: string, val: string | null) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (val == null || val === "" || val === "all" || val === "followers") next.delete(key);
      else next.set(key, val);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setFilterMissingGenre = (v: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof v === "function" ? (v as any)(filterMissingGenre) : v;
    // Mutuamente exclusivo com filtro de gênero específico
    setSearchParams(prev => {
      const np = new URLSearchParams(prev);
      if (next) { np.set("sem_genero", "1"); np.delete("genero"); }
      else np.delete("sem_genero");
      return np;
    }, { replace: true });
  };
  const setFilterGenreId = (v: string | null) => {
    setSearchParams(prev => {
      const np = new URLSearchParams(prev);
      if (v) { np.set("genero", v); np.delete("sem_genero"); }
      else np.delete("genero");
      return np;
    }, { replace: true });
  };
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
  const setSortBy = (v: "followers" | "recent" | "valuation") => updateParam("sort", v);

  // Paginação server-side: começa com 50, "Carregar mais" cresce em +50.
  // Mantém uma fonte só (sem useInfiniteQuery) — queryKey muda quando
  // loadedCount cresce, e os updates locais (setItems) seguem o key atual.
  const [loadedCount, setLoadedCount] = useState(PAGE_SIZE);

  // Filtro da lixeira: só elegíveis para retorno (reactivation_eligible_at IS NOT NULL).
  // Sincronizado com URL (?elegiveis=1) pra permitir deep-link a partir do card
  // "Saúde do Ecossistema" no topo da página.
  const onlyEligible = searchParams.get("elegiveis") === "1" && showArchived;
  const setOnlyEligible = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const value = typeof next === "function" ? (next as (p: boolean) => boolean)(onlyEligible) : next;
      updateParam("elegiveis", value ? "1" : null);
    },
    [onlyEligible, updateParam],
  );

  // Reset paginação ao trocar de aba — evita carregar 500 itens de "all"
  // e mostrar só os que sobrarem ao filtrar uma fase.
  useEffect(() => {
    setLoadedCount(PAGE_SIZE);
  }, [filterFase, showArchived, filterMissingGenre, filterGenreId, filterSize, onlyEligible]);

  // Limpa o param ao sair da lixeira.
  useEffect(() => {
    if (!showArchived && searchParams.get("elegiveis")) {
      updateParam("elegiveis", null);
    }
  }, [showArchived, searchParams, updateParam]);

  const itemsQuery = useQuery({
    queryKey: ["managed-playlists", loadedCount, filterFase, showArchived, sortBy, filterMissingGenre, filterGenreId, filterSize, onlyEligible],
    queryFn: async () => {
      let q = supabase
        .from("managed_playlists")
        .select("*");
      if (sortBy === "followers") {
        q = q.order("followers", { ascending: false, nullsFirst: false }).order("imported_at", { ascending: false });
      } else {
        q = q.order("imported_at", { ascending: false });
      }
      if (showArchived) {
        q = q.not("archived_at", "is", null);
        if (onlyEligible) q = q.not("reactivation_eligible_at", "is", null);
      } else {
        q = q.is("archived_at", null);
      }
      // Fase server-side — abas mutuamente exclusivas (cada playlist cai em UMA só).
      // Hierarquia: Atenção > Prontas > Crescendo > Novas.
      const notAtencao = "or(lifecycle_phase.is.null,lifecycle_phase.not.in.(bloated,decline))";
      if (filterFase === "prontas") {
        // 100+ seguidores, fora de Atenção. Aceita seed/mature/growth e sem gênero (badge no card).
        q = q.gte("followers", 100).or("lifecycle_phase.is.null,lifecycle_phase.not.in.(bloated,decline)");
      } else if (filterFase === "crescendo") {
        // followers 10–99 e fora de Atenção (Prontas exige ≥100, então já não colide)
        q = q.gte("followers", 10).lt("followers", 100).or(notAtencao.replace(/^or\(|\)$/g, ""));
      } else if (filterFase === "novas") {
        q = q.lt("followers", 10).or(notAtencao.replace(/^or\(|\)$/g, ""));
      } else if (filterFase === "atencao") {
        q = q.in("lifecycle_phase", ["bloated", "decline"]);
      }
      // Filtros de gênero server-side (antes eram client-side, quebrando paginação)
      if (filterMissingGenre) {
        q = q.is("genre_id", null);
      } else if (filterGenreId) {
        q = q.eq("genre_id", filterGenreId);
      }
      // Filtro de tamanho server-side (antes era client-side, escondia playlists além do loadedCount)
      if (filterSize === "pequena") q = q.lt("followers", 1000);
      else if (filterSize === "media") q = q.gte("followers", 1000).lt("followers", 10000);
      else if (filterSize === "grande") q = q.gte("followers", 10000).lt("followers", 100000);
      else if (filterSize === "top") q = q.gte("followers", 100000);
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
      queryClient.setQueryData<ManagedPlaylist[]>(["managed-playlists", loadedCount, filterFase, showArchived, sortBy, filterMissingGenre, filterGenreId, filterSize, onlyEligible], (prev) => {
        const base = prev ?? [];
        return typeof updater === "function" ? (updater as (p: ManagedPlaylist[]) => ManagedPlaylist[])(base) : updater;
      });
    },
    [queryClient, loadedCount, filterFase, showArchived, sortBy, filterMissingGenre, filterGenreId, filterSize],
  );

  // Contagens reais do catálogo inteiro (5 colunas, payload mínimo).
  const countsQuery = useQuery({
    queryKey: ["managed-playlists-counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("managed_playlists")
        .select("id, followers, genre_id, archived_at, reactivation_eligible_at, lifecycle_phase")
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as CountRow[];
    },
    staleTime: 60_000,
  });
  const countRows = countsQuery.data ?? [];
  const totalActiveCount = countRows.filter((r) => !r.archived_at).length;
  const totalArchivedCount = countRows.filter((r) => r.archived_at).length;
  const eligibleCount = countRows.filter((r) => r.archived_at && r.reactivation_eligible_at).length;

  // Contagens por fase (catálogo ativo inteiro).
  const activeRows = useMemo(() => countRows.filter((r) => !r.archived_at), [countRows]);
  // Classificador mutuamente exclusivo — cada playlist cai em UMA aba só.
  // Hierarquia: Atenção > Prontas > Crescendo > Novas.
  const classifyFase = useCallback((r: CountRow): "prontas" | "crescendo" | "novas" | "atencao" | null => {
    const phase = r.lifecycle_phase ?? null;
    const f = r.followers ?? 0;
    if (phase === "bloated" || phase === "decline") return "atencao";
    // Prontas: 100+ seguidores. Aceita qualquer fase (inclusive seed) e qualquer estado de gênero.
    // Quando sem genre_id, recebe badge "Sem gênero" no card (precisa classificar pra entrar em campanha).
    if (f >= 100) return "prontas";
    if (f >= 10 && f < 100) return "crescendo";
    if (f < 10) return "novas";
    return null;
  }, []);

  const faseCounts = useMemo(() => {
    const acc = { all: activeRows.length, prontas: 0, crescendo: 0, novas: 0, atencao: 0 };
    for (const r of activeRows) {
      const k = classifyFase(r);
      if (k) acc[k]++;
    }
    return acc;
  }, [activeRows, classifyFase]);

  // Total real considerando TODOS os filtros server-side (fase + sem_genero + genero).
  // Sem isso, "Carregar mais" desliga antes da hora quando os filtros reduzem o conjunto.
  const totalLoadedTarget = useMemo(() => {
    if (showArchived) return totalArchivedCount;
    return activeRows.filter((r) => {
      if (filterFase !== "all" && classifyFase(r) !== filterFase) return false;
      if (filterMissingGenre && r.genre_id) return false;
      if (filterGenreId && r.genre_id !== filterGenreId) return false;
      const f = r.followers ?? 0;
      if (filterSize === "pequena" && !(f < 1000)) return false;
      if (filterSize === "media" && !(f >= 1000 && f < 10000)) return false;
      if (filterSize === "grande" && !(f >= 10000 && f < 100000)) return false;
      if (filterSize === "top" && !(f >= 100000)) return false;
      return true;
    }).length;
  }, [showArchived, totalArchivedCount, activeRows, filterFase, filterMissingGenre, filterGenreId, filterSize, classifyFase]);
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
  const [pendingSyncs, setPendingSyncs] = useState<Array<{
    spotify_user_id: string | null;
    display_name: string | null;
    found: number;
    imported: number;
    pending: number;
    auto_archived: number;
    last_sync_at: string | null;
  }>>([]);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [syncReport, setSyncReport] = useState<{
    title: string;
    items: Array<{
      account: string;
      found: number;
      already_existed: number;
      imported: number;
      active: number;
      auto_archived: number;
      deferred: number;
      pending_after: number;
      fully_synced: boolean;
      spotify_calls: number;
      rate_429: number;
      circuit_status: string;
      circuit_blocked_until: string | null;
    }>;
  } | null>(null);

  async function loadAccounts() {
    const { data } = await supabase
      .from("spotify_user_tokens_public" as any)
      .select("id, spotify_user_id, display_name, email, is_default")
      .order("is_default", { ascending: false })
      .order("display_name", { ascending: true, nullsFirst: false });
    setAccounts(((data ?? []) as unknown) as SpotifyAccountLite[]);
  }

  async function loadPendingSyncs() {
    const { data } = await supabase
      .from("accounts")
      .select("spotify_user_id, display_name, last_sync_found, last_sync_imported, last_sync_pending, last_sync_auto_archived, last_sync_at")
      .gt("last_sync_pending", 0)
      .order("last_sync_at", { ascending: false });
    setPendingSyncs(((data ?? []) as any[]).map(a => ({
      spotify_user_id: a.spotify_user_id,
      display_name: a.display_name,
      found: a.last_sync_found ?? 0,
      imported: a.last_sync_imported ?? 0,
      pending: a.last_sync_pending ?? 0,
      auto_archived: a.last_sync_auto_archived ?? 0,
      last_sync_at: a.last_sync_at,
    })));
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

  function reportItemFromResponse(label: string, data: any) {
    const r = data?.report ?? {};
    const cb = r.circuit_breaker ?? {};
    return {
      account: label,
      found: r.found ?? data?.owned_count ?? 0,
      already_existed: r.already_existed ?? 0,
      imported: r.imported ?? data?.imported ?? 0,
      active: r.active ?? data?.pipeline_dispatched ?? 0,
      auto_archived: r.auto_archived ?? data?.auto_archived ?? 0,
      deferred: r.deferred ?? data?.deferred_count ?? 0,
      pending_after: r.pending_after ?? r.deferred ?? data?.deferred_count ?? 0,
      fully_synced: r.fully_synced ?? ((r.pending_after ?? r.deferred ?? 0) === 0),
      spotify_calls: r.spotify_calls_sync ?? 0,
      rate_429: r.rate_429_count ?? 0,
      circuit_status: cb.status ?? "closed",
      circuit_blocked_until: cb.blocked_until ?? null,
    };
  }

  async function handleBulkImport(spotifyUserId?: string, accountLabel?: string) {
    setBulkImporting(true);
    try {
      const { data, error } = await supabase.functions.invoke("import-account-playlists", {
        body: spotifyUserId ? { spotify_user_id: spotifyUserId } : {},
      });
      // Circuit breaker aberto: aviso amigável, sem stack/blank screen
      if (data?.circuit_open || data?.error === "SPOTIFY_CIRCUIT_OPEN") {
        const mins = Math.max(1, Math.ceil((data.retry_after_sec ?? 0) / 60));
        const until = data.blocked_until ? new Date(data.blocked_until).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : null;
        toast({
          title: "Spotify temporariamente bloqueado",
          description: until
            ? `Limite de chamadas atingido. Tente novamente após ${until} (~${mins} min).`
            : `Limite de chamadas atingido. Aguarde ~${mins} min e tente de novo.`,
          variant: "destructive",
        });
        return;
      }
      if (error || !data?.ok) throw new Error(error?.message ?? data?.error ?? "Falhou");
      setSyncReport({
        title: accountLabel ? `Sincronização — ${accountLabel}` : "Sincronização concluída",
        items: [reportItemFromResponse(accountLabel ?? "Conta padrão", data)],
      });
      load();
      loadPendingSyncs();
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
      const { data: tokensRaw, error: tokErr } = await supabase
        .from("spotify_user_tokens_public" as any)
        .select("spotify_user_id, display_name, email");
      if (tokErr) throw new Error(tokErr.message);
      const tokens = ((tokensRaw ?? []) as unknown) as Array<{ spotify_user_id: string | null; display_name: string | null; email: string | null }>;

      const targets = tokens.filter(
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

      const reportItems: any[] = [];
      const failures: string[] = [];
      for (const t of targets) {
        const label = t.display_name ?? t.email ?? t.spotify_user_id!;
        try {
          const { data, error } = await supabase.functions.invoke("import-account-playlists", {
            body: { spotify_user_id: t.spotify_user_id },
          });
          if (error || !data?.ok) {
            failures.push(`${label}: ${error?.message ?? data?.error ?? "falhou"}`);
          } else {
            reportItems.push(reportItemFromResponse(label, data));
          }
        } catch (e: any) {
          failures.push(`${label}: ${e.message}`);
        }
      }

      setSyncReport({
        title: `Sincronização global — ${reportItems.length}/${targets.length} contas`,
        items: reportItems,
      });
      if (failures.length) {
        toast({
          title: `${failures.length} falha(s) na sincronização`,
          description: failures.slice(0, 2).join("; "),
          variant: "destructive",
        });
      }
      load();
      loadPendingSyncs();
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
    loadPendingSyncs();
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
    .filter((p) => (filterAppBlocked ? blockedSet.has(p.id) : true))
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
      // Respeita o sort do usuário. followers/recent já vêm ordenados do server.
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
    // Dupla confirmação: primeiro aviso + segundo passo exigindo digitar EXCLUIR.
    if (!confirm(`Atenção: ${archivedCount} playlist(s) arquivadas serão APAGADAS PERMANENTEMENTE.\n\nEsta ação não pode ser desfeita. Deseja continuar?`)) return;
    const typed = prompt(`Para confirmar a exclusão permanente de ${archivedCount} playlist(s), digite EXCLUIR (em maiúsculas).`);
    if (typed !== "EXCLUIR") {
      toast({ title: "Exclusão cancelada", description: "Texto de confirmação não confere." });
      return;
    }
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



      {/* Saúde do ecossistema + Top oportunidades — mesma régua, lado a lado, abre em popup */}
      <div className="grid grid-cols-2 gap-3 items-stretch">
        {/* Saúde do ecossistema */}
        <Dialog>
          <DialogTrigger asChild>
            <button
              type="button"
              className={cn(
                "nx-card !p-0 overflow-hidden text-center w-full h-full group",
                "flex items-center justify-center gap-2 px-3 py-6 hover:bg-[hsl(var(--hover))] transition-colors",
                opportunities.length === 0 && "col-span-2",
              )}
            >
              <Activity className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-[13px] font-semibold truncate">Saúde do ecossistema</span>
              <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                {totalActiveCount + totalArchivedCount}
              </span>
              {eligibleCount > 0 && (
                <span className="inline-flex items-center gap-0.5 text-[10px] text-warning font-semibold shrink-0">
                  <Bell className="h-3 w-3" />
                  {eligibleCount}
                </span>
              )}
            </button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Saúde do ecossistema</DialogTitle>
              <DialogDescription>Composição do catálogo monitorado.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 gap-2">
              <Link
                to="/operacao"
                className="group rounded-xl border border-border/40 bg-[hsl(var(--elevated))] px-3 py-2.5 transition-all hover:border-foreground/30 flex items-center justify-between gap-2"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className="h-2 w-2 rounded-full bg-success shrink-0" />
                  <span className="text-[13px] text-foreground/85 group-hover:text-foreground truncate">Ativas</span>
                </span>
                <span className="text-[16px] font-semibold tabular-nums">{totalActiveCount}</span>
              </Link>
              <Link
                to="/operacao?arquivadas=1"
                className="group rounded-xl border border-border/40 bg-[hsl(var(--elevated))] px-3 py-2.5 transition-all hover:border-foreground/30 flex items-center justify-between gap-2"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <Archive className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-[13px] text-foreground/85 group-hover:text-foreground truncate">Arquivadas</span>
                </span>
                <span className="text-[16px] font-semibold tabular-nums">{totalArchivedCount}</span>
              </Link>
              <Link
                to="/operacao?arquivadas=1&elegiveis=1"
                className={cn(
                  "group rounded-xl border px-3 py-2.5 transition-all flex items-center justify-between gap-2",
                  eligibleCount > 0
                    ? "border-warning/30 bg-warning/5 hover:border-warning/60"
                    : "border-border/40 bg-[hsl(var(--elevated))] hover:border-foreground/30",
                )}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <Bell className={cn("h-3.5 w-3.5 shrink-0", eligibleCount > 0 ? "text-warning" : "text-muted-foreground")} />
                  <span className={cn(
                    "text-[13px] truncate",
                    eligibleCount > 0 ? "text-warning" : "text-foreground/85 group-hover:text-foreground",
                  )}>
                    Elegíveis para retorno
                  </span>
                </span>
                <span className={cn(
                  "text-[16px] font-semibold tabular-nums",
                  eligibleCount > 0 ? "text-warning" : "text-foreground",
                )}>
                  {eligibleCount}
                </span>
              </Link>
            </div>
          </DialogContent>
        </Dialog>

        {/* Top oportunidades */}
        {opportunities.length > 0 && (
          <Dialog>
            <DialogTrigger asChild>
              <button
                type="button"
                className="nx-card !p-0 overflow-hidden text-center w-full h-full group flex items-center justify-center gap-2 px-3 py-6 hover:bg-[hsl(var(--hover))] transition-colors"
              >
                <Target className="h-4 w-4 text-primary shrink-0" />
                <span className="text-[13px] font-semibold truncate">Top oportunidades</span>
                <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                  {opportunities.length}
                </span>
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Top oportunidades</DialogTitle>
                <DialogDescription>Onde alimentar primeiro — ordenado por match score.</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[60vh] overflow-y-auto nx-scroll pr-1">
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
            </DialogContent>
          </Dialog>
        )}
      </div>



      {/* Banner: contas com playlists aguardando próximo lote (cap por execução) */}
      {!showArchived && !showCapacity && pendingSyncs.length > 0 && (() => {
        const BATCH_CAP = 50;
        const top = pendingSyncs[0];
        const totalPending = pendingSyncs.reduce((s, a) => s + a.pending, 0);
        const nextBatch = Math.min(BATCH_CAP, top.pending);
        const remainingAfter = Math.max(0, top.pending - nextBatch);
        const pct = top.found > 0 ? Math.round((top.imported / top.found) * 100) : 0;
        const isLastBatch = remainingAfter === 0;
        return (
          <div className="nx-card !p-3 sm:!p-4 flex flex-col sm:flex-row sm:items-center gap-3 border-sky-500/30 bg-sky-500/5">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <div className="h-8 w-8 rounded-full bg-sky-500/15 flex items-center justify-center shrink-0">
                <RefreshCw className="h-4 w-4 text-sky-400" />
              </div>
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="text-[13px] font-semibold text-foreground">
                  {totalPending} playlist{totalPending > 1 ? "s" : ""} aguardando próximo lote
                </div>
                <div className="text-[11px] text-muted-foreground leading-snug">
                  <span className="text-foreground/80 font-medium">{top.display_name ?? "—"}</span>
                  {" · "}
                  {top.imported} de {top.found} importadas
                  {pendingSyncs.length > 1 ? ` · +${pendingSyncs.length - 1} conta(s)` : ""}
                </div>
                {/* Barra de progresso */}
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 rounded-full bg-border/40 overflow-hidden">
                    <div
                      className="h-full bg-sky-400 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{pct}%</span>
                </div>
                <div className="text-[11px] text-muted-foreground leading-snug">
                  Próximo lote: <span className="text-foreground font-medium">+{nextBatch}</span>
                  {" · "}
                  {isLastBatch
                    ? <span className="text-emerald-400 font-medium">após esta execução: importação concluída</span>
                    : <>restarão <span className="text-foreground font-medium">{remainingAfter}</span></>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap sm:shrink-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 flex-1 sm:flex-none border-sky-500/40 text-sky-400 hover:bg-sky-500/10 hover:text-sky-300"
                    onClick={() => top.spotify_user_id && handleBulkImport(top.spotify_user_id, top.display_name ?? undefined)}
                    disabled={bulkImporting || !top.spotify_user_id}
                  >
                    {bulkImporting ? "Importando…" : `Importar próximo lote (+${nextBatch})`}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs text-xs leading-snug">
                  Para evitar bloqueios e rate limits do Spotify, a importação é feita em lotes de até {BATCH_CAP} playlists por execução.
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        );
      })()}

      {/* Banner: playlists sem gênero — atalho para classificar */}

      {!showArchived && !showCapacity && missingGenreCount > 0 && !filterMissingGenre && (
        <div className="nx-card !p-3 sm:!p-4 flex flex-col sm:flex-row sm:items-center gap-3 border-warning/40 bg-warning/10">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="h-8 w-8 rounded-full bg-warning/20 flex items-center justify-center shrink-0">
              <AlertCircle className="h-4 w-4 text-warning" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-foreground">
                {missingGenreCount} {missingGenreCount === 1 ? "playlist sem gênero" : "playlists sem gênero"}
              </div>
              <div className="text-[11px] text-muted-foreground leading-snug">
                Classifique para liberar match e relatórios.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap sm:shrink-0">
            {pendingSuggestionCount > 0 ? (
              <Button
                size="sm"
                variant="outline"
                className="h-8 flex-1 sm:flex-none border-primary/40 text-primary hover:bg-primary/15 hover:text-primary"
                onClick={() => { setFilterFase("all"); setFilterGenreId(null); setFilterMissingGenre(true); }}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Revisar ({pendingSuggestionCount})
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="h-8 flex-1 sm:flex-none"
                onClick={() => runGenreSuggest()}
                disabled={suggesting}
                title="Sugerir gêneros via IA"
              >
                <Sparkles className={cn("h-3.5 w-3.5", suggesting && "animate-pulse")} />
                {suggesting
                  ? (suggestProgress ? `${suggestProgress.done}/${suggestProgress.total}` : "Sugerindo…")
                  : "Sugerir IA"}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-8 flex-1 sm:flex-none border-warning/40 text-warning hover:bg-warning/15 hover:text-warning"
              onClick={() => { setFilterFase("all"); setFilterMissingGenre(true); }}
            >
              Classificar
            </Button>
          </div>
        </div>
      )}

      {/* Filtro por fase — padrão unificado com /campanhas:
           mobile = grid 5 cards quadrados (ícone + label + contagem)
           desktop = underline tabs */}
      {!showArchived && !showCapacity && (() => {
        const FASE_META = [
          { key: "all",       label: "Todas",     count: faseCounts.all,       icon: ListMusic,    tip: "Todas as playlists ativas do catálogo." },
          { key: "prontas",   label: "Prontas",   count: faseCounts.prontas,   icon: CheckCircle2, tip: "Playlists com 100+ seguidores e gênero definido. Prontas para usar em campanhas." },
          { key: "crescendo", label: "Crescendo", count: faseCounts.crescendo, icon: TrendingUp,   tip: "Entre 10 e 99 seguidores. Estão ganhando força — alimente com boas músicas." },
          { key: "novas",     label: "Novas",     count: faseCounts.novas,     icon: Sparkles,     tip: "Menos de 10 seguidores. Recém criadas, precisam de tempo para crescer." },
          { key: "atencao",   label: "Atenção",   count: faseCounts.atencao,   icon: AlertCircle,  tip: "Perdendo seguidores ou engajamento. Precisam de intervenção." },
        ] as const;
        return (
          <>
            {/* Mobile: 5 cards quadrados */}
            <div className="grid grid-cols-5 gap-1.5 sm:hidden">
              {FASE_META.map((t) => {
                const Icon = t.icon;
                const active = filterFase === t.key;
                const disabled = t.key !== "all" && t.count === 0;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setFilterFase(t.key)}
                    disabled={disabled}
                    aria-label={`${t.label} (${t.count})`}
                    className={cn(
                      "flex flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2 transition-colors",
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground hover:text-foreground",
                      disabled && "opacity-40 pointer-events-none",
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="text-[10px] font-medium leading-none truncate max-w-full">{t.label}</span>
                    <span className="text-[10px] tabular-nums opacity-70 leading-none">{t.count}</span>
                  </button>
                );
              })}
            </div>

            {/* Desktop / tablet: underline tabs */}
            <div className="hidden sm:flex items-center gap-1 border-b border-border overflow-x-auto overflow-y-hidden scrollbar-none">
              {FASE_META.map((t) => {
                const Icon = t.icon;
                const active = filterFase === t.key;
                return (
                  <Tooltip key={t.key} delayDuration={200}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => setFilterFase(t.key)}
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
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-[260px] text-[12px] leading-snug">
                      {t.tip}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </>
        );
      })()}

      {/* Chip "Apps bloqueados" foi movido pra dentro do cluster de ações
           (ao lado do botão Arquivado), pra não ocupar uma linha inteira no mobile. */}



      {/* Toolbar — 1 linha (mobile colapsa texto pra caber sem scroll) */}
      <div className="flex flex-nowrap items-center gap-1.5 sm:gap-2">



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
        {/* Manutenção: ação (não filtro) ao lado de Importar */}
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
        {/* Ordenar — agrupa as opções num dropdown só */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant={sortBy !== "followers" ? "default" : "outline"}
              size="sm"
              className="gap-1.5 h-9 w-9 sm:w-auto px-0 sm:px-3 shrink-0"
              title="Ordenar"
              aria-label="Ordenar"
            >
              <ArrowUpDown className="h-4 w-4" />
              <span className="hidden sm:inline">
                {sortBy === "valuation" ? "Valuation" : sortBy === "recent" ? "Recente" : "Maiores"}
              </span>
              <ChevronDown className="h-3.5 w-3.5 opacity-70 -mr-0.5 hidden sm:inline" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuItem onClick={() => setSortBy("followers")} className="gap-2">
              {sortBy === "followers" ? <Check className="h-4 w-4 text-primary" /> : <span className="w-4" />}
              <span>Mais seguidores</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSortBy("recent")} className="gap-2">
              {sortBy === "recent" ? <Check className="h-4 w-4 text-primary" /> : <span className="w-4" />}
              <span>Mais recentes</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSortBy("valuation")} className="gap-2">
              {sortBy === "valuation" ? <Check className="h-4 w-4 text-primary" /> : <span className="w-4" />}
              <span>Maior valuation</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
          <DropdownMenuContent align="start" className="w-64 max-h-96 overflow-y-auto scrollbar-none p-1">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-2 py-1.5">
              Filtrar por gênero
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setFilterGenreId(null)} className="gap-2 px-2 py-2 cursor-pointer">
              {!filterGenreId && !filterMissingGenre ? <Check className="h-3.5 w-3.5 text-primary shrink-0" /> : <span className="w-3.5 shrink-0" />}
              <span className="flex-1 text-[13px]">Todos os gêneros</span>
              <span className="text-[11px] tabular-nums text-muted-foreground">{totalActiveCount}</span>
            </DropdownMenuItem>
            {missingGenreCount > 0 && (
              <DropdownMenuItem onClick={() => setFilterMissingGenre(true)} className="gap-2 px-2 py-2 cursor-pointer">
                {filterMissingGenre ? <Check className="h-3.5 w-3.5 text-primary shrink-0" /> : <span className="w-3.5 shrink-0" />}
                <span className="flex-1 text-[13px] text-warning">Sem gênero</span>
                <span className="text-[11px] tabular-nums text-warning">{missingGenreCount}</span>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {(() => {
              const counts = new Map<string, number>();
              for (const r of activeRows) {
                if (r.genre_id) counts.set(r.genre_id, (counts.get(r.genre_id) ?? 0) + 1);
              }
              const rows = genres
                .map((g) => ({ ...g, count: counts.get(g.id) ?? 0 }))
                .sort((a, b) => b.count - a.count || a.nome.localeCompare(b.nome, "pt-BR"));
              return rows.map((g) => {
                const active = filterGenreId === g.id;
                const empty = g.count === 0;
                return (
                  <DropdownMenuItem
                    key={g.id}
                    onClick={() => setFilterGenreId(g.id)}
                    className={cn("gap-2 px-2 py-2 cursor-pointer", empty && "opacity-50")}
                  >
                    {active ? <Check className="h-3.5 w-3.5 text-primary shrink-0" /> : <span className="w-3.5 shrink-0" />}
                    <span className="flex-1 truncate text-[13px] capitalize">{g.nome}</span>
                    <span className={cn("text-[11px] tabular-nums", active ? "text-primary" : "text-muted-foreground")}>{g.count}</span>
                  </DropdownMenuItem>
                );
              });
            })()}
          </DropdownMenuContent>
        </DropdownMenu>
        {/* Estado: alterna Ativas/Lixeira. Contagens já aparecem nos cards de fase acima — evitar duplicar. */}
        <div className="sm:ml-auto flex items-center gap-1.5 shrink-0">
          {/* Apps Spotify bloqueados — botão circular igual à régua de ações (mobile: só ícone + badge). */}
          {!showArchived && !showCapacity && blockedRows.length > 0 && (
            <Tooltip delayDuration={150}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setFilterAppBlocked(!filterAppBlocked)}
                  aria-pressed={filterAppBlocked}
                  aria-label={`Apps bloqueados (${blockedRows.length})`}
                  title={`Apps bloqueados (${blockedRows.length})`}
                  className={cn(
                    "relative h-9 w-9 sm:w-auto sm:px-3 rounded-full text-[11px] sm:text-xs font-medium border transition-colors tabular-nums shrink-0 inline-flex items-center justify-center gap-1.5",
                    filterAppBlocked
                      ? "bg-destructive/15 border-destructive/50 text-destructive"
                      : "bg-elevated border-destructive/40 text-destructive/90 hover:bg-destructive/10",
                  )}
                >
                  <AlertCircle className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                  <span className="hidden sm:inline">Apps bloqueados ({blockedRows.length})</span>
                  <span
                    aria-hidden
                    className="sm:hidden absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-destructive text-[10px] font-bold leading-none text-destructive-foreground inline-flex items-center justify-center tabular-nums"
                  >
                    {blockedRows.length}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[280px] text-[12px] leading-snug">
                <div className="font-semibold">{blockedAppName ?? "App Spotify"} bloqueado</div>
                {blockedUntil && (
                  <div className="text-muted-foreground mt-0.5">
                    Até {new Date(blockedUntil).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </div>
                )}
                <div className="text-muted-foreground mt-1">
                  {blockedRows.length} playlist{blockedRows.length === 1 ? "" : "s"} afetada{blockedRows.length === 1 ? "" : "s"}. Toque pra filtrar.
                </div>
              </TooltipContent>
            </Tooltip>
          )}
          {showArchived ? (
            <Link
              to="/operacao"
              replace
              className="h-9 w-9 sm:w-auto sm:px-3 rounded-full text-[11px] sm:text-xs font-medium border transition-colors tabular-nums shrink-0 inline-flex items-center justify-center gap-1.5 bg-elevated border-border text-muted-foreground hover:text-foreground"
              title="Ativas"
              aria-label="Voltar para ativas"
            >
              <ListMusic className="h-4 w-4 sm:hidden" />
              <span className="hidden sm:inline">Ativas</span>
            </Link>
          ) : (
            <Link
              to="/operacao?arquivadas=1"
              replace
              className="h-9 w-9 sm:w-auto sm:px-3 rounded-full text-[11px] sm:text-xs font-medium border transition-colors tabular-nums shrink-0 inline-flex items-center justify-center gap-1.5 bg-elevated border-border text-muted-foreground hover:text-foreground"
              title={`Arquivado (${totalArchivedCount})`}
              aria-label={`Arquivado (${totalArchivedCount})`}
            >
              <Archive className="h-4 w-4 sm:hidden" />
              <span className="hidden sm:inline">Arquivado ({totalArchivedCount})</span>
            </Link>
          )}

          {/* Capacidade ocultada — acessível pela URL /catalogo?aba=capacidade se necessário. */}


          {showArchived && eligibleCount > 0 && (
            <button
              type="button"
              onClick={() => setOnlyEligible((v) => !v)}
              className={cn(
                "h-9 px-3 rounded-full text-[11px] sm:text-xs font-medium border transition-colors tabular-nums shrink-0 inline-flex items-center gap-1.5",
                onlyEligible
                  ? "bg-primary/15 border-primary/40 text-primary"
                  : "bg-elevated border-border text-muted-foreground hover:text-foreground",
              )}
              title="Playlists arquivadas que voltaram a ultrapassar 100 saves"
            >
              🔔 Elegíveis para retorno ({eligibleCount})
            </button>
          )}

          {showArchived && items.filter(i => i.archived_at).length > 0 && (
            <Button
              onClick={emptyTrash}
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
              title="Excluir permanentemente todas as playlists arquivadas (pede confirmação dupla)"
            >
              <Trash2 className="h-3.5 w-3.5" /> Excluir arquivadas
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
                {(p.followers ?? 0) >= 100 && !p.genre_id && (
                  <div
                    className="inline-flex items-center gap-1 self-start rounded-full border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning"
                    title="Tem público mínimo, mas precisa de gênero classificado para entrar em campanhas"
                  >
                    <AlertCircle className="h-2.5 w-2.5" />
                    Sem gênero
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

      {/* Sync report dialog */}
      <Dialog open={!!syncReport} onOpenChange={(o) => !o && setSyncReport(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{syncReport?.title ?? "Relatório de sincronização"}</DialogTitle>
            <DialogDescription>
              Chamadas Spotify contam apenas listagem + followers (síncrono). Pipeline de tracks/cérebro
              roda em background.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {(syncReport?.items ?? []).map((it, idx) => {
              const breakerOpen = it.circuit_status === "open";
              const had429 = it.rate_429 > 0;
              const hasPending = it.pending_after > 0;
              return (
                <div key={idx} className="rounded-md border border-border bg-card/50 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium flex items-center gap-2">
                      {it.fully_synced ? (
                        <span className="text-emerald-500">✅</span>
                      ) : (
                        <span className="text-amber-500">⚠️</span>
                      )}
                      {it.account}
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      {had429 && (
                        <span className="rounded bg-destructive/15 text-destructive px-2 py-0.5">
                          {it.rate_429}× 429
                        </span>
                      )}
                      <span
                        className={cn(
                          "rounded px-2 py-0.5",
                          breakerOpen
                            ? "bg-destructive/15 text-destructive"
                            : "bg-emerald-500/15 text-emerald-500",
                        )}
                      >
                        Breaker {breakerOpen ? "OPEN" : "closed"}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                    <div>
                      <div className="text-muted-foreground text-xs">Encontradas no Spotify</div>
                      <div className="font-semibold">{it.found}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Já existiam</div>
                      <div className="font-semibold">{it.already_existed}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Importadas agora</div>
                      <div className="font-semibold text-emerald-500">{it.imported}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Auto-arquivadas</div>
                      <div className="font-semibold">{it.auto_archived}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Pendentes</div>
                      <div className={cn("font-semibold", hasPending ? "text-amber-500" : "text-muted-foreground")}>
                        {it.pending_after}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-xs">Calls Spotify</div>
                      <div className="font-semibold">{it.spotify_calls}</div>
                    </div>
                  </div>
                  {hasPending && (
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
                      ⚠️ Existem <strong>{it.pending_after}</strong> playlist{it.pending_after > 1 ? "s" : ""} aguardando importação devido ao limite de 50 por execução.
                      Clique em <strong>Sincronizar</strong> de novo para importar o próximo lote.
                    </div>
                  )}
                  {it.fully_synced && it.imported > 0 && (
                    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-500">
                      ✅ Conta totalmente sincronizada.
                    </div>
                  )}
                  {breakerOpen && it.circuit_blocked_until && (
                    <div className="text-xs text-destructive">
                      Bloqueado até {new Date(it.circuit_blocked_until).toLocaleString("pt-BR")}
                    </div>
                  )}
                </div>
              );
            })}
            {(syncReport?.items ?? []).length === 0 && (
              <div className="text-sm text-muted-foreground">Nenhuma conta sincronizada.</div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setSyncReport(null)}>Fechar</Button>
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
