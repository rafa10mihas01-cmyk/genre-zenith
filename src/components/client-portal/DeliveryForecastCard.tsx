// Previsão de entrega — curva ESTÁTICA do plano aprovado.
// Calculada uma vez a partir do simulation_snapshot (meta, days,
// top200Position, top200StreamsDay) e nunca muda. Não lê dados ao vivo,
// não acumula entrega real, não faz fetch.
//
// Distribuição: rampa 20/60/20 — primeiros 20% dos dias entregam 10%,
// meio 60% entregam 70%, últimos 20% entregam 20% (entrada gradual).
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

// Rampa 20/60/20: pesos por dia. Soma == 1.
function buildRampWeights(days: number): number[] {
  if (days <= 0) return [];
  const n1 = Math.max(1, Math.floor(days * 0.2));
  const n3 = Math.max(1, Math.floor(days * 0.2));
  const n2 = Math.max(1, days - n1 - n3);
  const w: number[] = [];
  for (let i = 0; i < n1; i++) w.push(0.10 / n1);
  for (let i = 0; i < n2; i++) w.push(0.70 / n2);
  for (let i = 0; i < n3; i++) w.push(0.20 / n3);
  // Garante length == days (arredondamento de Math.floor pode ter sobrado/faltado)
  while (w.length < days) w.push(w[w.length - 1] ?? 0);
  return w.slice(0, days);
}

export function DeliveryForecastCard({ forecast }: Props) {
  const {
    totalDays, goalPlays,
    top200Position, top200StreamsDay,
  } = forecast;

  const data = useMemo(() => {
    const days = Math.max(1, totalDays || 0);
    const meta = Math.max(0, goalPlays || 0);
    const weights = buildRampWeights(days);

    // Curva acumulada planejada (rampa 20/60/20).
    let running = 0;
    const points = weights.map((w, i) => {
      running += meta * w;
      return { day: i + 1, label: `D${i + 1}`, planejado: Math.round(running) };
    });

    // Benchmark: total necessário pra manter posição alvo durante toda a campanha.
    const benchmark = top200Position && top200StreamsDay
      ? top200StreamsDay * days
      : null;

    // Dia do marco: primeiro dia onde acumulado >= top200StreamsDay × dia
    // (ritmo necessário pra manter a posição). Fallback pro benchmark total
    // se nunca cruzar a curva incremental.
    let markDay: number | null = null;
    let markValue: number | null = null;
    if (top200StreamsDay && top200Position) {
      for (let i = 0; i < points.length; i++) {
        const needed = top200StreamsDay * (i + 1);
        if (points[i].planejado >= needed) {
          markDay = i + 1;
          markValue = points[i].planejado;
          break;
        }
      }
      if (markDay === null && benchmark) {
        for (let i = 0; i < points.length; i++) {
          if (points[i].planejado >= benchmark) {
            markDay = i + 1;
            markValue = points[i].planejado;
            break;
          }
        }
      }
    }

    const dailyAvg = days > 0 ? Math.round(meta / days) : 0;
    return { points, benchmark, markDay, markValue, dailyAvg, days, meta };
  }, [totalDays, goalPlays, top200Position, top200StreamsDay]);

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
            Curva planejada do plano aprovado
          </p>
        </div>

        <div className="h-[240px] sm:h-[280px] w-full -mx-2">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data.points} margin={{ top: 20, right: 16, left: 0, bottom: 0 }}>
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
                formatter={(v: number) => [formatFull(v), "Plays planejados"]}
              />

              {data.benchmark && (
                <ReferenceLine
                  y={data.benchmark}
                  stroke="hsl(var(--muted-foreground))"
                  strokeDasharray="2 4"
                  strokeOpacity={0.55}
                  label={{
                    value: `Top ${top200Position} · ${formatPlays(data.benchmark)}`,
                    position: "insideTopRight",
                    fill: "hsl(var(--muted-foreground))",
                    fontSize: 10, fillOpacity: 0.85,
                  }}
                />
              )}

              <Line
                type="monotone" dataKey="planejado"
                stroke="hsl(var(--primary))" strokeWidth={2}
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

        <div className="space-y-1.5">
          <p className="text-[12.5px] text-foreground/85 leading-relaxed">
            Ritmo planejado: {formatFull(data.dailyAvg)} plays/dia · Meta: {formatFull(data.meta)} plays em {data.days} dias
          </p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Estimativa baseada no plano aprovado. Não é garantia de resultado.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
