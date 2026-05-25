// Curva PLANEJADA da campanha (não real) — gerada server-side pelo
// buildEcoPlan a partir do plano de distribuição aprovado. O cliente vê
// só o shape da curva + dia previsto pra atingir a meta. Sem playlist,
// sem preço, sem números diários.
import { Card, CardContent } from "@/components/ui/card";
import { Sparkles } from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer,
  Tooltip as ReTooltip, XAxis, YAxis,
} from "recharts";

export type ForecastPayload = {
  curve: Array<{ day: number; cumulative: number }>;
  goalHitDay: number | null;
  totalDays: number;
  goalPlays: number;
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
  const { curve, goalHitDay, totalDays, goalPlays } = forecast;
  if (!curve || curve.length < 2) return null;

  const data = curve.map((p) => ({ label: `D${p.day}`, plays: p.cumulative }));

  const sentence = goalHitDay
    ? `Pelo plano de distribuição aprovado, a previsão é atingir a meta de ${formatFull(goalPlays)} plays por volta do dia ${goalHitDay}, com curva de aceleração contínua até o dia ${totalDays}.`
    : `Pelo plano de distribuição aprovado, a curva acelera gradualmente ao longo dos ${totalDays} dias da campanha.`;

  return (
    <Card className="border-border">
      <CardContent className="p-5 sm:p-6 space-y-5">
        <div>
          <h2 className="text-[15px] font-semibold inline-flex items-center gap-2 tracking-tight">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            Previsão de entrega
          </h2>
          <p className="text-[12px] text-muted-foreground mt-1 leading-snug">
            Curva planejada com base no plano de distribuição aprovado
          </p>
        </div>

        <div className="h-[220px] sm:h-[260px] w-full -mx-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="g_forecast_portal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.22} />
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
                formatter={(v: number) => [formatFull(v), "Plays previstos"]}
              />
              {goalPlays > 0 && (
                <ReferenceLine
                  y={goalPlays}
                  stroke="hsl(var(--primary))"
                  strokeDasharray="4 4"
                  strokeOpacity={0.45}
                  label={{
                    value: "Meta",
                    position: "right",
                    fill: "hsl(var(--primary))",
                    fontSize: 10, fillOpacity: 0.7,
                  }}
                />
              )}
              {goalHitDay && (
                <ReferenceLine
                  x={`D${goalHitDay}`}
                  stroke="hsl(var(--primary))"
                  strokeDasharray="2 4"
                  strokeOpacity={0.55}
                  label={{
                    value: `Meta prevista · D${goalHitDay}`,
                    position: "top",
                    fill: "hsl(var(--primary))",
                    fontSize: 10, fillOpacity: 0.85,
                  }}
                />
              )}
              <Area
                type="monotone" dataKey="plays"
                stroke="hsl(var(--primary))" strokeWidth={1.25}
                strokeDasharray="5 4"
                fill="url(#g_forecast_portal)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <p className="text-[12.5px] text-muted-foreground leading-relaxed">
          {sentence}
        </p>
      </CardContent>
    </Card>
  );
}
