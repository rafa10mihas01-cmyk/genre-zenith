import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBRL, formatInt, type CampaignResult } from "@/lib/campaignEngine";
import { TrendingUp, Wallet, Zap, Layers, Flame, Rocket, Activity, Anchor } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

/** KPIs do resultado — renderizar separadamente no topo da página. */
export function CalculadoraKpis({ r }: { r: CampaignResult }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Kpi icon={TrendingUp} label="Meta" value={formatInt(r.meta)} hint="streams totais" />
      <Kpi icon={Wallet} label="Custo total" value={formatBRL(r.custoTotal)} hint={`R$ ${r.custoPorStream.toFixed(3)}/stream`} />
      <Kpi icon={Zap} label="Pico/dia" value={formatInt(r.picoPorDia)} hint={`média ${formatInt(r.mediaPorDia)}`} />
      <Kpi icon={Layers} label="Duração" value={`${r.days}d`} hint={r.modo === "simultaneo" ? "simultâneo" : "sequencial"} />
    </div>
  );
}

export function CalculadoraResultado({ r }: { r: CampaignResult }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Distribuição do investimento</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <SplitBar
            label="Ecossistema próprio"
            pct={r.splitEcoPct}
            streams={r.streamsEco}
            custo={r.custoEco}
            tone="primary"
          />
          <SplitBar
            label="Ecossistema externo"
            pct={100 - r.splitEcoPct}
            streams={r.streamsExt}
            custo={r.custoExt}
            tone="muted"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Curva de entrega</CardTitle>
        </CardHeader>
        <CardContent>
          <CurvaChart curva={r.curva} />
          <div className="mt-3 text-xs text-muted-foreground flex justify-between">
            <span>Inércia: ×{r.inercia.toFixed(2)}</span>
            <span>{r.curva.length} dias</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, hint }: { icon: any; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="text-xl font-semibold mt-1 tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

function SplitBar({
  label, pct, streams, custo, tone,
}: { label: string; pct: number; streams: number; custo: number; tone: "primary" | "muted" }) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1.5">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {pct}% · {formatInt(streams)} streams · <span className="text-foreground font-semibold">{formatBRL(custo)}</span>
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={tone === "primary" ? "h-full bg-primary" : "h-full bg-muted-foreground/40"}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ============================================================================
// Curva de entrega — gráfico de barras com fases coloridas, tooltip e marcadores
// ============================================================================

type Phase = {
  key: "aq" | "ac" | "pm" | "su";
  label: string;
  icon: any;
  start: number;          // D1-based inclusive
  end: number;            // inclusive
  color: string;          // tailwind text/bg accent
  bar: string;            // fill hex/hsl for the bar
  tint: string;           // tinted bg for the card
};

/** Divide a duração em 4 fases proporcionais (~28/18/26/28). */
function buildPhases(days: number): Phase[] {
  if (days <= 0) return [];
  const c1 = Math.max(1, Math.round(days * 0.28));
  const c2 = Math.max(c1 + 1, Math.round(days * 0.46));
  const c3 = Math.max(c2 + 1, Math.round(days * 0.72));
  return [
    { key: "aq", label: "Aquecimento", icon: Flame,    start: 1,      end: c1,   color: "text-warning",        bar: "hsl(var(--warning))",       tint: "bg-warning/5 border-warning/30" },
    { key: "ac", label: "Aceleração",  icon: Rocket,   start: c1 + 1, end: c2,   color: "text-warning",        bar: "hsl(var(--warning))",       tint: "bg-warning/5 border-warning/30" },
    { key: "pm", label: "Permanência", icon: Activity, start: c2 + 1, end: c3,   color: "text-primary",        bar: "hsl(var(--primary))",       tint: "bg-primary/5 border-primary/30" },
    { key: "su", label: "Sustentação", icon: Anchor,   start: c3 + 1, end: days, color: "text-muted-foreground", bar: "hsl(var(--muted-foreground))", tint: "bg-muted/20 border-border" },
  ];
}

function phaseOfDay(day: number, phases: Phase[]): Phase {
  for (const p of phases) if (day >= p.start && day <= p.end) return p;
  return phases[phases.length - 1];
}

function CurvaChart({ curva }: { curva: CampaignResult["curva"] }) {
  const [hoverDay, setHoverDay] = useState<number | null>(null);
  const phases = useMemo(() => buildPhases(curva.length), [curva.length]);

  if (!curva.length) return null;

  const max = Math.max(...curva.map(c => c.streamsDay));
  const total = curva[curva.length - 1]?.cumulative ?? 0;

  // SVG dimensions
  const W = 800, H = 180, P = 8;
  const innerW = W - P * 2;
  const innerH = H - P * 2;
  const barW = innerW / curva.length;
  const gap = Math.min(1.5, barW * 0.18);

  const hover = hoverDay != null ? curva[hoverDay - 1] : null;
  const hoverPhase = hover ? phaseOfDay(hover.day, phases) : null;

  return (
    <div className="space-y-3">
      {/* Cards de fase */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {phases.map(ph => {
          const dur = ph.end - ph.start + 1;
          const Icon = ph.icon;
          return (
            <div key={ph.key} className={cn("rounded-xl border p-2.5", ph.tint)}>
              <div className={cn("flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold", ph.color)}>
                <Icon className="h-3 w-3" />
                {ph.label}
              </div>
              <div className="text-base font-semibold mt-1 tabular-nums">{dur}d</div>
              <div className="text-[10px] text-muted-foreground tabular-nums">
                D{ph.start}—D{ph.end}
              </div>
            </div>
          );
        })}
      </div>

      {/* Gráfico de barras com tooltip */}
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto block"
          preserveAspectRatio="none"
          onMouseLeave={() => setHoverDay(null)}
        >
          {/* baseline */}
          <line x1={P} x2={W - P} y1={H - P} y2={H - P} stroke="hsl(var(--border))" strokeWidth="0.5" />

          {curva.map((c, i) => {
            const ph = phaseOfDay(c.day, phases);
            const h = max > 0 ? (c.streamsDay / max) * innerH : 0;
            const x = P + i * barW;
            const y = H - P - h;
            const isHover = hoverDay === c.day;
            return (
              <g key={c.day}>
                <rect
                  x={x + gap / 2}
                  y={y}
                  width={Math.max(0.5, barW - gap)}
                  height={Math.max(0.5, h)}
                  fill={ph.bar}
                  opacity={hoverDay && !isHover ? 0.45 : 1}
                />
                {/* hover hitbox covering full column height */}
                <rect
                  x={x}
                  y={P}
                  width={barW}
                  height={innerH}
                  fill="transparent"
                  onMouseEnter={() => setHoverDay(c.day)}
                />
                {isHover && (
                  <line x1={x + barW / 2} x2={x + barW / 2} y1={P} y2={H - P} stroke="hsl(var(--foreground))" strokeWidth="0.5" strokeDasharray="2 2" opacity="0.5" />
                )}
              </g>
            );
          })}
        </svg>

        {/* Tooltip flutuante */}
        {hover && hoverPhase && (() => {
          const idx = hover.day - 1;
          const leftPct = ((idx + 0.5) / curva.length) * 100;
          const flip = leftPct > 65;
          const PhIcon = hoverPhase.icon;
          return (
            <div
              className="pointer-events-none absolute top-1 z-10 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg px-3 py-2 text-[11px] min-w-[160px]"
              style={{ left: `${leftPct}%`, transform: `translateX(${flip ? "-100%" : "0"})` }}
            >
              <div className={cn("font-semibold tabular-nums flex items-center gap-1", hoverPhase.color)}>
                <PhIcon className="h-3 w-3" />
                D{hover.day} · {hoverPhase.label}
              </div>
              <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 tabular-nums text-foreground">
                <span className="text-muted-foreground">No dia</span>
                <span className="text-right font-semibold">{formatInt(hover.streamsDay)}</span>
                <span className="text-muted-foreground">Acumulado</span>
                <span className="text-right">{formatInt(hover.cumulative)}</span>
                <span className="text-muted-foreground">% da meta</span>
                <span className="text-right">{total > 0 ? Math.round((hover.cumulative / total) * 100) : 0}%</span>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Marcadores de dia (D1, fronteiras de fase, último dia) */}
      <div className="relative h-4 text-[10px] text-muted-foreground tabular-nums">
        {(() => {
          const marks = new Set<number>([1, curva.length]);
          // Apenas o início de cada fase (evita sobreposição D17/D18, D28/D29...)
          phases.forEach(p => { if (p.start > 1) marks.add(p.start); });
          return Array.from(marks).sort((a, b) => a - b).map(d => {
            const leftPct = ((d - 0.5) / curva.length) * 100;
            const align = d === 1 ? "left-0 translate-x-0" : d === curva.length ? "right-0 -translate-x-0 left-auto" : "-translate-x-1/2";
            return (
              <span
                key={d}
                className={cn("absolute", d === curva.length ? "right-0" : "")}
                style={d === curva.length ? undefined : { left: `${leftPct}%` }}
              >
                <span className={cn("inline-block", d !== 1 && d !== curva.length && "-translate-x-1/2")}>D{d}</span>
              </span>
            );
          });
        })()}
      </div>
    </div>
  );
}

