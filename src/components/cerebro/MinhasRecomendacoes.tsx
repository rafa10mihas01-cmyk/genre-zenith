import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatNumber, timeAgo } from "@/lib/format";
import {
  AlertCircle, ArrowRight, Brain, CheckCircle2, ListChecks, ListMusic, Music2, Sparkles, Target, Users,
} from "lucide-react";

type ManagedPlaylist = {
  id: string;
  canonical_playlist_id: string | null;
  spotify_playlist_id: string;
  spotify_url: string | null;
  name: string;
  cover_url: string | null;
  followers: number | null;
  tracks_count: number | null;
  last_diagnosis_at: string | null;
  imported_at: string | null;
};

type BrainRecommendation = {
  priority?: number;
  action?: string;
  reason?: string;
};

type BrainRow = {
  playlist_id: string;
  recommendations: BrainRecommendation[] | null;
  signals: Array<{ severity?: string; message?: string }> | null;
  headroom_pct: number | null;
  confidence_score: number | null;
  health_trend: string | null;
  last_calculated_at: string | null;
};

export function MinhasRecomendacoes({ genreId }: { genreId?: string }) {
  const [playlists, setPlaylists] = useState<ManagedPlaylist[]>([]);
  const [brains, setBrains] = useState<Record<string, BrainRow>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!genreId) {
        setPlaylists([]);
        setBrains({});
        setLoading(false);
        return;
      }

      setLoading(true);
      const { data } = await supabase
        .from("managed_playlists")
        .select("id, canonical_playlist_id, spotify_playlist_id, spotify_url, name, cover_url, followers, tracks_count, last_diagnosis_at, imported_at")
        .eq("genre_id", genreId)
        .is("archived_at", null)
        .order("followers", { ascending: false, nullsFirst: false });

      const list = (data ?? []) as ManagedPlaylist[];
      const canonicalIds = list.map((p) => p.canonical_playlist_id).filter(Boolean) as string[];
      const brainMap: Record<string, BrainRow> = {};

      if (canonicalIds.length > 0) {
        const { data: brainRows } = await supabase
          .from("playlist_brain")
          .select("playlist_id, recommendations, signals, headroom_pct, confidence_score, health_trend, last_calculated_at")
          .in("playlist_id", canonicalIds);

        (brainRows ?? []).forEach((row: any) => {
          brainMap[row.playlist_id] = row as BrainRow;
        });
      }

      if (!cancelled) {
        setPlaylists(list);
        setBrains(brainMap);
        setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [genreId]);

  const rows = useMemo(() => {
    return playlists
      .map((playlist) => ({ playlist, brain: playlist.canonical_playlist_id ? brains[playlist.canonical_playlist_id] : undefined }))
      .sort((a, b) => {
        const ar = a.brain?.recommendations?.length ?? 0;
        const br = b.brain?.recommendations?.length ?? 0;
        if (ar !== br) return br - ar;
        const as = a.brain?.signals?.length ?? 0;
        const bs = b.brain?.signals?.length ?? 0;
        if (as !== bs) return bs - as;
        return (b.playlist.followers ?? 0) - (a.playlist.followers ?? 0);
      });
  }, [playlists, brains]);

  const summary = useMemo(() => {
    const withBrain = rows.filter((r) => !!r.brain).length;
    const actions = rows.reduce((total, r) => total + (r.brain?.recommendations?.length ?? 0), 0);
    const alerts = rows.reduce((total, r) => total + (r.brain?.signals?.length ?? 0), 0);
    return { withBrain, actions, alerts, noBrain: Math.max(0, rows.length - withBrain) };
  }, [rows]);

  return (
    <div className="space-y-5">
      <section className="nx-card p-5 border-primary/30 bg-primary/5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 max-w-3xl">
            <div className="flex items-center gap-2 text-primary mb-2">
              <Target className="h-4 w-4" />
              <span className="text-[11px] uppercase tracking-[0.18em] font-bold">Suas playlists</span>
            </div>
            <h2 className="text-lg font-bold leading-tight">Recomendações das playlists que já estão no catálogo</h2>
            <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
              Esta área é só do que é seu. O cérebro cruza as playlists importadas, os dados coletados e o cálculo de cada playlist para dizer o que mexer agora.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 shrink-0">
            <MiniStat icon={ListMusic} label="Minhas" value={formatNumber(rows.length)} />
            <MiniStat icon={Brain} label="Calculadas" value={formatNumber(summary.withBrain)} />
            <MiniStat icon={ListChecks} label="Ações" value={formatNumber(summary.actions)} tone="primary" />
            <MiniStat icon={AlertCircle} label="Sinais" value={formatNumber(summary.alerts)} tone={summary.alerts > 0 ? "warning" : "default"} />
          </div>
        </div>
      </section>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
        </div>
      ) : rows.length === 0 ? (
        <section className="nx-card p-6 text-center">
          <Brain className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <h3 className="font-bold">Nenhuma playlist sua ligada a este gênero</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl mx-auto">
            O mercado pode existir aqui, mas a recomendação das suas playlists só aparece quando a playlist importada está marcada com este gênero.
          </p>
          <Button asChild className="mt-4" variant="outline">
            <Link to="/operacao">Abrir minhas playlists</Link>
          </Button>
        </section>
      ) : (
        <div className="space-y-3">
          {rows.map(({ playlist, brain }) => (
            <PlaylistRecommendationCard key={playlist.id} playlist={playlist} brain={brain} />
          ))}
        </div>
      )}
    </div>
  );
}

