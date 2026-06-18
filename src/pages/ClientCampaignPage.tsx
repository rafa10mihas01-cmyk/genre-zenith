// ClientCampaignPage — painel público SOMENTE LEITURA para o CLIENTE final
// Acesso: /campanha/:token (token separado do link do curador)
// Toda a sanitização está no edge get-client-campaign-public.
// Layout espelha CuratorPage (container, atmosfera verde, topbar, cards) —
// mas só com os dados visíveis ao cliente (sem upload, sem notificações).
import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useExternalSplash } from "@/hooks/useExternalSplash";
import { PageLoader } from "@/components/PageLoader";
import {
  TrendingUp,
  ListMusic,
  Music2,
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  Image as ImageIcon,
  ChevronRight,
} from "lucide-react";
import { PrintThumbs } from "@/components/playlist-deals/PrintThumbs";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { NexEngineLogo } from "@/components/NexEngineLogo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";
import { SpreadsheetUploadCard } from "@/components/client-portal/SpreadsheetUploadCard";

type SafeDeal = {
  campaign_name: string;
  song_name: string;
  song_artist: string | null;
  song_cover_url: string | null;
  smartlink_url: string | null;
  started_at: string | null;
  ends_at: string | null;
  last_update: string | null;
  status: "Em andamento" | "Acelerando" | "Meta batida" | "Finalizada";
};
type SafeProgress = {
  delivered: number;
  target: number;
  pct: number;
  last7_growth: number;
  last7_pct: number;
  days_elapsed: number;
  target_days: number;
  pace: "abaixo do esperado" | "normal" | "acelerando";
};
type SafeSong = {
  id: string;
  client_token: string;
  song_name: string;
  song_artist: string | null;
  song_cover_url: string | null;
  smartlink_url: string | null;
};
type SafePlaylist = {
  name: string;
  image_url: string | null;
  delivered: number;
  status: "Nova" | "Crescendo" | "Destaque" | "Estável";
  source?: "curator" | "engine";
  planned?: number;
};
type SafeSeriesPoint = { date: string; delivered: number };
type SafeSnapshotPlaylist = {
  playlist_id: string;
  playlist_name: string;
  image_url: string | null;
  plays: number;
};
type SafeSnapshotEntry = {
  captured_at: string;
  is_initial_capture: boolean;
  playlists_count: number;
  total_plays: number;
  print_url: string | null;
  print_urls: string[];
  playlists: SafeSnapshotPlaylist[];
};

