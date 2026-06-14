// Detalhe de uma música do catálogo — dados reais.
// Lê: catalog_tracks, catalog_track_baselines, v_catalog_track_telemetry,
//     v_catalog_track_playlist_attribution, catalog_placements (+managed_playlists),
//     catalog_snapshot_queue, song_snapshots.
import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, Music2, Layers, TrendingUp, Activity, ExternalLink,
  BarChart3, ListMusic, History, Gauge, CheckCircle2, AlertTriangle, Clock,
  PlayCircle, RefreshCw,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { KpiBig } from "@/components/KpiBig";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

type Track = {
  id: string;
  spotify_track_id: string;
  track_name: string;
  artist_name: string;
  cover_url: string | null;
  isrc: string | null;
  status: string;
  added_at: string;
};
type Baseline = {
  captured_at: string;
  popularity: number | null;
  monthly_listeners: number | null;
  streams: number | null;
};
type Telemetry = {
  baseline_at: string | null;
  baseline_plays_28d: number | null;
  last_captured_at: string | null;
  last_plays_28d: number | null;
  growth_abs: number | null;
  growth_pct: number | null;
  playlists_present_count: number;
  total_plays_7d_from_playlists: number;
  snapshots_count: number;
};
type Placement = {
  id: string;
  status: string;
  position: number | null;
  added_at: string | null;
  scheduled_for: string;
  attempts: number;
  last_error_code: string | null;
  managed_playlists: { name: string; cover_url: string | null; followers: number | null; spotify_playlist_id: string | null } | null;
};
type Attribution = {
  spotify_playlist_id: string;
  name: string;
  owner: string | null;
  spotify_url: string | null;
  first_seen_at: string;
  last_seen_at: string;
  observations: number;
  current_position: number | null;
  current_plays_7d: number | null;
  status: string;
};
type QueueRow = { status: string; scheduled_for: string; attempts: number; max_attempts: number; last_error: string | null; locked_at: string | null };
type Snapshot = { id: string; captured_at: string; total_plays_28d: number | null; processing_error: string | null };

const fmt = (n: number | null | undefined) => (typeof n === "number" ? n.toLocaleString("pt-BR") : "—");
const rel = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const min = Math.round(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const days = Math.round(h / 24);
  return `há ${days} d`;
};

async function fetchDetail(id: string) {
  const [trackRes, baselineRes, telemetryRes, placementsRes, attributionRes, queueRes, snapshotsRes] = await Promise.all([
    supabase.from("catalog_tracks").select("id, spotify_track_id, track_name, artist_name, cover_url, isrc, status, added_at").eq("id", id).maybeSingle(),
    supabase.from("catalog_track_baselines").select("captured_at, popularity, monthly_listeners, streams").eq("catalog_track_id", id).maybeSingle(),
    supabase.from("v_catalog_track_telemetry").select("baseline_at, baseline_plays_28d, last_captured_at, last_plays_28d, growth_abs, growth_pct, playlists_present_count, total_plays_7d_from_playlists, snapshots_count").eq("catalog_track_id", id).maybeSingle(),
    supabase.from("catalog_placements").select("id, status, position, added_at, scheduled_for, attempts, last_error_code, managed_playlists:managed_playlist_id(name, cover_url, followers, spotify_playlist_id)").eq("catalog_track_id", id).order("status", { ascending: true }),
    supabase.from("v_catalog_track_playlist_attribution").select("spotify_playlist_id, name, owner, spotify_url, first_seen_at, last_seen_at, observations, current_position, current_plays_7d, status").eq("catalog_track_id", id).order("current_plays_7d", { ascending: false, nullsFirst: false }),
    supabase.from("catalog_snapshot_queue").select("status, scheduled_for, attempts, max_attempts, last_error, locked_at").eq("catalog_track_id", id).order("scheduled_for", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("song_snapshots").select("id, captured_at, total_plays_28d, processing_error").eq("catalog_track_id", id).order("captured_at", { ascending: true }).limit(60),
  ]);
  return {
    track: trackRes.data as Track | null,
    baseline: baselineRes.data as Baseline | null,
    telemetry: telemetryRes.data as Telemetry | null,
    placements: (placementsRes.data ?? []) as unknown as Placement[],
    attribution: (attributionRes.data ?? []) as Attribution[],
    queue: queueRes.data as QueueRow | null,
    snapshots: (snapshotsRes.data ?? []) as Snapshot[],
  };
}

function StatusDot({ status }: { status: string }) {
  const m: Record<string, { cls: string; label: string }> = {
    active: { cls: "bg-emerald-500", label: "Ativa" },
    pending: { cls: "bg-amber-500", label: "Pendente" },
    processing: { cls: "bg-sky-400", label: "Processando" },
    retry: { cls: "bg-amber-500", label: "Retry" },
    failed: { cls: "bg-rose-500", label: "Falha" },
    removed: { cls: "bg-zinc-500", label: "Removida" },
  };
  const s = m[status] ?? { cls: "bg-zinc-500", label: status };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cn("h-1.5 w-1.5 rounded-full", s.cls)} />
      {s.label}
    </span>
  );
}

