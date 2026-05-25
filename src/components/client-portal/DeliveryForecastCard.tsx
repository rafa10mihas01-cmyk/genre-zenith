// Previsão de entrega — duas curvas sobre a janela real (effectiveDays).
//
//  CURVA 1 (eixo esq., linha sólida verde): plays/dia da MÚSICA.
//    Sobe a partir de baselineStreamsDay somando a entrega diária da campanha,
//    estabiliza ao atingir top200StreamsDay (teto natural), e nos últimos 16%
//    desce smoothstep de volta ao baseline (saída suave do plano).
//
//  CURVA 2 (eixo dir., linha tracejada verde clara): entrega DIÁRIA da campanha
//    direto da curva do snapshot (curve[i].cumulative — cumulative[i-1]).
//
//  Ponto verde: primeiro dia em que a curva 1 atinge top200StreamsDay.
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

export type OrganicSummary = {
  total_plays?: number;
  by_kind?: Record<string, number>;
};

type Props = { forecast: ForecastPayload; organicSummary?: OrganicSummary | null };


function formatPlays(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return Math.round(n).toString();
}
function formatFull(n: number): string {
  return new Intl.NumberFormat("pt-BR").format(Math.round(n));
}

// smoothstep S(t) = t²(3 − 2t)
const S = (t: number) => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

