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

// Distribuição suave (smoothstep S-curve). CDF S(t) = t² (3 − 2t), peso
// diário = S((i+1)/days) − S(i/days). Soma == 1, sem picos abruptos.
function smoothCumulative(days: number): number[] {
  if (days <= 0) return [];
  const S = (t: number) => Math.max(0, Math.min(1, t * t * (3 - 2 * t)));
  const cdf: number[] = [];
  for (let i = 1; i <= days; i++) cdf.push(S(i / days));
  return cdf;
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
    const cdf = smoothCumulative(days);

    // Acumulado da música = baseline (o que ela já tem) + acumulado da
    // entrega da campanha até aquele dia. Linha única, smooth.
    const points = cdf.map((c, i) => ({
      day: i + 1,
      label: `D${i + 1}`,
      acumulado: Math.round(baseline + meta * c),
    }));

    // Marco: primeiro dia em que o acumulado cruza o benchmark do chart.
    let markDay: number | null = null;
    let markValue: number | null = null;
    if (top200StreamsDay && top200Position) {
      for (let i = 0; i < points.length; i++) {
        if (points[i].acumulado >= top200StreamsDay) {
          markDay = i + 1;
          markValue = points[i].acumulado;
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

              {top200StreamsDay && top200Position && (
                <ReferenceLine
                  y={top200StreamsDay}
                  stroke="hsl(var(--muted-foreground))"
                  strokeDasharray="2 4"
                  strokeOpacity={0.6}
                  label={{
                    value: `Top ${top200Position} · ${formatPlays(top200StreamsDay)}`,
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

              {data.markDay && data.markValue != null && (
                <ReferenceDot
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
            Acumulado da música
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