function PlaylistRecommendationCard({ playlist, brain }: { playlist: ManagedPlaylist; brain?: BrainRow }) {
  const recommendations = brain?.recommendations ?? [];
  const signals = brain?.signals ?? [];
  const hasActions = recommendations.length > 0;
  const detailUrl = playlist.canonical_playlist_id ? `/playlists/${playlist.canonical_playlist_id}` : "/operacao";

  return (
    <article className={cn("nx-card p-4", hasActions ? "border-primary/35" : "")}> 
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          {playlist.cover_url ? (
            <img src={playlist.cover_url} alt="" className="h-16 w-16 rounded-lg object-cover border border-border shrink-0" loading="lazy" />
          ) : (
            <div className="h-16 w-16 rounded-lg border border-border bg-elevated grid place-items-center shrink-0">
              <Music2 className="h-5 w-5 text-muted-foreground" />
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-[10px] uppercase tracking-[0.16em] font-bold text-primary">Minha playlist</span>
              {brain?.health_trend && <TrendBadge trend={brain.health_trend} />}
              {typeof brain?.confidence_score === "number" && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-elevated border border-border text-muted-foreground">
                  confiança {brain.confidence_score}%
                </span>
              )}
            </div>

            <h3 className="text-base font-bold leading-tight truncate">{playlist.name}</h3>
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 tabular-nums flex-wrap">
              <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{formatNumber(playlist.followers)}</span>
              <span className="inline-flex items-center gap-1"><Music2 className="h-3 w-3" />{formatNumber(playlist.tracks_count)} faixas</span>
              <span>{brain?.last_calculated_at ? `cérebro ${timeAgo(brain.last_calculated_at)}` : "sem cálculo do cérebro"}</span>
            </div>

            <div className="mt-3 space-y-2">
              {hasActions ? (
                recommendations.slice(0, 3).map((rec, index) => (
                  <div key={`${rec.action}-${index}`} className="flex gap-2 text-sm leading-relaxed">
                    <span className="mt-0.5 h-5 min-w-5 rounded-full bg-primary/15 text-primary text-[11px] font-bold grid place-items-center">
                      {rec.priority ?? index + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="font-medium text-foreground/90">{rec.action}</div>
                      {rec.reason && <div className="text-xs text-muted-foreground">{rec.reason}</div>}
                    </div>
                  </div>
                ))
              ) : brain ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  Sem ação urgente para essa playlist agora.
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <AlertCircle className="h-4 w-4 text-warning" />
                  Ainda falta cálculo do cérebro para essa playlist.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex lg:flex-col gap-2 lg:items-end shrink-0">
          <StatusPill actions={recommendations.length} signals={signals.length} />
          <Button asChild variant={hasActions ? "default" : "outline"} size="sm" className="shrink-0">
            <Link to={detailUrl}>
              Ver análise <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </div>
    </article>
  );
}

function MiniStat({ icon: Icon, label, value, tone = "default" }: { icon: any; label: string; value: string; tone?: "default" | "primary" | "warning" }) {
  return (
    <div className={cn(
      "rounded-xl border px-3 py-2 min-w-[104px] bg-background/70",
      tone === "primary" ? "border-primary/35" : tone === "warning" ? "border-warning/35" : "border-border",
    )}>
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[9px] uppercase tracking-wider font-bold">{label}</span>
      </div>
      <div className="text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}

function TrendBadge({ trend }: { trend: string }) {
  const label = trend === "crescendo" ? "crescendo" : trend === "encolhendo" ? "caindo" : trend === "estavel" ? "estável" : trend.split("_").join(" ");
  return (
    <span className="text-[10px] px-2 py-0.5 rounded-full bg-elevated border border-border text-muted-foreground">
      {label}
    </span>
  );
}

function StatusPill({ actions, signals }: { actions: number; signals: number }) {
  if (actions > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 text-primary px-3 py-1 text-xs font-bold whitespace-nowrap">
        <Sparkles className="h-3.5 w-3.5" /> {actions} ação{actions > 1 ? "es" : ""}
      </span>
    );
  }
  if (signals > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 text-warning px-3 py-1 text-xs font-bold whitespace-nowrap">
        <AlertCircle className="h-3.5 w-3.5" /> {signals} sinal{signals > 1 ? "ais" : ""}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-elevated text-muted-foreground px-3 py-1 text-xs font-bold whitespace-nowrap">
      <CheckCircle2 className="h-3.5 w-3.5" /> ok
    </span>
  );
}