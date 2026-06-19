/* eslint-disable react-refresh/only-export-components -- co-located helpers/variants/hooks; split would force a large refactor with no runtime benefit (HMR only) */
// CurvaEntregaChart — gráfico de barras de entrega ao longo do tempo,
// dividido em 4 fases (Aquecimento · Aceleração · Permanência · Sustentação).
//
// Extraído de operacao/calculadora/CalculadoraResultado.tsx para virar
// componente compartilhado entre Calculadora (admin) e Portal do Cliente.
//
// Props:
//   curva       — vetor diário com { day, streamsDay, cumulative, streamsEcoDay?, streamsExtDay? }
//   inercia     — multiplicador exibido no rodapé (admin). Opcional.
//   clientMode  — quando true: esconde toggle Ecossistema/Externo (sempre "Todos")
//                 e esconde a linha "Inércia ×N" do rodapé. Usado no portal.
import { useMemo, useState } from "react";
import { Flame, Rocket, Activity, Anchor } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatInt } from "@/lib/campaignEngine";

export type CurvaPoint = {
  day: number;
  streamsDay: number;
  cumulative: number;
  streamsEcoDay?: number;
  streamsExtDay?: number;
};

type Phase = {
  key: "aq" | "ac" | "pm" | "su";
  label: string;
  icon: LucideIcon;
  start: number;          // D1-based inclusive
  end: number;            // inclusive
  color: string;          // tailwind text accent
  bar: string;            // fill hsl for the bar
  tint: string;           // tinted bg for the card
};

/** Divide a duração em 4 fases proporcionais (~28/18/26/28). */
export function buildPhases(days: number): Phase[] {
  if (days <= 0) return [];
  const c1 = Math.max(1, Math.round(days * 0.28));
  const c2 = Math.max(c1 + 1, Math.round(days * 0.46));
  const c3 = Math.max(c2 + 1, Math.round(days * 0.72));
  return [
    { key: "aq", label: "Aquecimento", icon: Flame,    start: 1,      end: c1,   color: "text-warning",          bar: "hsl(var(--warning) / 0.55)",          tint: "bg-warning/5 border-warning/30" },
    { key: "ac", label: "Aceleração",  icon: Rocket,   start: c1 + 1, end: c2,   color: "text-warning",          bar: "hsl(var(--warning) / 0.55)",          tint: "bg-warning/5 border-warning/30" },
    { key: "pm", label: "Permanência", icon: Activity, start: c2 + 1, end: c3,   color: "text-primary",          bar: "hsl(var(--primary) / 0.55)",          tint: "bg-primary/5 border-primary/30" },
    { key: "su", label: "Sustentação", icon: Anchor,   start: c3 + 1, end: days, color: "text-muted-foreground", bar: "hsl(var(--muted-foreground) / 0.45)", tint: "bg-muted/20 border-border" },
  ];
}

function phaseOfDay(day: number, phases: Phase[]): Phase {
  for (const p of phases) if (day >= p.start && day <= p.end) return p;
  return phases[phases.length - 1];
}

type CurvaView = "todos" | "eco" | "ext";

type Props = {
  curva: CurvaPoint[];
  inercia?: number;
  clientMode?: boolean;
};

export function CurvaEntregaChart({ curva, inercia, clientMode = false }: Props) {
  const [hoverDay, setHoverDay] = useState<number | null>(null);
  const [view, setView] = useState<CurvaView>("todos");
  const phases = useMemo(() => buildPhases(curva.length), [curva.length]);

  if (!curva.length) return null;

  // No clientMode forçamos sempre "todos" — sem split eco/externo.
  const activeView: CurvaView = clientMode ? "todos" : view;

  // Suporte a snapshots antigos sem split por dia: fallback p/ streamsDay.
  const valueOf = (c: CurvaPoint) =>
    activeView === "eco" ? (c.streamsEcoDay ?? 0)
    : activeView === "ext" ? (c.streamsExtDay ?? c.streamsDay)
    : c.streamsDay;

  // Escala TRAVADA no total — eco/ext aparecem proporcionalmente menores.
  const max = Math.max(1, ...curva.map(c => c.streamsDay));
  const total = curva.reduce((s, c) => s + valueOf(c), 0);

  // SVG dimensions — mais baixo e arejado pra leitura elegante
  const W = 800, H = 110, P = 6;
  const innerW = W - P * 2;
  const innerH = H - P * 2;
  const barW = innerW / curva.length;
  const gap = Math.min(2, barW * 0.32);
  const radius = Math.min(1.5, (barW - gap) / 2);

  const hover = hoverDay != null ? curva[hoverDay - 1] : null;
  const hoverPhase = hover ? phaseOfDay(hover.day, phases) : null;
  const hoverValue = hover ? valueOf(hover) : 0;

  const viewOptions: { key: CurvaView; label: string }[] = [
    { key: "todos", label: "Todos" },
    { key: "eco", label: "Ecossistema" },
    { key: "ext", label: "Externo" },
  ];

  return (
    <div className="space-y-3">
      {/* Toggle de visualização — só admin */}
      {!clientMode && (
        <div className="flex items-center justify-end gap-1">
          {viewOptions.map(opt => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setView(opt.key)}
              className={cn(
                "px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors",
                view === opt.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-transparent text-muted-foreground border-border hover:text-foreground hover:bg-muted/30",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Cards de fase — sempre visíveis na visão Todos */}
      {activeView === "todos" && (
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
      )}

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
            const h = max > 0 ? (valueOf(c) / max) * innerH : 0;
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
                  rx={radius}
                  ry={radius}
                  fill={activeView === "todos" ? ph.bar : activeView === "eco" ? "hsl(var(--primary) / 0.55)" : "hsl(var(--muted-foreground) / 0.45)"}
                  opacity={hoverDay && !isHover ? 0.35 : 0.85}
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
                <span className="text-right font-semibold">{formatInt(hoverValue)}</span>
                <span className="text-muted-foreground">Acumulado</span>
                <span className="text-right">{formatInt(hover.cumulative)}</span>
                <span className="text-muted-foreground">% do total</span>
                <span className="text-right">{total > 0 ? Math.round((hoverValue / total) * 100) : 0}%</span>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Marcadores de dia (D1, fronteiras de fase, último dia) */}
      <div className="relative h-4 text-[10px] text-muted-foreground tabular-nums">
        {(() => {
          const marks = new Set<number>([1, curva.length]);
          phases.forEach(p => { if (p.start > 1) marks.add(p.start); });
          return Array.from(marks).sort((a, b) => a - b).map(d => {
            const leftPct = ((d - 0.5) / curva.length) * 100;
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

      {/* Rodapé — Inércia só admin */}
      {activeView === "todos" && (
        <div className="mt-2 text-xs text-muted-foreground flex justify-between">
          {!clientMode && typeof inercia === "number"
            ? <span>Inércia: ×{inercia.toFixed(2)}</span>
            : <span />}
          <span>{curva.length} dias</span>
        </div>
      )}
    </div>
  );
}
