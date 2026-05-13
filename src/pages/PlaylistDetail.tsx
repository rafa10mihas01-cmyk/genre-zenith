import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, Sparkles, Loader2, ExternalLink,
  TrendingUp, TrendingDown, Minus, AlertCircle, CheckCircle2, Activity,
} from "lucide-react";
import {
  usePlaylistBrain,
  usePlaylistBrainHistory,
  useRecalcPlaylistBrain,
  type BrainSignal,
  type BrainRecommendation,
} from "@/hooks/usePlaylistBrain";
import { cn } from "@/lib/utils";

type PlaylistRow = {
  id: string;
  spotify_playlist_id: string;
  name: string | null;
  ownership: string;
  followers: number | null;
  cover_url: string | null;
};

type ManagedRow = {
  id: string;
  cover_url: string | null;
  description: string | null;
  tracks_count: number;
  spotify_url: string;
  genre_id: string | null;
};

const TREND_LABEL: Record<string, { label: string; tone: string; Icon: any }> = {
  crescendo: { label: "Crescendo", tone: "text-primary", Icon: TrendingUp },
  estavel:   { label: "Estável",   tone: "text-muted-foreground", Icon: Minus },
  encolhendo:{ label: "Encolhendo",tone: "text-destructive", Icon: TrendingDown },
  novo:      { label: "Novo",      tone: "text-muted-foreground", Icon: Activity },
  sem_dados: { label: "Sem dados", tone: "text-muted-foreground", Icon: Activity },
};

const SEV_BADGE: Record<BrainSignal["severity"], string> = {
  high:   "bg-destructive/15 text-destructive border-destructive/40",
  medium: "bg-warning/10 text-warning border-warning/40",
  low:    "bg-muted text-muted-foreground border-border",
};

function fmtNum(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("pt-BR").format(n);
}

function relTime(iso: string) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "agora";
  if (d < 3600) return `há ${Math.round(d / 60)}min`;
  if (d < 86400) return `há ${Math.round(d / 3600)}h`;
  return `há ${Math.round(d / 86400)}d`;
}

