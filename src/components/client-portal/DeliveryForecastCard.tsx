// Previsão de entrega — duas curvas estáticas calculadas do simulation_snapshot:
//
//  CURVA 1 (linha principal, eixo esq.): plays/dia da MÚSICA dia a dia.
//    Começa em baselineStreamsDay (plays/dia atual da faixa) e soma a cada
//    dia o incremento planejado da campanha (meta × peso da rampa 20/60/20).
//
//  CURVA 2 (área sutil, eixo dir.): ACUMULADO entregue pela campanha dia a dia.
//    Começa em 0 e termina em `meta` no último dia (mesma rampa 20/60/20).
//
//  Benchmark (linha pontilhada): top200StreamsDay — plays/dia necessários
//  pra atingir a posição alvo do Top 200.
//
//  Ponto marcado: primeiro dia em que a curva 1 cruza o benchmark.
//
// Sem dados ao vivo, sem fetch, sem estado.
import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Sparkles } from "lucide-react";
import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine,
  ResponsiveContainer, Tooltip as ReTooltip, XAxis, YAxis,
} from "recharts";

export type ForecastPayload = {
  curve?: Array<{ day: number; cumulative: number }>;
  goalHitDay?: number | null;
  totalDays: number;
  goalPlays: number;
  startedAt?: string;
  top200Position?: number | null;
  top200StreamsDay?: number | null;
  baselineStreamsDay?: number | null;
  plannedDailyAverage?: number;
};

type Props = { forecast: ForecastPayload };

function formatPlays(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return Math.round(n).toString();
}
function formatFull(n: number): string {
  return new Intl.NumberFormat("pt-BR").format(Math.round(n));
}

// Rampa 20/60/20: peso por dia. Soma == 1.
function buildRampWeights(days: number): number[] {
  if (days <= 0) return [];
  const n1 = Math.max(1, Math.floor(days * 0.2));
  const n3 = Math.max(1, Math.floor(days * 0.2));
  const n2 = Math.max(1, days - n1 - n3);
  const w: number[] = [];
  for (let i = 0; i < n1; i++) w.push(0.10 / n1);
  for (let i = 0; i < n2; i++) w.push(0.70 / n2);
  for (let i = 0; i < n3; i++) w.push(0.20 / n3);
  while (w.length < days) w.push(w[w.length - 1] ?? 0);
  return w.slice(0, days);
}

