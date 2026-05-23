import { Card, CardContent } from "@/components/ui/card";
import { formatInt, formatBRL } from "@/lib/campaignEngine";
import type { CampaignSnapshot } from "@/lib/campaignSnapshot";
import { cn } from "@/lib/utils";

type Props = {
  snapshot: CampaignSnapshot;
  delivered: number;
  daysElapsed: number;
  showFinance: boolean;
};

export function OverviewTab({ snapshot, delivered, daysElapsed, showFinance }: Props) {
  const pct = snapshot.meta > 0 ? Math.min(100, Math.round((delivered / snapshot.meta) * 100)) : 0;
  const plannedToDate = snapshot.curva.slice(0, daysElapsed).reduce((s, p) => s + p.streamsDay, 0);
  const adherence = plannedToDate > 0 ? Math.round((delivered / plannedToDate) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* KPIs grandes */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Meta" value={formatInt(snapshot.meta)} sub="streams" />
        <Kpi label="Entregue" value={formatInt(delivered)} sub={`${pct}% da meta`} tone="primary" />
        <Kpi
          label="Aderência ao plano"
          value={`${adherence}%`}
          sub={`vs ${formatInt(plannedToDate)} planejados`}
          tone={adherence >= 85 ? "primary" : "warning"}
        />
        <Kpi label="Duração" value={`${snapshot.days}d`} sub={snapshot.modo === "simultaneo" ? "simultâneo" : "sequencial"} />
      </div>

      {/* Curva resumo */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-semibold">Curva de entrega</div>
              <div className="text-xs text-muted-foreground">Planejado por dia · acumulado</div>
            </div>
            <div className="text-right text-xs text-muted-foreground tabular-nums">
              média {formatInt(snapshot.mediaPorDia)}/dia · pico {formatInt(snapshot.picoPorDia)}
            </div>
          </div>
          <MiniCurva curva={snapshot.curva} elapsedDays={daysElapsed} />
        </CardContent>
      </Card>

      {/* Financeiro só interno */}
      {showFinance && (
        <Card>
          <CardContent className="p-5">
            <div className="text-sm font-semibold mb-3">Resumo financeiro interno</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <Kpi label="Investimento" value={formatBRL(snapshot.custoTotal)} compact />
              <Kpi label="CPP" value={formatBRL(snapshot.custoPorStream)} sub="por stream" compact />
              <Kpi label="Eco" value={`${snapshot.splitEcoPct}%`} sub={`${formatInt(snapshot.streamsEco)} streams`} compact />
              <Kpi label="Externo" value={`${100 - snapshot.splitEcoPct}%`} sub={`${formatInt(snapshot.streamsExt)} streams`} compact />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, tone, compact }: { label: string; value: string; sub?: string; tone?: "primary" | "warning"; compact?: boolean }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card", compact ? "p-3" : "p-4")}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
      <div className={cn(
        "font-semibold tabular-nums leading-tight mt-1",
        compact ? "text-lg" : "text-2xl",
        tone === "primary" && "text-primary",
        tone === "warning" && "text-warning",
      )}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground tabular-nums mt-1">{sub}</div>}
    </div>
  );
}

function MiniCurva({ curva, elapsedDays }: { curva: CampaignSnapshot["curva"]; elapsedDays: number }) {
  if (curva.length === 0) return null;
  const w = 720, h = 180, pad = 16;
  const maxS = Math.max(...curva.map(p => p.streamsDay), 1);
  const maxC = curva[curva.length - 1].cumulative;
  const xs = (i: number) => pad + (i / Math.max(curva.length - 1, 1)) * (w - pad * 2);
  const ysBar = (v: number) => h - pad - (v / maxS) * (h - pad * 2);
  const yC = (v: number) => h - pad - (v / maxC) * (h - pad * 2);
  const lineCum = curva.map((p, i) => `${i === 0 ? "M" : "L"} ${xs(i)} ${yC(p.cumulative)}`).join(" ");
  const barW = Math.max(1, (w - pad * 2) / curva.length - 1);
  const todayX = elapsedDays > 0 ? xs(Math.min(elapsedDays - 1, curva.length - 1)) : null;

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-32" preserveAspectRatio="none">
        {curva.map((p, i) => (
          <rect
            key={p.day}
            x={xs(i) - barW / 2}
            y={ysBar(p.streamsDay)}
            width={barW}
            height={h - pad - ysBar(p.streamsDay)}
            fill="hsl(var(--primary))"
            opacity={i < elapsedDays ? 0.45 : 0.18}
          />
        ))}
        <path d={lineCum} fill="none" stroke="hsl(var(--primary))" strokeWidth={1.5} />
        {todayX !== null && (
          <line x1={todayX} y1={pad} x2={todayX} y2={h - pad} stroke="hsl(var(--primary))" strokeDasharray="2 2" opacity={0.5} />
        )}
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1 tabular-nums">
        <span>D1</span>
        <span>Hoje · D{elapsedDays || 1}</span>
        <span>D{curva.length}</span>
      </div>
    </div>
  );
}
