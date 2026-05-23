import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatInt, formatBRL } from "@/lib/campaignEngine";
import type { CampaignSnapshot } from "@/lib/campaignSnapshot";
import { cn } from "@/lib/utils";
import { Music, Camera, TrendingUp, TrendingDown, Minus, ArrowRight, ExternalLink } from "lucide-react";
import type { EcoAllocation } from "../types";

type EcoSnap = {
  managed_playlist_id: string;
  plays_24h: number | null;
  plays_7d: number | null;
  plays_28d: number | null;
  captured_at: string;
};

type ProofPreview = {
  id: string;
  captured_at: string;
  playlist_name: string;
  screenshot_url: string | null;
  delta_plays: number | null;
};

type Props = {
  snapshot: CampaignSnapshot;
  delivered: number;
  daysElapsed: number;
  showFinance: boolean;
  allocations?: EcoAllocation[];
  snapshots?: EcoSnap[];
  proofs?: ProofPreview[];
  onJumpTab?: (tab: "playlists" | "proofs" | "curve" | "finance") => void;
};

export function OverviewTab({
  snapshot, delivered, daysElapsed, showFinance,
  allocations = [], snapshots = [], proofs = [], onJumpTab,
}: Props) {
  const pct = snapshot.meta > 0 ? Math.min(100, Math.round((delivered / snapshot.meta) * 100)) : 0;
  const plannedToDate = snapshot.curva.slice(0, daysElapsed).reduce((s, p) => s + p.streamsDay, 0);
  const adherence = plannedToDate > 0 ? Math.round((delivered / plannedToDate) * 100) : 0;

  // Top 5 playlists no ar por entrega
  const latestByPl = new Map<string, EcoSnap>();
  for (const s of snapshots) {
    if (!latestByPl.has(s.managed_playlist_id)) latestByPl.set(s.managed_playlist_id, s);
  }
  const topPlaylists = allocations
    .filter(a => a.status === "active" || a.status === "dispatched" || a.status === "done")
    .map(a => ({
      a,
      delivered: Number(latestByPl.get(a.managed_playlist_id)?.plays_28d ?? latestByPl.get(a.managed_playlist_id)?.plays_7d ?? 0),
      delta24: latestByPl.get(a.managed_playlist_id)?.plays_24h ?? 0,
    }))
    .sort((x, y) => y.delivered - x.delivered)
    .slice(0, 5);

  const recentProofs = [...proofs]
    .sort((a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime())
    .slice(0, 4);

  return (
    <div className="space-y-6">
      {/* KPIs grandes */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Meta" value={formatInt(snapshot.meta)} sub="streams" />
        <Kpi label="Entregue" value={formatInt(delivered)} sub={`${pct}% da meta`} tone="primary" />
        <Kpi
          label="Aderência ao plano"
          value={`${adherence}%`}
          sub={`vs ${formatInt(plannedToDate)} planejados`}
          tone={adherence >= 85 ? "primary" : "warning"}
        />
        <Kpi label="Duração" value={`${snapshot.days}d`} sub={snapshot.modo === "simultaneo" ? "simultâneo" : "sequencial"} />
      </div>

      {/* Grid principal: Curva + Top playlists */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm font-semibold">Curva de entrega</div>
                <div className="text-xs text-muted-foreground">Planejado por dia · acumulado</div>
              </div>
              <div className="text-right text-xs text-muted-foreground tabular-nums">
                média {formatInt(snapshot.mediaPorDia)}/dia · pico {formatInt(snapshot.picoPorDia)}
              </div>
            </div>
            <MiniCurva curva={snapshot.curva} elapsedDays={daysElapsed} />
            {onJumpTab && (
              <div className="mt-3 text-right">
                <Button variant="ghost" size="sm" onClick={() => onJumpTab("curve")} className="h-7 text-xs">
                  Ver curva completa <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold">Playlists no ar</div>
              <span className="text-xs text-muted-foreground tabular-nums">{topPlaylists.length}/{allocations.length}</span>
            </div>
            {topPlaylists.length === 0 ? (
              <div className="text-xs text-muted-foreground py-6 text-center">
                Nenhuma playlist ativa ainda.
              </div>
            ) : (
              <ul className="space-y-2.5">
                {topPlaylists.map(({ a, delivered: d, delta24 }) => {
                  const pl = a.managed_playlists;
                  const p = a.planned_streams > 0 ? Math.min(100, Math.round((d / a.planned_streams) * 100)) : 0;
                  return (
                    <li key={a.id} className="flex items-center gap-2.5">
                      {pl?.cover_url ? (
                        <img src={pl.cover_url} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
                      ) : (
                        <div className="w-8 h-8 rounded bg-muted grid place-items-center shrink-0">
                          <Music className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium truncate leading-tight">{pl?.name ?? "—"}</div>
                        <div className="h-1 rounded-full bg-muted overflow-hidden mt-1">
                          <div className="h-full bg-primary" style={{ width: `${p}%` }} />
                        </div>
                      </div>
                      <DeltaInline value={delta24} />
                    </li>
                  );
                })}
              </ul>
            )}
            {onJumpTab && allocations.length > 0 && (
              <div className="mt-3 text-right">
                <Button variant="ghost" size="sm" onClick={() => onJumpTab("playlists")} className="h-7 text-xs">
                  Ver todas <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Últimas provas */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Camera className="h-4 w-4 text-muted-foreground" />
              <div className="text-sm font-semibold">Últimas provas</div>
            </div>
            {onJumpTab && proofs.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => onJumpTab("proofs")} className="h-7 text-xs">
                Timeline completa <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            )}
          </div>
          {recentProofs.length === 0 ? (
            <div className="text-xs text-muted-foreground py-6 text-center">
              Sem provas capturadas ainda.
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {recentProofs.map((p) => (
                <a
                  key={p.id}
                  href={p.screenshot_url ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    "group rounded-lg overflow-hidden border border-border bg-muted/30 block",
                    !p.screenshot_url && "pointer-events-none",
                  )}
                >
                  <div className="aspect-video bg-muted relative overflow-hidden">
                    {p.screenshot_url ? (
                      <img src={p.screenshot_url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                    ) : (
                      <div className="w-full h-full grid place-items-center">
                        <TrendingUp className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <div className="p-2">
                    <div className="text-[11px] font-medium truncate">{p.playlist_name}</div>
                    <div className="text-[10px] text-muted-foreground flex items-center justify-between mt-0.5">
                      <span>{timeAgo(p.captured_at)}</span>
                      {p.delta_plays != null && p.delta_plays !== 0 && (
                        <span className={cn("tabular-nums", p.delta_plays > 0 ? "text-primary" : "text-destructive")}>
                          {p.delta_plays > 0 ? "+" : ""}{formatInt(p.delta_plays)}
                        </span>
                      )}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Financeiro só interno: custo NexEngine x venda pro cliente x margem */}
      {showFinance && (() => {
        const venda = snapshot.clientPriceTotal
          ?? (snapshot.pricePerStreamSell ? snapshot.meta * snapshot.pricePerStreamSell : 0);
        const custo = snapshot.custoTotal ?? 0;
        const margem = venda - custo;
        const margemPct = venda > 0 ? Math.round((margem / venda) * 100) : 0;
        return (
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-sm font-semibold">Resumo financeiro interno</div>
                  <div className="text-xs text-muted-foreground">
                    {snapshot.pricePerStreamSell
                      ? `Tabela de venda: R$ ${(snapshot.pricePerStreamSell * 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} / 1M streams`
                      : "Tabela de venda não definida"}
                  </div>
                </div>
                {onJumpTab && (
                  <Button variant="ghost" size="sm" onClick={() => onJumpTab("finance")} className="h-7 text-xs">
                    Detalhes <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <Kpi label="Custo (eu pago)" value={formatBRL(custo)} sub={`CPP R$ ${snapshot.custoPorStream.toFixed(3).replace(".", ",")}`} compact />
                <Kpi label="Venda (cliente paga)" value={formatBRL(venda)} sub={`${formatInt(snapshot.meta)} streams`} tone="primary" compact />
                <Kpi
                  label="Margem"
                  value={formatBRL(margem)}
                  sub={`${margemPct}% sobre venda`}
                  tone={margem > 0 ? "primary" : "warning"}
                  compact
                />
                <Kpi label="Split eco / ext" value={`${snapshot.splitEcoPct}% / ${100 - snapshot.splitEcoPct}%`} sub={`${formatInt(snapshot.streamsEco)} eco`} compact />
              </div>
            </CardContent>
          </Card>
        );
      })()}

    </div>
  );
}

function Kpi({ label, value, sub, tone, compact }: { label: string; value: string; sub?: string; tone?: "primary" | "warning"; compact?: boolean }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card", compact ? "p-3" : "p-4")}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
      <div className={cn(
        "font-semibold tabular-nums leading-tight mt-1",
        compact ? "text-lg" : "text-2xl",
        tone === "primary" && "text-primary",
        tone === "warning" && "text-warning",
      )}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground tabular-nums mt-1">{sub}</div>}
    </div>
  );
}

function DeltaInline({ value }: { value: number | null }) {
  if (value == null || value === 0) {
    return <span className="text-[10px] text-muted-foreground inline-flex items-center gap-0.5 shrink-0 tabular-nums"><Minus className="h-2.5 w-2.5" />—</span>;
  }
  if (value > 0) {
    return <span className="text-[10px] text-primary inline-flex items-center gap-0.5 shrink-0 tabular-nums font-medium"><TrendingUp className="h-2.5 w-2.5" />+{formatInt(value)}</span>;
  }
  return <span className="text-[10px] text-destructive inline-flex items-center gap-0.5 shrink-0 tabular-nums"><TrendingDown className="h-2.5 w-2.5" />{formatInt(value)}</span>;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "agora";
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function MiniCurva({ curva, elapsedDays }: { curva: CampaignSnapshot["curva"]; elapsedDays: number }) {
  if (curva.length === 0) return null;
  const w = 720, h = 180, pad = 16;
  const maxS = Math.max(...curva.map(p => p.streamsDay), 1);
  const maxC = curva[curva.length - 1].cumulative;
  const xs = (i: number) => pad + (i / Math.max(curva.length - 1, 1)) * (w - pad * 2);
  const ysBar = (v: number) => h - pad - (v / maxS) * (h - pad * 2);
  const yC = (v: number) => h - pad - (v / maxC) * (h - pad * 2);
  const lineCum = curva.map((p, i) => `${i === 0 ? "M" : "L"} ${xs(i)} ${yC(p.cumulative)}`).join(" ");
  const barW = Math.max(1, (w - pad * 2) / curva.length - 1);
  const todayX = elapsedDays > 0 ? xs(Math.min(elapsedDays - 1, curva.length - 1)) : null;

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-32" preserveAspectRatio="none">
        {curva.map((p, i) => (
          <rect
            key={p.day}
            x={xs(i) - barW / 2}
            y={ysBar(p.streamsDay)}
            width={barW}
            height={h - pad - ysBar(p.streamsDay)}
            fill="hsl(var(--primary))"
            opacity={i < elapsedDays ? 0.45 : 0.18}
          />
        ))}
        <path d={lineCum} fill="none" stroke="hsl(var(--primary))" strokeWidth={1.5} />
        {todayX !== null && (
          <line x1={todayX} y1={pad} x2={todayX} y2={h - pad} stroke="hsl(var(--primary))" strokeDasharray="2 2" opacity={0.5} />
        )}
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1 tabular-nums">
        <span>D1</span>
        <span>Hoje · D{elapsedDays || 1}</span>
        <span>D{curva.length}</span>
      </div>
    </div>
  );
}
