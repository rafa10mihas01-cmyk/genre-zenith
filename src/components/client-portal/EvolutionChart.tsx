// Gráfico de evolução acumulada da campanha — fonte única: `series`
// devolvida sanitizada por get-client-campaign-public. Antes esse mesmo
// gráfico era reconstruído ad-hoc no portal a partir de campaign_eco_snapshots,
// o que dava números diferentes do legado /campanha/:token. Agora os dois
// portais leem da mesma fonte e mostram a mesma curva.
import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp } from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer,
  Tooltip as ReTooltip, XAxis, YAxis,
} from "recharts";

export type EvolutionSeriesPoint = { date: string; delivered: number };

type Props = {
  series: EvolutionSeriesPoint[];
  target?: number;
  pct?: number;
};

function formatPlays(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return Math.round(n).toString();
}
function formatFullPlays(n: number): string {
  return new Intl.NumberFormat("pt-BR").format(Math.round(n));
}

export function EvolutionChart({ series, target = 0, pct = 0 }: Props) {
  // Curva acumulada monotônica: nunca cai. Dia sem print = patamar horizontal
  // ("estável aguardando próximo print"), não queda.
  const chartData = useMemo(() => {
    let running = 0;
    return series.map((p) => {
      running += Math.max(0, p.delivered || 0);
      return {
        date: new Date(p.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }),
        plays: running,
      };
    });
  }, [series]);

  if (chartData.length < 2) return null;

  return (
    <Card className="border-border">
      <CardContent className="p-5 sm:p-6 space-y-5">
        <div>
          <h2 className="text-[15px] font-semibold inline-flex items-center gap-2 tracking-tight">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            Evolução da campanha
          </h2>
          <p className="text-[12px] text-muted-foreground mt-1 leading-snug">
            Plays acumulados ao longo do tempo
          </p>
        </div>
        <div className="h-[220px] sm:h-[260px] w-full -mx-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="g_plays_portal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false} tickLine={false} minTickGap={24}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false} tickLine={false}
                tickFormatter={(v) => formatPlays(v as number)} width={40}
              />
              <ReTooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 12, fontSize: 12,
                }}
                labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                formatter={(v: number) => [formatFullPlays(v), "Plays"]}
              />
              {target > 0 && pct >= 20 && (
                <ReferenceLine
                  y={target}
                  stroke="hsl(var(--primary))"
                  strokeDasharray="4 4"
                  strokeOpacity={0.35}
                  label={{ value: "Meta", position: "right", fill: "hsl(var(--primary))", fontSize: 10, fillOpacity: 0.6 }}
                />
              )}
              <Area
                type="monotone" dataKey="plays"
                stroke="hsl(var(--primary))" strokeWidth={1.25}
                fill="url(#g_plays_portal)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