function Sparkline({ points }: { points: Snapshot[] }) {
  const w = 720, h = 200, pad = 24;
  if (points.length < 2) {
    return (
      <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground">
        {points.length === 0 ? "Sem snapshots ainda — primeira coleta abre o gráfico." : "Apenas 1 snapshot. Aguardando a próxima coleta para desenhar a curva."}
      </div>
    );
  }
  const ys = points.map((p) => p.total_plays_28d ?? 0);
  const maxY = Math.max(...ys, 1);
  const minY = Math.min(...ys);
  const x = (i: number) => pad + (i / (points.length - 1)) * (w - pad * 2);
  const y = (v: number) => h - pad - ((v - minY) / Math.max(1, maxY - minY)) * (h - pad * 2);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.total_plays_28d ?? 0)}`).join(" ");
  const area = `${path} L ${x(points.length - 1)} ${h - pad} L ${x(0)} ${h - pad} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[200px]">
      <defs>
        <linearGradient id="splFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.25" />
          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((t) => (
        <line key={t} x1={pad} x2={w - pad} y1={pad + (h - pad * 2) * t} y2={pad + (h - pad * 2) * t} stroke="hsl(var(--border))" strokeDasharray="2 4" strokeWidth={1} />
      ))}
      <path d={area} fill="url(#splFill)" />
      <path d={path} fill="none" stroke="hsl(var(--primary))" strokeWidth={2.5} />
    </svg>
  );
}

