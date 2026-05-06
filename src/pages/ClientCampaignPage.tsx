// ClientCampaignPage — painel público SOMENTE LEITURA para o CLIENTE final
// Acesso: /campanha/:token (token separado do link do curador)
// Toda a sanitização está no edge get-client-campaign-public.
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Loader2,
  TrendingUp,
  ListMusic,
  Music2,
  CalendarDays,
  CheckCircle2,
  Activity,
  Sparkles,
} from "lucide-react";
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
import { Progress } from "@/components/ui/progress";
import { NexEngineLogo } from "@/components/NexEngineLogo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";

type SafeDeal = {
  campaign_name: string;
  song_name: string;
  song_artist: string | null;
  song_cover_url: string | null;
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
type SafePlaylist = {
  name: string;
  image_url: string | null;
  delivered: number;
  status: "Nova" | "Crescendo" | "Destaque" | "Estável";
};
type SafeSeriesPoint = { date: string; delivered: number };

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

const STATUS_STYLES: Record<SafeDeal["status"], string> = {
  "Em andamento":
    "bg-primary/10 text-primary border border-primary/20",
  "Acelerando":
    "bg-primary/15 text-primary border border-primary/30",
  "Meta batida":
    "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30",
  "Finalizada":
    "bg-muted text-muted-foreground border border-border",
};

const PLAYLIST_STATUS_STYLES: Record<SafePlaylist["status"], string> = {
  "Nova": "bg-blue-500/10 text-blue-400 border-blue-500/20",
  "Crescendo": "bg-primary/10 text-primary border-primary/20",
  "Destaque": "bg-amber-500/10 text-amber-400 border-amber-500/20",
  "Estável": "bg-muted text-muted-foreground border-border",
};

const PACE_LABEL: Record<SafeProgress["pace"], { label: string; tone: string }> = {
  "abaixo do esperado": {
    label: "Ritmo abaixo do esperado",
    tone: "text-amber-400",
  },
  "normal": { label: "Ritmo normal", tone: "text-foreground" },
  "acelerando": { label: "Ritmo acelerando", tone: "text-primary" },
};

export default function ClientCampaignPage() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deal, setDeal] = useState<SafeDeal | null>(null);
  const [progress, setProgress] = useState<SafeProgress | null>(null);
  const [series, setSeries] = useState<SafeSeriesPoint[]>([]);
  const [playlists, setPlaylists] = useState<SafePlaylist[]>([]);

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
    } else {
      setDeal(data.deal);
      setProgress(data.progress);
      setSeries(data.series ?? []);
      setPlaylists(data.playlists ?? []);
      setError(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const chartData = useMemo(() => {
    return series.map((p) => ({
      date: new Date(p.date).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "short",
      }),
      plays: p.delivered,
    }));
  }, [series]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
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

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* TOPBAR PÚBLICA */}
      <header
        className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/70"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="mx-auto max-w-6xl flex items-center justify-between gap-3 px-4 sm:px-6 h-14">
          <div className="flex items-center gap-2 min-w-0">
            <NexEngineLogo size={28} variant="mark" className="shrink-0" />
            <span className="font-semibold text-[15px] truncate">NexEngine</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span
              className={cn(
                "text-[11px] font-medium px-2.5 py-1 rounded-full whitespace-nowrap",
                STATUS_STYLES[deal.status],
              )}
            >
              {deal.status}
            </span>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main
        className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 32px)" }}
      >
        {/* HERO — Capa + título da campanha */}
        <section className="flex items-center gap-4 sm:gap-5 min-w-0">
          <div className="relative h-16 w-16 sm:h-20 sm:w-20 rounded-2xl overflow-hidden bg-elevated border border-border shrink-0">
            {deal.song_cover_url ? (
              <img
                src={deal.song_cover_url}
                alt={deal.song_name}
                className="h-full w-full object-cover"
                loading="eager"
              />
            ) : (
              <div className="h-full w-full flex items-center justify-center">
                <Music2 className="h-7 w-7 text-muted-foreground" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-bold">
              Campanha
            </p>
            <h1 className="text-xl sm:text-3xl font-semibold tracking-tight leading-tight truncate">
              {deal.song_name}
            </h1>
            {deal.song_artist && (
              <p className="text-sm sm:text-base text-muted-foreground truncate">
                {deal.song_artist}
              </p>
            )}
          </div>
        </section>

        {/* CARD HERO — números grandes */}
        <Card className="overflow-hidden">
          <CardContent className="p-5 sm:p-8 space-y-5">
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                Plays entregues
              </span>
              <div className="flex items-end gap-2 sm:gap-3 flex-wrap min-w-0">
                <span className="text-4xl sm:text-6xl font-semibold tracking-tight leading-none tabular-nums">
                  {formatFullPlays(progress.delivered)}
                </span>
                <span className="text-sm sm:text-base text-muted-foreground pb-1 sm:pb-2">
                  de {formatFullPlays(progress.target)} plays
                </span>
              </div>
            </div>

            <div className="space-y-2.5">
              <Progress value={progress.pct} className="h-2.5" />
              <div className="flex items-center justify-between text-xs sm:text-sm gap-2 flex-wrap">
                <span className="font-medium text-foreground tabular-nums">
                  {progress.pct.toFixed(1)}% concluído
                </span>
                <span className="text-muted-foreground tabular-nums">
                  Faltam {formatPlays(remaining)}
                </span>
              </div>
            </div>

            {progress.last7_growth > 0 && (
              <div className="flex items-center gap-2 text-sm text-primary border-t border-border pt-4">
                <TrendingUp className="h-4 w-4" />
                <span>
                  +{formatPlays(progress.last7_growth)} plays nos últimos 7 dias
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* MINI KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {[
            {
              icon: Activity,
              label: "Ritmo",
              value: PACE_LABEL[progress.pace].label,
              tone: PACE_LABEL[progress.pace].tone,
            },
            {
              icon: ListMusic,
              label: "Playlists",
              value: String(playlists.length),
            },
            {
              icon: CalendarDays,
              label: "Dias decorridos",
              value: `${progress.days_elapsed} / ${progress.target_days}`,
            },
            {
              icon: CheckCircle2,
              label: "Última atualização",
              value: formatDateTime(deal.last_update),
              small: true,
            },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardContent className="p-4 space-y-1.5 min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                  <kpi.icon className="h-3.5 w-3.5" />
                  <span className="truncate">{kpi.label}</span>
                </div>
                <p
                  className={cn(
                    "font-semibold tabular-nums truncate",
                    kpi.small ? "text-xs sm:text-sm" : "text-base sm:text-lg",
                    "tone" in kpi && kpi.tone ? kpi.tone : "text-foreground",
                  )}
                  title={kpi.value}
                >
                  {kpi.value}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* GRÁFICO */}
        {chartData.length > 1 && (
          <Card>
            <CardContent className="p-5 sm:p-6 space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="text-base sm:text-lg font-semibold">
                    Evolução da campanha
                  </h2>
                  <p className="text-xs sm:text-sm text-muted-foreground">
                    Plays acumulados ao longo do tempo
                  </p>
                </div>
              </div>
              <div className="h-[220px] sm:h-[280px] w-full -mx-2">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={chartData}
                    margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="g_plays" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="0%"
                          stopColor="hsl(var(--primary))"
                          stopOpacity={0.35}
                        />
                        <stop
                          offset="100%"
                          stopColor="hsl(var(--primary))"
                          stopOpacity={0}
                        />
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
                    {progress.target > 0 && (
                      <ReferenceLine
                        y={progress.target}
                        stroke="hsl(var(--primary))"
                        strokeDasharray="4 4"
                        strokeOpacity={0.5}
                        label={{
                          value: "Meta",
                          position: "right",
                          fill: "hsl(var(--primary))",
                          fontSize: 10,
                        }}
                      />
                    )}
                    <Area
                      type="monotone"
                      dataKey="plays"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      fill="url(#g_plays)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}

        {/* PLAYLISTS MONITORADAS */}
        {playlists.length > 0 && (
          <section className="space-y-3 sm:space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base sm:text-lg font-semibold">
                  Playlists monitoradas
                </h2>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  Playlists que estão entregando plays para a campanha
                </p>
              </div>
              <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                {playlists.length}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {playlists.map((p, i) => (
                <Card key={`${p.name}-${i}`} className="overflow-hidden">
                  <CardContent className="p-4 flex items-center gap-3 min-w-0">
                    <div className="relative h-12 w-12 rounded-lg overflow-hidden bg-elevated border border-border shrink-0">
                      {p.image_url ? (
                        <img
                          src={p.image_url}
                          alt={p.name}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center">
                          <ListMusic className="h-5 w-5 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p
                        className="text-sm font-medium truncate"
                        title={p.name}
                      >
                        {p.name}
                      </p>
                      <div className="flex items-center gap-2 mt-1 min-w-0">
                        <span
                          className={cn(
                            "text-[10px] font-medium px-1.5 py-0.5 rounded border whitespace-nowrap",
                            PLAYLIST_STATUS_STYLES[p.status],
                          )}
                        >
                          {p.status}
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums truncate">
                          +{formatPlays(p.delivered)} plays
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* STATUS DA CAMPANHA */}
        <Card>
          <CardContent className="p-5 sm:p-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Início", value: formatDate(deal.started_at) },
              {
                label: "Previsão",
                value: deal.ends_at ? formatDate(deal.ends_at) : "—",
              },
              {
                label: "Playlists",
                value: String(playlists.length),
              },
              {
                label: "Ritmo",
                value: PACE_LABEL[progress.pace].label,
              },
            ].map((it) => (
              <div key={it.label} className="space-y-1 min-w-0">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium truncate">
                  {it.label}
                </p>
                <p className="text-sm font-medium truncate" title={it.value}>
                  {it.value}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* CONFIANÇA */}
        <div className="flex items-start gap-2.5 text-xs text-muted-foreground border-t border-border pt-5">
          <Sparkles className="h-3.5 w-3.5 shrink-0 mt-0.5 text-primary" />
          <p className="leading-relaxed">
            Os dados são atualizados automaticamente a partir das playlists
            monitoradas e snapshots do Spotify for Artists. Esta página é apenas
            de leitura.
          </p>
        </div>
      </main>
    </div>
  );
}
