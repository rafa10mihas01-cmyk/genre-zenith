import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, Target, Clock, Zap, TrendingUp, ListMusic, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { NexEngineLogo } from "@/components/NexEngineLogo";

type Deal = {
  id: string;
  curator_name: string;
  song_spotify_url: string;
  song_name: string;
  song_artist: string | null;
  song_cover_url: string | null;
  target_plays: number | null;
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

export default function CuratorPage() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deal, setDeal] = useState<Deal | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [logs, setLogs] = useState<DealLog[]>([]);
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    if (!token) return;
    const { data, error: fnErr } = await supabase.functions.invoke(
      "get-curator-deal-public",
      { body: { public_token: token } },
    );
    if (fnErr || !data?.ok) {
      setError(data?.error || fnErr?.message || "not found");
      setDeal(null);
      setPlaylists([]);
      setLogs([]);
    } else {
      setDeal(data.deal as Deal);
      setPlaylists((data.playlists ?? []) as Playlist[]);
      setLogs((data.logs ?? []) as DealLog[]);
      setError(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const stats = useMemo(() => {
    if (!deal) {
      return {
        target: 0,
        baseline: 0,
        latest: 0,
        earned: 0,
        remaining: 0,
        pct: 0,
        vel: null as number | null,
        eta: null as number | null,
        hasBaseline: false,
        daysRunning: 0,
      };
    }
    const target = Number(deal.target_plays ?? 0);
    const baseline = Number(deal.baseline_plays ?? 0);
    const sorted = [...logs].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    const nonBase = sorted.filter((l) => !l.is_baseline);
    const hasBaseline = sorted.some((l) => l.is_baseline);
    const latest = nonBase.length > 0 ? Number(nonBase[nonBase.length - 1].total_plays) : baseline;
    const earned = nonBase.length > 0 ? Math.max(0, latest - baseline) : 0;
    const remaining = Math.max(0, target - earned);
    const pct = target > 0 ? Math.min(100, Math.round((earned / target) * 100)) : 0;

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

    const startRef = deal.started_at ?? deal.created_at;
    const daysRunning = startRef
      ? Math.max(
          0,
          Math.floor((Date.now() - new Date(startRef).getTime()) / (1000 * 60 * 60 * 24)),
        )
      : 0;

    return { target, baseline, latest, earned, remaining, pct, vel, eta, hasBaseline, daysRunning };
  }, [deal, logs]);

  const handleAdd = async () => {
    if (!token || !url.trim()) return;
    setSubmitting(true);
    const { data, error: fnErr } = await supabase.functions.invoke(
      "add-curator-playlist",
      { body: { public_token: token, spotify_url: url.trim() } },
    );
    setSubmitting(false);
    if (fnErr || !data?.ok) {
      toast.error(data?.error || fnErr?.message || "Erro ao adicionar playlist");
      return;
    }
    toast.success("Playlist adicionada");
    setUrl("");
    await load();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !deal) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-6 text-center">
            <p className="text-base font-medium">Link inválido ou expirado</p>
            <p className="text-sm text-muted-foreground mt-2">
              Verifique o link com quem o enviou.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isDone = stats.target > 0 && stats.earned >= stats.target;

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="max-w-xl mx-auto space-y-5">
        {/* Header — música + curador */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              {deal.song_cover_url ? (
                <img
                  src={deal.song_cover_url}
                  alt={deal.song_name}
                  className="w-20 h-20 rounded-lg object-cover shrink-0"
                />
              ) : (
                <div className="w-20 h-20 rounded-lg bg-muted shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-semibold truncate">{deal.song_name}</h1>
                {deal.song_artist && (
                  <p className="text-muted-foreground truncate text-sm">{deal.song_artist}</p>
                )}
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <Badge variant="secondary">Curador: {deal.curator_name}</Badge>
                  <Badge
                    className={
                      isDone
                        ? "bg-success text-success-foreground hover:bg-success/90"
                        : !stats.hasBaseline
                        ? "bg-warning/15 text-warning hover:bg-warning/15 border-0"
                        : "bg-primary/15 text-primary hover:bg-primary/15 border-0"
                    }
                  >
                    {isDone
                      ? "Concluído"
                      : !stats.hasBaseline
                      ? "Aguardando início"
                      : "Em progresso"}
                  </Badge>
                </div>
              </div>
            </div>
            <a
              href={deal.song_spotify_url}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="h-3 w-3" />
              Abrir música no Spotify
            </a>
          </CardContent>
        </Card>

        {/* Progresso da campanha */}
        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Progresso da campanha</h2>
              <span className="text-2xl font-semibold tabular-nums">{stats.pct}%</span>
            </div>

            <div className="space-y-2">
              <Progress value={stats.pct} className="h-2.5" />
              <div className="flex items-center justify-between text-sm tabular-nums">
                <span className="text-foreground font-medium">
                  {formatPlays(stats.earned)} plays
                </span>
                <span className="text-muted-foreground">
                  meta: {formatPlays(stats.target)}
                </span>
              </div>
            </div>

            <Separator />

            {/* Grid de KPIs */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border border-white/[0.04] bg-card/50 p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                  <Target className="h-3 w-3" />
                  Faltam
                </div>
                <div className="text-base font-semibold tabular-nums">
                  {formatPlays(stats.remaining)} plays
                </div>
              </div>

              <div className="rounded-md border border-white/[0.04] bg-card/50 p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                  <Clock className="h-3 w-3" />
                  Tempo decorrido
                </div>
                <div className="text-base font-semibold tabular-nums">
                  {stats.daysRunning} {stats.daysRunning === 1 ? "dia" : "dias"}
                </div>
              </div>

              <div className="rounded-md border border-white/[0.04] bg-card/50 p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                  <Zap className="h-3 w-3 text-primary" />
                  Velocidade
                </div>
                <div className="text-base font-semibold tabular-nums">
                  {stats.vel !== null ? `${formatPlays(stats.vel)}/dia` : "—"}
                </div>
              </div>

              <div className="rounded-md border border-white/[0.04] bg-card/50 p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                  <TrendingUp className="h-3 w-3" />
                  ETA
                </div>
                <div className="text-base font-semibold tabular-nums">
                  {stats.eta === null
                    ? "—"
                    : stats.eta === 0
                    ? "Concluído"
                    : `~${stats.eta} ${stats.eta === 1 ? "dia" : "dias"}`}
                </div>
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-muted-foreground">Início</div>
                <div className="text-foreground font-medium mt-0.5">
                  {formatDate(deal.started_at ?? deal.created_at)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Plays iniciais</div>
                <div className="text-foreground font-medium tabular-nums mt-0.5">
                  {formatPlays(stats.baseline)}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Suas playlists com performance */}
        <Card>
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold inline-flex items-center gap-2">
                <ListMusic className="h-4 w-4" />
                Suas playlists
              </h2>
              <span className="text-xs text-muted-foreground">
                {playlists.length} no total
              </span>
            </div>

            {playlists.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Nenhuma playlist adicionada ainda
              </p>
            ) : (
              <ul className="space-y-2">
                {playlists.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-white/[0.04] p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <a
                        href={p.spotify_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-medium truncate hover:underline block"
                      >
                        {p.playlist_name}
                      </a>
                      {p.followers !== null && (
                        <div className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                          {formatPlays(p.followers)} seguidores
                        </div>
                      )}
                    </div>
                    {p.is_baseline ? (
                      <Badge variant="secondary" className="shrink-0">Inicial</Badge>
                    ) : (
                      <Badge className="bg-success text-success-foreground hover:bg-success/90 shrink-0">
                        Nova
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Adicionar playlist */}
        <Card>
          <CardContent className="p-5 space-y-3">
            <div>
              <h2 className="text-base font-semibold">Adicionar playlist</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Cole o link de uma playlist do Spotify onde a música foi adicionada
              </p>
            </div>
            <Input
              placeholder="https://open.spotify.com/playlist/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={submitting}
            />
            <Button
              onClick={handleAdd}
              disabled={submitting || !url.trim()}
              className="w-full"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Adicionar
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
