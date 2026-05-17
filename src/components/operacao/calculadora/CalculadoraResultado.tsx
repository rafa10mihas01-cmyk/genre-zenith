import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBRL, formatInt, type CampaignResult } from "@/lib/campaignEngine";
import { TrendingUp, Wallet, Zap, Layers } from "lucide-react";

export function CalculadoraResultado({ r }: { r: CampaignResult }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={TrendingUp} label="Meta" value={formatInt(r.meta)} hint="streams totais" />
        <Kpi icon={Wallet} label="Custo total" value={formatBRL(r.custoTotal)} hint={`R$ ${r.custoPorStream.toFixed(3)}/stream`} />
        <Kpi icon={Zap} label="Pico/dia" value={formatInt(r.picoPorDia)} hint={`média ${formatInt(r.mediaPorDia)}`} />
        <Kpi icon={Layers} label="Duração" value={`${r.days}d`} hint={r.modo === "simultaneo" ? "simultâneo" : "sequencial"} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Distribuição do investimento</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <SplitBar
            label="Ecossistema próprio"
            pct={r.splitEcoPct}
            streams={r.streamsEco}
            custo={r.custoEco}
            tone="primary"
          />
          <SplitBar
            label="Ecossistema externo"
            pct={100 - r.splitEcoPct}
            streams={r.streamsExt}
            custo={r.custoExt}
            tone="muted"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Curva de entrega</CardTitle>
        </CardHeader>
        <CardContent>
          <CurvaSVG curva={r.curva} />
          <div className="mt-3 text-xs text-muted-foreground flex justify-between">
            <span>Inércia: ×{r.inercia.toFixed(2)}</span>
            <span>{r.curva.length} dias</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, hint }: { icon: any; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="text-xl font-semibold mt-1 tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

function SplitBar({
  label, pct, streams, custo, tone,
}: { label: string; pct: number; streams: number; custo: number; tone: "primary" | "muted" }) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1.5">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {pct}% · {formatInt(streams)} streams · <span className="text-foreground font-semibold">{formatBRL(custo)}</span>
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={tone === "primary" ? "h-full bg-primary" : "h-full bg-muted-foreground/40"}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function CurvaSVG({ curva }: { curva: CampaignResult["curva"] }) {
  if (!curva.length) return null;
  const W = 600, H = 160, P = 8;
  const max = Math.max(...curva.map(c => c.streamsDay));
  const stepX = (W - P * 2) / Math.max(1, curva.length - 1);
  const points = curva.map((c, i) => {
    const x = P + i * stepX;
    const y = H - P - ((c.streamsDay / Math.max(1, max)) * (H - P * 2));
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const area = `${P},${H - P} ${points} ${P + (curva.length - 1) * stepX},${H - P}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="none">
      <polygon points={area} fill="hsl(var(--primary) / 0.15)" />
      <polyline points={points} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" />
    </svg>
  );
}
