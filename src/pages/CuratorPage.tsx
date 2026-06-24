import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Loader2,
  Target,
  Clock,
  Zap,
  TrendingUp,
  ListMusic,
  ExternalLink,
  Upload,
  Download,
  ChevronRight,
  ChevronDown,
  Music2,
  CalendarDays,
  ImageIcon,
  ClipboardPaste,
  Plus,
  HelpCircle,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { cn } from "@/lib/utils";
import { PrintThumbs } from "@/components/playlist-deals/PrintThumbs";
import { PrintsHistoryCard, type PrintsHistoryEntry } from "@/components/client-portal/PrintsHistoryCard";
import {
  CuratorSubmissionsKpis,
  type BaselineConflict,
  type CuratorSubmissionsSummary,
} from "@/components/curators/BaselineConflictsSection";

import { supabase } from "@/integrations/supabase/client";
import { useExternalSplash } from "@/hooks/useExternalSplash";
import { PageLoader } from "@/components/PageLoader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { NexEngineLogo } from "@/components/NexEngineLogo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CuratorNotificationsBell } from "@/components/public/CuratorNotificationsBell";
import { markCuratorPublicMode } from "@/lib/publicRouteMode";
import { PasteUrlsDialog } from "@/components/curators/PasteUrlsDialog";
import { AddSongToPlaylistDialog } from "@/components/curators/AddSongToPlaylistDialog";
import { CuratorAccessGate, curatorAccessStorageKey } from "@/components/public/CuratorAccessGate";
import { getCuratorJwt, invokeCuratorPortal, storeCuratorJwt } from "@/lib/curatorPortalAuth";
import { HistoricoPrevioBadge, HistoricoPrevioAlert, HistoricoPrevioCounter } from "@/components/campanhas/HistoricoPrevio";
import { friendlyUploadName, downloadUploadUrlAsXlsx } from "@/lib/spreadsheetDisplay";

type Deal = {
  id: string;
  curator_name: string;
  song_spotify_url: string;
  song_name: string;
  song_artist: string | null;
  song_cover_url: string | null;
  target_plays: number | null;
  daily_goal: number | null;
  baseline_plays: number | null;
  cost: number | null;
  started_at: string | null;
  ends_at: string | null;
  public_token: string;
  created_at: string;
};

type Playlist = {
  id: string;
  deal_id: string;
  song_id?: string | null;
  spotify_url: string;
  playlist_name: string;
  followers: number | null;
  is_initial_roster: boolean;
  added_at: string;
  spotify_playlist_id?: string | null;
  spotify_owner_id?: string | null;
  spotify_owner_name?: string | null;
  image_url?: string | null;
  added_at_spotify?: string | null;
  match_status?: string | null;
  match_reason?: string | null;
  plays_24h?: number | null;
  plays_7d?: number | null;
  plays_28d?: number | null;
  last_window_capture_at?: string | null;
  /** Soma de plays_7d na captura de baseline da campanha. >0 = histórico prévio. */
  baseline_plays_prior?: number | null;
};

type DealSong = {
  id: string;
  deal_id: string;
  song_spotify_url: string;
  spotify_track_id: string | null;
  song_name: string;
  song_artist: string | null;
  song_cover_url: string | null;
  daily_goal: number;
  target_plays: number | null;
  baseline_plays: number;
  position: number;
  started_at: string | null;
  ends_at: string | null;
  ramp_up_days: number | null;
  created_at: string;
};

// Vem direto da RPC `get_curator_deal_progress` — fonte única de verdade.
type ProgressPerPlaylist = {
  playlist_id: string;
  playlist_name: string | null;
  is_initial_roster: boolean;
  baseline_plays: number | null;
  latest_plays: number | null;
  delivered: number;
  last_captured_at: string | null;
  snapshot_count: number;
  attribution_method?: string | null;
};

type DealProgress = {
  deal_id: string;
  target_plays: number;
  daily_goal: number;
  baseline_total: number;
  latest_total: number;
  delivered_curator: number;
  delivered_total: number;
  first_capture_at: string | null;
  last_capture_at: string | null;
  days_elapsed: number;
  daily_avg: number;
  progress_pct: number;
  eta_days: number | null;
  per_playlist: ProgressPerPlaylist[];
  delivered_per_song?: ProgressPerSong[] | null;
};

type ProgressPerSong = {
  song_id: string;
  target_plays: number;
  daily_goal: number;
  baseline_total: number;
  latest_total: number;
  delivered_curator: number;
  first_capture_at: string | null;
  last_capture_at: string | null;
  progress_pct: number;
};

type SnapshotPlaylistEntry = {
  playlist_id: string;
  playlist_name: string;
  image_url: string | null;
  spotify_url: string | null;
  spotify_owner_name: string | null;
  followers: number | null;
  plays: number | null;
  plays_7d: number | null;
};

type SnapshotHistoryEntry = {
  captured_at: string;
  is_initial_capture: boolean;
  playlists_count: number;
  total_plays: number;
  print_url: string | null;
  print_urls?: string[] | null;
  note?: string | null;
  playlists?: SnapshotPlaylistEntry[];
};

function cleanSnapshotNote(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw).trim();
  s = s.replace(/^\[bot[^\]]*\]\s*/i, "").trim();
  if (!s) return null;
  const low = s.toLowerCase();
  if (low === "coleta diária" || low === "coleta diaria" || low === "auto-collect") return "coleta";
  if (low === "baseline inicial") return "baseline";
  return s;
}

