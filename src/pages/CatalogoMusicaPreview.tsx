// MOCKUP visual — /catalogo/preview-musica
// Tela de exemplo (dados fake) pra demonstrar como ficaria o dashboard
// de detalhe de uma música do catálogo. NÃO consome banco, NÃO é produção.
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft, Music2, Layers, TrendingUp, Activity, Sparkles,
  PlayCircle, Clock, CheckCircle2, AlertTriangle, ExternalLink,
  BarChart3, ListMusic, History, Gauge,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { KpiBig } from "@/components/KpiBig";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ---------- MOCK DATA ----------
const track = {
  name: "Luz da Manhã",
  artist: "Marina Costa",
  cover: "https://i.scdn.co/image/ab67616d0000b273e8b066f70c206551210d902b",
  isrc: "BRRGE2400123",
  added_at: "2026-05-22",
  spotify_url: "#",
  baseline_streams: 12450,
  current_streams: 38720,
  delta_total: 26270,
  delta_28d: 18430,
  cps_avg: 0.42,
  placements_active: 14,
  placements_total: 18,
  placements_pending: 1,
  placements_failed: 0,
  followers_reach: 287430,
};

const placements = [
  { id: "1", playlist: "Indie Brasil 2026", followers: 48230, position: 7, status: "active", days: 14, streams_28d: 3120, delta: 2840, cover: null, genre: "indie" },
  { id: "2", playlist: "Acústico Tarde", followers: 31200, position: 3, status: "active", days: 21, streams_28d: 2890, delta: 2410, cover: null, genre: "acustico" },
  { id: "3", playlist: "MPB Novidades", followers: 92100, position: 12, status: "active", days: 9, streams_28d: 4210, delta: 3980, cover: null, genre: "mpb" },
  { id: "4", playlist: "Manhã Suave", followers: 18700, position: 5, status: "active", days: 18, streams_28d: 1230, delta: 1010, cover: null, genre: "lofi" },
  { id: "5", playlist: "Pop Brasil Hits", followers: 156400, position: 24, status: "pending", days: 0, streams_28d: 0, delta: 0, cover: null, genre: "pop" },
  { id: "6", playlist: "Foco & Estudo", followers: 73900, position: 9, status: "active", days: 12, streams_28d: 2440, delta: 2110, cover: null, genre: "chill" },
];

const execLog = [
  { ts: "há 2 min", level: "ok", msg: "process-catalog-placements: 14 ativos, 1 pendente, 0 falhas" },
  { ts: "há 4 min", level: "ok", msg: "Adicionada em 'Pop Brasil Hits' — posição 24" },
  { ts: "há 1 h", level: "warn", msg: "spotify_circuit_open — placement reagendado para retry (+8 min)" },
  { ts: "há 3 h", level: "ok", msg: "snapshot-catalog-tracks-daily: streams=38720 (Δ +1240)" },
  { ts: "há 1 d", level: "ok", msg: "Distribuição inicial concluída — 14/18 playlists ativas" },
];

// Curva fake (baseline vs realizado)
const curvePoints = Array.from({ length: 28 }, (_, i) => {
  const baseline = 12450 + i * 220;
  const real = 12450 + Math.pow(i, 1.45) * 380 + Math.sin(i / 3) * 400;
  return { day: i, baseline, real };
});

// ---------- COMPONENTES MOCK ----------
function fmt(n: number) {
  return n.toLocaleString("pt-BR");
}

function StatusDot({ status }: { status: string }) {
  const m: Record<string, { cls: string; label: string }> = {
    active: { cls: "bg-emerald-500", label: "Ativa" },
    pending: { cls: "bg-amber-500", label: "Pendente" },
    failed: { cls: "bg-rose-500", label: "Falha" },
  };
  const s = m[status] ?? m.active;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cn("h-1.5 w-1.5 rounded-full", s.cls)} />
      {s.label}
    </span>
  );
}