function formatPlays(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "0";
  const v = Number(n);
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return Math.round(v).toString();
}
function formatFullPlays(n: number | null | undefined): string {
  if (n == null) return "0";
  return new Intl.NumberFormat("pt-BR").format(Math.round(Number(n)));
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
// Status visíveis ao cliente — reduzidos a 2 leituras humanas.
// O mapa interno (Nova/Crescendo/Destaque/Estável) é colapsado.
function clientPlaylistStatus(p: SafePlaylist): "entregando" | "aguardando" {
  if (p.status === "Nova" || p.delivered <= 0) return "aguardando";
  return "entregando";
}
const PLAYLIST_STATUS_STYLES: Record<"entregando" | "aguardando", string> = {
  "entregando": "bg-success/10 text-success border-success/20",
  "aguardando": "bg-muted text-muted-foreground border-border",
};
const PLAYLIST_STATUS_LABEL: Record<"entregando" | "aguardando", string> = {
  "entregando": "Entregando",
  "aguardando": "Aguardando atualização",
};

export default function ClientCampaignPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const onExternal = useExternalSplash();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deal, setDeal] = useState<SafeDeal | null>(null);
  const [progress, setProgress] = useState<SafeProgress | null>(null);
  const [series, setSeries] = useState<SafeSeriesPoint[]>([]);
  const [playlists, setPlaylists] = useState<SafePlaylist[]>([]);
  const [songs, setSongs] = useState<SafeSong[]>([]);
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
  const [snapshotHistory, setSnapshotHistory] = useState<SafeSnapshotEntry[]>([]);
  const [openSnapshotKey, setOpenSnapshotKey] = useState<string | null>(null);
  const [spreadsheetSource, setSpreadsheetSource] = useState(false);
  const [lastSpreadsheetUploadAt, setLastSpreadsheetUploadAt] = useState<string | null>(null);
  const [recentUploads, setRecentUploads] = useState<any[]>([]);
  const [campaignApproved, setCampaignApproved] = useState(false);


  const load = async () => {
    if (!token) return;
    setLoading(true);
    const { data, error: fnErr } = await supabase.functions.invoke(
      "get-client-campaign-public",
      { body: { client_token: token.trim() } },
    );
    if (fnErr || !data?.ok) {
      setError(data?.error || fnErr?.message || "not_found");
      setDeal(null);
      setProgress(null);
      setSeries([]);
      setPlaylists([]);
      setSongs([]);
      setSelectedSongId(null);
      setSnapshotHistory([]);
      setSpreadsheetSource(false);
      setRecentUploads([]);
    } else {
      setDeal(data.deal);
      setProgress(data.progress);
      setSeries(data.series ?? []);
      setPlaylists(data.playlists ?? []);
      setSongs(data.songs ?? []);
      setSelectedSongId(data.selected_song_id ?? null);
      setSnapshotHistory((data.snapshot_history ?? []) as SafeSnapshotEntry[]);
      setSpreadsheetSource(Boolean(data.spreadsheet_source));
      setLastSpreadsheetUploadAt(data.last_spreadsheet_upload_at ?? null);
      setRecentUploads(data.recent_uploads ?? []);
      setCampaignApproved(Boolean(data.campaign_approved));
      setError(null);

    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const hasMultipleSongs = songs.length > 1;
  const selectedSong = useMemo(
    () => (selectedSongId ? songs.find((s) => s.id === selectedSongId) ?? null : null),
    [selectedSongId, songs],
  );

  const handleSelectSong = (songToken: string) => {
    if (!songToken || songToken === token) return;
    navigate(`/campanha/${songToken}`);
  };

  const chartData = useMemo(() => {
    // Curva acumulada monotônica: nunca cai. Dia sem print = patamar horizontal
    // ("estável aguardando próximo print"), não queda. Mais honesto e calmante
    // do que plotar delta diário, que finge "queda" quando só faltou coleta.
    let running = 0;
    return series.map((p) => {
      const delta = Math.max(0, p.delivered || 0);
      running += delta;
      return {
        date: new Date(p.date).toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "short",
        }),
        plays: running,
      };
    });
  }, [series]);

  if (loading) {
    return <PageLoader />;
  }
  if (error || !deal || !progress) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <Card className="max-w-md w-full">
          <CardContent className="p-6 text-center space-y-3">
            <h1 className="text-lg font-semibold">Link inválido</h1>
            <p className="text-sm text-muted-foreground">
              Este link não existe ou foi desativado. Entre em contato para
              receber um novo acesso.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const remaining = Math.max(0, progress.target - progress.delivered);
  const isDone = progress.target > 0 && progress.delivered >= progress.target;

  // Status — sem vermelho destrutivo. Só verde (ok) ou âmbar suave (warn).
  // Vermelho fica reservado pra erro real (campanha cancelada, dias sem print).
  const dailyAvg = progress.target_days > 0 ? progress.delivered / Math.max(1, progress.days_elapsed) : 0;
  const dailyGoal = progress.target_days > 0 ? progress.target / progress.target_days : 0;
  const dailyRatio = dailyGoal > 0 ? dailyAvg / dailyGoal : 1;
  const statusKey: "ok" | "warn" = isDone
    ? "ok"
    : dailyGoal === 0
    ? "ok"
    : dailyRatio >= 0.95
    ? "ok"
    : "warn";
  const humanLabel: string = isDone
    ? "Meta batida"
    : progress.pace === "acelerando"
      ? "Campanha acelerando"
      : statusKey === "warn"
        ? "Entregando abaixo do ritmo esperado"
        : progress.delivered > 0
          ? "Entrega estável"
          : "Campanha em andamento";
  const semaforo = statusKey === "ok"
    ? { dot: "bg-success", text: "text-success", ring: "ring-success/25", bg: "bg-success/[0.05]", label: humanLabel }
    : { dot: "bg-warning", text: "text-warning", ring: "ring-warning/25", bg: "bg-warning/[0.05]", label: humanLabel };

  return (
    <div className="relative min-h-screen bg-background py-8 sm:py-10 overflow-hidden">
      {/* Atmosfera verde — suave e difusa (igual CuratorPage) */}
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
          {/* Topbar — compacto, igual CuratorPage */}
          <div className="flex items-center justify-between gap-3 py-2 border-b border-border/50">
            <div className="flex items-center gap-2.5 min-w-0">
              <NexEngineLogo variant="mark" size={20} />
              <div className="min-w-0">
                <div className="text-[12.5px] font-semibold tracking-tight leading-tight truncate">
                  {deal.song_artist || "Cliente"}
                </div>
                <div className="text-[10px] text-muted-foreground/60 mt-0.5 leading-none truncate">
                  Acompanhamento da campanha
                </div>
              </div>
            </div>
            <div className="flex items-center gap-0.5 rounded-lg border border-border/40 bg-card/40 backdrop-blur-sm px-1 py-0.5">
              <ThemeToggle />
            </div>
          </div>

          {/* Header — Campanha + identidade + semáforo */}
          <Card className="nx-card nx-card-glow !p-0 overflow-hidden border-border">
            <CardContent className="p-5 sm:p-6 pt-5 sm:pt-6 md:pt-6 space-y-6">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/80">
                  Campanha
                </span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 text-[11px] font-medium",
                    semaforo.text,
                  )}
                >
                  <span className="relative flex h-1.5 w-1.5">
                    <span
                      className={cn(
                        "absolute inline-flex h-full w-full rounded-full opacity-75",
                        semaforo.dot,
                        !isDone && "animate-ping",
                      )}
                    />
                    <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", semaforo.dot)} />
                  </span>
                  {semaforo.label}
                </span>
              </div>



              {/* Identidade da música */}
              {(() => {
                const headerCover = selectedSong?.song_cover_url ?? deal.song_cover_url;
                const headerName = selectedSong?.song_name ?? deal.song_name;
                const headerArtist = selectedSong?.song_artist ?? deal.song_artist;
                return (
                  <>
                    <div className="flex items-center gap-4">
                      {headerCover ? (
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
                            loading="eager"
                          />
                        </div>
                      ) : (
                        <div className="w-[72px] h-[72px] rounded-xl bg-muted shrink-0 flex items-center justify-center ring-1 ring-border">
                          <Music2 className="h-6 w-6 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70 mb-1 inline-flex items-center gap-2">
                          {selectedSong ? "Música selecionada" : "Música"}
                        </div>
                        <h1 className="text-[17px] sm:text-[18px] font-semibold leading-tight tracking-tight truncate">
                          {headerName}
                        </h1>
                        {headerArtist && (
                          <p className="text-[12px] text-muted-foreground truncate mt-0.5 leading-snug">
                            {headerArtist}
                          </p>
                        )}
                        <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-muted/40 ring-1 ring-border px-2 py-0.5 text-[10px] text-muted-foreground tabular-nums max-w-full">
                          <CalendarDays className="h-3 w-3 shrink-0 text-muted-foreground/80" />
                          <span className="uppercase tracking-wider text-muted-foreground/70 text-[9px]">Janela</span>
                          <span className="text-foreground/90 truncate">
                            {formatShortDate(deal.started_at)} → {formatShortDate(deal.ends_at)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="h-px bg-border" />

                    {/* HERO — número neutro + microcopy temporal + frase humana */}
                    <div className={cn("rounded-xl p-4 ring-1", semaforo.bg, semaforo.ring)}>
                      <div className="flex items-baseline gap-1.5 flex-wrap">
                        <span className="text-[30px] sm:text-[36px] font-bold tabular-nums leading-none tracking-tight text-foreground">
                          {formatFullPlays(progress.delivered)}
                        </span>
                        <span className="text-[16px] sm:text-[18px] font-semibold tabular-nums text-muted-foreground leading-none">
                          / {formatFullPlays(progress.target)}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        Plays entregues desde o início da campanha
                      </p>
                      <div className="mt-3 h-1 rounded-full bg-background/40 overflow-hidden">
                        <div
                          className={cn("h-full rounded-full transition-all duration-500", semaforo.dot)}
                          style={{ width: `${Math.min(100, progress.pct)}%` }}
                        />
                      </div>
                      <div className="mt-2.5 flex items-center justify-between gap-3 flex-wrap">
                        <span className={cn("inline-flex items-center gap-1.5 text-[12px] font-medium", semaforo.text)}>
                          <span className={cn("h-1.5 w-1.5 rounded-full", semaforo.dot)} />
                          {semaforo.label}
                        </span>
                        {progress.last7_growth > 0 && (
                          <span className="text-[10.5px] uppercase tracking-wider inline-flex items-center gap-1 text-muted-foreground tabular-nums">
                            <TrendingUp className="h-3 w-3" />
                            +{formatPlays(progress.last7_growth)} em 7d
                          </span>
                        )}
                      </div>
                    </div>


                    {(deal.smartlink_url || selectedSong?.smartlink_url) && (
                      <a
                        href={selectedSong?.smartlink_url ?? deal.smartlink_url ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => onExternal()}
                        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground bg-muted/40 ring-1 ring-border hover:ring-border hover:bg-muted/60 transition-colors"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Abrir no Spotify
                      </a>
                    )}
                  </>
                );
              })()}
            </CardContent>
          </Card>

          {/* Músicas da campanha — filtro visual (espelha CuratorPage) */}
          {hasMultipleSongs && (
            <Card className="nx-card nx-card-glow !p-0 border-border">
              <CardContent className="p-5 sm:p-6 pt-7 sm:pt-8 md:pt-8 space-y-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-[15px] font-semibold inline-flex items-center gap-2 tracking-tight">
                      <ListMusic className="h-4 w-4 text-muted-foreground" />
                      Músicas desta campanha
                    </h2>
                    <p className="text-[12px] text-muted-foreground mt-1.5 leading-snug">
                      Toque em uma música para ver seus dados
                    </p>
                  </div>
                  <span className="text-[12px] text-muted-foreground shrink-0 tabular-nums">
                    {songs.length} músicas
                  </span>
                </div>

                <ul className="space-y-2 max-h-[280px] overflow-y-auto pr-1 -mr-1 scroll-smooth">
                  {songs.map((s) => {
                    const isSelected = s.id === selectedSongId
                      || (selectedSongId == null && s.client_token === token);
                    return (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => handleSelectSong(s.client_token)}
                          className={cn(
                            "w-full text-left px-3 py-2.5 transition-all",
                            isSelected ? "nx-subcard ring-1 ring-primary/40 !border-primary/40" : "nx-subcard-hover",
                          )}
                          aria-pressed={isSelected}
                        >
                          <div className="flex items-center gap-3">
                            {s.song_cover_url ? (
                              <img
                                src={s.song_cover_url}
                                alt={s.song_name}
                                className="w-9 h-9 rounded-md object-cover ring-1 ring-border shrink-0"
                                loading="lazy"
                              />
                            ) : (
                              <div className="w-9 h-9 rounded-md bg-muted shrink-0 flex items-center justify-center">
                                <Music2 className="h-4 w-4 text-muted-foreground" />
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="text-[13.5px] font-medium leading-tight truncate">
                                {s.song_name}
                              </div>
                              {s.song_artist && (
                                <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                                  {s.song_artist}
                                </div>
                              )}
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

          {/* Linha discreta — só Playlists ativas + Última atualização */}
          {(() => {
            const activeCount = playlists.length;
            const lastUpdateRelative = (() => {
              if (!deal.last_update) return "—";
              const diffMs = Date.now() - new Date(deal.last_update).getTime();
              if (diffMs < 0) return "agora";
              const mins = Math.floor(diffMs / 60000);
              if (mins < 1) return "agora";
              if (mins < 60) return `há ${mins} min`;
              const hrs = Math.floor(mins / 60);
              if (hrs < 24) return `há ${hrs}h`;
              const days = Math.floor(hrs / 24);
              return `há ${days}d`;
            })();
            return (
              <div className="flex items-center justify-between gap-3 px-1 text-[11.5px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <ListMusic className="h-3.5 w-3.5" />
                  <span className="tabular-nums text-foreground/85 font-medium">{activeCount}</span>
                  <span>{activeCount === 1 ? "playlist ativa" : "playlists ativas"}</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Atualizado {lastUpdateRelative}</span>
                </span>
              </div>
            );
          })()}

          {/* Gráfico — evolução */}
          {chartData.length > 1 && (
            <Card className="nx-card nx-card-glow !p-0 border-border">
                <CardContent className="p-5 sm:p-6 pt-8 sm:pt-9 space-y-5">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <h2 className="text-[15px] font-semibold inline-flex items-center gap-2 tracking-tight">
                      <TrendingUp className="h-4 w-4 text-muted-foreground" />
                      Evolução da campanha
                    </h2>
                    <p className="text-[12px] text-muted-foreground mt-1 leading-snug">
                      Plays acumulados ao longo do tempo
                    </p>
                  </div>
                </div>
                <div className="h-[220px] sm:h-[260px] w-full -mx-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={chartData}
                      margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="g_plays" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="hsl(var(--border))"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                        axisLine={false}
                        tickLine={false}
                        minTickGap={24}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => formatPlays(v as number)}
                        width={40}
                      />
                      <ReTooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 12,
                          fontSize: 12,
                        }}
                        labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                        formatter={(v: number) => [formatFullPlays(v), "Plays"]}
                      />
                      {/* Linha de meta só aparece quando já passou de 20% — antes disso parece inalcançável */}
                      {progress.target > 0 && progress.pct >= 20 && (
                        <ReferenceLine
                          y={progress.target}
                          stroke="hsl(var(--primary))"
                          strokeDasharray="4 4"
                          strokeOpacity={0.35}
                          label={{
                            value: "Meta",
                            position: "right",
                            fill: "hsl(var(--primary))",
                            fontSize: 10,
                            fillOpacity: 0.6,
                          }}
                        />
                      )}
                      <Area
                        type="monotone"
                        dataKey="plays"
                        stroke="hsl(var(--primary))"
                        strokeWidth={1.25}
                        fill="url(#g_plays)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Playlists monitoradas */}
          {playlists.length > 0 ? (
            <Card className="nx-card nx-card-glow !p-0 border-border">
              <CardContent className="p-5 sm:p-6 pt-8 sm:pt-9 space-y-5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <h2 className="text-[15px] font-semibold inline-flex items-center gap-2 tracking-tight">
                      <ListMusic className="h-4 w-4 text-muted-foreground" />
                      Playlists monitoradas
                    </h2>
                    <p className="text-[12px] text-muted-foreground mt-1 leading-snug">
                      Playlists que estão entregando plays para a campanha
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary bg-primary/10 ring-1 ring-primary/20 rounded-full px-2.5 py-1 tabular-nums shrink-0">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-75 animate-ping" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
                    </span>
                    {playlists.length} ativas
                  </span>
                </div>

                <div className="flex items-start gap-2 rounded-xl bg-[hsl(var(--elevated))] border border-border/60 px-3 py-2.5">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5 text-primary" />
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Atualizado automaticamente a partir dos prints enviados pelo curador. Esta página é apenas de leitura.
                  </p>
                </div>

                <ul className="space-y-2 max-h-[420px] overflow-y-auto pr-1 nx-scroll">
                  {playlists.map((p, i) => (
                    <li
                      key={`${p.name}-${i}`}
                      className="nx-subcard !p-3 transition-all hover:!border-primary/30 hover:bg-[hsl(var(--hover))]"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="relative h-11 w-11 rounded-md overflow-hidden bg-muted ring-1 ring-border shrink-0">
                          {p.image_url ? (
                            <img
                              src={p.image_url}
                              alt={p.name}
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="h-full w-full flex items-center justify-center">
                              <ListMusic className="h-4 w-4 text-muted-foreground" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13.5px] font-medium truncate" title={p.name}>
                            {p.name}
                          </p>
                          {(() => {
                            const st = clientPlaylistStatus(p);
                            const isEngine = p.source === "engine";
                            return (
                              <div className="flex items-center gap-1.5 mt-1 min-w-0 flex-wrap">
                                <span
                                  className={cn(
                                    "text-[10px] font-medium px-1.5 py-0.5 rounded border whitespace-nowrap",
                                    PLAYLIST_STATUS_STYLES[st],
                                  )}
                                >
                                  {PLAYLIST_STATUS_LABEL[st]}
                                </span>
                                <span
                                  className={cn(
                                    "text-[9.5px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border whitespace-nowrap",
                                    isEngine
                                      ? "text-primary border-primary/40 bg-primary/10"
                                      : "text-muted-foreground border-border bg-[hsl(var(--elevated))]",
                                  )}
                                >
                                  {isEngine ? "Engine" : "Curador"}
                                </span>
                              </div>
                            );
                          })()}
                        </div>
                        <div className="text-right shrink-0">
                          {p.delivered > 0 ? (
                            <>
                              <div className="text-[14px] font-semibold tabular-nums text-foreground leading-none">
                                +{formatPlays(p.delivered)}
                              </div>
                              <div className="text-[9px] uppercase tracking-wider text-muted-foreground mt-1">
                                entregues
                              </div>
                            </>
                          ) : (
                            <div className="text-[10.5px] text-muted-foreground/80 italic leading-snug max-w-[120px]">
                              Aguardando primeiro print
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : (
            <Card className="nx-card nx-card-glow !p-0 border-border">
              <CardContent className="p-8 text-center space-y-2">
                <div className="mx-auto h-12 w-12 rounded-2xl bg-muted/40 ring-1 ring-border flex items-center justify-center">
                  <ListMusic className="h-5 w-5 text-muted-foreground" />
                </div>
                <p className="text-[14px] font-semibold">Aguardando primeira coleta</p>
                <p className="text-[12px] text-muted-foreground">
                  As playlists monitoradas aparecerão aqui assim que o curador iniciar a entrega.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Upload de planilha — só quando o deal não tem Spotify conectado */}
          {spreadsheetSource && (
            <SpreadsheetUploadCard
              clientToken={token!}
              lastUploadAt={lastSpreadsheetUploadAt}
              recentUploads={recentUploads}
              onUploaded={load}
              approved={campaignApproved}
            />
          )}


          {/* Histórico de prints — só leitura, sem links externos pra Spotify */}
          {snapshotHistory.length > 0 && (
            <Card className="nx-card nx-card-glow !p-0 border-border">
              <CardContent className="p-5 sm:p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <h2 className="text-[15px] font-semibold tracking-tight">Histórico de prints</h2>
                    <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                      Prints enviados pelo curador a partir do Spotify for Artists
                    </p>
                  </div>
                  <span className="text-[12px] text-muted-foreground shrink-0">
                    {snapshotHistory.length} {snapshotHistory.length === 1 ? "registro" : "registros"}
                  </span>
                </div>

                {(() => {
                  const ordered = [...snapshotHistory];
                  return (
                    <div className="max-h-[600px] overflow-y-auto pr-1 -mr-1 scroll-smooth space-y-2.5 nx-scroll">
                      {ordered.map((entry, idx) => {
                        const prev = ordered[idx - 1];
                        const delta = prev
                          ? Number(entry.total_plays) - Number(prev.total_plays)
                          : 0;
                        const dt = new Date(entry.captured_at);
                        const dayLabel = dt.toLocaleDateString("pt-BR", {
                          weekday: "short",
                          day: "2-digit",
                          month: "2-digit",
                        });
                        const time = dt.toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        });
                        const prints = (entry.print_urls && entry.print_urls.length > 0)
                          ? entry.print_urls
                          : (entry.print_url ? [entry.print_url] : []);
                        const snapPlaylists = entry.playlists ?? [];
                        const coverUrl =
                          selectedSong?.song_cover_url ??
                          songs[0]?.song_cover_url ??
                          deal?.song_cover_url ??
                          null;
                        const snapshotKey = `${entry.captured_at}-${idx}`;
                        return (
                          <details
                            key={snapshotKey}
                            open={openSnapshotKey === snapshotKey}
                            onToggle={(event) => {
                              const isOpen = (event.currentTarget as HTMLDetailsElement).open;
                              setOpenSnapshotKey((current) => {
                                if (isOpen) return snapshotKey;
                                return current === snapshotKey ? null : current;
                              });
                            }}
                            className="group/snap nx-subcard p-0 overflow-hidden [&[open]>summary_.snapchev]:rotate-90"
                          >
                            <summary className="cursor-pointer list-none p-3.5 flex items-center gap-3 hover:bg-[hsl(var(--hover))] transition-colors">
                              {coverUrl ? (
                                <img
                                  src={coverUrl}
                                  alt={`Capa de ${dayLabel}`}
                                  loading="lazy"
                                  className="h-11 w-11 rounded-lg object-cover ring-1 ring-border shrink-0 bg-muted/40"
                                />
                              ) : (
                                <div className="h-11 w-11 rounded-lg bg-muted/40 ring-1 ring-border flex items-center justify-center shrink-0">
                                  <ImageIcon className="h-4 w-4 text-muted-foreground" />
                                </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="text-[13px] font-semibold leading-tight capitalize">
                                  {dayLabel} · {time}
                                </div>
                                <div className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
                                  {entry.is_initial_capture ? "Início da medição" : "Coleta"} ·{" "}
                                  {entry.playlists_count}{" "}
                                  {entry.playlists_count === 1 ? "playlist" : "playlists"}
                                  {prints.length > 0 && (
                                    <>
                                      {" · "}
                                      {prints.length} {prints.length === 1 ? "print" : "prints"}
                                    </>
                                  )}
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <div className="text-[13px] font-bold tabular-nums leading-tight">
                                  {Number(entry.total_plays).toLocaleString("pt-BR")}
                                </div>
                                <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground/80 mt-0.5">
                                  total da playlist
                                </div>
                                {prev && delta !== 0 && (
                                  <div className="mt-1.5">
                                    <div
                                      className={cn(
                                        "text-[11px] font-semibold tabular-nums leading-none",
                                        delta >= 0 ? "text-success" : "text-warning",
                                      )}
                                    >
                                      {delta >= 0 ? "+" : "−"}
                                      {Math.abs(delta).toLocaleString("pt-BR")}
                                    </div>
                                    <div className="text-[9.5px] text-muted-foreground/80 mt-0.5 leading-tight">
                                      {delta >= 0
                                        ? "novos plays desde o último print"
                                        : "Spotify revisou plays"}
                                    </div>
                                  </div>
                                )}
                              </div>
                              <ChevronRight className="snapchev h-4 w-4 text-muted-foreground shrink-0 transition-transform ml-1" />
                            </summary>

                            <div className="border-t border-border/60 px-4 py-4 bg-[hsl(var(--background))]/40 space-y-4">
                              {prints.length > 0 && (
                                <div>
                                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                                    Prints ({prints.length})
                                  </div>
                                  <PrintThumbs urls={prints} size="md" />
                                </div>
                              )}

                              <div>
                                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                                  Playlists do registro ({snapPlaylists.length})
                                </div>
                                {snapPlaylists.length === 0 ? (
                                  <div className="text-[12px] text-muted-foreground italic py-2">
                                    Nenhuma playlist vinculada a este registro.
                                  </div>
                                ) : (
                                  <ul className="space-y-1.5">
                                    {snapPlaylists.map((pl) => (
                                      <li
                                        key={pl.playlist_id}
                                        className="flex items-center gap-3 rounded-md border border-border/40 bg-[hsl(var(--elevated))]/40 px-2.5 py-2"
                                      >
                                        {pl.image_url ? (
                                          <img
                                            src={pl.image_url}
                                            alt=""
                                            className="h-9 w-9 rounded-md object-cover shrink-0 ring-1 ring-border/50"
                                          />
                                        ) : (
                                          <div className="h-9 w-9 rounded-md bg-muted/40 flex items-center justify-center shrink-0">
                                            <Music2 className="h-4 w-4 text-muted-foreground" />
                                          </div>
                                        )}
                                        <div className="min-w-0 flex-1">
                                          <div className="text-[12.5px] font-medium leading-tight truncate">
                                            {pl.playlist_name}
                                          </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                          <div className="text-[12.5px] font-semibold tabular-nums leading-tight">
                                            {Number(pl.plays ?? 0).toLocaleString("pt-BR")}
                                          </div>
                                          <div className="text-[10px] text-muted-foreground">
                                            plays
                                          </div>
                                        </div>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  );
                })()}
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
