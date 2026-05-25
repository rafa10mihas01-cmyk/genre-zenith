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
import { useMemo, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Sparkles } from "lucide-react";
import {
  CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine,
  ResponsiveContainer, Tooltip as ReTooltip, XAxis, YAxis,
} from "recharts";

function useNarrow(breakpoint = 640) {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const sync = () => setNarrow(mql.matches);
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, [breakpoint]);
  return narrow;
}


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

export function DeliveryForecastCard({ forecast, organicSummary }: Props) {
  const {
    curve, top200Position, top200StreamsDay, baselineStreamsDay, goalPlays,
  } = forecast;
  const isNarrow = useNarrow();

  const organicTotal = Math.max(0, Number(organicSummary?.total_plays ?? 0));
  const showOrganic = organicTotal > 0;



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

    // Curva 3 (opcional): plays orgânicos coletados — distribui o total
    // capturado uniformemente do dia 7 em diante (proxy diário).
    const organicStartDay = 7;
    const organicDaysCount = Math.max(0, days - (organicStartDay - 1));
    const organicPerDay = showOrganic && organicDaysCount > 0
      ? organicTotal / organicDaysCount
      : 0;

    const points = src.map((c, i) => ({
      day: c.day,
      label: `D${c.day}`,
      trackPlays: Math.round(trackPlays[i]),
      delivery: Math.round(delivery[i]),
      cumulative: Math.round(c.cumulative || 0),
      organic: showOrganic && (i + 1) >= organicStartDay
        ? Math.round(organicPerDay)
        : null,
    }));

    const deliveryTotal = delivery.reduce((s, v) => s + v, 0);
    return { points, markDay, markValue, baseline, target, peakValue, deliveryTotal };
  }, [curve, top200StreamsDay, baselineStreamsDay, showOrganic, organicTotal]);


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

  // Eixo direito: entrega diária + orgânico, com folga.
  const maxDelivery = Math.max(0, ...data.points.map(p => p.delivery));
  const maxOrganic = Math.max(0, ...data.points.map(p => p.organic ?? 0));
  const yRightMax = Math.max(1_000, round50k(Math.max(maxDelivery, maxOrganic) * 1.3, "ceil"));


  return (
    <Card>
      <CardContent className="space-y-3">
        <div>
          <h2 className="text-[13px] font-semibold inline-flex items-center gap-1.5 tracking-tight">
            <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
            Previsão de entrega
          </h2>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
            Plays/dia da música e combustível diário da campanha
          </p>
        </div>

        <div className="h-[220px] sm:h-[240px] w-full -mx-2">

          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data.points}
              margin={{ top: 20, right: isNarrow ? 8 : 16, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: isNarrow ? 9 : 11, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false} tickLine={false}
                minTickGap={isNarrow ? 40 : 24}
                interval="preserveStartEnd"
              />
              {/* Eixo esquerdo: plays/dia da música */}
              <YAxis
                yAxisId="left"
                tick={{ fontSize: isNarrow ? 9 : 11, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false} tickLine={false}
                tickFormatter={(v) => formatPlays(v as number)}
                width={isNarrow ? 38 : 56}
                domain={[yLeftMin, yLeftMax]}
              />
              {/* Eixo direito: entrega diária — escondido em telas estreitas */}
              <YAxis
                yAxisId="right" orientation="right"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground) / 0.7)" }}
                axisLine={false} tickLine={false}
                tickFormatter={(v) => formatPlays(v as number)}
                width={isNarrow ? 0 : 48}
                hide={isNarrow}
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
                formatter={(value: number, name: string, item: any) => {
                  if (name === "trackPlays") return [`${formatFull(value)} plays`, "Plays/dia da música"];
                  if (name === "organic") return [`${formatFull(value)} plays/dia`, "Orgânico (Rádio · Autoplay · Mixes)"];
                  if (name === "delivery") {
                    const cum = item?.payload?.cumulative;
                    const acc = Number.isFinite(cum)
                      ? `\nAcumulado: ${formatPlays(cum)} plays`
                      : "";
                    return [`${formatFull(value)} plays${acc}`, "Entrega do dia"];
                  }
                  return [`${formatFull(value)} plays`, name];
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
                    value: isNarrow
                      ? (top200Position ? `Top ${top200Position}` : "Alvo")
                      : (top200Position
                          ? `Top ${top200Position} · ${formatPlays(data.target)}`
                          : `Alvo · ${formatPlays(data.target)}`),
                    position: "insideTopRight",
                    fill: "hsl(var(--muted-foreground))",
                    fontSize: isNarrow ? 9 : 10, fillOpacity: 0.9,
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
                    value: isNarrow ? "Meta" : `Meta · ${formatPlays(goalPlays)}`,
                    position: "insideTopRight",
                    fill: "hsl(var(--muted-foreground))",
                    fontSize: isNarrow ? 9 : 10, fillOpacity: 0.85,
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
              {/* Orgânico coletado (a partir do dia 7) */}
              {showOrganic && (
                <Line
                  yAxisId="right"
                  type="monotone" dataKey="organic"
                  stroke="hsl(210 90% 60%)"
                  strokeWidth={1.75}
                  strokeDasharray="5 4"
                  strokeLinecap="round"
                  dot={false} isAnimationActive={false}
                  connectNulls={false}
                />
              )}


              {data.markDay && data.markValue != null && (
                <ReferenceDot
                  yAxisId="left"
                  x={`D${data.markDay}`} y={data.markValue}
                  r={5}
                  fill="hsl(var(--primary))"
                  stroke="hsl(var(--background))"
                  strokeWidth={2}
                  label={{
                    value: isNarrow
                      ? `D${data.markDay}`
                      : (top200Position
                          ? `Top ${top200Position} · Dia ${data.markDay}`
                          : `Alvo · Dia ${data.markDay}`),
                    position: "top",
                    fill: "hsl(var(--primary))",
                    fontSize: isNarrow ? 9.5 : 10.5, fontWeight: 600,
                  }}

                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-[2px] w-3 bg-primary rounded" />
            Plays/dia
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0 w-3 border-t-2 border-dashed border-primary/60" />
            Entrega diária
          </span>
          {data.target != null && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-0 w-3 border-t-2 border-dashed border-muted-foreground/60" />
              {top200Position ? `Top ${top200Position}` : "Alvo"}
            </span>
          )}
          {goalPlays > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-0 w-3 border-t-2 border-dashed border-muted-foreground/40" />
              Meta
            </span>
          )}
          {showOrganic && (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-0 w-3 border-t-2 border-dashed" style={{ borderColor: "hsl(210 90% 60%)" }} />
              Orgânico
            </span>
          )}
        </div>

        {showOrganic && (
          <p className="text-[11px] text-foreground/80 leading-snug pt-2 border-t border-border">
            Campanha: <span className="font-semibold">{formatPlays(data.deliveryTotal)}</span>
            {" · "}Orgânico: <span className="font-semibold">{formatPlays(organicTotal)}</span>
            {" · "}Total: <span className="font-semibold">{formatPlays(data.deliveryTotal + organicTotal)}</span>
          </p>
        )}

        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Estimativa baseada no plano aprovado. Não é garantia de resultado.
        </p>

      </CardContent>
    </Card>
  );
}

