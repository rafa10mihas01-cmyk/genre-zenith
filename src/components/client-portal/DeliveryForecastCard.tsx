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
import { Sparkles, TrendingUp } from "lucide-react";
import {
  CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine,
  ResponsiveContainer, Tooltip as ReTooltip, XAxis, YAxis,
} from "recharts";
import { recomputeCurva } from "@/lib/campaignEngine";
import { useChartProjection } from "@/hooks/useChartProjection";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";

// Hook: streams_day REAIS da música (raw_chart_daily) entre startedAt e hoje.
// Retorna Map<YYYY-MM-DD, streams_day>. Vazio quando faltar trackId/startedAt.
function useRealTrackStreams(spotifyTrackId?: string | null, startedAt?: string | null) {
  const [map, setMap] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    let cancel = false;
    if (!spotifyTrackId || !startedAt) { setMap(new Map()); return; }
    (async () => {
      const startDate = startedAt.slice(0, 10);
      const { data } = await supabase
        .from("raw_chart_daily")
        .select("chart_date,streams_day")
        .eq("spotify_track_id", spotifyTrackId)
        .eq("chart_name", "top200_br")
        .gte("chart_date", startDate)
        .order("chart_date", { ascending: true });
      if (cancel) return;
      const m = new Map<string, number>();
      for (const r of ((data ?? []) as Array<{ chart_date: string; streams_day: number }>)) {
        m.set(r.chart_date, r.streams_day);
      }
      setMap(m);
    })();
    return () => { cancel = true; };
  }, [spotifyTrackId, startedAt]);
  return map;
}

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

type Props = { forecast: ForecastPayload; organicSummary?: OrganicSummary | null; spotifyTrackId?: string | null };


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