export default function CatalogoMusicaDetalhe() {
  const { id = "" } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ["catalog", "detail", id], queryFn: () => fetchDetail(id), enabled: !!id, refetchInterval: 30_000 });

  const placementsByStatus = useMemo(() => {
    const m: Record<string, number> = { active: 0, pending: 0, processing: 0, retry: 0, failed: 0, removed: 0 };
    (q.data?.placements ?? []).forEach((p) => { m[p.status] = (m[p.status] ?? 0) + 1; });
    return m;
  }, [q.data]);

  const reach = useMemo(() => (q.data?.placements ?? [])
    .filter((p) => p.status === "active")
    .reduce((s, p) => s + (p.managed_playlists?.followers ?? 0), 0), [q.data]);

  if (q.isLoading) {
    return (
      <PageContainer>
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-60 w-full" />
      </PageContainer>
    );
  }
  if (!q.data?.track) {
    return (
      <PageContainer>
        <div className="rounded-2xl border border-border bg-card p-8 text-center text-muted-foreground">
          Música não encontrada. <Link to="/catalogo" className="text-primary underline">Voltar ao catálogo</Link>
        </div>
      </PageContainer>
    );
  }
  const t = q.data.track;
  const b = q.data.baseline;
  const tel = q.data.telemetry;
  const placements = q.data.placements;
  const attribution = q.data.attribution;
  const queue = q.data.queue;
  const snapshots = q.data.snapshots;

  const baselineOk = !!b && (b.popularity != null || b.monthly_listeners != null || b.streams != null);

  return (
    <>
      <PageHeader
        domain="playlists"
        title={t.track_name}
        subtitle={`${t.artist_name}${t.isrc ? ` · ISRC ${t.isrc}` : ""}`}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm" className="h-9 rounded-full gap-1.5">
              <Link to="/catalogo"><ArrowLeft className="h-4 w-4" /><span className="hidden sm:inline">Voltar</span></Link>
            </Button>
            <Button variant="outline" size="sm" className="h-9 rounded-full gap-1.5" asChild>
              <a href={`https://open.spotify.com/track/${t.spotify_track_id}`} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" /><span className="hidden sm:inline">Spotify</span>
              </a>
            </Button>
          </div>
        }
      />

      <PageContainer>
        {/* HERO */}
        <section className="rounded-2xl border border-border bg-card p-5 flex flex-col sm:flex-row gap-5">
          {t.cover_url ? (
            <img src={t.cover_url} alt="" className="h-28 w-28 rounded-xl object-cover shadow-lg shrink-0" />
          ) : (
            <div className="h-28 w-28 rounded-xl bg-muted flex items-center justify-center shrink-0"><Music2 className="h-8 w-8 text-muted-foreground" /></div>
          )}
          <div className="flex-1 min-w-0 space-y-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Música do catálogo</div>
              <h2 className="text-2xl font-semibold text-foreground">{t.track_name}</h2>
              <div className="text-sm text-muted-foreground">{t.artist_name}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="text-xs">Ativa desde {new Date(t.added_at).toLocaleDateString("pt-BR")}</Badge>
              <Badge variant="outline" className="text-xs gap-1">
                <CheckCircle2 className={cn("h-3 w-3", placementsByStatus.active > 0 ? "text-emerald-500" : "text-muted-foreground")} />
                {placementsByStatus.active}/{placements.length} placements ativos
              </Badge>
              <Badge variant="outline" className="text-xs gap-1">
                <Layers className="h-3 w-3 text-amber-400" />
                Alcance: {fmt(reach)}
              </Badge>
              <Badge variant="outline" className={cn("text-xs gap-1", baselineOk ? "" : "border-amber-500/40 text-amber-400")}>
                {baselineOk ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <AlertTriangle className="h-3 w-3 text-amber-500" />}
                Baseline {baselineOk ? "capturada" : "pendente"}
              </Badge>
            </div>
          </div>
        </section>

        {/* KPIs */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiBig tier="hero" icon={Music2} label="Streams 28d (atual)" value={fmt(tel?.last_plays_28d)} hint={tel?.baseline_plays_28d != null ? `Baseline ${fmt(tel.baseline_plays_28d)}` : "Sem baseline ainda"} domain="playlists" />
          <KpiBig icon={TrendingUp} label="Δ vs baseline" value={tel?.growth_abs != null ? `${tel.growth_abs >= 0 ? "+" : ""}${fmt(tel.growth_abs)}` : "—"} hint={tel?.growth_pct != null ? `${tel.growth_pct >= 0 ? "+" : ""}${tel.growth_pct}%` : "Aguardando 2º snapshot"} domain="campaigns" />
          <KpiBig icon={Layers} label="Playlists detectadas" value={fmt(tel?.playlists_present_count)} hint={`${fmt(tel?.total_plays_7d_from_playlists)} plays 7d (VPS)`} domain="deals" />
          <KpiBig tier="quiet" icon={Activity} label="Snapshots" value={fmt(tel?.snapshots_count)} hint={`Última: ${rel(tel?.last_captured_at)}`} domain="system" />
        </section>

        {/* BASELINE + COLETA */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Baseline T0</h3>
                <p className="text-xs text-muted-foreground">Estado inicial capturado na entrada</p>
              </div>
              {baselineOk ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <AlertTriangle className="h-4 w-4 text-amber-500" />}
            </div>
            {b ? (
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-border p-3">
                  <div className="text-[11px] uppercase text-muted-foreground">Popularity</div>
                  <div className="text-lg font-semibold font-mono">{b.popularity ?? "—"}</div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-[11px] uppercase text-muted-foreground">Ouvintes/mês</div>
                  <div className="text-lg font-semibold font-mono">{fmt(b.monthly_listeners)}</div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-[11px] uppercase text-muted-foreground">Streams</div>
                  <div className="text-lg font-semibold font-mono">{fmt(b.streams)}</div>
                </div>
                <div className="col-span-3 text-[11px] text-muted-foreground">
                  Capturada {new Date(b.captured_at).toLocaleString("pt-BR")}
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">Baseline ainda não chegou. O bot deve gravar nas próximas coletas.</div>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Fila de coleta</h3>
                <p className="text-xs text-muted-foreground">Próxima rodada do bot</p>
              </div>
              <RefreshCw className="h-4 w-4 text-muted-foreground" />
            </div>
            {queue ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Status</span><StatusDot status={queue.status === "pending" || queue.status === "processing" ? queue.status : queue.status === "failed" ? "failed" : "pending"} /></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Agendada para</span><span className="font-mono text-xs">{new Date(queue.scheduled_for).toLocaleString("pt-BR")}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Tentativas</span><span className="font-mono text-xs">{queue.attempts}/{queue.max_attempts}</span></div>
                {queue.last_error && (
                  <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-2 text-xs text-rose-300">{queue.last_error}</div>
                )}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">Nenhum item na fila. Última coleta {rel(tel?.last_captured_at)}.</div>
            )}
          </div>
        </section>

        {/* CURVA */}
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Evolução de streams</h3>
              <p className="text-xs text-muted-foreground">total_plays_28d ao longo dos snapshots</p>
            </div>
            <div className="text-xs text-muted-foreground">{snapshots.length} pontos</div>
          </div>
          <Sparkline points={snapshots} />
        </section>

        {/* PLACEMENTS GERENCIADOS */}
        <section className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="p-5 border-b border-border flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><ListMusic className="h-4 w-4" /> Placements na rede</h3>
              <p className="text-xs text-muted-foreground">{placementsByStatus.active} ativos · {placementsByStatus.pending + placementsByStatus.retry + placementsByStatus.processing} em fila · {placementsByStatus.failed} falhas · {placementsByStatus.removed} removidos</p>
            </div>
          </div>
          {placements.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Sem placements ainda.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="text-left font-medium px-4 py-3">Playlist</th>
                    <th className="text-left font-medium px-4 py-3">Seguidores</th>
                    <th className="text-left font-medium px-4 py-3">Posição</th>
                    <th className="text-left font-medium px-4 py-3">Adicionada</th>
                    <th className="text-left font-medium px-4 py-3">Tentativas</th>
                    <th className="text-left font-medium px-4 py-3">Status / erro</th>
                  </tr>
                </thead>
                <tbody>
                  {placements.map((p) => (
                    <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {p.managed_playlists?.cover_url ? (
                            <img src={p.managed_playlists.cover_url} alt="" className="h-7 w-7 rounded object-cover" />
                          ) : (
                            <div className="h-7 w-7 rounded bg-muted flex items-center justify-center"><PlayCircle className="h-3.5 w-3.5 text-muted-foreground" /></div>
                          )}
                          <span className="font-medium text-foreground">{p.managed_playlists?.name ?? "—"}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{fmt(p.managed_playlists?.followers)}</td>
                      <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{p.position != null ? `#${p.position}` : "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{p.added_at ? new Date(p.added_at).toLocaleDateString("pt-BR") : "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{p.attempts}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          <StatusDot status={p.status} />
                          {p.last_error_code && <span className="text-[10px] text-rose-400 font-mono">{p.last_error_code}</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ATRIBUIÇÃO VPS — playlists onde o bot detectou a faixa */}
        <section className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="p-5 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><History className="h-4 w-4" /> Playlists detectadas pela VPS</h3>
            <p className="text-xs text-muted-foreground">Onde o bot encontrou a faixa nos snapshots (inclui playlists fora da nossa rede)</p>
          </div>
          {attribution.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Sem detecções ainda. Aguarde o próximo snapshot.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="text-left font-medium px-4 py-3">Playlist</th>
                    <th className="text-left font-medium px-4 py-3">Owner</th>
                    <th className="text-left font-medium px-4 py-3">Pos atual</th>
                    <th className="text-right font-medium px-4 py-3">Plays 7d</th>
                    <th className="text-left font-medium px-4 py-3">Observações</th>
                    <th className="text-left font-medium px-4 py-3">Visto por último</th>
                  </tr>
                </thead>
                <tbody>
                  {attribution.slice(0, 50).map((a) => (
                    <tr key={a.spotify_playlist_id} className="border-b border-border last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3">
                        {a.spotify_url ? (
                          <a href={a.spotify_url} target="_blank" rel="noreferrer" className="font-medium text-foreground hover:text-primary inline-flex items-center gap-1">
                            {a.name} <ExternalLink className="h-3 w-3 opacity-60" />
                          </a>
                        ) : (
                          <span className="font-medium text-foreground">{a.name}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{a.owner ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{a.current_position != null ? `#${a.current_position}` : "—"}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{fmt(a.current_plays_7d)}</td>
                      <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{a.observations}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{rel(a.last_seen_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </PageContainer>
    </>
  );
}
