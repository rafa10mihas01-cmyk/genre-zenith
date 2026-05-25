// Previsão de entrega — gráfico híbrido: REAL acumulado (linha sólida) +
// PROJEÇÃO inteligente a partir de hoje (linha tracejada), com marco da
// posição alvo do chart (Top 200) quando a campanha tem `top200Position`
// no snapshot. Quando não tem (meta manual), mostra só o marco da meta.
import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Sparkles } from "lucide-react";
import {
  CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine,
  ResponsiveContainer, Tooltip as ReTooltip, XAxis, YAxis,
} from "recharts";

export type ForecastPayload = {
  curve: Array<{ day: number; cumulative: number }>;
  goalHitDay: number | null;
  totalDays: number;
  goalPlays: number;
  startedAt?: string;
  top200Position?: number | null;
  top200StreamsDay?: number | null;
  plannedDailyAverage?: number;
};

export type EvolutionPoint = { date: string; delivered: number };

type Props = {
  forecast: ForecastPayload;
  evolutionSeries?: EvolutionPoint[];
};

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

export function DeliveryForecastCard({ forecast, evolutionSeries = [] }: Props) {
  const {
    totalDays, goalPlays,
    startedAt, top200Position, top200StreamsDay,
    plannedDailyAverage = 0,
  } = forecast;

  // Benchmark de chart: top200StreamsDay × 30 (equivalente mensal cumulativo
  // pra "manter a posição X" no Top 200 ao longo de um mês).
  const chartBenchmark = top200Position && top200StreamsDay
    ? top200StreamsDay * 30
    : null;

  const data = useMemo(() => {
    const days = Math.max(1, totalDays || 30);
    const start = startedAt ? new Date(startedAt) : null;

    // 1) Curva REAL — agrega evolutionSeries por dia da campanha (D1..DN).
    const realByDay: number[] = Array.from({ length: days }, () => 0);
    if (start && evolutionSeries.length > 0) {
      for (const p of evolutionSeries) {
        const t = new Date(p.date).getTime();
        const dayIdx = Math.floor((t - start.getTime()) / 86_400_000);
        if (dayIdx >= 0 && dayIdx < days) {
          realByDay[dayIdx] += Math.max(0, p.delivered || 0);
        }
      }
    }

    // 2) Dia atual relativo à campanha (1-based, clamp).
    const today = start
      ? Math.min(days, Math.max(1, Math.ceil((Date.now() - start.getTime()) / 86_400_000)))
      : 1;

    // 3) Cumulativo real até hoje.
    let runningReal = 0;
    const realCumByDay: (number | null)[] = Array.from({ length: days }, () => null);
    for (let i = 0; i < today; i++) {
      runningReal += realByDay[i] ?? 0;
      realCumByDay[i] = runningReal;
    }
    const cumulativeNow = runningReal;

    // 4) Ritmo dos últimos 7 dias com dados reais (> 0). Se 0, cai pro planejado.
    const recentDays = realByDay.slice(Math.max(0, today - 7), today);
    const nonZero = recentDays.filter((v) => v > 0);
    const avgRecent = nonZero.length > 0
      ? nonZero.reduce((s, v) => s + v, 0) / nonZero.length
      : 0;
    const rate = avgRecent > 0 ? avgRecent : Math.max(0, plannedDailyAverage);

    // 5) Projeção linear a partir de hoje. Estende até cruzar benchmark/goal,
    //    sem exceder totalDays*2 (proteção).
    const projCumByDay: (number | null)[] = Array.from({ length: days }, () => null);
    if (today >= 1 && today <= days) {
      projCumByDay[today - 1] = cumulativeNow;
      for (let i = today; i < days; i++) {
        projCumByDay[i] = (projCumByDay[i - 1] ?? cumulativeNow) + rate;
      }
    }

    // 6) Dia do marco (benchmark do chart OU goal_plays quando não há chart).
    const targetForMark = chartBenchmark ?? (goalPlays > 0 ? goalPlays : null);
    let markDay: number | null = null;
    let markValue: number | null = null;
    if (targetForMark) {
      for (let i = 0; i < days; i++) {
        const cum = realCumByDay[i] ?? projCumByDay[i];
        if (cum != null && cum >= targetForMark) { markDay = i + 1; markValue = cum; break; }
      }
      // Se não cruza dentro do prazo mas tem ritmo, extrapola só pra label.
      if (markDay === null && rate > 0) {
        const remaining = targetForMark - cumulativeNow;
        if (remaining > 0) {
          const extraDays = Math.ceil(remaining / rate);
          const cand = today + extraDays;
          if (cand <= days * 2) { markDay = cand; markValue = targetForMark; }
        }
      }
    }

    const points = Array.from({ length: days }, (_, i) => ({
      day: i + 1,
      label: `D${i + 1}`,
      real: realCumByDay[i],
      projecao: projCumByDay[i],
    }));

    return { points, today, markDay, markValue, rate, cumulativeNow, targetForMark };
  }, [evolutionSeries, totalDays, startedAt, plannedDailyAverage, chartBenchmark, goalPlays]);

  if (data.points.length < 2) return null;

  const sentence = (() => {
    if (data.markDay && chartBenchmark && top200Position) {
      return `No ritmo atual (${formatFull(data.rate)} plays/dia), a faixa atinge o equivalente da posição #${top200Position} do Top 200 por volta do dia ${data.markDay}.`;
    }
    if (data.markDay && goalPlays > 0) {
      return `No ritmo atual (${formatFull(data.rate)} plays/dia), a meta de ${formatFull(goalPlays)} plays é atingida por volta do dia ${data.markDay}.`;
    }
    return `Ritmo atual de ${formatFull(data.rate)} plays/dia ao longo de ${totalDays} dias.`;
  })();

  return (
    <Card className="border-border">
      <CardContent className="p-5 sm:p-6 space-y-5">
        <div>
          <h2 className="text-[15px] font-semibold inline-flex items-center gap-2 tracking-tight">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            Previsão de entrega
          </h2>
          <p className="text-[12px] text-muted-foreground mt-1 leading-snug">
            Plays reais entregues e projeção a partir de hoje
          </p>
        </div>

        <div className="h-[240px] sm:h-[280px] w-full -mx-2">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data.points} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false} tickLine={false} minTickGap={24}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false} tickLine={false}
                tickFormatter={(v) => formatPlays(v as number)} width={44}
              />
              <ReTooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 12, fontSize: 12,
                }}
                labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                formatter={(v: number, name: string) => {
                  const label = name === "real" ? "Entregue" : "Projeção";
                  return [formatFull(v), label];
                }}
              />

              {/* Benchmark do chart (cinza, pontilhado) */}
              {chartBenchmark && (
                <ReferenceLine
                  y={chartBenchmark}
                  stroke="hsl(var(--muted-foreground))"
                  strokeDasharray="2 4"
                  strokeOpacity={0.55}
                  label={{
                    value: `Top ${top200Position} · ${formatPlays(chartBenchmark)}`,
                    position: "insideTopRight",
                    fill: "hsl(var(--muted-foreground))",
                    fontSize: 10, fillOpacity: 0.85,
                  }}
                />
              )}

              {/* Meta contratada (quando não tem chart, vira referência principal) */}
              {!chartBenchmark && goalPlays > 0 && (
                <ReferenceLine
                  y={goalPlays}
                  stroke="hsl(var(--primary))"
                  strokeDasharray="4 4"
                  strokeOpacity={0.5}
                  label={{
                    value: `Meta · ${formatPlays(goalPlays)}`,
                    position: "insideTopRight",
                    fill: "hsl(var(--primary))",
                    fontSize: 10, fillOpacity: 0.85,
                  }}
                />
              )}

              {/* Real — linha sólida verde */}
              <Line
                type="monotone" dataKey="real"
                stroke="hsl(var(--primary))" strokeWidth={2}
                dot={false} isAnimationActive={false}
                connectNulls={false}
              />

              {/* Projeção — linha tracejada verde clara */}
              <Line
                type="monotone" dataKey="projecao"
                stroke="hsl(var(--primary))" strokeWidth={1.5}
                strokeDasharray="5 4" strokeOpacity={0.55}
                dot={false} isAnimationActive={false}
                connectNulls={false}
              />

              {/* Marco do dia estimado */}
              {data.markDay && data.markValue != null && data.markDay <= totalDays && (
                <ReferenceDot
                  x={`D${data.markDay}`} y={data.markValue}
                  r={5}
                  fill="hsl(var(--primary))"
                  stroke="hsl(var(--background))"
                  strokeWidth={2}
                  label={{
                    value: chartBenchmark && top200Position
                      ? `Top ${top200Position} estimado · D${data.markDay}`
                      : `Meta estimada · D${data.markDay}`,
                    position: "top",
                    fill: "hsl(var(--primary))",
                    fontSize: 10.5, fontWeight: 600,
                  }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="space-y-1.5">
          <p className="text-[12.5px] text-foreground/85 leading-relaxed">
            {sentence}
          </p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Estimativa baseada no ritmo atual. Não é garantia de resultado.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