function formatFollowers(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1).replace(".", ",")}k`;
  return v.toLocaleString("pt-BR");
}

function formatPlays(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "0";
  const v = Number(n);
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return Math.round(v).toString();
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function formatShortDate(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = typeof iso === "string" ? new Date(iso) : iso;
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  } catch {
    return "—";
  }
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

/**
 * Ciclo de relatório: a cada 7 dias contados a partir do dia em que a
 * campanha começou, com corte sempre às 17:00. Isso é puramente UI/cosmético
 * (countdown no topo) — não calcula progresso, só molda o "próximo print".
 */
function getAnchor(startedAtIso: string | null | undefined): Date {
  const base = startedAtIso ? new Date(startedAtIso) : new Date();
  const a = new Date(base);
  a.setHours(17, 0, 0, 0);
  return a;
}

function cycleEnd(anchor: Date, from: Date = new Date()): Date {
  const week = 7 * 24 * 60 * 60 * 1000;
  const diff = from.getTime() - anchor.getTime();
  const cycles = Math.floor(diff / week) + 1;
  const target = Math.max(1, cycles);
  return new Date(anchor.getTime() + target * week);
}

function cycleStart(anchor: Date, from: Date = new Date()): Date {
  const end = cycleEnd(anchor, from);
  return new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "agora";
  const totalMin = Math.floor(ms / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  if (days >= 1) return `${days}d ${hours}h`;
  const mins = totalMin % 60;
  if (hours >= 1) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function normalizePublicToken(value?: string): string {
  return decodeURIComponent(value ?? "").trim();
}

function isPlaceholderToken(value: string): boolean {
  const lower = value.toLowerCase();
  return !value || value === ":token" || lower === "token";
}

export default function CuratorPage() {
  const { token } = useParams<{ token: string }>();
  const onExternal = useExternalSplash();
  // --- Gate de acesso por OTP (espelha portal do cliente) ---
  const [gateChecked, setGateChecked] = useState(false);
  const [gateRequired, setGateRequired] = useState(false);
  const [gateAuthed, setGateAuthed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const tok = normalizePublicToken(token);
    if (!tok || isPlaceholderToken(tok)) {
      setGateChecked(true);
      setGateRequired(false);
      return;
    }
    (async () => {
      try {
        const hash = window.location.hash || "";
        const match = hash.match(/[#&]admin_jwt=([^&]+)/);
        if (match) {
          const adminJwt = decodeURIComponent(match[1]);
          storeCuratorJwt(tok, adminJwt, "admin");
          try { window.history.replaceState(null, "", window.location.pathname + window.location.search); } catch { /* ignore */ }
          if (!cancelled) { setGateAuthed(true); setGateRequired(true); setGateChecked(true); return; }
        }
      } catch { /* ignore */ }

      try {
        if (getCuratorJwt(tok)) {
          if (!cancelled) { setGateAuthed(true); setGateRequired(true); setGateChecked(true); return; }
        }
      } catch { /* ignore */ }

      try {
        const { data: sess } = await supabase.auth.getSession();
        if (sess?.session?.access_token) {
          const { data: bp } = await supabase.functions.invoke("admin-curator-access", {
            body: { token: tok },
          });
          const adminJwt = (bp as any)?.jwt as string | undefined;
          const adminEmail = (bp as any)?.email as string | undefined;
          if (adminJwt) {
            storeCuratorJwt(tok, adminJwt, adminEmail ?? "admin");
            if (!cancelled) { setGateAuthed(true); setGateRequired(true); setGateChecked(true); return; }
          }
        }
      } catch { /* ignore — cai no fluxo normal */ }

      const { data } = await supabase.functions.invoke("check-curator-access", { body: { token: tok } });
      if (cancelled) return;
      const req = !!(data as any)?.required;
      setGateRequired(req);
      setGateAuthed(!req);
      setGateChecked(true);
    })();
    return () => { cancelled = true; };
  }, [token]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deal, setDeal] = useState<Deal | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [songs, setSongs] = useState<DealSong[]>([]);
  const [progress, setProgress] = useState<DealProgress | null>(null);
  const [snapshotHistory, setSnapshotHistory] = useState<SnapshotHistoryEntry[]>([]);
  // FASE 13.0 — has_baseline server-side (deriva de CPC).
  const [serverHasBaseline, setServerHasBaseline] = useState<boolean | null>(null);
  const [access, setAccess] = useState<{ writable: boolean; code?: string; reason?: string }>({ writable: true });
  const [campaignContext, setCampaignContext] = useState<{
    is_campaign_shadow: boolean;
    campaign_id: string | null;
    baseline_status: string | null;
    baseline_captured_at: string | null;
    baseline_reference_date: string | null;
    baseline_playlist_count: number;
  }>({
    is_campaign_shadow: false,
    campaign_id: null,
    baseline_status: null,
    baseline_captured_at: null,
    baseline_reference_date: null,
    baseline_playlist_count: 0,
  });
  const [curatorSubmissions, setCuratorSubmissions] =
    useState<CuratorSubmissionsSummary | null>(null);
  const [baselineConflicts, setBaselineConflicts] = useState<BaselineConflict[]>([]);
  const [url, setUrl] = useState("");
  const [position, setPosition] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  // Dialog: vincular uma música a uma playlist já cadastrada no deal
  const [addSongToPlaylistFor, setAddSongToPlaylistFor] = useState<DealSong | null>(null);
  // Modal: músicas da campanha presentes em uma playlist do curador
  const [curatorPlaylistModalKey, setCuratorPlaylistModalKey] = useState<string | null>(null);
  // Filtro visual por música (não afeta números — RPC já é agregada por deal)
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
  // Tick a cada 60s pra atualizar countdown
  const [, setNowTick] = useState(0);
  // Janela visível nas playlists do curador
  const [playlistWindow, setPlaylistWindow] = useState<"7d" | "28d">("7d");
  const [priorOnly, setPriorOnly] = useState(false);
  // Tabs: divide a página em fases pra evitar scroll gigante no mobile
  const [activeTab, setActiveTab] = useState<"cadastro" | "entrega" | "evidencias" | "arquivos" | "historico">("entrega");
  // Fase 7.3 — novos blocos: galeria de prints, histórico de Excel, timeline.
  type PrintEntry = {
    kind: "delivery_proof" | "snapshot";
    captured_at: string;
    playlist_id: string | null;
    playlist_name: string | null;
    playlist_image: string | null;
    screenshot_url: string;
    position: number | null;
    bot: string | null;
    source: string | null;
  };
  type UploadEntry = {
    id: string;
    file_name: string;
    reference_date: string | null;
    created_at: string;
    rows_imported: number | null;
    total_streams: number | null;
    is_baseline: boolean;
    upload_mode: string | null;
    window_kind: string | null;
    window_days: number | null;
    status: string | null;
    superseded: boolean;
    superseded_at: string | null;
    quarantined: boolean;
    download_url: string | null;
  };
  type TimelineEntry = { at: string; kind: string; label: string; detail?: string | null };
  const [prints, setPrints] = useState<PrintEntry[]>([]);
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [openSnapshotKey, setOpenSnapshotKey] = useState<string | null>(null);
  const initialTabSetRef = useRef(false);
  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasMultipleSongs = songs.length > 1;

  const resolveSpotifyPlaylistUrl = (
    p: { spotify_url?: string | null; spotify_playlist_id?: string | null },
  ): string | null => {
    const raw = (p.spotify_url ?? "").trim();
    if (raw && /^https?:\/\//i.test(raw)) return raw;
    const id = (p.spotify_playlist_id ?? "").trim();
    if (id) return `https://open.spotify.com/playlist/${id}`;
    return null;
  };

  const selectedSong = useMemo(
    () => (selectedSongId ? songs.find((s) => s.id === selectedSongId) ?? null : null),
    [selectedSongId, songs],
  );
  const playlistSongRequired = hasMultipleSongs && !selectedSongId;

  const visiblePlaylists = useMemo(() => {
    if (!selectedSongId) return playlists;
    return playlists.filter((p) => p.song_id === selectedSongId || !p.song_id);
  }, [playlists, selectedSongId]);

  // "Playlists do curador" no portal: só as cadastradas pelo próprio curador.
  // Editorial / organic / suspicious vêm do algoritmo do Spotify e ficam só no painel interno.
  const curatorPlaylists = useMemo(
    () =>
      visiblePlaylists.filter((p) => {
        if (p.is_initial_roster) return false;
        const status = (p.match_status ?? "curator") as string;
        return status === "curator";
      }),
    [visiblePlaylists],
  );
  // 1 card por playlist do curador
  const curatorGroupedByPlaylist = useMemo(() => {
    const groups = new Map<
      string,
      { key: string; sample: Playlist; songsInside: DealSong[] }
    >();
    for (const p of curatorPlaylists) {
      const key = p.spotify_playlist_id || p.spotify_url || p.id;
      if (!groups.has(key)) {
        groups.set(key, { key, sample: p, songsInside: [] });
      }
    }
    const baseAll = playlists.filter((p) => p.is_initial_roster);
    for (const [, g] of groups) {
      const pid = g.sample.spotify_playlist_id;
      if (!pid) continue;
      const matchedSongIds = new Set(
        baseAll.filter((b) => b.spotify_playlist_id === pid).map((b) => b.song_id).filter(Boolean) as string[],
      );
      g.songsInside = songs.filter((s) => matchedSongIds.has(s.id));
    }
    return Array.from(groups.values());
  }, [curatorPlaylists, playlists, songs]);

  // Baseline (playlists onde a música JÁ está antes do deal começar) — só nome + link,
  // exibido pro curador num bloco colapsado pra evitar cadastro duplicado.
  const baselinePlaylistsForCurator = useMemo(() => {
    const base = playlists.filter((p) => p.is_initial_roster);
    const filtered = selectedSongId
      ? base.filter((p) => p.song_id === selectedSongId || !p.song_id)
      : base;
    const seen = new Map<string, Playlist>();
    for (const p of filtered) {
      const key = p.spotify_playlist_id || p.spotify_url || p.id;
      if (!seen.has(key)) seen.set(key, p);
    }
    return Array.from(seen.values()).sort((a, b) =>
      (a.playlist_name || "").localeCompare(b.playlist_name || "", "pt-BR"),
    );
  }, [playlists, selectedSongId]);
  const [baselineOpen, setBaselineOpen] = useState(false);

  const curatorModalGroup = useMemo(
    () => curatorGroupedByPlaylist.find((g) => g.key === curatorPlaylistModalKey) ?? null,
    [curatorGroupedByPlaylist, curatorPlaylistModalKey],
  );

  const load = async () => {
    const publicToken = normalizePublicToken(token);
    if (isPlaceholderToken(publicToken)) {
      setError("placeholder_token");
      setDeal(null);
      setPlaylists([]);
      setProgress(null);
      setSnapshotHistory([]);
      setSongs([]);
      setLoading(false);
      return;
    }

    const { data, error: fnErr } = await invokeCuratorPortal<any>(
      "get-curator-deal-public",
      publicToken,
      { body: { slug: publicToken } },
    );
    if (fnErr || !data?.ok) {
      setError(data?.error || fnErr?.message || "not found");
      setDeal(null);
      setPlaylists([]);
      setProgress(null);
      setSnapshotHistory([]);
      setSongs([]);
    } else {
      setDeal(data.deal as Deal);
      setPlaylists((data.playlists ?? []) as Playlist[]);
      setSongs((data.songs ?? []) as DealSong[]);
      setProgress((data.progress ?? null) as DealProgress | null);
      setSnapshotHistory((data.snapshot_history ?? []) as SnapshotHistoryEntry[]);
      setServerHasBaseline(
        typeof (data as { has_baseline?: unknown }).has_baseline === "boolean"
          ? (data as { has_baseline: boolean }).has_baseline
          : null,
      );
      setAccess(data.access ?? { writable: true });
      if (data.campaign_context) setCampaignContext(data.campaign_context);
      setCuratorSubmissions((data.curator_submissions ?? null) as CuratorSubmissionsSummary | null);
      setBaselineConflicts((data.baseline_conflicts ?? []) as BaselineConflict[]);
      setPrints((data.prints ?? []) as PrintEntry[]);
      setUploads((data.uploads ?? []) as UploadEntry[]);
      setTimeline((data.timeline ?? []) as TimelineEntry[]);
      setError(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    markCuratorPublicMode(normalizePublicToken(token));
    if (!gateChecked) return;
    if (gateRequired && !gateAuthed) { setLoading(false); return; }
    setLoading(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, gateChecked, gateRequired, gateAuthed]);

  // Fase 6 — realtime: novo snapshot deste deal recarrega dados públicos
  useEffect(() => {
    if (!deal?.id) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debouncedReload = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        load();
      }, 800);
    };
    const channel = supabase
      .channel(`curator-public-snapshots-${deal.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "curator_deal_snapshots",
          filter: `deal_id=eq.${deal.id}`,
        },
        debouncedReload,
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal?.id]);

  /**
   * stats — TUDO que envolve número de progresso vem da RPC.
   * O frontend só monta os valores de UI (ciclo semanal, dias decorridos).
   * Quando uma música está selecionada, usamos seus targets/baseline pra
   * compor a janela e o "Esta semana", mas o `delivered/pct/eta/avg`
   * permanecem do agregado da RPC (não temos delivered por música ainda).
   */
  const stats = useMemo(() => {
    const now = new Date();
    const anchorRef = selectedSong?.started_at ?? deal?.started_at ?? deal?.created_at ?? null;
    const anchor = getAnchor(anchorRef);
    const cycEnd = cycleEnd(anchor, now);
    const cycStart = cycleStart(anchor, now);
    const msToCycleEnd = cycEnd.getTime() - now.getTime();

    // Quando uma música é selecionada, prefere métricas dela (delivered_per_song).
    const songProg = selectedSongId
      ? progress?.delivered_per_song?.find((s) => s.song_id === selectedSongId) ?? null
      : null;

    const target = Number(
      songProg?.target_plays ?? selectedSong?.target_plays ?? progress?.target_plays ?? deal?.target_plays ?? 0,
    );
    const dailyGoal = Number(
      songProg?.daily_goal ?? selectedSong?.daily_goal ?? progress?.daily_goal ?? deal?.daily_goal ?? 0,
    );
    const baseline = Number(songProg?.baseline_total ?? progress?.baseline_total ?? deal?.baseline_plays ?? 0);
    const latest = Number(songProg?.latest_total ?? progress?.latest_total ?? baseline);
    const earned = Number(songProg?.delivered_curator ?? progress?.delivered_curator ?? 0);
    const remaining = Math.max(0, target - earned);
    const pct = Number(songProg?.progress_pct ?? progress?.progress_pct ?? 0);
    const dailyAvg = Number(progress?.daily_avg ?? 0);
    const eta = progress?.eta_days ?? null;
    // FASE 13.0 — prioriza has_baseline server-side (deriva de CPC oficial).
    // Fallback mantém compat com payloads antigos.
    const hasBaseline = serverHasBaseline
      ?? ((progress?.per_playlist?.length ?? 0) > 0 || snapshotHistory.length > 0);
    const lastCaptureAt = songProg?.last_capture_at ?? progress?.last_capture_at ?? null;
    const firstCaptureAt = songProg?.first_capture_at ?? progress?.first_capture_at ?? null;

    const startRef = selectedSong?.started_at ?? deal?.started_at ?? deal?.created_at;
    const daysRunning = startRef
      ? Math.max(
          0,
          Math.floor((Date.now() - new Date(startRef).getTime()) / (1000 * 60 * 60 * 24)),
        )
      : 0;

    const msInWeek = 7 * 24 * 60 * 60 * 1000;
    const cycleProgress = Math.min(
      1,
      Math.max(0, (now.getTime() - cycStart.getTime()) / msInWeek),
    );
    const weeklyTarget = dailyGoal * 7;
    const weekRemaining = Math.max(0, Math.round(weeklyTarget * (1 - cycleProgress)));

    // Plays "do ciclo": delta entre os 2 últimos snapshots (já calculado no histórico)
    let cyclePlays = 0;
    if (snapshotHistory.length >= 2) {
      const last = snapshotHistory[snapshotHistory.length - 1];
      const prev = snapshotHistory[snapshotHistory.length - 2];
      cyclePlays = Math.max(0, Number(last.total_plays) - Number(prev.total_plays));
    }
    const cyclePct =
      dailyGoal > 0
        ? Math.min(100, Math.round((cyclePlays / 7 / dailyGoal) * 100))
        : 0;

    const isOverdue = hasBaseline
      && lastCaptureAt !== null
      && new Date(lastCaptureAt).getTime() < cycStart.getTime()
      && now.getTime() - cycStart.getTime() > 24 * 60 * 60 * 1000;

    return {
      target,
      dailyGoal,
      baseline,
      latest,
      earned,
      remaining,
      pct,
      dailyAvg,
      eta,
      hasBaseline,
      daysRunning,
      cycleStart: cycStart,
      cycleEnd: cycEnd,
      msToCycleEnd,
      weekRemaining,
      cyclePlays,
      cyclePct,
      isOverdue,
      lastCaptureAt,
      firstCaptureAt,
    };
  }, [deal, progress, snapshotHistory, selectedSong, selectedSongId]);

  const isDone = stats.target > 0 && stats.earned >= stats.target;
  const perPlaylist = progress?.per_playlist ?? [];
  // FASE 1 — apenas playlists oficialmente cadastradas pelo curador (match_status='curator')
  // alimentam progresso/KPIs/Performance. Sem essas, o portal esconde tudo e pede cadastro.
  const hasCuratorPlaylists = curatorPlaylists.length > 0;
  const collectionProblem = hasCuratorPlaylists
    && snapshotHistory.length === 0
    && prints.length === 0
    && uploads.length === 0;
  // Default da tab: se não tem playlist cadastrada, abre em "Cadastro";
  // se já tem, abre em "Entrega". Só roda uma vez no primeiro load.
  useEffect(() => {
    if (loading || initialTabSetRef.current) return;
    initialTabSetRef.current = true;
    setActiveTab(hasCuratorPlaylists ? "entrega" : "cadastro");
  }, [loading, hasCuratorPlaylists]);
  const curatorOwnedPlaylistIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of playlists) {
      if ((p.match_status ?? "") === "curator") ids.add(p.id);
    }
    return ids;
  }, [playlists]);
  // Mapa playlist_id → data real que o curador declarou a playlist (colou o link aqui).
  // Usado pra exibir "cadastrada em X" na Performance, separado de "último print".
  const declaredAtByPlaylistId = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of playlists) {
      if (p.added_at) m.set(p.id, p.added_at);
    }
    return m;
  }, [playlists]);
  const perPlaylistCurator = perPlaylist
    .filter((p) => !p.is_initial_roster && curatorOwnedPlaylistIds.has(p.playlist_id))
    .sort((a, b) => Number(b.delivered ?? 0) - Number(a.delivered ?? 0));

  const handleAdd = async () => {
    if (!token || !url.trim()) return;
    if (!access.writable) {
      toast.error(access.reason || "Este deal não aceita mais alterações");
      return;
    }
    if (playlistSongRequired) {
      toast.error("Selecione a música antes de adicionar a playlist");
      return;
    }
    const parsedPosition = position.trim() === "" ? null : Number(position.trim());
    if (parsedPosition !== null && (!Number.isFinite(parsedPosition) || parsedPosition < 1 || !Number.isInteger(parsedPosition))) {
      toast.error("Posição deve ser um número inteiro maior que zero");
      return;
    }
    const realToken = deal?.public_token ?? token;
    setSubmitting(true);
    const { data, error: fnErr } = await supabase.functions.invoke(
      "register-curator-playlist",
      { body: { public_token: realToken, urls: [url.trim()], song_id: selectedSongId, position: parsedPosition } },
    );
    setSubmitting(false);
    if (fnErr || !data?.ok) {
      toast.error(data?.error || fnErr?.message || "Erro ao adicionar playlist");
      return;
    }
    const item = Array.isArray(data.items) ? data.items[0] : null;
    if (item?.status === "ok") {
      // Cadastro feito. Se a música já estava lá, só avisa — não bloqueia.
      if (item?.track_presence?.found) {
        const pos = item.track_presence.position ? ` (posição ${item.track_presence.position})` : "";
        toast.success("Playlist adicionada", {
          description: `A música já estava dentro${pos}.`,
        });
      } else {
        toast.success("Playlist adicionada");
      }
    } else if (item?.status === "duplicate") {
      toast.warning("Essa playlist já está registrada nessa música");
      return;
    } else if (item?.status === "duplicate_in_payload") {
      toast.warning("Link repetido");
      return;
    } else if (item?.status === "baseline_blocked") {
      toast.error("Essa playlist já existia antes do deal (baseline)", {
        description: "Não conta como entrega do curador.",
      });
      return;
    } else if (item?.status === "awaiting_baseline") {
      toast.error("A campanha ainda está aguardando a baseline", {
        description: "Volte assim que a primeira coleta do Spotify for capturada.",
      });
      return;
    } else if (item?.status === "campaign_baseline_blocked" || item?.status === "baseline_conflict") {
      toast.error("Esta playlist já continha a música antes do início da campanha", {
        description:
          "Ela não pode ser contabilizada como entrega nova. Você pode enviar outra playlist ou trabalhar ganho de posição nesta.",
        duration: 8000,
      });
      return;
    } else if (item?.status === "invalid_url") {
      toast.error("Link inválido");
      return;
    } else if (item?.status === "not_found") {
      toast.error("Playlist não encontrada no Spotify");
      return;
    } else if (item?.status === "timeout") {
      toast.error("Spotify demorou pra responder. Tenta de novo.");
      return;
    } else if (item?.error || (item?.status && item.status !== "ok")) {
      toast.error(item?.error || "Não foi possível registrar essa playlist");
      return;
    }
    setUrl("");
    setPosition("");
    await load();
  };

  const handleDownloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["URL da playlist"],
      ["https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"],
      ["https://open.spotify.com/playlist/37i9dQZF1DX0XUsuxWHRQd"],
    ]);
    ws["!cols"] = [{ wch: 70 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Playlists");
    XLSX.writeFile(wb, "playlists-template.xlsx");
  };

  const extractUrlsFromSheet = (file: File): Promise<string[]> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const wb = XLSX.read(data, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
            header: 1,
            blankrows: false,
          });
          const urls: string[] = [];
          for (const row of rows) {
            for (const cell of row as unknown[]) {
              if (typeof cell === "string" && cell.includes("spotify.com")) {
                urls.push(cell.trim());
              }
            }
          }
          resolve(urls);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });

  const handleImportFile = async (file: File) => {
    if (!token) return;
    if (!access.writable) {
      toast.error(access.reason || "Este deal não aceita mais alterações");
      return;
    }
    if (playlistSongRequired) {
      toast.error("Selecione a música antes de importar playlists");
      return;
    }
    setImporting(true);
    try {
      const urls = await extractUrlsFromSheet(file);
      if (urls.length === 0) {
        toast.error("Nenhuma URL do Spotify encontrada na planilha");
        return;
      }
      if (urls.length > 200) {
        toast.error("Máximo de 200 playlists por importação");
        return;
      }
      const realToken = deal?.public_token ?? token;
      const { data, error: fnErr } = await supabase.functions.invoke(
        "register-curator-playlist",
        { body: { public_token: realToken, urls, song_id: selectedSongId } },
      );
      if (fnErr || !data?.ok) {
        toast.error(data?.error || fnErr?.message || "Erro ao importar");
        return;
      }
      const items = Array.isArray(data.items) ? data.items : [];
      const s = data.summary ?? {};
      const added = s.inserted ?? items.filter((i: { status?: string }) => i.status === "ok").length;
      const dupExisting = s.duplicate ?? 0;
      const dupPayload = s.duplicate_in_payload ?? 0;
      const alreadyInPlaylist = s.track_already_present ?? items.filter((i: { track_presence?: { found?: boolean } }) => i.track_presence?.found).length;
      const invalid = s.invalid ?? 0;
      const notFound = s.not_found ?? 0;
      const tmout = s.timeout ?? 0;
      const errs = s.error ?? items.filter((i: { error?: string }) => i.error).length;
      const parts: string[] = [`${added} adicionadas`];
      if (dupExisting) parts.push(`${dupExisting} já no deal`);
      if (dupPayload) parts.push(`${dupPayload} repetidas na lista`);
      if (alreadyInPlaylist) parts.push(`${alreadyInPlaylist} já com a música`);
      if (invalid) parts.push(`${invalid} inválidas`);
      if (notFound) parts.push(`${notFound} não encontradas`);
      if (tmout) parts.push(`${tmout} expiraram`);
      if (errs) parts.push(`${errs} com erro`);
      const hasIssue = errs + tmout + notFound + invalid > 0;
      const notify = hasIssue ? toast.warning : alreadyInPlaylist ? toast.warning : toast.success;
      notify("Importação concluída", { description: parts.join(" · ") });
      await load();
    } catch (err) {
      toast.error("Não foi possível ler o arquivo");
      console.error(err);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  if (!gateChecked) {
    return <PageLoader />;
  }

  if (gateRequired && !gateAuthed) {
    const tok = normalizePublicToken(token);
    return (
      <CuratorAccessGate
        token={tok}
        onAuthed={() => setGateAuthed(true)}
      />
    );
  }

  if (loading) {
    return <PageLoader />;
  }

  if (error || !deal) {
    const isPlaceholderLink = error === "placeholder_token";
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-6 pt-6 md:pt-6 text-center">
            <p className="text-base font-medium">
              {isPlaceholderLink ? "Link sem token da curadoria" : "Link inválido ou expirado"}
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              {isPlaceholderLink
                ? "Copie o link pelo card do deal, não pela rota de exemplo."
                : "Verifique o link com quem o enviou."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-background py-8 sm:py-10 overflow-hidden">
      {/* Atmosfera verde — suave e difusa, sem dominar */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-0 hidden dark:block"
        style={{
          background: [
            "radial-gradient(ellipse 70% 45% at 50% 0%, rgba(29,185,84,0.09) 0%, rgba(29,185,84,0) 75%)",
            "radial-gradient(ellipse 45% 55% at 0% 30%, rgba(29,185,84,0.05) 0%, rgba(29,185,84,0) 75%)",
            "radial-gradient(ellipse 45% 55% at 100% 50%, rgba(29,185,84,0.045) 0%, rgba(29,185,84,0) 75%)",
            "radial-gradient(ellipse 75% 35% at 50% 100%, rgba(29,185,84,0.04) 0%, rgba(29,185,84,0) 75%)",
          ].join(", "),
        }}
      />
      <div className="relative z-10 w-full max-w-[1200px] mx-auto px-5 sm:px-6 md:px-8">
        <div className="max-w-xl md:max-w-2xl mx-auto space-y-4 sm:space-y-5">
        {/* Topbar — compacto, operacional, estilo Linear/Stripe */}
        <div className="flex items-center justify-between gap-3 py-2 border-b border-border/50">
          <div className="flex items-center gap-2.5 min-w-0">
            <NexEngineLogo variant="mark" size={20} />
            <div className="min-w-0">
              <div className="text-[12.5px] font-semibold tracking-tight leading-tight truncate">
                {deal.curator_name || "Curadoria"}
              </div>
              <div className="text-[10px] text-muted-foreground/60 mt-0.5 leading-none truncate">
                Campanhas monitoradas em tempo real
              </div>
            </div>
          </div>
          <div className="flex items-center gap-0.5 rounded-lg border border-border/40 bg-card/40 backdrop-blur-sm px-1 py-0.5">
            <ThemeToggle />
            <span className="w-px h-5 bg-border/50" aria-hidden />
            <CuratorNotificationsBell
              publicToken={deal.public_token}
              dealId={deal.id}
              stats={{
                target: stats.target,
                dailyGoal: stats.dailyGoal,
                earned: stats.earned,
                pct: stats.pct,
                todayPlays: stats.cyclePlays,
                todayPct: stats.cyclePct,
                hasBaseline: stats.hasBaseline,
                isOverdue: stats.isOverdue,
                vel: stats.dailyAvg || null,
                eta: stats.eta,
                daysRunning: stats.daysRunning,
                lastImportAt: stats.lastCaptureAt ? new Date(stats.lastCaptureAt) : null,
              }}
            />
          </div>
        </div>

        {!access.writable && (
          <div className="rounded-2xl border border-warning/40 bg-warning/10 px-5 py-4 text-sm text-warning-foreground">
            <div className="font-semibold mb-1">Este deal não aceita mais alterações</div>
            <div className="text-muted-foreground">
              {access.reason ?? "Estado atual bloqueia novas playlists, prints e coleta."}
            </div>
          </div>
        )}

        {/* Header — campanha + música */}
        <Card className="nx-card nx-card-glow !p-0 overflow-hidden border-border">
          <CardContent className="p-3.5 sm:p-4 pt-3.5 sm:pt-4 md:pt-4 space-y-3.5">

            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/80">
                Campanha
              </span>
              {(() => {
                const overdue = stats.isOverdue && !isDone;
                const dotColor = isDone
                  ? "bg-primary"
                  : overdue
                  ? "bg-warning"
                  : !stats.hasBaseline
                  ? "bg-warning"
                  : "bg-primary";
                const label = isDone
                  ? "Concluído"
                  : overdue
                  ? `Relatório atrasado · venceu ${formatShortDate(stats.cycleStart)} 17h`
                  : !stats.hasBaseline
                  ? "Aguardando primeiro print do admin"
                  : `Próximo relatório · ${formatCountdown(stats.msToCycleEnd)}`;
                return (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 text-[11px] font-medium",
                      overdue ? "text-warning" : "text-muted-foreground",
                    )}
                  >
                    <span className="relative flex h-1.5 w-1.5">
                      <span
                        className={cn(
                          "absolute inline-flex h-full w-full rounded-full opacity-75",
                          dotColor,
                          !overdue && "animate-ping",
                        )}
                      />
                      <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", dotColor)} />
                    </span>
                    {label}
                  </span>
                );
              })()}
            </div>

            {/* Identidade */}
            {(() => {
              const isAll = !selectedSong && hasMultipleSongs;
              const headerCover = selectedSong?.song_cover_url ?? (isAll ? null : deal.song_cover_url);
              const headerName = selectedSong?.song_name ?? (isAll ? "Todas as músicas" : deal.song_name);
              const headerArtist = selectedSong?.song_artist ?? (isAll ? null : deal.song_artist);
              const headerUrl = selectedSong?.song_spotify_url ?? deal.song_spotify_url;
              return (
                <>
                  <div className="flex items-center gap-4">
                    {(() => {
                      if (isAll) {
                        const covers = songs
                          .map((s) => s.song_cover_url)
                          .filter((c): c is string => !!c)
                          .slice(0, 4);
                        const count = covers.length;
                        const gridClass =
                          count <= 1
                            ? "grid-cols-1 grid-rows-1"
                            : count === 2
                            ? "grid-cols-2 grid-rows-1"
                            : "grid-cols-2 grid-rows-2";
                        return (
                          <div className="relative shrink-0">
                            <div
                              aria-hidden
                              className="absolute inset-0 -z-10 rounded-xl blur-xl opacity-50"
                              style={{ background: "rgba(29,185,84,0.35)" }}
                            />
                            <div className={cn(
                              "w-[72px] h-[72px] rounded-xl overflow-hidden ring-1 ring-border bg-muted grid gap-px",
                              gridClass,
                            )}>
                              {count === 0 ? (
                                <div className="flex items-center justify-center bg-muted">
                                  <ListMusic className="h-6 w-6 text-muted-foreground" />
                                </div>
                              ) : count === 3 ? (
                                <>
                                  <img src={covers[0]} alt="" className="w-full h-full object-cover row-span-2" />
                                  <img src={covers[1]} alt="" className="w-full h-full object-cover" />
                                  <img src={covers[2]} alt="" className="w-full h-full object-cover" />
                                </>
                              ) : (
                                covers.map((c, i) => (
                                  <img key={i} src={c} alt="" className="w-full h-full object-cover" />
                                ))
                              )}
                            </div>
                          </div>
                        );
                      }
                      return headerCover ? (
                        <div className="relative shrink-0">
                          <div
                            aria-hidden
                            className="absolute inset-0 -z-10 rounded-xl blur-xl opacity-50"
                            style={{ background: "rgba(29,185,84,0.35)" }}
                          />
                          <img
                            src={headerCover}
                            alt={headerName}
                            className="w-14 h-14 rounded-lg object-cover ring-1 ring-border"
                          />
                        </div>
                      ) : (
                        <div className="w-14 h-14 rounded-lg bg-muted shrink-0 flex items-center justify-center ring-1 ring-border">
                          <ListMusic className="h-5 w-5 text-muted-foreground" />
                        </div>
                      );
                    })()}
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70 mb-1 inline-flex items-center gap-2">
                        {selectedSong ? "Música selecionada" : isAll ? "Visão geral" : "Música"}
                        {selectedSong && (
                          <button
                            type="button"
                            onClick={() => setSelectedSongId(null)}
                            className="text-[9px] uppercase tracking-wider text-primary hover:underline"
                          >
                            limpar
                          </button>
                        )}
                      </div>
                      <h1 className="text-[17px] sm:text-[18px] font-semibold leading-tight tracking-tight truncate">
                        {headerName}
                      </h1>
                      {isAll ? (
                        <p className="text-[12px] text-muted-foreground truncate mt-0.5 leading-snug">
                          {songs.length} músicas no combinado
                        </p>
                      ) : headerArtist ? (
                        <p className="text-[12px] text-muted-foreground truncate mt-0.5 leading-snug">
                          {headerArtist}
                        </p>
                      ) : null}
                      {(() => {
                        // Mostra o prazo REAL do contrato do curador (started_at → ends_at do deal),
                        // não o ciclo de 7 dias. É o número que ele tem que enxergar pra entregar.
                        const dealStart = deal?.started_at ? new Date(deal.started_at) : null;
                        const dealEnd = deal?.ends_at ? new Date(deal.ends_at) : null;
                        const totalDays = dealStart && dealEnd
                          ? Math.max(1, Math.round((dealEnd.getTime() - dealStart.getTime()) / 86400000))
                          : null;
                        const daysLeft = dealEnd
                          ? Math.max(0, Math.ceil((dealEnd.getTime() - Date.now()) / 86400000))
                          : null;
                        return (
                          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-muted/40 ring-1 ring-border px-2 py-0.5 text-[10px] text-muted-foreground tabular-nums max-w-full">
                            <CalendarDays className="h-3 w-3 shrink-0 text-muted-foreground/80" />
                            <span className="uppercase tracking-wider text-muted-foreground/70 text-[9px]">Seu prazo</span>
                            {dealStart && dealEnd ? (
                              <>
                                <span className="text-foreground/90 truncate">
                                  {formatShortDate(dealStart)} → {formatShortDate(dealEnd)}
                                </span>
                                {totalDays !== null && (
                                  <span className="text-muted-foreground/70">· {totalDays}d</span>
                                )}
                                {daysLeft !== null && daysLeft > 0 && (
                                  <span className="text-primary/80 font-medium">· {daysLeft}d restantes</span>
                                )}
                              </>
                            ) : (
                              <span className="text-foreground/90 truncate">
                                {formatShortDate(stats.cycleStart)} → {formatShortDate(stats.cycleEnd)}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="h-px bg-border" />

                  {/* HERO — Quanto entregou + quanto falta + frase humana */}
                  {hasCuratorPlaylists && stats.hasBaseline ? (() => {
                    const dailyRatio = stats.dailyGoal > 0 ? stats.dailyAvg / stats.dailyGoal : 0;
                    // Vermelho só pra erro real (zero entrega após 7 dias). Senão, âmbar suave.
                    const statusKey: "ok" | "warn" =
                      stats.dailyGoal === 0 ? "ok"
                      : dailyRatio >= 0.95 ? "ok"
                      : "warn";
                    const s = statusKey === "ok"
                      ? { dot: "bg-success",  text: "text-success",  ring: "ring-success/25",  bg: "bg-success/[0.06]" }
                      : { dot: "bg-warning",  text: "text-warning",  ring: "ring-warning/25",  bg: "bg-warning/[0.06]" };
                    // Frase humana, sem jargão.
                    const remainingPerDay = stats.dailyGoal > 0
                      ? Math.max(0, stats.dailyGoal - stats.dailyAvg)
                      : 0;
                    const humanLine = statusKey === "ok"
                      ? "Você está no ritmo da meta"
                      : remainingPerDay > 0
                        ? `Faltam ${formatPlays(remainingPerDay)} plays por dia para bater a meta`
                        : "Ritmo abaixo do esperado nos últimos dias";
                    return (
                      <div className={cn("rounded-xl p-3.5 ring-1", s.bg, s.ring)}>
                        <div className="flex items-baseline gap-1.5 flex-wrap">
                          <span className={cn("text-[26px] sm:text-[30px] font-bold tabular-nums leading-none tracking-tight text-foreground")}>
                            {formatPlays(stats.earned)}
                          </span>
                          <span className="text-[15px] sm:text-[16px] font-semibold tabular-nums text-muted-foreground leading-none">
                            / {formatPlays(stats.target)}
                          </span>
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground ml-1">
                            entregue desde o início
                          </span>
                        </div>
                        <div className="mt-2.5 h-1 rounded-full bg-background/40 overflow-hidden">
                          <div
                            className={cn("h-full rounded-full transition-all duration-500", s.dot)}
                            style={{ width: `${Math.min(100, stats.pct)}%` }}
                          />
                        </div>
                        <div className={cn("mt-2.5 inline-flex items-center gap-1.5 text-[12px] font-medium", s.text)}>
                          <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
                          {humanLine}
                        </div>
                      </div>
                    );
                  })() : null}

                  <a
                    href={headerUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => onExternal()}
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground bg-muted/40 ring-1 ring-border hover:ring-border hover:bg-muted/60 transition-colors"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Abrir no Spotify
                  </a>
                </>
              );
            })()}
          </CardContent>
        </Card>

        {/* Músicas da campanha — filtro visual */}
        {hasMultipleSongs && (
          <Card className="nx-card nx-card-glow !p-0 border-border">
            <CardContent className="p-5 sm:p-6 pt-5 sm:pt-6 md:pt-6 space-y-5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[15px] font-semibold inline-flex items-center gap-2 tracking-tight">
                    <ListMusic className="h-4 w-4 text-muted-foreground" />
                    Músicas da campanha
                  </h2>
                  <p className="text-[12px] text-muted-foreground mt-1.5 leading-snug">
                    {selectedSong
                      ? "Toque em \"Todas\" para ver geral"
                      : "Toque em uma música para filtrar playlists"}
                  </p>
                </div>
                <span className="text-[12px] text-muted-foreground shrink-0 tabular-nums">
                  {songs.length} músicas
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedSongId(null)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors ring-1",
                    selectedSongId === null
                      ? "bg-primary/15 text-primary ring-primary/40"
                      : "bg-muted/40 text-muted-foreground ring-border hover:bg-muted/60",
                  )}
                >
                  Todas as músicas
                </button>
              </div>

              <ul className="space-y-2 max-h-[280px] overflow-y-auto pr-1 -mr-1 scroll-smooth">
                {songs.map((s) => {
                  const isSelected = selectedSongId === s.id;
                  return (
                    <li key={s.id}>
                      <div
                        className={cn(
                          "relative w-full px-3 py-2.5 transition-all",
                          isSelected ? "nx-subcard ring-1 ring-primary/40 !border-primary/40" : "nx-subcard-hover",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedSongId(isSelected ? null : s.id)}
                          aria-pressed={isSelected}
                          className="w-full text-left"
                        >
                          <div className="flex items-center gap-3">
                            {s.song_cover_url ? (
                              <img
                                src={s.song_cover_url}
                                alt={s.song_name}
                                className="w-9 h-9 rounded-md object-cover ring-1 ring-border shrink-0"
                              />
                            ) : (
                              <div className="w-9 h-9 rounded-md bg-muted shrink-0" />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="text-[12.5px] font-semibold leading-tight truncate">
                                {s.song_name}
                              </div>
                              {s.song_artist && (
                                <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                                  {s.song_artist}
                                </div>
                              )}
                            </div>
                            {(s.target_plays ?? 0) > 0 && (
                              <div className="text-right shrink-0 ml-2">
                                <div className="text-[12px] font-semibold tabular-nums leading-none">
                                  {formatPlays(s.target_plays)}
                                </div>
                                <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground mt-1">
                                  meta · {formatPlays(s.daily_goal)}/dia
                                </div>
                              </div>
                            )}
                          </div>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Tabs por fase — pipeline em pílulas, mobile-first */}
        <div className="pt-1 sticky top-2 z-30">
          <div className="grid grid-cols-3 items-center gap-0.5 rounded-full bg-card/80 backdrop-blur-md border border-border/50 p-0.5 shadow-[0_4px_16px_-8px_rgba(0,0,0,0.4)] w-full">
            {([
              { id: "cadastro" as const, label: "Cadastro", icon: ListMusic, count: curatorPlaylists.length || null },
              { id: "entrega" as const, label: "Entrega", icon: Target, count: stats.target > 0 ? `${stats.pct}%` : null },
              { id: "historico" as const, label: "Histórico", icon: Clock, count: (snapshotHistory.length + prints.length + uploads.length) || null },
            ]).map((t) => {
              const Icon = t.icon;
              const isActive = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    if (t.id === "historico" || activeTab === "historico") setOpenSnapshotKey(null);
                    setActiveTab(t.id);
                  }}
                  aria-pressed={isActive}
                  className={cn(
                    "inline-flex items-center justify-center gap-1.5 rounded-full px-2 py-1 text-[11.5px] font-medium tracking-tight transition-colors whitespace-nowrap min-w-0",
                    isActive
                      ? "bg-[hsl(var(--elevated))] text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-3 w-3 shrink-0" />
                  <span className="truncate">{t.label}</span>
                  {t.count != null && (
                    <span className={cn("text-[10px] tabular-nums", isActive ? "text-primary" : "text-muted-foreground/60")}>
                      {t.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Resumo de submissões na camada de campanha.
            Só aparece quando o deal está vinculado a uma campanha e há submissões. */}
        {curatorSubmissions && curatorSubmissions.total > 0 && (
          <CuratorSubmissionsKpis summary={curatorSubmissions} />
        )}


        {/* Meta combinada — sempre visível, mesmo antes de cadastrar playlists.
            É o número do contrato. Sem isso o curador não sabe o que entregar. */}
        {activeTab === "entrega" && (stats.target > 0 || stats.dailyGoal > 0) && (
          <Card className="nx-card nx-card-glow !p-0 border-border">
            <CardContent className="p-5 sm:p-6 pt-5 sm:pt-6 md:pt-6">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/80 mb-1">
                    Combinado
                  </div>
                  <h2 className="text-[15px] font-semibold tracking-tight">
                    {selectedSong ? "Meta desta música" : hasMultipleSongs ? "Meta total da campanha" : "Meta da campanha"}
                  </h2>
                </div>
                <Target className="h-4 w-4 text-muted-foreground shrink-0" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="nx-subcard p-4">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                    Plays a entregar
                  </div>
                  <div className="text-[22px] font-bold tabular-nums leading-none text-foreground">
                    {formatPlays(stats.target)}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1.5">
                    Total contratado
                  </div>
                </div>
                {(() => {
                  const goal = stats.dailyGoal;
                  const avg = stats.dailyAvg;
                  const ratio = goal > 0 ? avg / goal : 0;
                  const hasData = stats.hasBaseline && avg > 0;
                  const below = hasData && ratio < 0.85;
                  const onTrack = hasData && ratio >= 0.85 && ratio < 1.1;
                  const ahead = hasData && ratio >= 1.1;
                  const pulse = below;
                  return (
                    <div
                      className={cn(
                        "nx-subcard p-4 relative",
                        below && "border-warning/50 ring-1 ring-warning/30",
                        ahead && "border-success/40",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Meta diária
                        </div>
                        {hasData && (
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full",
                              below && "bg-warning/15 text-warning",
                              onTrack && "bg-muted text-muted-foreground",
                              ahead && "bg-success/15 text-success",
                            )}
                          >
                            <span
                              className={cn(
                                "h-1.5 w-1.5 rounded-full",
                                below && "bg-warning animate-pulse",
                                onTrack && "bg-muted-foreground",
                                ahead && "bg-success",
                              )}
                            />
                            {below ? "Abaixo" : ahead ? "Acima" : "No ritmo"}
                          </span>
                        )}
                      </div>
                      <div className="text-[22px] font-bold tabular-nums leading-none text-foreground">
                        {formatPlays(goal)}
                        <span className="text-[12px] font-medium text-muted-foreground"> /dia</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-1.5">
                        {hasData ? (
                          <>
                            Você: <span className={cn(
                              "font-semibold tabular-nums",
                              below && "text-warning",
                              ahead && "text-success",
                              onTrack && "text-foreground",
                            )}>{formatPlays(Math.round(avg))}/dia</span>
                            {" · "}
                            {below
                              ? `faltam ${formatPlays(Math.max(0, Math.round(goal - avg)))}/dia`
                              : ahead
                                ? `+${Math.round((ratio - 1) * 100)}% acima`
                                : "ritmo combinado"}
                          </>
                        ) : (
                          "Ritmo combinado"
                        )}
                      </div>
                      {below && (
                        <span
                          aria-hidden
                          className="pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-warning/40 animate-pulse"
                        />
                      )}
                    </div>
                  );
                })()}

              </div>
            </CardContent>
          </Card>
        )}

        {/* Estado vazio: sem playlists cadastradas pelo curador */}
        {activeTab === "cadastro" && !hasCuratorPlaylists && (
          <Card className="nx-card !p-0 border-primary/40 animate-nx-heartbeat">
            <CardContent className="p-6 sm:p-8 pt-6 sm:pt-8 md:pt-8 flex flex-col items-center text-center gap-4">
              <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center ring-1 ring-primary/30">
                <ListMusic className="h-6 w-6 text-primary" />
              </div>
              <div className="space-y-1.5 max-w-sm">
                <h2 className="text-[15px] font-semibold tracking-tight">
                  Adicione suas playlists para iniciar o monitoramento.
                </h2>
                <p className="text-[12.5px] text-muted-foreground leading-relaxed">
                  A medição é feita exclusivamente sobre as playlists cadastradas nesta campanha.
                </p>
                <div className="inline-flex items-center gap-2 mt-2 px-3 py-1 rounded-full bg-muted/60 border border-border/60">
                  <span className="text-[11px] font-semibold tabular-nums text-foreground">0</span>
                  <span className="text-[11px] text-muted-foreground">playlists declaradas</span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed mt-2">
                  Cadastre suas playlists antes do primeiro print para que contem na meta.
                </p>
              </div>
              <Button
                size="sm"
                disabled
                className="rounded-full opacity-60"
                title="Adicione pelo menos 1 playlist para iniciar"
              >
                Iniciar campanha
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Banner pós-cadastro: contador + aviso permanente */}
        {activeTab === "cadastro" && hasCuratorPlaylists && (
          <div className="nx-card !p-3 flex items-center justify-between gap-3 border-border/60">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center ring-1 ring-primary/20 shrink-0">
                <ListMusic className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <div className="text-[12.5px] font-semibold leading-tight">
                  <span className="tabular-nums">{curatorPlaylists.length}</span>{" "}
                  {curatorPlaylists.length === 1 ? "playlist declarada" : "playlists declaradas"}
                </div>
                <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                  Cadastre suas playlists antes do primeiro print para que contem na meta.
                </div>
              </div>
            </div>
          </div>
        )}


        {/* Total acumulado (histórico) — separado visualmente do delta */}
        {activeTab === "entrega" && hasCuratorPlaylists && stats.hasBaseline && (
          <Card className="nx-card nx-card-glow !p-0 border-border">
            <CardContent className="p-5 pt-5 md:pt-5 grid grid-cols-2 gap-4 divide-x divide-border">
              <div className="pr-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                  Total acumulado (histórico)
                </div>
                <div className="text-[20px] font-bold tabular-nums text-foreground leading-none">
                  {formatPlays(stats.latest)}
                </div>
                <div className="text-[10px] text-muted-foreground mt-1.5">
                  Plays totais reportados — não é a entrega
                </div>
              </div>
              <div className="pl-4">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                  Média histórica por dia
                </div>
                <div className="text-[18px] font-semibold tabular-nums leading-none text-muted-foreground">
                  {formatPlays(stats.dailyAvg)}
                  <span className="text-[12px] font-medium"> /dia</span>
                </div>
                <div className="text-[10px] text-muted-foreground mt-1.5">
                  Calculada desde o primeiro snapshot válido — não é a entrega de hoje
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Combinado total */}
        {activeTab === "entrega" && hasCuratorPlaylists && (
        <Card className="nx-card nx-card-glow !p-0 border-border">
          <CardContent className="p-5 sm:p-6 pt-5 sm:pt-6 md:pt-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-[15px] font-semibold tracking-tight">Progresso da meta total</h2>
                <p className="text-[10.5px] text-muted-foreground mt-0.5">Plays entregues desde o início vs meta contratada</p>
              </div>
              <span className="text-[20px] font-bold tabular-nums">{stats.pct}%</span>
            </div>

            <div className="space-y-2.5">
              <Progress value={stats.pct} className="h-2 rounded-full" />
              <div className="flex items-center justify-between text-[12px] tabular-nums pt-1">
                <span className="text-foreground font-medium">
                  Entregue desde o início: <span className="font-semibold">{formatPlays(stats.earned)}</span>
                </span>
                <span className="text-muted-foreground">
                  Meta: {formatPlays(stats.target)}
                </span>
              </div>
            </div>

            <Separator className="bg-border" />

            <div className="grid grid-cols-2 gap-3">
              <div className="nx-subcard p-4">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1.5 uppercase tracking-wider">
                  <Target className="h-3 w-3" />
                  Faltam
                </div>
                <div className="text-[18px] font-semibold tabular-nums leading-none">
                  {formatPlays(stats.remaining)}
                </div>
              </div>

              <div className="nx-subcard p-4">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1.5 uppercase tracking-wider">
                  <Clock className="h-3 w-3" />
                  Decorrido
                </div>
                <div className="text-[18px] font-semibold tabular-nums leading-none">
                  {stats.daysRunning} {stats.daysRunning === 1 ? "dia" : "dias"}
                </div>
              </div>

              <div className="nx-subcard p-4">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1.5 uppercase tracking-wider">
                  <Zap className="h-3 w-3 text-muted-foreground" />
                  Média histórica
                </div>
                <div className="text-[16px] font-semibold tabular-nums leading-none text-muted-foreground">
                  {stats.dailyAvg > 0 ? `${formatPlays(stats.dailyAvg)}/dia` : "—"}
                </div>
                <div className="text-[9.5px] text-muted-foreground mt-1 leading-tight">
                  Desde o 1º snapshot
                </div>
              </div>

              <div className="nx-subcard p-4">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1.5 uppercase tracking-wider">
                  <TrendingUp className="h-3 w-3" />
                  ETA
                </div>
                <div className="text-[18px] font-semibold tabular-nums leading-none">
                  {stats.eta == null
                    ? "—"
                    : stats.eta === 0
                    ? "✓"
                    : `~${stats.eta}d`}
                </div>
              </div>
            </div>

            {stats.isOverdue && (
              <div className="text-[11px] text-warning leading-snug">
                Aguardando relatório do ciclo que fechou em {formatShortDate(stats.cycleStart)} 17h.
              </div>
            )}
          </CardContent>
        </Card>
        )}
        {/* Performance por playlist — vem direto da RPC */}
        {activeTab === "entrega" && perPlaylistCurator.length > 0 && (
          <Card className="nx-card nx-card-glow !p-0 border-border">
            <CardContent className="p-5 sm:p-6 pt-5 sm:pt-6 md:pt-6 space-y-4">
              <div className="w-full flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h2 className="text-[14px] font-semibold inline-flex items-center gap-2 tracking-tight">
                    <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
                    Performance por playlist
                  </h2>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                    Plays entregues por cada playlist desde o primeiro snapshot
                  </p>
                </div>
                <span className="text-[11px] text-muted-foreground shrink-0">
                  {perPlaylistCurator.length} {perPlaylistCurator.length === 1 ? "playlist" : "playlists"}
                </span>
              </div>

              <ul className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1 -mr-1">
                {perPlaylistCurator.map((p) => {
                  const delivered = Number(p.delivered ?? 0);
                  return (
                    <li key={p.playlist_id} className="nx-subcard p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-semibold leading-tight truncate flex items-center gap-2">
                            <span className="truncate">{p.playlist_name ?? "Playlist removida"}</span>
                            {(p.attribution_method === "late_discovery_zero" || p.attribution_method === "manual_zero") && (
                              <span
                                className="shrink-0 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/30"
                                title={
                                  p.attribution_method === "manual_zero"
                                    ? "Atribuição manual: baseline forçado em 0, todos os plays contam para a meta."
                                    : "Playlist cadastrada após o início do deal: baseline = 0, todos os plays contam para a meta."
                                }
                              >
                                {p.attribution_method === "manual_zero" ? "manual 0" : "base 0"}
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground/70 tabular-nums flex-wrap">
                            {declaredAtByPlaylistId.get(p.playlist_id) && (
                              <span title="Data e hora em que o curador declarou esta playlist como dele (colou o link aqui no NexEngine)">
                                cadastrada {formatDateTime(declaredAtByPlaylistId.get(p.playlist_id)!)}
                              </span>
                            )}
                            {p.last_captured_at && (
                              <>
                                {declaredAtByPlaylistId.get(p.playlist_id) && <span aria-hidden>·</span>}
                                <span title="Última coleta de plays desta playlist">último print {formatShortDate(p.last_captured_at)}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[15px] font-bold tabular-nums leading-tight text-foreground">
                            +{formatPlays(delivered)}
                          </div>
                          <div className="text-[9.5px] text-muted-foreground uppercase tracking-wider mt-0.5">
                            entregues desde o início
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}


        {/* Playlists do curador */}
        {activeTab === "entrega" && (
        <Card className="nx-card nx-card-glow !p-0 border-border">
          <CardContent className="p-5 sm:p-6 pt-5 sm:pt-6 md:pt-6 space-y-4">
            <div className="w-full flex items-center justify-between gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <h2 className="text-[14px] font-semibold inline-flex items-center gap-2 tracking-tight">
                  <ListMusic className="h-3.5 w-3.5 text-muted-foreground" />
                  Playlists monitoradas
                </h2>
                <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                  Visualização das playlists — não altera a entrega total da campanha
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="inline-flex rounded-full bg-[hsl(var(--elevated))] border border-border p-0.5">
                  {(["7d", "28d"] as const).map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => setPlaylistWindow(w)}
                      className={cn(
                        "px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wider rounded-full transition-colors",
                        playlistWindow === w
                          ? "bg-primary/15 text-primary ring-1 ring-primary/40"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {w}
                    </button>
                  ))}
                </div>
                <span className="text-[11px] text-muted-foreground">
                  {curatorGroupedByPlaylist.length} {curatorGroupedByPlaylist.length === 1 ? "playlist" : "playlists"}
                </span>
              </div>
            </div>

            {curatorGroupedByPlaylist.length === 0 ? (
              <div className="py-6 flex flex-col items-center text-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-[hsl(var(--elevated))] border border-border/60 flex items-center justify-center">
                  <ListMusic className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="text-[12px] text-muted-foreground max-w-xs">
                  Sem playlists enviadas
                </p>
              </div>
            ) : (
              <>
                {/* Histórico prévio — alerta forte + contador compacto.
                    Playlists onde a música já estava antes da campanha começar:
                    curador precisa SUBIR a posição da faixa pra entrega contar. */}
                {(() => {
                  const priorCount = curatorGroupedByPlaylist.filter(
                    (g) => Number(g.sample.baseline_plays_prior ?? 0) > 0,
                  ).length;
                  if (priorCount === 0) return null;
                  return (
                    <div className="mb-3 space-y-2">
                      <HistoricoPrevioAlert count={priorCount} />
                      <HistoricoPrevioCounter
                        count={priorCount}
                        active={priorOnly}
                        onClick={() => setPriorOnly((v) => !v)}
                      />
                    </div>
                  );
                })()}
                {(() => {
                  const visible = priorOnly
                    ? curatorGroupedByPlaylist.filter(
                        (g) => Number(g.sample.baseline_plays_prior ?? 0) > 0,
                      )
                    : curatorGroupedByPlaylist;
                  return (
                <ul
                  className={cn(
                    "space-y-2 pr-1 -mr-1 scroll-smooth",
                    visible.length > 4 && "max-h-[280px] overflow-y-auto",
                  )}
                >
                {visible.map((g) => {
                  const p = g.sample;
                  return (
                    <li key={g.key}>
                      <button
                        type="button"
                        onClick={() => setCuratorPlaylistModalKey(g.key)}
                        className="group w-full text-left px-3 py-2.5 transition-all nx-subcard-hover hover:!border-primary/30"
                      >
                        <div className="flex items-center gap-3">
                          <div className="relative w-10 h-10 rounded-md overflow-hidden bg-primary/10 ring-1 ring-primary/20 shrink-0">
                            {p.image_url ? (
                              <img
                                src={p.image_url}
                                alt={p.playlist_name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <ListMusic className="h-4 w-4 text-primary" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[12.5px] font-semibold leading-tight truncate group-hover:text-primary transition-colors">
                                {p.playlist_name}
                              </span>
                              <span className="text-[9px] font-semibold uppercase tracking-wider shrink-0 px-1.5 py-0.5 rounded-full ring-1 leading-none text-primary bg-primary/10 ring-primary/20">
                                Curador
                              </span>
                              {Number(p.baseline_plays_prior ?? 0) > 0 && (
                                <HistoricoPrevioBadge />
                              )}
                            </div>
                            <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground tabular-nums">
                              {p.followers !== null && (
                                <span>{formatPlays(p.followers)} seguidores</span>
                              )}
                              {g.songsInside.length > 0 && (
                                <>
                                  {p.followers !== null && <span className="text-muted-foreground/40">·</span>}
                                  <span>{g.songsInside.length} já dentro</span>
                                </>
                              )}
                            </div>
                          </div>
                          {(() => {
                            const v =
                              playlistWindow === "7d"
                                ? p.plays_7d
                                : p.plays_28d;
                            const has = v !== null && v !== undefined;
                            return (
                              <div className="text-right shrink-0 mr-1">
                                <div className={cn("text-[13px] font-semibold tabular-nums leading-none", has ? "text-foreground" : "text-muted-foreground/50")}>
                                  {has ? formatPlays(Number(v)) : "—"}
                                </div>
                                <div className="text-[9px] uppercase tracking-wider text-muted-foreground mt-1">
                                  plays {playlistWindow}
                                </div>
                              </div>
                            );
                          })()}
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60 group-hover:text-primary transition-colors shrink-0" />
                        </div>
                      </button>
                    </li>
                  );
                })}
                </ul>
                  );
                })()}
              </>

            )}
          </CardContent>
        </Card>
        )}



        {/* Modal: músicas já presentes em uma playlist do curador */}
        {activeTab === "entrega" && (
        <Dialog open={!!curatorPlaylistModalKey} onOpenChange={(o) => !o && setCuratorPlaylistModalKey(null)}>
          <DialogContent className="max-w-md w-[calc(100%-2rem)] overflow-hidden">
            <DialogHeader className="min-w-0">
              <DialogTitle asChild>
                <div className="flex items-center gap-3 min-w-0 pr-6">
                {curatorModalGroup?.sample.image_url && (
                  <img
                    src={curatorModalGroup.sample.image_url}
                    alt=""
                    className="w-10 h-10 rounded-lg object-cover ring-1 ring-border shrink-0"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold leading-tight truncate">
                    {curatorModalGroup?.sample.playlist_name}
                  </div>
                  {curatorModalGroup?.sample.followers !== null && curatorModalGroup?.sample.followers !== undefined && (
                    <div className="text-[11px] font-normal text-muted-foreground">
                      {formatPlays(curatorModalGroup.sample.followers)} seguidores
                    </div>
                  )}
                </div>
                </div>
              </DialogTitle>
              <DialogDescription>
                Músicas da campanha já presentes nesta playlist antes do início
              </DialogDescription>
            </DialogHeader>
            {Number(curatorModalGroup?.sample.baseline_plays_prior ?? 0) > 0 && (
              <HistoricoPrevioAlert />
            )}
            <div className="space-y-2">
              {curatorModalGroup?.songsInside.length ? (
                curatorModalGroup.songsInside.map((s) => (
                  <div key={s.id} className="nx-subcard-hover flex items-center gap-3 p-2.5">
                    {s.song_cover_url ? (
                      <img src={s.song_cover_url} alt="" className="w-10 h-10 rounded-md object-cover ring-1 ring-border" />
                    ) : (
                      <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center">
                        <Music2 className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium leading-tight truncate">{s.song_name}</div>
                      {s.song_artist && (
                        <div className="text-[11px] text-muted-foreground truncate">{s.song_artist}</div>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-6 text-center text-[12px] text-muted-foreground">
                  Nenhuma faixa da campanha estava aqui no início.
                </div>
              )}
            </div>
            {(() => {
              const u = curatorModalGroup?.sample
                ? resolveSpotifyPlaylistUrl(curatorModalGroup.sample)
                : null;
              if (!u) return null;
              return (
                <a
                  href={u}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => onExternal()}
                  className="inline-flex items-center justify-center gap-1.5 text-[12px] text-primary hover:underline mt-2"
                >
                  Abrir no Spotify <ExternalLink className="h-3 w-3" />
                </a>
              );
            })()}
          </DialogContent>
        </Dialog>
        )}

        {/* Adicionar playlist */}
        {activeTab === "cadastro" && (
        <Card className="nx-card nx-card-glow !p-0 border-border">
          <CardContent className="p-5 sm:p-6 pt-5 sm:pt-6 md:pt-6 space-y-5">
            {campaignContext.is_campaign_shadow && campaignContext.baseline_status === "pending" && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[12.5px] leading-relaxed text-amber-100">
                <div className="font-semibold mb-1">Aguardando baseline da campanha</div>
                <p className="text-amber-100/80">
                  A primeira coleta do Spotify for Artists ainda não foi feita. Cadastros de playlist ficam
                  bloqueados até a baseline ser capturada — assim garantimos que sua entrega não se confunda
                  com playlists que já listavam a música antes do início da campanha.
                </p>
              </div>
            )}
            {campaignContext.is_campaign_shadow && campaignContext.baseline_status === "captured" && campaignContext.baseline_playlist_count > 0 && (
              <div className="rounded-xl border border-border/60 bg-muted/30 px-4 py-2.5 text-[11.5px] text-muted-foreground">
                Baseline da campanha capturada: <strong className="text-foreground">{campaignContext.baseline_playlist_count}</strong> {campaignContext.baseline_playlist_count === 1 ? "playlist" : "playlists"} fazem parte da foto inicial e não podem ser cadastradas como entrega.
              </div>
            )}
            {baselinePlaylistsForCurator.length > 0 && (
              <Collapsible open={baselineOpen} onOpenChange={setBaselineOpen}>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/20 hover:bg-muted/30 transition-colors px-4 py-3 text-left"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-foreground leading-tight">
                          Já está nestas playlists
                          <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                            ({baselinePlaylistsForCurator.length})
                          </span>
                        </div>
                        <div className="text-[11.5px] text-muted-foreground/90 mt-0.5 leading-snug">
                          Não cadastre estas — a música já estava aqui antes do deal
                        </div>
                      </div>
                    </div>
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 text-muted-foreground shrink-0 transition-transform",
                        baselineOpen && "rotate-180",
                      )}
                    />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ul className="mt-2 space-y-1.5 max-h-[260px] overflow-y-auto pr-1 [scrollbar-width:thin]">
                    {baselinePlaylistsForCurator.map((p) => {
                      const href = resolveSpotifyPlaylistUrl(p);
                      return (
                        <li
                          key={p.id}
                          className="flex items-center gap-2.5 rounded-lg bg-muted/15 hover:bg-muted/25 transition-colors px-3 py-2"
                        >
                          {p.image_url ? (
                            <img
                              src={p.image_url}
                              alt=""
                              className="h-8 w-8 rounded-md object-cover ring-1 ring-border shrink-0"
                            />
                          ) : (
                            <div className="h-8 w-8 rounded-md bg-muted shrink-0 flex items-center justify-center">
                              <Music2 className="h-3.5 w-3.5 text-muted-foreground" />
                            </div>
                          )}
                          <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">
                            {p.playlist_name || "Playlist"}
                          </span>
                          {href && (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="shrink-0 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                              title="Abrir no Spotify"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </CollapsibleContent>
              </Collapsible>
            )}
            <div>

              <h2 className="text-[15px] font-semibold tracking-tight text-foreground">Adicionar playlist</h2>
              <p className="text-[11.5px] text-subtle-foreground mt-1 leading-snug">
                {playlistSongRequired
                  ? "Selecione a música da campanha antes de adicionar a playlist"
                  : selectedSong
                    ? `Playlist será vinculada em ${selectedSong.song_name}`
                    : "Cole o link de uma playlist do Spotify ou importe em lote"}
              </p>
            </div>
            {hasMultipleSongs && (
              <div
                className={cn(
                  "grid grid-cols-1 gap-2",
                  songs.length > 2 &&
                    "max-h-[128px] overflow-y-auto pr-1 -mr-1 [scrollbar-width:thin]",
                )}
              >
                {songs.map((s) => {
                  const isSelected = selectedSongId === s.id;
                  return (
                    <div
                      key={s.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedSongId(s.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedSongId(s.id);
                        }
                      }}
                      className={cn(
                        "w-full flex items-center gap-3 rounded-xl px-3 py-2 text-left transition-all ring-1 cursor-pointer",
                        isSelected
                          ? "bg-primary/10 ring-primary/50 text-foreground"
                          : "bg-muted/30 ring-border hover:bg-muted/50 text-muted-foreground",
                      )}
                    >
                      {s.song_cover_url ? (
                        <img src={s.song_cover_url} alt={s.song_name} className="w-8 h-8 rounded-md object-cover ring-1 ring-border shrink-0" />
                      ) : (
                        <div className="w-8 h-8 rounded-md bg-muted shrink-0" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{s.song_name}</span>
                      {access.writable && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAddSongToPlaylistFor(s);
                          }}
                          title={`Adicionar "${s.song_name}" em uma playlist já cadastrada`}
                          aria-label={`Adicionar ${s.song_name} em playlist existente`}
                          className="shrink-0 inline-flex items-center justify-center h-7 w-7 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-[10px] font-medium uppercase tracking-wider text-subtle-foreground px-1">
                Link da playlist
              </label>
              <Input
                placeholder="https://open.spotify.com/playlist/…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={submitting || importing}
                className="h-10 text-[14px] px-4 rounded-xl bg-[hsl(var(--elevated))] ring-1 ring-border/50 border-0 focus-visible:ring-2 focus-visible:ring-primary/40 placeholder:text-subtle-foreground/70"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-medium uppercase tracking-wider text-subtle-foreground px-1">
                Posição na playlist <span className="text-subtle-foreground/60 normal-case font-normal tracking-normal">· opcional</span>
              </label>
              <Select
                value={position || undefined}
                onValueChange={(v) => setPosition(v)}
                disabled={submitting || importing}
              >
                <SelectTrigger className="h-10 text-[14px] px-4 rounded-xl bg-[hsl(var(--elevated))] ring-1 ring-border/50 border-0 focus:ring-2 focus:ring-primary/40 [&>span]:text-subtle-foreground/70 data-[state=open]:[&>span]:text-foreground data-[placeholder]:[&>span]:text-subtle-foreground/70">
                  <SelectValue placeholder="Selecionar posição" />
                </SelectTrigger>
                <SelectContent className="max-h-[280px]">
                  {Array.from({ length: 100 }, (_, i) => i + 1).map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}{n === 1 ? "ª (primeira)" : "ª"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handleAdd}
              disabled={submitting || importing || !url.trim() || playlistSongRequired || !access.writable || (campaignContext.is_campaign_shadow && campaignContext.baseline_status === "pending")}
              className="w-full h-10 text-[14px] font-semibold rounded-xl"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Adicionar
            </Button>

            <div className="flex items-center gap-3 pt-1">
              <div className="flex-1 h-px bg-border" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                ou em lote
              </span>
              <div className="flex-1 h-px bg-border" />
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImportFile(f);
              }}
            />
            <div className="grid grid-cols-3 gap-2 sm:gap-3 px-1 sm:px-2">
              <Button
                type="button"
                variant="outline"
                className="h-11 w-full px-2 sm:px-4 text-[12px] sm:text-[13px] font-medium rounded-xl border-border/70 bg-[hsl(var(--elevated))] hover:bg-[hsl(var(--elevated))]/80 hover:border-primary/50 hover:text-primary transition-all duration-200 [&>svg]:shrink-0"
                onClick={() => {
                  if (playlistSongRequired) {
                    toast.error("Escolha uma música primeiro", {
                      description: "Selecione a música acima antes de importar as playlists.",
                    });
                    return;
                  }
                  if (!access.writable) {
                    toast.error("Esta campanha está bloqueada para novas playlists");
                    return;
                  }
                  fileInputRef.current?.click();
                }}
                disabled={submitting || importing}
              >
                {importing ? (
                  <Loader2 className="h-4 w-4 animate-spin sm:mr-2" />
                ) : (
                  <Upload className="h-4 w-4 sm:mr-2" />
                )}
                <span className="hidden sm:inline truncate">Importar</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11 w-full px-2 sm:px-4 text-[12px] sm:text-[13px] font-medium rounded-xl border-border/70 bg-[hsl(var(--elevated))] hover:bg-[hsl(var(--elevated))]/80 hover:border-primary/50 hover:text-primary transition-all duration-200 [&>svg]:shrink-0"
                onClick={() => {
                  if (playlistSongRequired) {
                    toast.error("Escolha uma música primeiro", {
                      description: "Selecione a música acima antes de colar as playlists.",
                    });
                    return;
                  }
                  if (!access.writable) {
                    toast.error("Esta campanha está bloqueada para novas playlists");
                    return;
                  }
                  setPasteOpen(true);
                }}
                disabled={submitting || importing}
              >
                <ClipboardPaste className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline truncate">Colar várias</span>
                <span className="sm:hidden truncate">Colar</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11 w-full px-2 sm:px-4 text-[12px] sm:text-[13px] font-medium rounded-xl border-border/70 bg-[hsl(var(--elevated))] hover:bg-[hsl(var(--elevated))]/80 hover:border-primary/50 hover:text-primary transition-all duration-200 [&>svg]:shrink-0"
                onClick={handleDownloadTemplate}
                disabled={importing}
              >
                <Download className="h-4 w-4 sm:mr-2" />
                <span className="truncate"><span className="sm:hidden">Modelo</span><span className="hidden sm:inline">Modelo</span></span>
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground/80 text-center pt-1 leading-relaxed">
              Importe planilha (até 100) ou cole até 50 links de uma vez
              <br />
              <span className="opacity-70">Baixe o modelo pronto e envie preenchido</span>
            </p>
          </CardContent>
        </Card>
        )}

        <PasteUrlsDialog
          open={pasteOpen}
          onClose={() => setPasteOpen(false)}
          publicToken={deal?.public_token ?? token ?? ""}
          songId={selectedSongId}
          songRequired={playlistSongRequired}
          writable={access.writable}
          onImported={() => load()}
        />

        <AddSongToPlaylistDialog
          open={addSongToPlaylistFor !== null}
          onOpenChange={(v) => {
            if (!v) setAddSongToPlaylistFor(null);
          }}
          song={addSongToPlaylistFor}
          publicToken={deal?.public_token ?? token ?? ""}
          allPlaylists={playlists}
          onAdded={() => load()}
        />


        {/* Fase 7.3 P4 — Galeria de Evidências (prints reais por playlist). */}
        {activeTab === "historico" && prints.length > 0 && (
          <Card className="nx-card nx-card-glow !p-0 border-border">
            <CardContent className="p-5 sm:p-6 pt-5 sm:pt-6 md:pt-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <h2 className="text-[15px] font-semibold tracking-tight inline-flex items-center gap-2">
                    <ImageIcon className="h-4 w-4 text-muted-foreground" /> Evidências
                  </h2>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                    Prints coletados pelos bots e pelo admin, em ordem cronológica.
                  </p>
                </div>
                <span className="text-[12px] text-muted-foreground shrink-0 tabular-nums">{prints.length}</span>
              </div>
              {prints.length === 0 ? (
                <div className="text-center py-10 text-sm text-muted-foreground">Sem evidências ainda.</div>
              ) : (
                <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {prints.map((p, i) => (
                    <li key={`${p.kind}-${i}-${p.captured_at}`} className="rounded-lg border border-border overflow-hidden bg-card/40">
                      <a href={p.screenshot_url} target="_blank" rel="noreferrer" className="block aspect-video bg-muted overflow-hidden">
                        
                        <img src={p.screenshot_url} alt={p.playlist_name ?? "print"} className="w-full h-full object-cover hover:scale-105 transition-transform" loading="lazy" />
                      </a>
                      <div className="p-2 space-y-1">
                        <div className="text-[12px] font-medium truncate" title={p.playlist_name ?? ""}>
                          {p.playlist_name ?? "Playlist"}
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
                          <span>{formatDateTime(p.captured_at)}</span>
                          {p.position != null && <span className="text-primary">#{p.position}</span>}
                        </div>
                        <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60 truncate">
                          {p.kind === "delivery_proof" ? "bot" : "admin"}
                          {p.source ? ` · ${p.source}` : ""}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}


        {/* Histórico de importações — espelha o modal do admin: 1 linha por planilha. */}
        {activeTab === "historico" && (
        <Card className="nx-card nx-card-glow !p-0 border-border">
          <CardContent className="p-4 sm:p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-[15px] font-semibold tracking-tight">Histórico de importações</h2>
                <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                  Planilhas enviadas pelo admin para esta campanha.
                </p>
              </div>
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground shrink-0 tabular-nums">
                {uploads.length} {uploads.length === 1 ? "registro" : "registros"}
              </span>
            </div>

            {uploads.length === 0 ? (
              <div className="py-10 flex flex-col items-center text-center gap-3.5">
                <div className="h-12 w-12 rounded-2xl bg-[hsl(var(--elevated))] border border-border/60 flex items-center justify-center">
                  <Download className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="space-y-1 max-w-xs">
                  <div className="text-[14px] font-semibold text-foreground">
                    Nenhuma planilha enviada ainda
                  </div>
                  <div className="text-[12px] text-muted-foreground leading-relaxed">
                    Quando o admin importar a primeira planilha, ela aparece aqui.
                  </div>
                </div>
              </div>
            ) : (
              (() => {
                // Ordenar por reference_date desc; sem ref, usa created_at. Dedup por reference_date.
                const sorted = [...uploads].sort((a, b) => {
                  const ra = a.reference_date ?? a.created_at;
                  const rb = b.reference_date ?? b.created_at;
                  return rb.localeCompare(ra);
                });
                const seen = new Set<string>();
                const unique = sorted.filter((u) => {
                  const key = u.reference_date ?? u.id;
                  if (seen.has(key)) return false;
                  seen.add(key);
                  return true;
                });
                return (
                  <ul className="space-y-2 max-h-[420px] overflow-y-auto pr-1 -mr-1 scroll-smooth [mask-image:linear-gradient(to_bottom,black_calc(100%-24px),transparent)]">
                    {unique.map((u) => {
                      const refLabel = u.reference_date
                        ? formatDate(u.reference_date)
                        : formatDate(u.created_at);
                      return (
                        <li
                          key={u.id}
                          className="rounded-xl border border-border/60 bg-[hsl(var(--elevated))]/40 px-3 py-3 sm:px-4 sm:py-3.5"
                        >
                          <div className="flex items-center gap-3">
                            <div className="h-9 w-9 sm:h-10 sm:w-10 rounded-lg bg-muted/30 ring-1 ring-border/50 flex items-center justify-center shrink-0">
                              <Download className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-[13px] sm:text-[14px] font-semibold tabular-nums leading-tight">
                                  {refLabel}
                                </span>
                                {u.is_baseline && (
                                  <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-semibold">
                                    baseline
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-muted-foreground tabular-nums mt-1 leading-snug">
                                {u.total_streams != null && (
                                  <>{formatPlays(u.total_streams)} streams</>
                                )}
                                {u.total_streams != null && u.rows_imported != null && " · "}
                                {u.rows_imported != null && (
                                  <>{u.rows_imported.toLocaleString("pt-BR")} playlists</>
                                )}
                              </div>
                            </div>
                            {u.download_url ? (
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await downloadUploadUrlAsXlsx({
                                      signedUrl: u.download_url!,
                                      fileName: u.file_name,
                                      referenceDate: u.reference_date,
                                    });
                                  } catch (err) {
                                    toast.error(err instanceof Error ? err.message : "Falha ao baixar planilha");
                                  }
                                }}
                                className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-card/40 px-2.5 py-1.5 text-[11.5px] font-medium text-primary hover:bg-[hsl(var(--hover))] hover:border-primary/40 transition-colors"
                                aria-label={`Baixar planilha de ${refLabel}`}
                              >
                                <Download className="h-3.5 w-3.5" />
                                <span className="hidden xs:inline sm:inline">Baixar</span>
                              </button>
                            ) : (
                              <span className="shrink-0 text-[10.5px] text-muted-foreground/60 italic">
                                indisponível
                              </span>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                );
              })()
            )}
          </CardContent>
        </Card>
        )}


        {/* Footer — minimal: logo + wordmark */}
        <footer className="pt-6 pb-4 flex flex-col items-center justify-center gap-1 text-center">
          <NexEngineLogo variant="auto" size={16} />
          <span className="text-[11px] text-foreground/70 font-medium tracking-wide">NexEngine</span>
        </footer>
      </div>
      </div>
    </div>
  );
}
