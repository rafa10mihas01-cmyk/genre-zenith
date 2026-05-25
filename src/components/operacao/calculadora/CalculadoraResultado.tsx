import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBRL, formatInt, computePhaseDays, type CampaignResult } from "@/lib/campaignEngine";
import { TrendingUp, Wallet, Zap, Layers, Coins, Info } from "lucide-react";
import { CurvaEntregaChart } from "@/components/shared/CurvaEntregaChart";

/** KPIs do resultado — hierarquia operacional:
 *   META é o headline (peso visual dominante)
 *   Pico/dia e Duração são secundários (leitura tática)
 *   Custo é terciário (referência financeira)
 *   Cliente paga é o valor cobrado (se pricePerStreamSell informado)
 */
export function CalculadoraKpis({ r, pricePerStreamSell }: { r: CampaignResult; pricePerStreamSell?: number }) {
  const clientTotal = pricePerStreamSell && pricePerStreamSell > 0
    ? Math.round(r.meta * pricePerStreamSell * 100) / 100
    : null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {/* Headline — ocupa 2 colunas no desktop, tipografia maior, acento primary */}
      <KpiHero
        icon={TrendingUp}
        label="Meta"
        value={formatInt(r.meta)}
        hint="streams totais planejados"
      />
      <Kpi
        icon={Zap}
        label="Pico/dia"
        value={formatInt(r.picoPorDia)}
        hint={`média ${formatInt(r.mediaPorDia)}`}
      />
      <Kpi
        icon={Layers}
        label="Duração"
        value={`${r.days}d`}
        hint={`plano real: ${r.effectiveDays}d`}
      />
      {clientTotal != null ? (
        <KpiClient
          icon={Coins}
          label="Cliente paga"
          value={formatBRL(clientTotal)}
          hint={`custo ${formatBRL(r.custoTotal)} · margem ${formatBRL(clientTotal - r.custoTotal)}`}
        />
      ) : (
        <KpiQuiet
          icon={Wallet}
          label="Custo"
          value={formatBRL(r.custoTotal)}
          hint={`R$ ${r.custoPorStream.toFixed(3)}/stream`}
        />
      )}
    </div>
  );
}


export function CalculadoraResultado({ r }: { r: CampaignResult }) {
  const phases = computePhaseDays(r.effectiveDays);
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/20 px-3 py-2.5 text-[12px] text-foreground/85">
        <Info className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
        <span className="leading-relaxed">
          Duração contratada: <strong className="text-foreground">{r.days} dias</strong> · Duração real do plano: <strong className="text-foreground">{r.effectiveDays} dias</strong>{" "}
          <span className="text-muted-foreground">
            (inclui {phases.ramp} dias de rampa + {phases.outro} dias de saída suave)
          </span>
        </span>
      </div>

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
          <CurvaChart curva={r.curva} inercia={r.inercia} />
        </CardContent>
      </Card>
    </div>
  );
}

/** KPI headline — destaque máximo, ocupa 2 colunas no desktop */
function KpiHero({ icon: Icon, label, value, hint }: { icon: any; label: string; value: string; hint?: string }) {
  return (
    <div className="md:col-span-2 rounded-2xl border border-border border-l-2 border-l-primary bg-card p-4 relative overflow-hidden">
      {/* glow sutil verde no canto — cockpit feel */}
      <div className="absolute -top-12 -right-12 h-32 w-32 rounded-full bg-primary/10 blur-2xl pointer-events-none" aria-hidden />
      <div className="relative flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] font-semibold text-primary">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="relative text-3xl md:text-4xl font-semibold mt-1.5 tabular-nums tracking-tight text-foreground">
        {value}
      </div>
      {hint && <div className="relative text-xs text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}

/** KPI secundário — leitura tática */
function Kpi({ icon: Icon, label, value, hint }: { icon: any; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="text-xl font-semibold mt-1 tabular-nums text-foreground">{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

/** KPI terciário — referência financeira, peso reduzido */
function KpiQuiet({ icon: Icon, label, value, hint }: { icon: any; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground/80">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="text-lg font-medium mt-1 tabular-nums text-muted-foreground">{value}</div>
      {hint && <div className="text-xs text-muted-foreground/70 mt-0.5">{hint}</div>}
    </div>
  );
}

/** KPI cliente — destaca o valor cobrado, com borda primary suave */
function KpiClient({ icon: Icon, label, value, hint }: { icon: any; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-primary/40 bg-primary/5 p-4">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider font-semibold text-primary">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="text-xl font-semibold mt-1 tabular-nums text-foreground">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
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
    { key: "aq", label: "Aquecimento", icon: Flame,    start: 1,      end: c1,   color: "text-warning",        bar: "hsl(var(--warning) / 0.55)",          tint: "bg-warning/5 border-warning/30" },
    { key: "ac", label: "Aceleração",  icon: Rocket,   start: c1 + 1, end: c2,   color: "text-warning",        bar: "hsl(var(--warning) / 0.55)",          tint: "bg-warning/5 border-warning/30" },
    { key: "pm", label: "Permanência", icon: Activity, start: c2 + 1, end: c3,   color: "text-primary",        bar: "hsl(var(--primary) / 0.55)",          tint: "bg-primary/5 border-primary/30" },
    { key: "su", label: "Sustentação", icon: Anchor,   start: c3 + 1, end: days, color: "text-muted-foreground", bar: "hsl(var(--muted-foreground) / 0.45)", tint: "bg-muted/20 border-border" },
  ];
}

function phaseOfDay(day: number, phases: Phase[]): Phase {
  for (const p of phases) if (day >= p.start && day <= p.end) return p;
  return phases[phases.length - 1];
}

type CurvaView = "todos" | "eco" | "ext";

function CurvaChart({ curva, inercia }: { curva: CampaignResult["curva"]; inercia: number }) {
  const [hoverDay, setHoverDay] = useState<number | null>(null);
  const [view, setView] = useState<CurvaView>("todos");
  const phases = useMemo(() => buildPhases(curva.length), [curva.length]);

  if (!curva.length) return null;

  // Suporte a snapshots antigos sem split por dia: fallback p/ streamsDay.
  const valueOf = (c: CampaignResult["curva"][number]) =>
    view === "eco" ? (c.streamsEcoDay ?? 0)
    : view === "ext" ? (c.streamsExtDay ?? c.streamsDay)
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
      {/* Toggle de visualização */}
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

      {/* Cards de fase — só na visão Todos */}
      {view === "todos" && (
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
                  fill={view === "todos" ? ph.bar : view === "eco" ? "hsl(var(--primary) / 0.55)" : "hsl(var(--muted-foreground) / 0.45)"}
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

      {/* Rodapé só na visão Todos (final consolidado da campanha). */}
      {view === "todos" && (
        <div className="mt-2 text-xs text-muted-foreground flex justify-between">
          <span>Inércia: ×{inercia.toFixed(2)}</span>
          <span>{curva.length} dias</span>
        </div>
      )}
    </div>
  );
}

