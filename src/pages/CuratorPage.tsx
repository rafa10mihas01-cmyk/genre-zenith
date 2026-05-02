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
} from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { cn } from "@/lib/utils";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { NexEngineLogo } from "@/components/NexEngineLogo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CuratorNotificationsBell } from "@/components/public/CuratorNotificationsBell";
import { PrintThumbs } from "@/components/playlist-deals/PrintThumbs";
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
  spotify_url: string;
  playlist_name: string;
  followers: number | null;
  is_baseline: boolean;
  added_at: string;
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
  const [baseOpen, setBaseOpen] = useState(false);
  const [curatorOpen, setCuratorOpen] = useState(true);
  // Fase 5 — filtro por música (null = todas)
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
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

    let todayPlays = 0;
    if (nonBase.length > 0) {
      const todayKey = new Date().toISOString().slice(0, 10);
      const lastBefore = [...sorted]
        .reverse()
        .find((l) => l.created_at.slice(0, 10) !== todayKey);
      const lastBeforeVal = lastBefore ? Number(lastBefore.total_plays) : baseline;
      todayPlays = Math.max(0, latest - lastBeforeVal);
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
      { body: { public_token: realToken, urls: [url.trim()] } },
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
        { body: { public_token: realToken, urls } },
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
    <div className="relative min-h-screen bg-background py-10 sm:py-14 overflow-hidden">
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
        <div className="max-w-xl md:max-w-2xl mx-auto space-y-7 sm:space-y-8">
        {/* Topbar — Logo + Tema + Sino de notificações */}
        <div className="flex items-center justify-between pb-4 sm:pb-2">
          <div className="w-9" aria-hidden />
          <NexEngineLogo variant="auto" size={28} />
          <div className="flex items-center gap-1">
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
          <CardContent className="p-7 sm:p-8 space-y-6">
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

            {/* Identidade: capa + música/curador */}
            <div className="flex items-center gap-4">
              {deal.song_cover_url ? (
                <div className="relative shrink-0">
                  <div
                    aria-hidden
                    className="absolute inset-0 -z-10 rounded-xl blur-xl opacity-50"
                    style={{ background: "rgba(29,185,84,0.35)" }}
                  />
                  <img
                    src={deal.song_cover_url}
                    alt={deal.song_name}
                    className="w-[72px] h-[72px] rounded-xl object-cover ring-1 ring-border"
                  />
                </div>
              ) : (
                <div className="w-[72px] h-[72px] rounded-xl bg-muted shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70 mb-1">
                  Música
                </div>
                <h1 className="text-[17px] sm:text-[18px] font-semibold leading-tight tracking-tight truncate">
                  {deal.song_name}
                </h1>
                <p className="text-[12px] text-muted-foreground truncate mt-0.5 leading-snug">
                  {deal.song_artist ? `${deal.song_artist} · ` : ""}Curador: {deal.curator_name}
                </p>
              </div>
            </div>

            {/* Divisor */}
            <div className="h-px bg-border" />

            {/* Briefing: meta · prazo · ritmo */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1">
                  Meta
                </div>
                <div className="text-[15px] font-semibold tabular-nums leading-none">
                  {formatPlays(stats.target)}
                  <span className="text-[11px] text-muted-foreground font-normal ml-1">plays</span>
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1">
                  Esta semana
                </div>
                <div className="text-[15px] font-semibold tabular-nums leading-none text-primary">
                  {stats.dailyGoal > 0 ? formatPlays(stats.weekRemaining) : "—"}
                  <span className="text-[11px] text-muted-foreground font-normal ml-1">no ciclo</span>
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1">
                  Progresso
                </div>
                <div className="text-[15px] font-semibold tabular-nums leading-none">
                  {stats.pct}
                  <span className="text-[11px] text-muted-foreground font-normal">%</span>
                </div>
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
              href={deal.song_spotify_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground bg-muted/40 ring-1 ring-border hover:ring-border hover:bg-muted/60 transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
              Abrir no Spotify
            </a>
          </CardContent>
        </Card>

        {/* Músicas da campanha — visível só quando há 2+ músicas no deal */}
        {songs.length > 1 && (
          <Card className="nx-card !p-0 border-border">
            <CardContent className="p-7 sm:p-8 space-y-5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[15px] font-semibold inline-flex items-center gap-2 tracking-tight">
                    <ListMusic className="h-4 w-4 text-muted-foreground" />
                    Músicas da campanha
                  </h2>
                  <p className="text-[12px] text-muted-foreground mt-1.5 leading-snug">
                    Cada música tem sua janela e meta individual
                  </p>
                </div>
                <span className="text-[12px] text-muted-foreground shrink-0 tabular-nums">
                  {songs.length} {songs.length === 1 ? "música" : "músicas"}
                </span>
              </div>

              <ul className="space-y-3">
                {songs.map((s) => {
                  // Logs/playlists individuais por música
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

                  // Status: aquecimento / ativo / concluído / aguardando
                  const startRef = s.started_at ?? deal.started_at ?? deal.created_at;
                  const startMs = startRef ? new Date(startRef).getTime() : null;
                  const ramp = Number(s.ramp_up_days ?? 5);
                  const daysSince = startMs
                    ? Math.floor((Date.now() - startMs) / (1000 * 60 * 60 * 24))
                    : 0;
                  const isDoneSong = target > 0 && earned >= target;
                  const inRampUp = startMs !== null && daysSince < ramp && !isDoneSong;

                  let statusLabel = "Ativa";
                  let statusColor = "text-primary";
                  if (isDoneSong) {
                    statusLabel = "Concluída";
                    statusColor = "text-primary";
                  } else if (inRampUp) {
                    const remaining = Math.max(1, ramp - daysSince);
                    statusLabel = `Aquecimento · ${remaining}d`;
                    statusColor = "text-warning";
                  } else if (!startMs) {
                    statusLabel = "Aguardando";
                    statusColor = "text-muted-foreground";
                  }

                  return (
                    <li
                      key={s.id}
                      className="rounded-xl bg-muted/40 ring-1 ring-border/50 p-4 hover:bg-muted/60 transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        {s.song_cover_url ? (
                          <img
                            src={s.song_cover_url}
                            alt={s.song_name}
                            className="w-12 h-12 rounded-lg object-cover ring-1 ring-border shrink-0"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-lg bg-muted shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <a
                                href={s.song_spotify_url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[13px] font-semibold leading-tight truncate hover:underline block"
                              >
                                {s.song_name}
                              </a>
                              {s.song_artist && (
                                <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                                  {s.song_artist}
                                </p>
                              )}
                            </div>
                            <span
                              className={cn(
                                "text-[10px] font-semibold uppercase tracking-wider shrink-0",
                                statusColor,
                              )}
                            >
                              {statusLabel}
                            </span>
                          </div>

                          {/* Linha de KPIs por música */}
                          <div className="grid grid-cols-3 gap-2 mt-3">
                            <div>
                              <div className="text-[9px] uppercase tracking-wider text-muted-foreground/70">
                                Meta
                              </div>
                              <div className="text-[12px] font-semibold tabular-nums">
                                {target > 0 ? formatPlays(target) : "—"}
                              </div>
                            </div>
                            <div>
                              <div className="text-[9px] uppercase tracking-wider text-muted-foreground/70">
                                Diário
                              </div>
                              <div className="text-[12px] font-semibold tabular-nums">
                                {Number(s.daily_goal ?? 0) > 0
                                  ? formatPlays(Number(s.daily_goal))
                                  : "—"}
                              </div>
                            </div>
                            <div>
                              <div className="text-[9px] uppercase tracking-wider text-muted-foreground/70">
                                Janela
                              </div>
                              <div className="text-[12px] font-semibold tabular-nums">
                                {s.started_at ? formatShortDate(s.started_at) : "—"}
                                {s.ends_at ? ` → ${formatShortDate(s.ends_at)}` : ""}
                              </div>
                            </div>
                          </div>

                          {/* Progresso individual */}
                          {target > 0 && (
                            <div className="mt-3 space-y-1.5">
                              <div className="h-1 rounded-full bg-muted/60 overflow-hidden">
                                <div
                                  className="h-full bg-primary rounded-full transition-all duration-500"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <div className="flex items-center justify-between text-[11px] tabular-nums">
                                <span className="text-foreground font-medium">
                                  {formatPlays(earned)} / {formatPlays(target)}
                                </span>
                                <span className="text-muted-foreground">{pct}%</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
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
            <CardContent className="p-7 sm:p-8 grid grid-cols-2 gap-6 divide-x divide-border">
              <div className="pr-2">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                  Plays totais hoje
                </div>
                <div className="text-[26px] font-bold tabular-nums text-foreground leading-none">
                  {formatPlays(stats.latest)}
                </div>
              </div>
              <div className="pl-6">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                  Hoje / combinado
                </div>
                <div className="text-[26px] font-bold tabular-nums leading-none">
                  <span className="text-primary">{formatPlays(stats.todayPlays)}</span>
                  <span className="text-muted-foreground text-[18px] font-semibold"> / {formatPlays(stats.dailyGoal)}</span>
                </div>
                {stats.dailyGoal > 0 && (
                  <div className="text-[11px] text-muted-foreground mt-2">
                    {stats.todayPct}% do combinado do dia
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Progresso da campanha */}
        <Card className="nx-card !p-0 border-border">
          <CardContent className="p-7 sm:p-8 space-y-6">
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
              <div className="rounded-xl bg-muted/40 ring-1 ring-border/50 p-4">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1.5 uppercase tracking-wider">
                  <Target className="h-3 w-3" />
                  Faltam
                </div>
                <div className="text-[18px] font-semibold tabular-nums leading-none">
                  {formatPlays(stats.remaining)}
                </div>
              </div>

              <div className="rounded-xl bg-muted/40 ring-1 ring-border/50 p-4">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1.5 uppercase tracking-wider">
                  <Clock className="h-3 w-3" />
                  Decorrido
                </div>
                <div className="text-[18px] font-semibold tabular-nums leading-none">
                  {stats.daysRunning} {stats.daysRunning === 1 ? "dia" : "dias"}
                </div>
              </div>

              <div className="rounded-xl bg-muted/40 ring-1 ring-border/50 p-4">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1.5 uppercase tracking-wider">
                  <Zap className="h-3 w-3 text-primary" />
                  Velocidade
                </div>
                <div className="text-[18px] font-semibold tabular-nums leading-none">
                  {stats.vel !== null ? `${formatPlays(stats.vel)}/dia` : "—"}
                </div>
              </div>

              <div className="rounded-xl bg-muted/40 ring-1 ring-border/50 p-4">
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
            <div className="rounded-xl bg-muted/40 ring-1 ring-border/50 p-4 space-y-2">
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

        {/* Playlists onde a música já está (baseline / pré-existentes) — colapsável */}
        {basePlaylists.length > 0 && (
          <Card className="nx-card !p-0 border-border">
            <CardContent className="p-7 sm:p-8 space-y-5">
              <button
                type="button"
                onClick={() => setBaseOpen((v) => !v)}
                className="w-full flex items-center justify-between gap-4 text-left"
                aria-expanded={baseOpen}
              >
                <div className="min-w-0 flex-1">
                  <h2 className="text-[15px] font-semibold inline-flex items-center gap-2 tracking-tight">
                    <ListMusic className="h-4 w-4 text-muted-foreground" />
                    Playlists em que a música já está
                  </h2>
                  <p className="text-[12px] text-muted-foreground mt-1.5 leading-snug">
                    Presença atual da faixa no catálogo
                  </p>
                </div>
                <span className="inline-flex items-center gap-2 text-[12px] text-muted-foreground shrink-0">
                  {basePlaylists.length} {basePlaylists.length === 1 ? "playlist" : "playlists"}
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 transition-transform duration-200",
                      baseOpen && "rotate-180",
                    )}
                  />
                </span>
              </button>

              {baseOpen && (
                <ul className="space-y-2 max-h-[60vh] sm:max-h-[360px] overflow-y-auto pr-1 -mr-1 scroll-smooth [mask-image:linear-gradient(to_bottom,black_calc(100%-32px),transparent)]">
                  {basePlaylists.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center justify-between gap-3 rounded-xl bg-muted/40 ring-1 ring-border/50 px-4 py-3 hover:bg-muted/60 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <a
                          href={p.spotify_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[13px] font-medium truncate hover:underline block leading-snug"
                        >
                          {p.playlist_name}
                        </a>
                        {p.followers !== null && (
                          <div className="text-[11px] text-muted-foreground mt-1 tabular-nums">
                            {formatPlays(p.followers)} seguidores
                          </div>
                        )}
                      </div>
                      <Badge variant="secondary" className="shrink-0 text-[10px] px-2 py-0 h-5 font-medium">
                        Inicial
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        {/* Playlists adicionadas pelo curador */}
        <Card className="nx-card !p-0 border-border">
          <CardContent className="p-7 sm:p-8 space-y-5">
            <button
              type="button"
              onClick={() => setCuratorOpen((v) => !v)}
              className="w-full flex items-center justify-between gap-4 text-left"
              aria-expanded={curatorOpen}
            >
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-semibold inline-flex items-center gap-2 tracking-tight">
                  <ListMusic className="h-4 w-4 text-muted-foreground" />
                  Suas playlists adicionadas
                </h2>
                <p className="text-[12px] text-muted-foreground mt-1.5 leading-snug">
                  Apenas as que você incluiu nesta curadoria
                </p>
              </div>
              <span className="inline-flex items-center gap-2 text-[12px] text-muted-foreground shrink-0">
                {curatorPlaylists.length} {curatorPlaylists.length === 1 ? "playlist" : "playlists"}
                <ChevronDown
                  className={cn(
                    "h-4 w-4 transition-transform duration-200",
                    curatorOpen && "rotate-180",
                  )}
                />
              </span>
            </button>

            {curatorOpen && (
              curatorPlaylists.length === 0 ? (
                <p className="text-[13px] text-muted-foreground py-6 text-center">
                  Nenhuma playlist adicionada ainda
                </p>
              ) : (
                <ul className="space-y-2 max-h-[60vh] sm:max-h-[360px] overflow-y-auto pr-1 -mr-1 scroll-smooth [mask-image:linear-gradient(to_bottom,black_calc(100%-32px),transparent)]">
                  {curatorPlaylists.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center justify-between gap-3 rounded-xl bg-muted/40 ring-1 ring-border/50 px-4 py-3 hover:bg-muted/60 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <a
                          href={p.spotify_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[13px] font-medium truncate hover:underline block leading-snug"
                        >
                          {p.playlist_name}
                        </a>
                        {p.followers !== null && (
                          <div className="text-[11px] text-muted-foreground mt-1 tabular-nums">
                            {formatPlays(p.followers)} seguidores
                          </div>
                        )}
                      </div>
                      <Badge className="bg-primary text-primary-foreground hover:bg-primary/90 shrink-0 text-[10px] px-2 py-0 h-5 border-0 font-semibold">
                        Nova
                      </Badge>
                    </li>
                  ))}
                </ul>
              )
            )}
          </CardContent>
        </Card>

        {/* Adicionar playlist — bloco de ação principal */}
        <Card className="nx-card !p-0 border-border">
          <CardContent className="p-7 sm:p-8 space-y-5">
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight">Adicionar playlist</h2>
              <p className="text-[12px] text-muted-foreground mt-1.5 leading-snug">
                Cole o link ou importe um lote em planilha
              </p>
            </div>
            <Input
              placeholder="https://open.spotify.com/playlist/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={submitting || importing}
              className="h-12 text-[14px] px-4 rounded-xl bg-muted/40 ring-1 ring-border/50 border-0 focus-visible:ring-2 focus-visible:ring-primary/40"
            />
            <Button
              onClick={handleAdd}
              disabled={submitting || importing || !url.trim()}
              className="w-full h-12 text-[14px] font-semibold rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
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
                className="h-12 w-full px-4 text-[13px] rounded-xl bg-muted/40 ring-1 ring-border hover:bg-border hover:ring-border [&>svg]:shrink-0 truncate"
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
                className="h-12 w-full px-4 text-[13px] rounded-xl bg-muted/40 ring-1 ring-border hover:bg-border hover:ring-border [&>svg]:shrink-0 truncate"
                onClick={handleDownloadTemplate}
                disabled={importing}
              >
                <Download className="h-4 w-4 mr-2" />
                <span className="truncate">Baixar modelo</span>
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground text-center pt-1">
              Aceita .xlsx, .xls ou .csv · até 200 playlists
            </p>
          </CardContent>
        </Card>


        {/* Histórico de prints (apenas os enviados pelo curador) */}
        {(() => {
          const curatorLogs = logs.filter((l) => !l.is_baseline);
          return (
            <Card className="nx-card !p-0 border-border">
              <CardContent className="p-7 sm:p-8 space-y-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-[15px] font-semibold tracking-tight">Histórico</h2>
                  <span className="text-[12px] text-muted-foreground">
                    {curatorLogs.length} {curatorLogs.length === 1 ? "registro" : "registros"}
                  </span>
                </div>
                {curatorLogs.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground py-6 text-center">
                    Nenhum print enviado ainda
                  </p>
                ) : (
                  <ul className="space-y-3 max-h-[70vh] sm:max-h-[480px] overflow-y-auto pr-1 -mr-1 scroll-smooth [mask-image:linear-gradient(to_bottom,black_calc(100%-32px),transparent)]">
                    {[...curatorLogs].reverse().map((log) => (
                      <li
                        key={log.id}
                        className="rounded-xl bg-muted/40 ring-1 ring-border/50 p-4 space-y-2.5 hover:bg-muted/60 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[15px] font-semibold tabular-nums">
                            {Number(log.total_plays).toLocaleString("pt-BR")} plays
                          </span>
                          <span className="text-[11px] text-muted-foreground shrink-0">
                            {formatDate(log.created_at)}
                          </span>
                        </div>
                        {log.note && (
                          <div className="text-[12px] text-muted-foreground leading-relaxed">{log.note}</div>
                        )}
                        {log.print_urls && log.print_urls.length > 0 && (
                          <PrintThumbs urls={log.print_urls} size="sm" />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })()}

        {/* Footer minimalista */}
        <div className="text-center pt-2 pb-4">
          <p className="text-[10px] text-muted-foreground">
            Powered by NexEngine
          </p>
        </div>
      </div>
      </div>
    </div>
  );
}