export function DeliveryForecastCard({ forecast }: Props) {
  const {
    curve, top200Position, top200StreamsDay, baselineStreamsDay, goalPlays,
  } = forecast;

  const data = useMemo(() => {
    const baseline = Math.max(0, baselineStreamsDay ?? 0);
    const target = top200StreamsDay && top200StreamsDay > 0 ? top200StreamsDay : null;
    const src = Array.isArray(curve) ? curve : [];
    const days = src.length;
    if (days < 2) return null;

    // Entrega diária da campanha = diferença do acumulado.
    const delivery: number[] = src.map((c, i) => {
      const prev = i === 0 ? 0 : (src[i - 1].cumulative || 0);
      return Math.max(0, (c.cumulative || 0) - prev);
    });

    // Janela de saída suave = últimos 16% (alinhado ao envelope do motor).
    const outroDays = Math.max(1, Math.round(days * 0.16));
    const outroStart = days - outroDays; // índice 0-based inclusivo

    // Curva 1: trackPlays/dia.
    // Subida: baseline + somatório da entrega, com TETO = target (Top 200).
    // Saída: smoothstep desce do valor atingido ao baseline ao longo do outro.
    const trackPlays: number[] = new Array(days).fill(0);
    let running = baseline;
    let peakValue = baseline;
    let peakIdx = -1;
    for (let i = 0; i < outroStart; i++) {
      running = running + delivery[i];
      if (target != null && running >= target) {
        running = target;
        if (peakIdx === -1) peakIdx = i;
      }
      trackPlays[i] = running;
      if (running > peakValue) peakValue = running;
    }
    const valueAtOutroStart = trackPlays[Math.max(0, outroStart - 1)] ?? baseline;
    for (let j = 0; j < outroDays; j++) {
      const i = outroStart + j;
      const t = (j + 1) / outroDays;
      // smoothstep down: de valueAtOutroStart → baseline
      trackPlays[i] = baseline + (valueAtOutroStart - baseline) * (1 - S(t));
    }

    // Primeiro dia em que a curva 1 cruza o target.
    let markDay: number | null = null;
    let markValue: number | null = null;
    if (target != null) {
      for (let i = 0; i < days; i++) {
        if (trackPlays[i] >= target - 0.5) {
          markDay = i + 1;
          markValue = Math.round(trackPlays[i]);
          break;
        }
      }
    }

    const points = src.map((c, i) => ({
      day: c.day,
      label: `D${c.day}`,
      trackPlays: Math.round(trackPlays[i]),
      delivery: Math.round(delivery[i]),
    }));

    return { points, markDay, markValue, baseline, target, peakValue };
  }, [curve, top200StreamsDay, baselineStreamsDay]);

  if (!data) return null;

  // Eixo esquerdo: arredonda em múltiplos de 50k pra leitura limpa.
  const round50k = (n: number, mode: "floor" | "ceil") =>
    mode === "floor"
      ? Math.floor(n / 50_000) * 50_000
      : Math.ceil(n / 50_000) * 50_000;
  const yLeftMin = Math.max(0, round50k(data.baseline * 0.95, "floor"));
  const yLeftMaxBase = Math.max(
    data.target ?? 0,
    data.peakValue,
    data.baseline * 1.1,
  );
  const yLeftMax = round50k(yLeftMaxBase * 1.05, "ceil");

  // Eixo direito: entrega diária, com folga.
  const maxDelivery = Math.max(0, ...data.points.map(p => p.delivery));
  const yRightMax = Math.max(1_000, round50k(maxDelivery * 1.3, "ceil"));

  return (
    <Card className="border-border">
      <CardContent className="p-5 sm:p-6 space-y-5">
        <div>
          <h2 className="text-[15px] font-semibold inline-flex items-center gap-2 tracking-tight">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            Previsão de entrega
          </h2>
          <p className="text-[12px] text-muted-foreground mt-1 leading-snug">
            Plays/dia da música e combustível diário da campanha
          </p>
        </div>

        <div className="h-[280px] sm:h-[320px] w-full -mx-2">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data.points} margin={{ top: 24, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false} tickLine={false} minTickGap={24}
              />
              {/* Eixo esquerdo: plays/dia da música */}
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false} tickLine={false}
                tickFormatter={(v) => formatPlays(v as number)} width={56}
                domain={[yLeftMin, yLeftMax]}
              />
              {/* Eixo direito: entrega diária */}
              <YAxis
                yAxisId="right" orientation="right"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground) / 0.7)" }}
                axisLine={false} tickLine={false}
                tickFormatter={(v) => formatPlays(v as number)} width={48}
                domain={[0, yRightMax]}
              />
              {/* Eixo oculto pra plotar a meta total contratada */}
              {goalPlays > 0 && (
                <YAxis
                  yAxisId="goal" orientation="right" hide
                  domain={[0, goalPlays * 1.1]}
                />
              )}
              <ReTooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 12, fontSize: 12,
                }}
                labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                formatter={(value: number, name: string) => {
                  if (name === "trackPlays") return [`${formatFull(value)} plays`, "Plays/dia da música"];
                  return [`${formatFull(value)} plays`, "Entrega do dia"];
                }}
              />

              {data.target != null && (
                <ReferenceLine
                  yAxisId="left"
                  y={data.target}
                  stroke="hsl(var(--muted-foreground))"
                  strokeDasharray="2 4"
                  strokeOpacity={0.55}
                  label={{
                    value: top200Position
                      ? `Top ${top200Position} · ${formatPlays(data.target)}`
                      : `Alvo · ${formatPlays(data.target)}`,
                    position: "insideTopRight",
                    fill: "hsl(var(--muted-foreground))",
                    fontSize: 10, fillOpacity: 0.9,
                  }}
                />
              )}

              {goalPlays > 0 && (
                <ReferenceLine
                  yAxisId="goal"
                  y={goalPlays}
                  stroke="hsl(var(--muted-foreground))"
                  strokeDasharray="2 4"
                  strokeOpacity={0.45}
                  label={{
                    value: `Meta · ${formatPlays(goalPlays)}`,
                    position: "insideTopRight",
                    fill: "hsl(var(--muted-foreground))",
                    fontSize: 10, fillOpacity: 0.85,
                  }}
                />
              )}

              {/* Entrega diária (atrás) */}
              <Line
                yAxisId="right"
                type="monotone" dataKey="delivery"
                stroke="hsl(var(--primary) / 0.55)"
                strokeWidth={1.75}
                strokeDasharray="4 3"
                strokeLinecap="round"
                dot={false} isAnimationActive={false}
              />

              {/* Plays/dia da música (frente) */}
              <Line
                yAxisId="left"
                type="monotone" dataKey="trackPlays"
                stroke="hsl(var(--primary))" strokeWidth={2.5}
                strokeLinecap="round" strokeLinejoin="round"
                dot={false} isAnimationActive={false}
              />

              {data.markDay && data.markValue != null && (
                <ReferenceDot
                  yAxisId="left"
                  x={`D${data.markDay}`} y={data.markValue}
                  r={5}
                  fill="hsl(var(--primary))"
                  stroke="hsl(var(--background))"
                  strokeWidth={2}
                  label={{
                    value: top200Position
                      ? `Top ${top200Position} · Dia ${data.markDay}`
                      : `Alvo · Dia ${data.markDay}`,
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
            <span className="inline-block h-0 w-4 border-t-2 border-dashed border-primary/60" />
            Entrega do dia (campanha)
          </span>
          {data.target != null && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-0 w-4 border-t-2 border-dashed border-muted-foreground/60" />
              {top200Position ? `Alvo Top ${top200Position}` : "Alvo"}
            </span>
          )}
          {goalPlays > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-0 w-4 border-t-2 border-dashed border-muted-foreground/40" />
              Meta contratada
            </span>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Estimativa baseada no plano aprovado. Não é garantia de resultado.
        </p>
      </CardContent>
    </Card>
  );
}