export function DeliveryForecastCard({ forecast, organicSummary, spotifyTrackId }: Props) {
  const {
    curve, top200Position, top200StreamsDay, baselineStreamsDay, goalPlays,
  } = forecast;
  const isNarrow = useNarrow();

  const organicTotal = Math.max(0, Number(organicSummary?.total_plays ?? 0));
  const showOrganic = organicTotal > 0;



  const data = useMemo(() => {
    const baseline = Math.max(0, baselineStreamsDay ?? 0);
    const target = top200StreamsDay && top200StreamsDay > 0 ? top200StreamsDay : null;

    // Recalcula a forma da curva LOCALMENTE a partir de meta + effectiveDays,
    // aplicando o envelope ATUAL do campaignEngine. Ignora `curve` vindo do
    // backend (que pode estar com snapshot antigo). Snapshot continua fonte
    // de verdade só pra meta/custos/split — a forma é sempre fresca.
    const totalDays = Array.isArray(curve) && curve.length > 0
      ? curve.length
      : (forecast.totalDays ?? 0);
    const meta = goalPlays > 0 ? goalPlays : 0;
    const fresh = meta > 0 && totalDays > 0 ? recomputeCurva(meta, totalDays) : [];
    const src = fresh.length > 0
      ? fresh.map(p => ({ day: p.day, cumulative: p.cumulative }))
      : (Array.isArray(curve) ? curve : []);
    const days = src.length;
  const organicTotal = Math.max(0, Number(organicSummary?.total_plays ?? 0));
  const showOrganic = organicTotal > 0;

  // Streams REAIS da música (raw_chart_daily) entre o início da campanha e hoje.
  // Usados pra desenhar o trecho passado da linha sólida com a verdade do chart.
  const realStreamsMap = useRealTrackStreams(spotifyTrackId ?? null, forecast.startedAt ?? null);


  const data = useMemo(() => {
    const baseline = Math.max(0, baselineStreamsDay ?? 0);
    const target = top200StreamsDay && top200StreamsDay > 0 ? top200StreamsDay : null;

    // Recalcula a forma da curva LOCALMENTE a partir de meta + effectiveDays.
    const totalDays = Array.isArray(curve) && curve.length > 0
      ? curve.length
      : (forecast.totalDays ?? 0);
    const meta = goalPlays > 0 ? goalPlays : 0;
    const fresh = meta > 0 && totalDays > 0 ? recomputeCurva(meta, totalDays) : [];
    const src = fresh.length > 0
      ? fresh.map(p => ({ day: p.day, cumulative: p.cumulative }))
      : (Array.isArray(curve) ? curve : []);
    const days = src.length;
    if (days < 2) return null;

    // Entrega diária da campanha = diferença do acumulado.
    const delivery: number[] = src.map((c, i) => {
      const prev = i === 0 ? 0 : (src[i - 1].cumulative || 0);
      return Math.max(0, (c.cumulative || 0) - prev);
    });

    // Janela de saída suave = últimos 16% (alinhado ao envelope do motor).
    const outroDays = Math.max(1, Math.round(days * 0.16));
    const outroStart = days - outroDays;

    // Índice do "hoje" relativo a startedAt (0-based). null se não souber.
    let todayIdx: number | null = null;
    if (forecast.startedAt) {
      const startMs = new Date(forecast.startedAt.slice(0, 10) + "T00:00:00Z").getTime();
      const todayMs = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime();
      const diff = Math.floor((todayMs - startMs) / 86_400_000);
      if (Number.isFinite(diff) && diff >= 0) todayIdx = Math.min(days - 1, diff);
    }

    // Curva 1: trackPlays/dia da música.
    // Passado (i <= todayIdx): valor REAL do raw_chart_daily quando disponível.
    // Futuro (i > todayIdx): projeta a partir do valor real de HOJE + entrega/dia.
    const trackPlays: number[] = new Array(days).fill(0);
    const realByIdx = new Map<number, number>();
    if (forecast.startedAt && realStreamsMap.size > 0) {
      const startMs = new Date(forecast.startedAt.slice(0, 10) + "T00:00:00Z").getTime();
      for (const [dateStr, sd] of realStreamsMap) {
        const dMs = new Date(dateStr + "T00:00:00Z").getTime();
        const idx = Math.floor((dMs - startMs) / 86_400_000);
        if (idx >= 0 && idx < days) realByIdx.set(idx, sd);
      }
    }

    // Preenche passado com REAL; se faltar dia, repete o último conhecido (ou baseline).
    let lastKnown = baseline;
    const pastEnd = todayIdx ?? -1;
    for (let i = 0; i <= pastEnd; i++) {
      if (realByIdx.has(i)) lastKnown = realByIdx.get(i)!;
      else if (i === 0) lastKnown = baseline;
      trackPlays[i] = lastKnown;
    }
    // Garante que D1 nunca some — ancora no baseline se a busca real não tiver dado.
    if (pastEnd >= 0 && !realByIdx.has(0)) trackPlays[0] = baseline;

    // Projeção do futuro: parte do valor real de HOJE (não do baseline antigo)
    // e soma a entrega diária. Estabiliza ao tocar o teto natural.
    const todayValue = pastEnd >= 0 ? trackPlays[pastEnd] : baseline;
    let peakValue = Math.max(baseline, todayValue);
    for (let i = pastEnd + 1; i < days; i++) {
      const v = todayValue + (delivery[i] || 0);
      trackPlays[i] = v;
      if (v > peakValue) peakValue = v;
    }
    // Outro suave: smoothstep do valor → todayValue (ancora de saída no real atual).
    if (pastEnd < outroStart) {
      const valueAtOutroStart = trackPlays[Math.max(0, outroStart - 1)] ?? todayValue;
      for (let j = 0; j < outroDays; j++) {
        const i = outroStart + j;
        if (i <= pastEnd) continue;
        const t = (j + 1) / outroDays;
        trackPlays[i] = todayValue + (valueAtOutroStart - todayValue) * (1 - S(t));
      }
    }

    // Atualiza pico considerando a curva inteira (passado real + futuro projetado).
    for (let i = 0; i < days; i++) if (trackPlays[i] > peakValue) peakValue = trackPlays[i];

    // Marcador de target (Top X): primeiro dia em que cruza.
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

    // Orgânico coletado (proxy diário a partir do dia 7).
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
    const todayDay = todayIdx != null ? todayIdx + 1 : null;
    const todayMarkValue = todayIdx != null ? Math.round(trackPlays[todayIdx]) : null;
    return { points, markDay, markValue, baseline, target, peakValue, deliveryTotal, todayDay, todayMarkValue };
  }, [curve, top200StreamsDay, baselineStreamsDay, showOrganic, organicTotal, goalPlays, forecast.totalDays, forecast.startedAt, realStreamsMap]);
  // Projeção de posição no chart (puramente ilustrativa, não afeta a curva).
  const projection = useChartProjection(spotifyTrackId ?? null, data?.peakValue ?? null);

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
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold inline-flex items-center gap-1.5 tracking-tight">
              <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
              Previsão de entrega
            </h2>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
              Plays/dia da música e combustível diário da campanha
            </p>
          </div>
          {projection.currentPosition != null && (
            <TooltipProvider delayDuration={120}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-primary cursor-help shrink-0"
                  >
                    <TrendingUp className="h-3 w-3" />
                    Posição atual #{projection.currentPosition}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[280px]">
                  <p className="text-[11px] leading-relaxed">
                    A música está em <strong>#{projection.currentPosition}</strong> no Top 200 BR hoje.
                    <br />
                    <span className="text-muted-foreground">Passe o mouse sobre a curva pra ver a posição estimada em cada dia.</span>
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
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
                cursor={{ stroke: "hsl(var(--border))", strokeWidth: 1 }}
                content={({ active, payload, label }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const byKey: Record<string, any> = {};
                  for (const p of payload) byKey[p.dataKey as string] = p;
                  const delivery = byKey.delivery?.value;
                  const trackPlays = byKey.trackPlays?.value;
                  const organic = byKey.organic?.value;
                  const cum = payload[0]?.payload?.cumulative;

                  const Row = ({
                    dot, label, value, unit, accent,
                  }: { dot: string; label: string; value: string; unit?: string; accent?: boolean }) => (
                    <div className="flex items-baseline justify-between gap-6">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="h-1.5 w-1.5 rounded-full shrink-0"
                          style={{ background: dot }}
                        />
                        <span className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground truncate">
                          {label}
                        </span>
                      </div>
                      <div className="flex items-baseline gap-1 shrink-0">
                        <span
                          className={
                            "tabular-nums font-semibold leading-none " +
                            (accent ? "text-primary text-[15px]" : "text-foreground text-[13.5px]")
                          }
                        >
                          {value}
                        </span>
                        {unit && (
                          <span className="text-[10.5px] text-muted-foreground leading-none">
                            {unit}
                          </span>
                        )}
                      </div>
                    </div>
                  );

                  return (
                    <div
                      className="rounded-xl border border-border/80 bg-card/95 backdrop-blur px-3.5 py-3 shadow-2xl shadow-black/40 min-w-[240px]"
                    >
                      <div className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground/80 font-medium mb-2.5">
                        Dia {label}
                      </div>
                      <div className="space-y-2">
                        {Number.isFinite(cum) && (
                          <Row
                            dot="hsl(var(--muted-foreground))"
                            label="Acumulado"
                            value={formatFull(cum)}
                            unit="plays"
                          />
                        )}
                        {Number.isFinite(delivery) && (
                          <Row
                            dot="hsl(var(--primary))"
                            label="Entrega do dia"
                            value={formatFull(delivery)}
                            unit="plays"
                            accent
                          />
                        )}
                        {Number.isFinite(trackPlays) && (
                          <Row
                            dot="hsl(var(--primary) / 0.55)"
                            label="Plays/dia da música"
                            value={formatFull(trackPlays)}
                            unit="plays"
                          />
                        )}
                        {Number.isFinite(organic) && (
                          <Row
                            dot="hsl(var(--muted-foreground) / 0.6)"
                            label="Orgânico"
                            value={formatFull(organic)}
                            unit="plays/dia"
                          />
                        )}
                        {(() => {
                          if (!Number.isFinite(trackPlays)) return null;
                          const band = projection.estimateBand(trackPlays);
                          const exact = projection.estimatePosition(trackPlays);
                          if (band == null || exact == null) return null;
                          return (
                            <div className="mt-2.5 pt-2.5 border-t border-border/60 flex items-baseline justify-between gap-6">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-primary" />
                                <span className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground truncate">
                                  Posição estimada
                                </span>
                              </div>
                              <span className="tabular-nums font-bold leading-none text-primary text-[18px]">
                                #{exact}
                              </span>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  );
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
                    position: "insideTopLeft",
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
                    offset: 12,
                    dx: isNarrow ? 18 : 28,
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

