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
  ChevronDown,
  ChevronRight,
  Music2,
} from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { cn } from "@/lib/utils";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { NexEngineLogo } from "@/components/NexEngineLogo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CuratorNotificationsBell } from "@/components/public/CuratorNotificationsBell";
import { PrintThumbs } from "@/components/playlist-deals/PrintThumbs";
import { DealLogDetailDialog } from "@/components/playlist-deals/DealLogDetailDialog";
import { markCuratorPublicMode } from "@/lib/publicRouteMode";

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
  is_baseline: boolean;
  added_at: string;
  spotify_playlist_id?: string | null;
  spotify_owner_id?: string | null;
  spotify_owner_name?: string | null;
  image_url?: string | null;
  added_at_spotify?: string | null;
  match_status?: string | null;
  match_reason?: string | null;
  streams_7d?: number | null;
  streams_28d?: number | null;
  streams_total?: number | null;
};

type DealLog = {
  id: string;
  deal_id: string;
  total_plays: number;
  note: string | null;
  is_baseline: boolean;
  created_at: string;
  song_id?: string | null;
  print_urls?: string[] | null;
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

function formatPlays(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return Math.round(n).toString();
}

function formatDate(iso: string | null): string {
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

function formatShortDate(iso: string | Date | null): string {
  if (!iso) return "—";
  try {
    const d = typeof iso === "string" ? new Date(iso) : iso;
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  } catch {
    return "—";
  }
}

/**
 * Ciclo de relatório: a cada 7 dias contados a partir do dia em que a
 * campanha começou (`started_at` ou `created_at`), com corte sempre às
 * 17:00 daquele dia da semana (delay do Spotify).
 *
 *  anchor       = 17:00 do dia em que a campanha começou
 *  cycleEnd(d)  = primeiro múltiplo de 7 dias após `anchor` que seja > d
 *  cycleStart(d)= cycleEnd(d) - 7 dias
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
  // quantos ciclos completos já passaram desde a âncora até agora
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deal, setDeal] = useState<Deal | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [logs, setLogs] = useState<DealLog[]>([]);
  const [songs, setSongs] = useState<DealSong[]>([]);
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [baseOpen, setBaseOpen] = useState(true);
  const [curatorOpen, setCuratorOpen] = useState(true);
  // Modal: baseline playlists de uma música
  const [baseSongModalId, setBaseSongModalId] = useState<string | null>(null);
  // Modal: músicas da campanha presentes em uma playlist do curador
  const [curatorPlaylistModalKey, setCuratorPlaylistModalKey] = useState<string | null>(null);
  // Fase 5 — filtro por música (null = todas)
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
  // Log clicado no histórico (abre modal de detalhe)
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  // Tick a cada 60s pra atualizar o countdown do ciclo
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasMultipleSongs = songs.length > 1;
  const selectedSong = useMemo(
    () => (selectedSongId ? songs.find((s) => s.id === selectedSongId) ?? null : null),
    [selectedSongId, songs],
  );

  // Playlists filtradas pela música selecionada (quando aplicável)
  const visiblePlaylists = useMemo(() => {
    if (!selectedSongId) return playlists;
    return playlists.filter((p: any) => p.song_id === selectedSongId || !p.song_id);
  }, [playlists, selectedSongId]);

  const basePlaylists = useMemo(
    () => visiblePlaylists.filter((p) => p.is_baseline),
    [visiblePlaylists],
  );
  const curatorPlaylists = useMemo(
    () => visiblePlaylists.filter((p) => !p.is_baseline),
    [visiblePlaylists],
  );

  // Agrupamento baseline: 1 card por música, com as playlists onde ela já está
  const baseGroupedBySong = useMemo(() => {
    // usa `playlists` (não filtrado) para mostrar todas as músicas
    const baseAll = playlists.filter((p) => p.is_baseline);
    const groups = new Map<string, { song: DealSong | null; deal: boolean; playlists: Playlist[] }>();
    for (const p of baseAll) {
      const key = p.song_id ?? "__deal__";
      if (!groups.has(key)) {
        const song = p.song_id ? songs.find((s) => s.id === p.song_id) ?? null : null;
        groups.set(key, { song, deal: !p.song_id, playlists: [] });
      }
      groups.get(key)!.playlists.push(p);
    }
    // garante todas as músicas da campanha apareçam mesmo sem baseline
    for (const s of songs) {
      if (!groups.has(s.id)) groups.set(s.id, { song: s, deal: false, playlists: [] });
    }
    return Array.from(groups.entries()).map(([key, v]) => ({ key, ...v }));
  }, [playlists, songs]);

  // Agrupamento curador: 1 card por playlist única, com as músicas que já estão nela (baseline)
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
    // para cada playlist do curador, descobre quais músicas da campanha já estão nela (via baseline match por spotify_playlist_id)
    const baseAll = playlists.filter((p) => p.is_baseline);
    for (const [key, g] of groups) {
      const pid = g.sample.spotify_playlist_id;
      if (!pid) continue;
      const matchedSongIds = new Set(
        baseAll.filter((b) => b.spotify_playlist_id === pid).map((b) => b.song_id).filter(Boolean) as string[],
      );
      g.songsInside = songs.filter((s) => matchedSongIds.has(s.id));
    }
    return Array.from(groups.values());
  }, [curatorPlaylists, playlists, songs]);

  const baseModalGroup = useMemo(
    () => baseGroupedBySong.find((g) => g.key === baseSongModalId) ?? null,
    [baseGroupedBySong, baseSongModalId],
  );
  const curatorModalGroup = useMemo(
    () => curatorGroupedByPlaylist.find((g) => g.key === curatorPlaylistModalKey) ?? null,
    [curatorGroupedByPlaylist, curatorPlaylistModalKey],
  );

  // Logs filtrados pela música selecionada
  const visibleLogs = useMemo(() => {
    if (!selectedSongId) return logs;
    return logs.filter((l) => l.song_id === selectedSongId);
  }, [logs, selectedSongId]);

  const load = async () => {
    const publicToken = normalizePublicToken(token);
    if (isPlaceholderToken(publicToken)) {
      setError("placeholder_token");
      setDeal(null);
      setPlaylists([]);
      setLogs([]);
      setSongs([]);
      setLoading(false);
      return;
    }

    const { data, error: fnErr } = await supabase.functions.invoke(
      "get-curator-deal-public",
      { body: { slug: publicToken } },
    );
    if (fnErr || !data?.ok) {
      setError(data?.error || fnErr?.message || "not found");
      setDeal(null);
      setPlaylists([]);
      setLogs([]);
      setSongs([]);
    } else {
      setDeal(data.deal as Deal);
      setPlaylists((data.playlists ?? []) as Playlist[]);
      setLogs((data.logs ?? []) as DealLog[]);
      setSongs((data.songs ?? []) as DealSong[]);
      setError(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    markCuratorPublicMode(normalizePublicToken(token));
    setLoading(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const stats = useMemo(() => {
    const now = new Date();
    // Quando há uma música selecionada, usa o started_at dela como âncora
    const anchorRef = selectedSong?.started_at ?? deal?.started_at ?? deal?.created_at ?? null;
    const anchor = getAnchor(anchorRef);
    const cycEnd = cycleEnd(anchor, now);
    const cycStart = cycleStart(anchor, now);
    const msToCycleEnd = cycEnd.getTime() - now.getTime();

    if (!deal) {
      return {
        target: 0,
        dailyGoal: 0,
        baseline: 0,
        latest: 0,
        earned: 0,
        remaining: 0,
        pct: 0,
        todayPlays: 0,
        todayPct: 0,
        vel: null as number | null,
        eta: null as number | null,
        hasBaseline: false,
        daysRunning: 0,
        cycleStart: cycStart,
        cycleEnd: cycEnd,
        msToCycleEnd,
        weekRemaining: 0,
        isOverdue: false,
        lastImportAt: null as Date | null,
        lastImportCycleEnd: null as Date | null,
      };
    }

    // Quando filtrado por música, usa metas e baseline da música; senão, do deal
    const target = Number(selectedSong?.target_plays ?? deal.target_plays ?? 0);
    const dailyGoal = Number(selectedSong?.daily_goal ?? deal.daily_goal ?? 0);
    const baseline = Number(selectedSong?.baseline_plays ?? deal.baseline_plays ?? 0);

    // Logs filtrados (já vem filtrado em visibleLogs quando há música)
    const sourceLogs = selectedSongId ? visibleLogs : logs;
    const sorted = [...sourceLogs].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    const nonBase = sorted.filter((l) => !l.is_baseline);
    const hasBaseline = sorted.some((l) => l.is_baseline);
    const latest = nonBase.length > 0 ? Number(nonBase[nonBase.length - 1].total_plays) : baseline;
    const earned = nonBase.length > 0 ? Math.max(0, latest - baseline) : 0;
    const remaining = Math.max(0, target - earned);
    const pct = target > 0 ? Math.min(100, Math.round((earned / target) * 100)) : 0;

    // Média/dia do último ciclo (7 dias):
    // pega o delta entre o último relatório e o anterior (ou baseline) e divide por 7.
    let todayPlays = 0;
    if (nonBase.length > 0) {
      const lastVal = Number(nonBase[nonBase.length - 1].total_plays);
      const prevVal =
        nonBase.length >= 2
          ? Number(nonBase[nonBase.length - 2].total_plays)
          : baseline;
      const cycleDelta = Math.max(0, lastVal - prevVal);
      todayPlays = Math.round(cycleDelta / 7);
    }
    const todayPct =
      dailyGoal > 0 ? Math.min(100, Math.round((todayPlays / dailyGoal) * 100)) : 0;

    let vel: number | null = null;
    if (nonBase.length >= 2) {
      const first = nonBase[0];
      const last = nonBase[nonBase.length - 1];
      const days =
        (new Date(last.created_at).getTime() - new Date(first.created_at).getTime()) /
        (1000 * 60 * 60 * 24);
      const delta = Number(last.total_plays) - Number(first.total_plays);
      if (days > 0 && delta > 0) vel = delta / days;
    }

    let eta: number | null = null;
    if (target > 0 && earned >= target) eta = 0;
    else if (vel && vel > 0) eta = Math.ceil(remaining / vel);

    const startRef = selectedSong?.started_at ?? deal.started_at ?? deal.created_at;
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

    const lastImportAt = nonBase.length > 0
      ? new Date(nonBase[nonBase.length - 1].created_at)
      : null;
    const lastImportCycleEnd = lastImportAt ? cycleEnd(anchor, new Date(lastImportAt.getTime() - 1)) : null;

    const currentCycleEndMs = cycEnd.getTime();
    const isOverdue = hasBaseline
      && lastImportCycleEnd !== null
      && lastImportCycleEnd.getTime() < currentCycleEndMs
      && now.getTime() - cycStart.getTime() > 24 * 60 * 60 * 1000;

    return {
      target, dailyGoal, baseline, latest, earned, remaining, pct,
      todayPlays, todayPct, vel, eta, hasBaseline, daysRunning,
      cycleStart: cycStart,
      cycleEnd: cycEnd,
      msToCycleEnd,
      weekRemaining,
      isOverdue,
      lastImportAt,
      lastImportCycleEnd,
    };
  }, [deal, logs, visibleLogs, selectedSong, selectedSongId]);


  const handleAdd = async () => {
    if (!token || !url.trim()) return;
    const realToken = deal?.public_token ?? token;
    setSubmitting(true);
    const { data, error: fnErr } = await supabase.functions.invoke(
      "register-curator-playlist",
      { body: { public_token: realToken, urls: [url.trim()], song_id: selectedSongId } },
    );
    setSubmitting(false);
    if (fnErr || !data?.ok) {
      toast.error(data?.error || fnErr?.message || "Erro ao adicionar playlist");
      return;
    }
    const item = Array.isArray(data.items) ? data.items[0] : null;
    if (item?.error) {
      toast.error(item.error);
      return;
    }
    if (item?.match_status === "suspicious") {
      toast.error("Esta playlist não é do seu perfil Spotify cadastrado");
      return;
    }
    toast.success("Playlist adicionada");
    setUrl("");
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
      const added = items.filter((i: { saved?: boolean }) => i.saved).length;
      const suspicious = items.filter((i: { match_status?: string }) => i.match_status === "suspicious").length;
      const errs = items.filter((i: { error?: string }) => i.error).length;
      const parts: string[] = [`${added} adicionadas`];
      if (suspicious) parts.push(`${suspicious} bloqueadas (não são do seu perfil)`);
      if (errs) parts.push(`${errs} com erro`);
      toast.success("Importação concluída", { description: parts.join(" · ") });
      await load();
    } catch (err) {
      toast.error("Não foi possível ler o arquivo");
      console.error(err);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !deal) {
    const isPlaceholderLink = error === "placeholder_token";
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-6 text-center">
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

  const isDone = stats.target > 0 && stats.earned >= stats.target;

  return (
    <div className="relative min-h-screen bg-background py-8 sm:py-10 overflow-hidden">
      {/* Atmosfera verde — glows espalhados pela página inteira (somente dark) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-0 hidden dark:block"
        style={{
          background: [
            // topo centro — mais forte
            "radial-gradient(ellipse 60% 40% at 50% 0%, rgba(29,185,84,0.18) 0%, rgba(29,185,84,0) 70%)",
            // lateral esquerda alta
            "radial-gradient(ellipse 40% 50% at 0% 25%, rgba(29,185,84,0.10) 0%, rgba(29,185,84,0) 70%)",
            // lateral direita média
            "radial-gradient(ellipse 40% 50% at 100% 45%, rgba(29,185,84,0.09) 0%, rgba(29,185,84,0) 70%)",
            // meio esquerda baixa
            "radial-gradient(ellipse 45% 35% at 10% 70%, rgba(29,185,84,0.07) 0%, rgba(29,185,84,0) 70%)",
            // base centro — leve
            "radial-gradient(ellipse 70% 30% at 50% 100%, rgba(29,185,84,0.08) 0%, rgba(29,185,84,0) 70%)",
            // direita baixa
            "radial-gradient(ellipse 35% 40% at 95% 85%, rgba(29,185,84,0.06) 0%, rgba(29,185,84,0) 70%)",
          ].join(", "),
        }}
      />
      {/* Container central global — mobile: full width, tablet: 900px, desktop: 1200px */}
      <div className="relative z-10 w-full max-w-[1200px] mx-auto px-5 sm:px-6 md:px-8">
        <div className="max-w-xl md:max-w-2xl mx-auto space-y-4 sm:space-y-5">
        {/* Topbar — Logo à esquerda, identidade da curadoria, ações à direita */}
        <div className="flex items-center justify-between gap-3 py-3 border-b border-border/50">
          <div className="flex items-center gap-2.5 min-w-0">
            <NexEngineLogo variant="mark" size={22} />
            <div className="min-w-0">
              <div className="text-[12px] font-semibold tracking-tight leading-none truncate">
                {deal.curator_name || "Curadoria"}
              </div>
              <div className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground/70 mt-1 leading-none">
                Curadoria
              </div>
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            <ThemeToggle />
            <CuratorNotificationsBell
              stats={{
                target: stats.target,
                dailyGoal: stats.dailyGoal,
                earned: stats.earned,
                pct: stats.pct,
                todayPlays: stats.todayPlays,
                todayPct: stats.todayPct,
                hasBaseline: stats.hasBaseline,
                isOverdue: stats.isOverdue,
                vel: stats.vel,
                eta: stats.eta,
                daysRunning: stats.daysRunning,
                lastImportAt: stats.lastImportAt,
              }}
            />
          </div>
        </div>

        {/* Header — campanha + música */}
        <Card className="nx-card !p-0 overflow-hidden border-border">
          <CardContent className="p-5 sm:p-6 space-y-6">
            {/* Eyebrow: CAMPANHA · próximo relatório (seg 17h) */}
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
                  ? "Aguardando relatório inicial"
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

            {/* Identidade: capa + música (curador já aparece no topo) */}
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
                      // Visão geral: mosaico com até 4 capas das músicas da campanha
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
                            : count === 3
                            ? "grid-cols-2 grid-rows-2"
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
                            className="w-[72px] h-[72px] rounded-xl object-cover ring-1 ring-border"
                          />
                        </div>
                      ) : (
                        <div className="w-[72px] h-[72px] rounded-xl bg-muted shrink-0 flex items-center justify-center ring-1 ring-border">
                          <ListMusic className="h-6 w-6 text-muted-foreground" />
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
                    </div>
                  </div>

                  {/* Divisor */}
                  <div className="h-px bg-border" />

                  {/* Briefing: meta · prazo · ritmo */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1">
                        Meta
                      </div>
                      <div className="text-[15px] font-semibold tabular-nums leading-none">
                        {formatPlays(stats.target)}
                      </div>
                      <div className="text-[10px] text-muted-foreground font-normal mt-1">plays</div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1">
                        Esta semana
                      </div>
                      <div className="text-[15px] font-semibold tabular-nums leading-none text-primary">
                        {stats.dailyGoal > 0 ? formatPlays(stats.weekRemaining) : "—"}
                      </div>
                      <div className="text-[10px] text-muted-foreground font-normal mt-1">restantes</div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1">
                        Progresso
                      </div>
                      <div className="text-[15px] font-semibold tabular-nums leading-none">
                        {stats.pct}<span className="text-[11px] text-muted-foreground font-normal ml-0.5">%</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground font-normal mt-1 invisible">.</div>
                    </div>
                  </div>

                  {/* Mini progress bar */}
                  {stats.hasBaseline && stats.target > 0 && (
                    <div className="h-1 rounded-full bg-muted/60 overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-500"
                        style={{ width: `${stats.pct}%` }}
                      />
                    </div>
                  )}

                  {/* CTA Spotify */}
                  <a
                    href={headerUrl}
                    target="_blank"
                    rel="noreferrer"
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

        {/* Músicas da campanha — visível só quando há 2+ músicas no deal.
            Clicar em uma música filtra todos os KPIs, playlists e histórico. */}
        {hasMultipleSongs && (
          <Card className="nx-card !p-0 border-border">
            <CardContent className="p-5 sm:p-6 space-y-5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[15px] font-semibold inline-flex items-center gap-2 tracking-tight">
                    <ListMusic className="h-4 w-4 text-muted-foreground" />
                    Músicas da campanha
                  </h2>
                  <p className="text-[12px] text-muted-foreground mt-1.5 leading-snug">
                    {selectedSong
                      ? "Visualizando apenas esta música — toque em \"Todas\" para ver geral"
                      : "Toque em uma música para ver progresso individual"}
                  </p>
                </div>
                <span className="text-[12px] text-muted-foreground shrink-0 tabular-nums">
                  {songs.length} músicas
                </span>
              </div>

              {/* Chip "Todas" */}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedSongId(null)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors ring-1",
                    selectedSongId === null
                      ? "bg-primary text-primary-foreground ring-primary"
                      : "bg-muted/40 text-muted-foreground ring-border hover:bg-muted/60",
                  )}
                >
                  Todas as músicas
                </button>
              </div>

              <ul className="space-y-2 max-h-[280px] overflow-y-auto pr-1 -mr-1 scroll-smooth">
                {songs.map((s) => {
                  const songLogs = logs.filter(
                    (l) => l.song_id === s.id && !l.is_baseline,
                  );
                  const lastPlays =
                    songLogs.length > 0
                      ? Number(songLogs[songLogs.length - 1].total_plays)
                      : Number(s.baseline_plays ?? 0);
                  const earned = Math.max(
                    0,
                    lastPlays - Number(s.baseline_plays ?? 0),
                  );
                  const target = Number(s.target_plays ?? 0);
                  const pct =
                    target > 0
                      ? Math.min(100, Math.round((earned / target) * 100))
                      : 0;

                  const startRef = s.started_at ?? deal.started_at ?? deal.created_at;
                  const startMs = startRef ? new Date(startRef).getTime() : null;
                  const ramp = Number(s.ramp_up_days ?? 5);
                  const daysSince = startMs
                    ? Math.floor((Date.now() - startMs) / (1000 * 60 * 60 * 24))
                    : 0;
                  const isDoneSong = target > 0 && earned >= target;
                  const inRampUp = startMs !== null && daysSince < ramp && !isDoneSong;

                  let statusLabel = "Ativa";
                  if (isDoneSong) statusLabel = "OK";
                  else if (inRampUp) statusLabel = `${Math.max(1, ramp - daysSince)}d`;
                  else if (!startMs) statusLabel = "—";

                  const isSelected = selectedSongId === s.id;

                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedSongId(isSelected ? null : s.id)
                        }
                        className={cn(
                          "w-full text-left px-3 py-2.5 transition-all",
                          isSelected
                            ? "nx-subcard ring-1 ring-primary/40 !border-primary/40"
                            : "nx-subcard-hover",
                        )}
                        aria-pressed={isSelected}
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
                            <div className="flex items-center gap-2">
                              <span className="text-[12.5px] font-semibold leading-tight truncate">
                                {s.song_name}
                              </span>
                              <span
                                className={cn(
                                  "text-[9px] font-semibold uppercase tracking-wider shrink-0 px-1.5 py-0.5 rounded-full ring-1 leading-none",
                                  isDoneSong
                                    ? "text-primary bg-primary/10 ring-primary/20"
                                    : inRampUp
                                    ? "text-warning bg-warning/10 ring-warning/20"
                                    : !startMs
                                    ? "text-muted-foreground bg-muted/40 ring-border"
                                    : "text-primary bg-primary/10 ring-primary/20",
                                )}
                              >
                                {statusLabel}
                              </span>
                            </div>
                            <div className="mt-1.5 flex items-center gap-2">
                              <div className="h-1 flex-1 rounded-full bg-muted/60 overflow-hidden">
                                <div
                                  className="h-full bg-primary rounded-full transition-all duration-500"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                                {formatPlays(earned)}/{target > 0 ? formatPlays(target) : "—"}
                              </span>
                              <span className="text-[10px] font-medium tabular-nums shrink-0 w-8 text-right">
                                {pct}%
                              </span>
                            </div>
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Plays hoje vs combinado diário */}
        {stats.hasBaseline && (
          <Card className="nx-card !p-0 border-border">
            <CardContent className="p-5 grid grid-cols-2 gap-4 divide-x divide-border">
              <div className="pr-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                  Plays acumulados
                </div>
                <div className="text-[20px] font-bold tabular-nums text-foreground leading-none">
                  {formatPlays(stats.latest)}
                </div>
                <div className="text-[10px] text-muted-foreground mt-1.5">
                  Total reportado até agora
                </div>
              </div>
              <div className="pl-4">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                  Média/dia · ciclo
                </div>
                <div className="text-[20px] font-bold tabular-nums leading-none">
                  <span className="text-primary">{formatPlays(stats.todayPlays)}</span>
                  <span className="text-muted-foreground text-[14px] font-semibold"> / {formatPlays(stats.dailyGoal)}</span>
                </div>
                {stats.dailyGoal > 0 && (
                  <div className="text-[10px] text-muted-foreground mt-1.5">
                    {stats.todayPct}% do combinado diário (último relatório ÷ 7)
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Progresso da campanha */}
        <Card className="nx-card !p-0 border-border">
          <CardContent className="p-5 sm:p-6 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold tracking-tight">Combinado total</h2>
              <span className="text-[20px] font-bold tabular-nums">{stats.pct}%</span>
            </div>

            <div className="space-y-2.5">
              <Progress value={stats.pct} className="h-2 rounded-full" />
              <div className="flex items-center justify-between text-[12px] tabular-nums pt-1">
                <span className="text-foreground font-medium">
                  {formatPlays(stats.earned)} plays
                </span>
                <span className="text-muted-foreground">
                  combinado: {formatPlays(stats.target)}
                </span>
              </div>
            </div>

            <Separator className="bg-border" />

            {/* Grid de KPIs — mini-cards */}
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
                  <Zap className="h-3 w-3 text-primary" />
                  Velocidade
                </div>
                <div className="text-[18px] font-semibold tabular-nums leading-none">
                  {stats.vel !== null ? `${formatPlays(stats.vel)}/dia` : "—"}
                </div>
              </div>

              <div className="nx-subcard p-4">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1.5 uppercase tracking-wider">
                  <TrendingUp className="h-3 w-3" />
                  ETA
                </div>
                <div className="text-[18px] font-semibold tabular-nums leading-none">
                  {stats.eta === null
                    ? "—"
                    : stats.eta === 0
                    ? "✓"
                    : `~${stats.eta}d`}
                </div>
              </div>
            </div>

            <Separator className="bg-border" />

            <div className="grid grid-cols-2 gap-4 text-[12px]">
              <div>
                <div className="text-muted-foreground uppercase tracking-wider text-[11px]">Início</div>
                <div className="text-foreground font-medium mt-1.5 text-[13px]">
                  {formatDate(deal.started_at ?? deal.created_at)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground uppercase tracking-wider text-[11px]">Plays iniciais</div>
                <div className="text-foreground font-medium tabular-nums mt-1.5 text-[13px]">
                  {formatPlays(stats.baseline)}
                </div>
              </div>
            </div>

            {/* Ciclo do relatório semanal */}
            <div className="nx-subcard p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-muted-foreground uppercase tracking-wider text-[11px]">
                  Ciclo atual
                </div>
                <div className="text-[11px] text-muted-foreground tabular-nums">
                  {formatShortDate(stats.cycleStart)} → {formatShortDate(stats.cycleEnd)} 17h
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 text-[12px]">
                <span className="text-muted-foreground">Último relatório</span>
                <span className="text-foreground font-medium tabular-nums">
                  {stats.lastImportAt
                    ? `${formatShortDate(stats.lastImportAt)} · ciclo ${formatShortDate(stats.lastImportCycleEnd)}`
                    : "—"}
                </span>
              </div>
              {stats.isOverdue && (
                <div className="text-[11px] text-warning leading-snug pt-1">
                  Aguardando relatório do ciclo que fechou em {formatShortDate(stats.cycleStart)} 17h.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Playlists onde a música já está — agrupadas por música (1 card por música) */}
        {baseGroupedBySong.length > 0 && (
          <Card className="nx-card !p-0 border-border">
            <CardContent className="p-5 sm:p-6 space-y-4">
              <div className="w-full flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h2 className="text-[14px] font-semibold inline-flex items-center gap-2 tracking-tight">
                    <ListMusic className="h-3.5 w-3.5 text-muted-foreground" />
                    Playlists em que as músicas já estão
                  </h2>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                    Clique em uma música para ver as playlists de origem
                  </p>
                </div>
                <span className="text-[11px] text-muted-foreground shrink-0">
                  {baseGroupedBySong.length} {baseGroupedBySong.length === 1 ? "música" : "músicas"}
                </span>
              </div>

              {(
                <div className="grid grid-cols-2 gap-3">
                  {baseGroupedBySong.map((g) => {
                    const cover = g.song?.song_cover_url ?? deal.song_cover_url;
                    const name = g.song?.song_name ?? deal.song_name;
                    const artist = g.song?.song_artist ?? deal.song_artist;
                    return (
                      <button
                        key={g.key}
                        type="button"
                        onClick={() => setBaseSongModalId(g.key)}
                        className="group nx-subcard-hover flex flex-col p-3 text-left"
                      >
                        <div className="relative w-full aspect-square rounded-lg overflow-hidden bg-muted/60 ring-1 ring-border/40 mb-3">
                          {cover ? (
                            <img
                              src={cover}
                              alt={name}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Music2 className="h-6 w-6 text-muted-foreground" />
                            </div>
                          )}
                          <span className="absolute top-2 left-2 text-[9px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-background/85 backdrop-blur text-foreground/80 ring-1 ring-border/60">
                            {g.playlists.length} {g.playlists.length === 1 ? "playlist" : "playlists"}
                          </span>
                        </div>
                        <div className="text-[13px] font-semibold leading-tight line-clamp-1 group-hover:text-primary transition-colors">
                          {name}
                        </div>
                        {artist && (
                          <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
                            {artist}
                          </div>
                        )}
                        <div className="mt-2 inline-flex items-center gap-1 text-[10px] text-muted-foreground/80 group-hover:text-primary/80 transition-colors">
                          Ver playlists
                          <ChevronRight className="h-3 w-3" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Playlists adicionadas pelo curador */}
        <Card className="nx-card !p-0 border-border">
          <CardContent className="p-5 sm:p-6 space-y-4">
            <div className="w-full flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h2 className="text-[14px] font-semibold inline-flex items-center gap-2 tracking-tight">
                  <ListMusic className="h-3.5 w-3.5 text-muted-foreground" />
                  Suas playlists adicionadas
                </h2>
                <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                  Clique em uma playlist para ver quais músicas da campanha já estão nela
                </p>
              </div>
              <span className="text-[11px] text-muted-foreground shrink-0">
                {curatorGroupedByPlaylist.length} {curatorGroupedByPlaylist.length === 1 ? "playlist" : "playlists"}
              </span>
            </div>

            {(
              curatorGroupedByPlaylist.length === 0 ? (
                <div className="py-6 flex flex-col items-center text-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-[hsl(var(--elevated))] border border-border/60 flex items-center justify-center">
                    <ListMusic className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <p className="text-[12px] text-muted-foreground max-w-xs">
                    Nenhuma playlist adicionada ainda — use o bloco abaixo para incluir a primeira.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 max-h-[60vh] sm:max-h-[480px] overflow-y-auto pr-1 -mr-1 scroll-smooth [mask-image:linear-gradient(to_bottom,black_calc(100%-32px),transparent)]">
                  {curatorGroupedByPlaylist.map((g) => {
                    const p = g.sample;
                    return (
                      <button
                        key={g.key}
                        type="button"
                        onClick={() => setCuratorPlaylistModalKey(g.key)}
                        className="group nx-subcard-hover flex flex-col p-3 text-left hover:!border-primary/30"
                      >
                        <div className="relative w-full aspect-square rounded-lg overflow-hidden bg-primary/10 ring-1 ring-primary/20 mb-3">
                          {p.image_url ? (
                            <img
                              src={p.image_url}
                              alt={p.playlist_name}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <ListMusic className="h-5 w-5 text-primary" />
                            </div>
                          )}
                          <span className="absolute top-2 left-2 text-[9px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/90 text-primary-foreground">
                            Curador
                          </span>
                          {g.songsInside.length > 0 && (
                            <span className="absolute bottom-2 right-2 text-[9px] font-semibold px-2 py-0.5 rounded-full bg-background/85 backdrop-blur text-foreground/80 ring-1 ring-border/60">
                              {g.songsInside.length} já dentro
                            </span>
                          )}
                        </div>
                        <div className="text-[12px] font-medium leading-tight line-clamp-2 group-hover:text-primary transition-colors">
                          {p.playlist_name}
                        </div>
                        {p.followers !== null && (
                          <div className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
                            {formatPlays(p.followers)} seguidores
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )
            )}
          </CardContent>
        </Card>

        {/* Modal: playlists baseline de uma música */}
        <Dialog open={!!baseSongModalId} onOpenChange={(o) => !o && setBaseSongModalId(null)}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3">
                {baseModalGroup?.song?.song_cover_url && (
                  <img
                    src={baseModalGroup.song.song_cover_url}
                    alt=""
                    className="w-10 h-10 rounded-lg object-cover ring-1 ring-border"
                  />
                )}
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold leading-tight truncate">
                    {baseModalGroup?.song?.song_name ?? deal.song_name}
                  </div>
                  {(baseModalGroup?.song?.song_artist ?? deal.song_artist) && (
                    <div className="text-[12px] font-normal text-muted-foreground truncate">
                      {baseModalGroup?.song?.song_artist ?? deal.song_artist}
                    </div>
                  )}
                </div>
              </DialogTitle>
              <DialogDescription>
                {baseModalGroup?.playlists.length ?? 0} playlists em que a música já está antes da campanha
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5 overflow-y-auto pr-1 -mr-1 pb-2">
              {baseModalGroup?.playlists.map((p) => (
                <a
                  key={p.id}
                  href={p.spotify_url}
                  target="_blank"
                  rel="noreferrer"
                  className="group nx-subcard-hover flex items-center gap-3 p-2.5"
                >
                  <div className="relative w-11 h-11 rounded-md overflow-hidden bg-muted/60 ring-1 ring-border/40 shrink-0">
                    {p.image_url ? (
                      <img
                        src={p.image_url}
                        alt={p.playlist_name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ListMusic className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium leading-tight truncate group-hover:text-primary transition-colors">
                      {p.playlist_name}
                    </div>
                    {p.followers !== null && (
                      <div className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
                        {formatPlays(p.followers)} seguidores
                      </div>
                    )}
                  </div>
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/60 group-hover:text-primary transition-colors shrink-0" />
                </a>
              ))}
              {baseModalGroup && baseModalGroup.playlists.length === 0 && (
                <div className="py-8 text-center text-[12px] text-muted-foreground">
                  Nenhuma playlist registrada para esta música.
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Modal: músicas da campanha já presentes em uma playlist do curador */}
        <Dialog open={!!curatorPlaylistModalKey} onOpenChange={(o) => !o && setCuratorPlaylistModalKey(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3">
                {curatorModalGroup?.sample.image_url && (
                  <img
                    src={curatorModalGroup.sample.image_url}
                    alt=""
                    className="w-10 h-10 rounded-lg object-cover ring-1 ring-border"
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
              </DialogTitle>
              <DialogDescription>
                Músicas da campanha já presentes nesta playlist antes do início
              </DialogDescription>
            </DialogHeader>
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
                  Nenhuma música da campanha estava nesta playlist antes do início.
                </div>
              )}
            </div>
            {curatorModalGroup?.sample.spotify_url && (
              <a
                href={curatorModalGroup.sample.spotify_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-1.5 text-[12px] text-primary hover:underline mt-2"
              >
                Abrir no Spotify <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </DialogContent>
        </Dialog>

        {/* Adicionar playlist — bloco de ação principal */}
        <Card className="nx-card !p-0 border-border">
          <CardContent className="p-5 sm:p-6 space-y-5">
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight">Adicionar playlist</h2>
              <p className="text-[12px] text-muted-foreground mt-1.5 leading-snug">
                Cole o link de uma playlist do Spotify ou importe um lote em planilha
              </p>
            </div>
            <Input
              placeholder="https://open.spotify.com/playlist/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={submitting || importing}
              className="h-10 text-[14px] px-4 rounded-xl bg-[hsl(var(--elevated))] ring-1 ring-border/50 border-0 focus-visible:ring-2 focus-visible:ring-primary/40"
            />
            <Button
              onClick={handleAdd}
              disabled={submitting || importing || !url.trim()}
              className="w-full h-10 text-[14px] font-semibold rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 hover:shadow-[0_8px_24px_-8px_hsl(141_76%_48%_/_0.5)] transition-all duration-200"
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
            <div className="grid grid-cols-2 gap-4 px-2">
              <Button
                type="button"
                variant="ghost"
                className="h-10 w-full px-4 text-[13px] rounded-xl bg-muted/40 ring-1 ring-border hover:bg-border hover:ring-border [&>svg]:shrink-0 truncate"
                onClick={() => fileInputRef.current?.click()}
                disabled={submitting || importing}
              >
                {importing ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                <span className="truncate">Importar</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-10 w-full px-4 text-[13px] rounded-xl bg-muted/40 ring-1 ring-border hover:bg-border hover:ring-border [&>svg]:shrink-0 truncate"
                onClick={handleDownloadTemplate}
                disabled={importing}
              >
                <Download className="h-4 w-4 mr-2" />
                <span className="truncate"><span className="sm:hidden">Modelo</span><span className="hidden sm:inline">Baixar modelo</span></span>
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground/80 text-center pt-1 leading-relaxed">
              Aceita .xlsx, .xls ou .csv · até 200 playlists
              <br />
              <span className="opacity-70">Use o modelo para garantir o formato correto</span>
            </p>
          </CardContent>
        </Card>


        {/* Histórico de prints (apenas os enviados pelo curador) */}
        {(() => {
          const curatorLogs = visibleLogs.filter((l) => !l.is_baseline);
          return (
            <Card className="nx-card !p-0 border-border">
              <CardContent className="p-5 sm:p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-[15px] font-semibold tracking-tight">Histórico</h2>
                  <span className="text-[12px] text-muted-foreground">
                    {curatorLogs.length} {curatorLogs.length === 1 ? "registro" : "registros"}
                  </span>
                </div>
                {curatorLogs.length === 0 ? (
                  <div className="py-10 flex flex-col items-center text-center gap-3.5">
                    <div className="h-12 w-12 rounded-2xl bg-[hsl(var(--elevated))] border border-border/60 flex items-center justify-center shadow-[0_8px_24px_-12px_rgba(0,0,0,0.5)]">
                      <ListMusic className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div className="space-y-1 max-w-xs">
                      <div className="text-[14px] font-semibold text-foreground">
                        Nenhum print enviado ainda
                      </div>
                      <div className="text-[12px] text-muted-foreground leading-relaxed">
                        Envie seu primeiro print para começar o acompanhamento
                      </div>
                    </div>
                  </div>
                ) : (
                  <ul className="space-y-2 max-h-[70vh] sm:max-h-[480px] overflow-y-auto pr-1 -mr-1 scroll-smooth [mask-image:linear-gradient(to_bottom,black_calc(100%-32px),transparent)]">
                    {[...curatorLogs].reverse().map((log, idx, arr) => {
                      const prev = arr[idx + 1];
                      const delta = prev
                        ? Number(log.total_plays) - Number(prev.total_plays)
                        : 0;
                      const deltaPositive = delta >= 0;
                      const logSong = log.song_id
                        ? songs.find((s) => s.id === log.song_id)
                        : null;
                      const cover =
                        logSong?.song_cover_url ?? deal?.song_cover_url ?? null;
                      const songName =
                        logSong?.song_name ?? deal?.song_name ?? "Música";
                      const linkedCount = playlists.filter((p) => {
                        if (p.deal_id !== log.deal_id) return false;
                        if (log.song_id && p.song_id) {
                          return p.song_id === log.song_id;
                        }
                        return true;
                      }).length;

                      return (
                        <li key={log.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedLogId(log.id)}
                            className="w-full text-left nx-subcard-hover p-3 flex items-center gap-3"
                          >
                            {cover ? (
                              <img
                                src={cover}
                                alt=""
                                className="h-12 w-12 rounded-lg object-cover shrink-0 ring-1 ring-border/40"
                              />
                            ) : (
                              <div className="h-12 w-12 rounded-lg bg-muted/60 flex items-center justify-center shrink-0">
                                <Music2 className="h-4 w-4 text-muted-foreground" />
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="text-[13px] font-semibold truncate leading-tight">
                                {songName}
                              </div>
                              <div className="text-[11px] text-muted-foreground mt-0.5">
                                {formatDate(log.created_at)}
                                {linkedCount > 0 && ` · ${linkedCount} playlist${linkedCount > 1 ? "s" : ""}`}
                                {log.print_urls && log.print_urls.length > 0 && ` · ${log.print_urls.length} print${log.print_urls.length > 1 ? "s" : ""}`}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-[14px] font-bold tabular-nums leading-tight">
                                {Number(log.total_plays).toLocaleString("pt-BR")}
                              </div>
                              {prev ? (
                                <div
                                  className={cn(
                                    "text-[11px] font-semibold tabular-nums mt-0.5",
                                    deltaPositive ? "text-success" : "text-destructive",
                                  )}
                                >
                                  {deltaPositive ? "+" : "−"}
                                  {Math.abs(delta).toLocaleString("pt-BR")}
                                </div>
                              ) : (
                                <div className="text-[10px] text-muted-foreground mt-0.5">
                                  plays
                                </div>
                              )}
                            </div>
                            <ChevronRight className="h-4 w-4 text-muted-foreground/60 shrink-0" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })()}

        {/* Footer */}
        <footer className="pt-6 pb-4 flex flex-col items-center justify-center gap-1.5 text-center">
          <div className="text-[11px] text-muted-foreground/70">
            © {new Date().getFullYear()} <span className="text-foreground/80 font-medium">NexEngine</span>
          </div>
          <div className="text-[11px] text-muted-foreground/60 max-w-xs leading-snug">
            Infraestrutura para distribuição e inteligência musical
          </div>
          <div className="flex items-center justify-center gap-2 text-[11px] text-muted-foreground/60 mt-1">
            <a
              href="mailto:suporte@nexengine.app"
              className="hover:text-foreground transition-colors"
            >
              Suporte
            </a>
            <span className="text-muted-foreground/30">•</span>
            <a href="/termos" className="hover:text-foreground transition-colors">
              Termos
            </a>
            <span className="text-muted-foreground/30">•</span>
            <a href="/privacidade" className="hover:text-foreground transition-colors">
              Privacidade
            </a>
          </div>
        </footer>
      </div>
      </div>

      {/* Modal sobreposto: detalhe do registro de print */}
      <DealLogDetailDialog
        open={selectedLogId !== null}
        log={
          (selectedLogId
            ? logs.find((l) => l.id === selectedLogId) ?? null
            : null) as any
        }
        prevLog={(() => {
          if (!selectedLogId) return null;
          const curatorLogs = logs.filter((l) => !l.is_baseline);
          const reversed = [...curatorLogs].reverse();
          const idx = reversed.findIndex((l) => l.id === selectedLogId);
          return (idx >= 0 ? reversed[idx + 1] ?? null : null) as any;
        })()}
        song={(() => {
          const log = selectedLogId
            ? logs.find((l) => l.id === selectedLogId)
            : null;
          if (!log?.song_id) return null;
          return (songs.find((s) => s.id === log.song_id) ?? null) as any;
        })()}
        fallbackSongName={deal?.song_name}
        fallbackSongCover={deal?.song_cover_url ?? null}
        fallbackArtist={deal?.song_artist ?? null}
        playlists={playlists as any}
        onClose={() => setSelectedLogId(null)}
      />
    </div>
  );
}
