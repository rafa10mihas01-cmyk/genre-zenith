// Previsão de entrega — usa a curva JÁ CALCULADA pelo motor em
// simulation_snapshot.curva (exposta no payload como forecast.curve).
// Não recalculamos nada localmente: o motor já aplicou rampa de entrada,
// platô e saída suave sobre os effective_days.
//
//  Y = baselineStreamsDay + cumulative[day]  (plays totais da música no dia)
//  Benchmark (linha pontilhada): top200StreamsDay
//  Ponto verde: primeiro dia em que Y >= top200StreamsDay
import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Sparkles } from "lucide-react";
import {
  CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine,
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

export function DeliveryForecastCard({ forecast }: Props) {
  const {
    curve, totalDays, goalPlays,
    top200Position, top200StreamsDay,
    baselineStreamsDay,
  } = forecast;

  const data = useMemo(() => {
    const baseline = Math.max(0, baselineStreamsDay ?? 0);
    const meta = Math.max(0, goalPlays || 0);
    const src = Array.isArray(curve) ? curve : [];

    // Eixo X = dias da curva do motor; Y = baseline + cumulative[day]
    const points = src.map((c) => ({
      day: c.day,
      label: `D${c.day}`,
      acumulado: Math.round(baseline + Math.max(0, c.cumulative || 0)),
    }));

    // Primeiro dia onde Y cruza o benchmark do Top 200
    let markDay: number | null = null;
    let markValue: number | null = null;
    if (top200StreamsDay && top200StreamsDay > 0) {
      for (let i = 0; i < points.length; i++) {
        if (points[i].acumulado >= top200StreamsDay) {
          markDay = points[i].day;
          markValue = points[i].acumulado;
          break;
        }
      }
    }

    const days = points.length || Math.max(1, totalDays || 0);
    const dailyAvg = days > 0 ? Math.round(meta / days) : 0;
    return { points, markDay, markValue, dailyAvg, days, meta, baseline };
  }, [curve, totalDays, goalPlays, top200StreamsDay, baselineStreamsDay]);

  if (data.points.length < 2) return null;

  const showBenchmark = !!(top200StreamsDay && top200StreamsDay > 0);

  return (
    <Card className="border-border">
      <CardContent className="p-5 sm:p-6 space-y-5">
        <div>
          <h2 className="text-[15px] font-semibold inline-flex items-center gap-2 tracking-tight">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            Previsão de entrega
          </h2>
          <p className="text-[12px] text-muted-foreground mt-1 leading-snug">
            Plays acumulados da música ao longo da campanha
          </p>
        </div>

        <div className="h-[260px] sm:h-[300px] w-full -mx-2">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data.points} margin={{ top: 24, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false} tickLine={false} minTickGap={24}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false} tickLine={false}
                tickFormatter={(v) => formatPlays(v as number)} width={52}
                domain={[
                  (dataMin: number) => Math.max(0, Math.floor(dataMin * 0.95)),
                  (dataMax: number) => Math.ceil(dataMax * 1.05),
                ]}
              />
              <ReTooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 12, fontSize: 12,
                }}
                labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                formatter={(v: number) => [formatFull(v), "Plays acumulados"]}
              />

              {showBenchmark && (
                <ReferenceLine
                  y={top200StreamsDay as number}
                  stroke="hsl(var(--muted-foreground))"
                  strokeDasharray="2 4"
                  strokeOpacity={0.6}
                  label={{
                    value: top200Position
                      ? `Top ${top200Position} · ${formatPlays(top200StreamsDay as number)}`
                      : `Benchmark · ${formatPlays(top200StreamsDay as number)}`,
                    position: "insideTopRight",
                    fill: "hsl(var(--muted-foreground))",
                    fontSize: 10, fillOpacity: 0.9,
                  }}
                />
              )}

              <Line
                type="basis" dataKey="acumulado"
                stroke="hsl(var(--primary))" strokeWidth={2.5}
                strokeLinecap="round" strokeLinejoin="round"
                dot={false} isAnimationActive={false}
              />

              {showBenchmark && data.markDay && data.markValue != null && (
                <ReferenceDot
                  x={`D${data.markDay}`} y={data.markValue}
                  r={5}
                  fill="hsl(var(--primary))"
                  stroke="hsl(var(--background))"
                  strokeWidth={2}
                  label={{
                    value: top200Position
                      ? `Top ${top200Position} · Dia ${data.markDay}`
                      : `Dia ${data.markDay}`,
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
            Acumulado da música
          </span>
          {showBenchmark && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-[2px] w-4 border-t-2 border-dashed border-muted-foreground/60" />
              {top200Position ? `Benchmark Top ${top200Position}` : "Benchmark"}
            </span>
          )}
        </div>

        <div className="space-y-1.5">
          <p className="text-[12.5px] text-foreground/85 leading-relaxed">
            Ritmo planejado: {formatFull(data.dailyAvg)} plays/dia · Meta total: {formatFull(data.meta)} plays em {data.days} dias
            {data.baseline > 0 && <> · Base atual da música: {formatFull(data.baseline)} plays/dia</>}
          </p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Estimativa baseada no plano aprovado. Não é garantia de resultado.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