export default function PlaylistDetail() {
  const { id } = useParams<{ id: string }>();
  const [pl, setPl] = useState<PlaylistRow | null>(null);
  const [mgd, setMgd] = useState<ManagedRow | null>(null);
  const [loadingPl, setLoadingPl] = useState(true);

  const { data: brain, isLoading: brainLoading } = usePlaylistBrain(id);
  const { data: history } = usePlaylistBrainHistory(id, 30);
  const recalc = useRecalcPlaylistBrain();

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoadingPl(true);
      const { data: p } = await supabase
        .from("playlists")
        .select("id, spotify_playlist_id, name, ownership, followers, cover_url")
        .eq("id", id)
        .maybeSingle();
      setPl(p as PlaylistRow | null);

      if (p?.spotify_playlist_id) {
        const { data: m } = await supabase
          .from("managed_playlists")
          .select("id, cover_url, description, tracks_count, spotify_url, genre_id")
          .eq("spotify_playlist_id", p.spotify_playlist_id)
          .maybeSingle();
        setMgd(m as ManagedRow | null);
      }
      setLoadingPl(false);
    })();
  }, [id]);

  if (loadingPl) {
    return (
      <PageContainer>
        <div className="h-64 grid place-items-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      </PageContainer>
    );
  }

  if (!pl) {
    return (
      <PageContainer>
        <PageHeader title="Playlist não encontrada" subtitle="Voltar para a lista" />
        <div className="mt-4">
          <Link to="/operacao" className="text-primary text-sm">← Operação</Link>
        </div>
      </PageContainer>
    );
  }

  const cover = mgd?.cover_url ?? pl.cover_url ?? null;
  const trend = TREND_LABEL[brain?.health_trend ?? "sem_dados"];

  return (
    <PageContainer>
      <PageHeader
        title={pl.name ?? "Playlist"}
        subtitle="Perfil vivo, capacidade e ações sugeridas"
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline" className="nx-pill">
              <Link to="/operacao"><ArrowLeft className="h-4 w-4 mr-1" />Voltar</Link>
            </Button>
            {mgd?.spotify_url && (
              <Button asChild variant="outline" className="nx-pill">
                <a href={mgd.spotify_url} target="_blank" rel="noreferrer">
                  Spotify <ExternalLink className="h-3.5 w-3.5 ml-1" />
                </a>
              </Button>
            )}
            <Button
              onClick={() => id && recalc.mutate(id)}
              disabled={recalc.isPending}
              className="nx-pill"
            >
              {recalc.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Sparkles className="h-4 w-4" />}
              <span className="ml-1.5">Recalcular cérebro</span>
            </Button>
          </div>
        }
      />

      {/* Identificação visual */}
      <div className="flex gap-4 items-start">
        <div className="w-24 h-24 rounded-xl bg-muted overflow-hidden shrink-0 border border-border">
          {cover ? (
            <img src={cover} alt={pl.name ?? ""} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full grid place-items-center text-muted-foreground text-xs">sem capa</div>
          )}
        </div>
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex flex-wrap gap-2 items-center">
            <Badge variant="outline" className="text-[10px]">{pl.ownership}</Badge>
            {brain?.identity?.nicho && (
              <Badge variant="outline" className="text-[10px]">{brain.identity.nicho}</Badge>
            )}
            <span className={cn("inline-flex items-center gap-1 text-xs font-medium", trend.tone)}>
              <trend.Icon className="h-3.5 w-3.5" />
              {trend.label}
            </span>
            {brain && (
              <span className="text-[11px] text-muted-foreground">
                Confiança {brain.confidence_score}/100 · atualizado {relTime(brain.last_calculated_at)}
              </span>
            )}
          </div>
          {mgd?.description && (
            <p className="text-sm text-muted-foreground line-clamp-2">{mgd.description}</p>
          )}
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Seguidores"
          value={fmtNum(pl.followers)}
        />
        <KpiCard
          label="Faixas"
          value={fmtNum(mgd?.tracks_count ?? brain?.personality?.total_tracks ?? null)}
        />
        <KpiCard
          label="Capacidade/dia"
          value={fmtNum(brain?.capacity_total ?? null)}
          hint={brain?.capacity_total != null ? "plays/dia estimados" : undefined}
        />
        <KpiCard
          label="Headroom"
          value={brain?.headroom_pct != null ? `${brain.headroom_pct.toFixed(0)}%` : "—"}
          hint="potencial não usado (Fase 2)"
        />
      </div>

      {/* Sinais + Recomendações lado a lado */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-warning" />
            <h2 className="text-sm font-semibold">Sinais ativos</h2>
            <span className="text-xs text-muted-foreground">
              {brain?.signals?.length ?? 0}
            </span>
          </div>
          {brainLoading ? (
            <div className="h-24 grid place-items-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : !brain || brain.signals.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              Nenhum problema detectado.
            </div>
          ) : (
            <ul className="space-y-2">
              {brain.signals.map((s, i) => (
                <li key={i} className="flex gap-2 items-start text-sm">
                  <span className={cn("inline-flex items-center px-1.5 h-5 rounded text-[10px] font-semibold border shrink-0", SEV_BADGE[s.severity])}>
                    {s.severity}
                  </span>
                  <span className="text-foreground/90">{s.message}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Ações sugeridas</h2>
            <span className="text-xs text-muted-foreground">
              {brain?.recommendations?.length ?? 0}
            </span>
          </div>
          {brainLoading ? (
            <div className="h-24 grid place-items-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : !brain || brain.recommendations.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4">Sem ações no momento.</div>
          ) : (
            <ol className="space-y-2.5">
              {brain.recommendations.map((r, i) => (
                <li key={i} className="flex gap-3 items-start text-sm">
                  <span className="w-6 h-6 rounded-full bg-primary/15 text-primary text-xs font-semibold grid place-items-center shrink-0">
                    {r.priority}
                  </span>
                  <div className="min-w-0">
                    <div className="text-foreground/90 font-medium">{r.action}</div>
                    <div className="text-muted-foreground text-xs mt-0.5">{r.reason}</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      {/* Identidade + Personalidade */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5 space-y-3">
          <h2 className="text-sm font-semibold">Identidade</h2>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <DetailItem label="Nicho" value={brain?.identity?.nicho ?? "—"} />
            <DetailItem
              label="Match com nicho"
              value={
                brain?.identity?.keywords_total
                  ? `${brain.identity.keywords_matched?.length ?? 0}/${brain.identity.keywords_total} palavras`
                  : "—"
              }
            />
          </dl>
          {brain?.identity?.keywords_matched && brain.identity.keywords_matched.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-2">
              {brain.identity.keywords_matched.slice(0, 8).map((k) => (
                <Badge key={k} variant="outline" className="text-[10px]">{k}</Badge>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5 space-y-3">
          <h2 className="text-sm font-semibold">Personalidade</h2>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <DetailItem label="Total de faixas" value={fmtNum(brain?.personality?.total_tracks ?? null)} />
            <DetailItem
              label="Frequência de update"
              value={
                brain?.personality?.freq_update_dias
                  ? `~${brain.personality.freq_update_dias} dias`
                  : "—"
              }
            />
            <DetailItem
              label="Snapshots coletados"
              value={fmtNum(brain?.personality?.snapshots_count ?? null)}
            />
          </dl>
        </Card>
      </div>

      {/* Histórico (mini) */}
      {history && history.length > 1 && (
        <Card className="p-5 space-y-3">
          <h2 className="text-sm font-semibold">Histórico de cálculos</h2>
          <div className="text-xs text-muted-foreground">
            {history.length} cálculos · do mais recente ao mais antigo
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="py-2 pr-3">Quando</th>
                  <th className="py-2 pr-3">Capacidade</th>
                  <th className="py-2 pr-3">Health</th>
                  <th className="py-2 pr-3">Sinais</th>
                  <th className="py-2">Confiança</th>
                </tr>
              </thead>
              <tbody>
                {history.slice(0, 10).map((h, i) => (
                  <tr key={i} className="border-b border-border/40">
                    <td className="py-2 pr-3 text-muted-foreground">{new Date(h.calculated_at).toLocaleString("pt-BR")}</td>
                    <td className="py-2 pr-3 tabular-nums">{fmtNum(h.capacity_total)}</td>
                    <td className="py-2 pr-3 tabular-nums">{h.health_score ?? "—"}</td>
                    <td className="py-2 pr-3 tabular-nums">{h.signals_count}</td>
                    <td className="py-2 tabular-nums">{h.confidence_score}/100</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </PageContainer>
  );
}

function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4 space-y-1.5">
      <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
        {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </Card>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground tabular-nums text-right">{value}</dd>
    </>
  );
}