function CurveChart() {
  const w = 720, h = 220, pad = 24;
  const maxY = Math.max(...curvePoints.map(p => Math.max(p.baseline, p.real)));
  const x = (i: number) => pad + (i / 27) * (w - pad * 2);
  const y = (v: number) => h - pad - (v / maxY) * (h - pad * 2);

  const baselinePath = curvePoints.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.baseline)}`).join(" ");
  const realPath = curvePoints.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.real)}`).join(" ");
  const realArea = `${realPath} L ${x(27)} ${h - pad} L ${x(0)} ${h - pad} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[220px]">
      <defs>
        <linearGradient id="realFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.25" />
          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map(t => (
        <line key={t} x1={pad} x2={w - pad} y1={pad + (h - pad * 2) * t} y2={pad + (h - pad * 2) * t}
          stroke="hsl(var(--border))" strokeDasharray="2 4" strokeWidth={1} />
      ))}
      <path d={realArea} fill="url(#realFill)" />
      <path d={baselinePath} fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} strokeDasharray="4 4" />
      <path d={realPath} fill="none" stroke="hsl(var(--primary))" strokeWidth={2.5} />
    </svg>
  );
}

// ---------- PÁGINA ----------
type TabId = "overview" | "playlists" | "curva" | "execucao";

export default function CatalogoMusicaPreview() {
  const [tab, setTab] = useState<TabId>("overview");

  return (
    <>
      <PageHeader
        domain="playlists"
        title={track.name}
        subtitle={`${track.artist} · ISRC ${track.isrc}`}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm" className="h-9 rounded-full gap-1.5">
              <Link to="/catalogo">
                <ArrowLeft className="h-4 w-4" />
                <span className="hidden sm:inline">Voltar ao catálogo</span>
              </Link>
            </Button>
            <Button variant="outline" size="sm" className="h-9 rounded-full gap-1.5" asChild>
              <a href={track.spotify_url} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                <span className="hidden sm:inline">Abrir no Spotify</span>
              </a>
            </Button>
          </div>
        }
      />

      <PageContainer>
        {/* HERO — capa + identificação */}
        <section className="rounded-2xl border border-border bg-card p-5 flex flex-col sm:flex-row gap-5">
          <img
            src={track.cover}
            alt=""
            className="h-32 w-32 rounded-xl object-cover shadow-lg shrink-0"
          />
          <div className="flex-1 min-w-0 space-y-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Música do catálogo</div>
              <h2 className="text-2xl font-semibold text-foreground">{track.name}</h2>
              <div className="text-sm text-muted-foreground">{track.artist}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="text-xs">Ativa desde {new Date(track.added_at).toLocaleDateString("pt-BR")}</Badge>
              <Badge variant="outline" className="text-xs gap-1">
                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                {track.placements_active}/{track.placements_total} playlists ativas
              </Badge>
              <Badge variant="outline" className="text-xs gap-1">
                <Sparkles className="h-3 w-3 text-amber-400" />
                Alcance combinado: {fmt(track.followers_reach)}
              </Badge>
            </div>
          </div>
        </section>

        {/* KPIs */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiBig
            tier="hero"
            icon={Music2}
            label="Streams atuais"
            value={fmt(track.current_streams)}
            hint={`Baseline ${fmt(track.baseline_streams)}`}
            domain="playlists"
          />
          <KpiBig
            icon={TrendingUp}
            label="Δ vs baseline"
            value={`+${fmt(track.delta_total)}`}
            hint={`+${fmt(track.delta_28d)} nos últimos 28d`}
            domain="campaigns"
          />
          <KpiBig
            icon={Gauge}
            label="CPS médio"
            value={track.cps_avg.toFixed(2)}
            hint="Custo por stream estimado"
            domain="deals"
          />
          <KpiBig
            tier="quiet"
            icon={Activity}
            label="Placements"
            value={`${track.placements_active}/${track.placements_total}`}
            hint={`${track.placements_pending} pendente · ${track.placements_failed} falha`}
            domain="system"
          />
        </section>

        {/* TABS */}
        {(() => {
          const TABS = [
            { id: "overview" as const, label: "Visão geral", icon: BarChart3 },
            { id: "playlists" as const, label: "Playlists", icon: ListMusic },
            { id: "curva" as const, label: "Curva", icon: TrendingUp },
            { id: "execucao" as const, label: "Execução", icon: History },
          ];
          return (
            <div className="flex items-center gap-1 border-b border-border overflow-x-auto -mx-4 px-4 lg:mx-0 lg:px-0">
              {TABS.map(t => {
                const Icon = t.icon;
                const active = tab === t.id;
                return (
                  <button key={t.id} onClick={() => setTab(t.id)}
                    className={cn(
                      "px-4 h-10 inline-flex items-center gap-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors",
                      active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                    )}>
                    <Icon className="h-4 w-4" /> {t.label}
                  </button>
                );
              })}
            </div>
          );
        })()}

        {/* CONTEÚDO POR TAB */}
        {tab === "overview" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Curva de streams (28d)</h3>
                  <p className="text-xs text-muted-foreground">Realizado vs. baseline projetado</p>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded bg-primary" />Realizado</span>
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground"><span className="h-px w-3 border-t border-dashed border-muted-foreground" />Baseline</span>
                </div>
              </div>
              <CurveChart />
            </div>

            <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
              <h3 className="text-sm font-semibold text-foreground">Top playlists por delta</h3>
              <ul className="space-y-3">
                {placements.filter(p => p.status === "active").sort((a, b) => b.delta - a.delta).slice(0, 4).map(p => (
                  <li key={p.id} className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded bg-muted flex items-center justify-center shrink-0">
                      <PlayCircle className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">{p.playlist}</div>
                      <div className="text-xs text-muted-foreground">{fmt(p.followers)} seguidores · pos {p.position}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-mono text-emerald-500">+{fmt(p.delta)}</div>
                      <div className="text-[10px] text-muted-foreground">28d</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {tab === "playlists" && (
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="text-left font-medium px-4 py-3">Playlist</th>
                  <th className="text-left font-medium px-4 py-3">Seguidores</th>
                  <th className="text-left font-medium px-4 py-3">Posição</th>
                  <th className="text-left font-medium px-4 py-3">Dias</th>
                  <th className="text-right font-medium px-4 py-3">Streams 28d</th>
                  <th className="text-right font-medium px-4 py-3">Δ baseline</th>
                  <th className="text-left font-medium px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {placements.map(p => (
                  <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded bg-muted flex items-center justify-center">
                          <ListMusic className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                        <span className="font-medium text-foreground">{p.playlist}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{fmt(p.followers)}</td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">#{p.position}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{p.days}d</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{p.streams_28d ? fmt(p.streams_28d) : "—"}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      {p.delta > 0 ? <span className="text-emerald-500">+{fmt(p.delta)}</span> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3"><StatusDot status={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === "curva" && (
          <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Curva detalhada (smart-shop)</h3>
              <p className="text-xs text-muted-foreground">Comparativo entre o que o motor projetou e o que efetivamente foi entregue</p>
            </div>
            <CurveChart />
            <div className="grid grid-cols-3 gap-3 pt-2">
              <div className="rounded-lg border border-border p-3">
                <div className="text-[11px] uppercase text-muted-foreground">Realizado 28d</div>
                <div className="text-lg font-semibold font-mono">+{fmt(track.delta_28d)}</div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-[11px] uppercase text-muted-foreground">Baseline 28d</div>
                <div className="text-lg font-semibold font-mono text-muted-foreground">+6.160</div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-[11px] uppercase text-muted-foreground">Performance</div>
                <div className="text-lg font-semibold text-emerald-500">+199%</div>
              </div>
            </div>
          </div>
        )}

        {tab === "execucao" && (
          <div className="rounded-2xl border border-border bg-card">
            <div className="p-5 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">Log do worker</h3>
              <p className="text-xs text-muted-foreground">process-catalog-placements + snapshot diário</p>
            </div>
            <ul className="divide-y divide-border">
              {execLog.map((l, i) => (
                <li key={i} className="px-5 py-3 flex items-start gap-3">
                  <div className="mt-0.5">
                    {l.level === "ok" && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                    {l.level === "warn" && <AlertTriangle className="h-4 w-4 text-amber-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-foreground">{l.msg}</div>
                    <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Clock className="h-3 w-3" /> {l.ts}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="rounded-xl border border-dashed border-border bg-card/50 p-4 text-xs text-muted-foreground text-center">
          🎨 Tela de pré-visualização — todos os dados acima são fictícios. Esta é só uma demonstração visual do dashboard proposto.
        </div>
      </PageContainer>
    </>
  );
}