export function DeliveryForecastCard({ forecast }: Props) {
  const {
    totalDays, goalPlays,
    top200Position, top200StreamsDay,
    baselineStreamsDay,
  } = forecast;

  const data = useMemo(() => {
    const days = Math.max(1, totalDays || 0);
    const meta = Math.max(0, goalPlays || 0);
    const baseline = Math.max(0, baselineStreamsDay ?? 0);
    const weights = buildRampWeights(days);

    let running = 0;
    const points = weights.map((w, i) => {
      const delivered = meta * w;
      running += delivered;
      return {
        day: i + 1,
        label: `D${i + 1}`,
        playsDay: Math.round(baseline + delivered),
        acumulado: Math.round(running),
      };
    });

    // Marco: primeiro dia em que plays/dia da música cruza o benchmark.
    let markDay: number | null = null;
    let markValue: number | null = null;
    if (top200StreamsDay && top200Position) {
      for (let i = 0; i < points.length; i++) {
        if (points[i].playsDay >= top200StreamsDay) {
          markDay = i + 1;
          markValue = points[i].playsDay;
          break;
        }
      }
    }

    const dailyAvg = days > 0 ? Math.round(meta / days) : 0;
    return { points, markDay, markValue, dailyAvg, days, meta, baseline };
  }, [totalDays, goalPlays, top200Position, top200StreamsDay, baselineStreamsDay]);

  if (data.points.length < 2 || data.meta <= 0) return null;

  return (
    <Card className="border-border">
      <CardContent className="p-5 sm:p-6 space-y-5">
        <div>
          <h2 className="text-[15px] font-semibold inline-flex items-center gap-2 tracking-tight">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            Previsão de entrega
          </h2>
          <p className="text-[12px] text-muted-foreground mt-1 leading-snug">
            Plays/dia projetados da música e total acumulado pela campanha
          </p>
        </div>

        <div className="h-[260px] sm:h-[300px] w-full -mx-2">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data.points} margin={{ top: 24, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="g_forecast_acum" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false} tickLine={false} minTickGap={24}
              />
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false} tickLine={false}
                tickFormatter={(v) => formatPlays(v as number)} width={48}
              />
              <YAxis
                yAxisId="right" orientation="right"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false} tickLine={false}
                tickFormatter={(v) => formatPlays(v as number)} width={48}
              />
              <ReTooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 12, fontSize: 12,
                }}
                labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                formatter={(v: number, name: string) => {
                  if (name === "playsDay") return [formatFull(v), "Plays/dia da música"];
                  if (name === "acumulado") return [formatFull(v), "Entregue pela campanha"];
                  return [formatFull(v), name];
                }}
              />

              {/* Benchmark — plays/dia necessários pra posição alvo */}
              {top200StreamsDay && top200Position && (
                <ReferenceLine
                  yAxisId="left"
                  y={top200StreamsDay}
                  stroke="hsl(var(--muted-foreground))"
                  strokeDasharray="2 4"
                  strokeOpacity={0.6}
                  label={{
                    value: `Top ${top200Position} · ${formatPlays(top200StreamsDay)}/dia`,
                    position: "insideTopRight",
                    fill: "hsl(var(--muted-foreground))",
                    fontSize: 10, fillOpacity: 0.9,
                  }}
                />
              )}

              {/* Curva 2 — acumulado entregue (área sutil, eixo direito) */}
              <Area
                yAxisId="right"
                type="monotone" dataKey="acumulado"
                stroke="hsl(var(--primary))" strokeOpacity={0.35} strokeWidth={1}
                fill="url(#g_forecast_acum)"
                isAnimationActive={false}
              />

              {/* Curva 1 — plays/dia da música (linha principal, eixo esquerdo) */}
              <Line
                yAxisId="left"
                type="monotone" dataKey="playsDay"
                stroke="hsl(var(--primary))" strokeWidth={2.25}
                dot={false} isAnimationActive={false}
              />

              {/* Marco — dia que cruza o benchmark */}
              {data.markDay && data.markValue != null && (
                <ReferenceDot
                  yAxisId="left"
                  x={`D${data.markDay}`} y={data.markValue}
                  r={5}
                  fill="hsl(var(--primary))"
                  stroke="hsl(var(--background))"
                  strokeWidth={2}
                  label={{
                    value: `Top ${top200Position} estimado · D${data.markDay}`,
                    position: "top",
                    fill: "hsl(var(--primary))",
                    fontSize: 10.5, fontWeight: 600,
                  }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-[2px] w-4 bg-primary rounded" />
            Plays/dia da música
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-3 bg-primary/25 rounded-sm" />
            Acumulado da campanha
          </span>
          {top200StreamsDay && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-[2px] w-4 border-t-2 border-dashed border-muted-foreground/60" />
              Benchmark Top {top200Position}
            </span>
          )}
        </div>

        <div className="space-y-1.5">
          <p className="text-[12.5px] text-foreground/85 leading-relaxed">
            Ritmo planejado: {formatFull(data.dailyAvg)} plays/dia · Meta total: {formatFull(data.meta)} plays em {data.days} dias
            {data.baseline > 0 && <> · Base atual da música: {formatFull(data.baseline)} plays/dia</>}
          </p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Esta é uma estimativa da curva esperada. A meta contratada será entregue — esta projeção mostra o ritmo planejado, que pode variar dia a dia.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
