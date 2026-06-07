import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBRL, formatInt, computePhaseDays, type CampaignResult } from "@/lib/campaignEngine";
import { formatBRLHero } from "@/lib/format";
import { TrendingUp, Wallet, Zap, Layers, Coins, Info } from "lucide-react";
import { CurvaEntregaChart } from "@/components/shared/CurvaEntregaChart";
import { Kpi } from "@/components/ui/kpi";

/** KPIs do resultado — hierarquia operacional:
 *   META é o headline (peso visual dominante)
 *   Pico/dia e Duração são secundários (leitura tática)
 *   Custo é terciário (referência financeira)
 *   Cliente paga é o valor cobrado (se pricePerStreamSell informado)
 */
export function CalculadoraKpis({ r, pricePerStreamSell }: { r: CampaignResult; pricePerStreamSell?: number }) {
  const clientTotal = pricePerStreamSell && pricePerStreamSell > 0
    ? Math.round(r.meta * pricePerStreamSell * 100) / 100
    : null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <Kpi
        variant="hero"
        icon={TrendingUp}
        label="Meta"
        value={formatInt(r.meta)}
        hint="streams totais planejados"
        className="md:col-span-2"
      />
      <Kpi
        icon={Zap}
        label="Pico/dia"
        value={formatInt(r.picoPorDia)}
        hint={`média ${formatInt(r.mediaPorDia)}`}
      />
      <Kpi
        icon={Layers}
        label="Duração"
        value={`${r.days}d`}
        hint={`plano real: ${r.effectiveDays}d`}
      />
      {clientTotal != null ? (
        <Kpi
          icon={Coins}
          tone="primary"
          label="Cliente paga"
          value={formatBRLHero(clientTotal)}
          hint={`custo ${formatBRLHero(r.custoTotal)} · margem ${formatBRLHero(clientTotal - r.custoTotal)}`}
        />
      ) : (
        <Kpi
          variant="compact"
          icon={Wallet}
          label="Custo"
          value={formatBRLHero(r.custoTotal)}
          hint={`R$ ${r.custoPorStream.toFixed(3)}/stream`}
        />
      )}
    </div>
  );
}



export function CalculadoraResultado({ r }: { r: CampaignResult }) {
  const phases = computePhaseDays(r.effectiveDays);
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/20 px-3 py-2.5 text-[12px] text-foreground/85">
        <Info className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
        <span className="leading-relaxed">
          Duração contratada: <strong className="text-foreground">{r.days} dias</strong> · Duração real do plano: <strong className="text-foreground">{r.effectiveDays} dias</strong>{" "}
          <span className="text-muted-foreground">
            (inclui {phases.ramp} dias de rampa + {phases.outro} dias de saída suave)
          </span>
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Distribuição do investimento</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <SplitBar
            label="Ecossistema próprio"
            pct={r.splitEcoPct}
            streams={r.streamsEco}
            custo={r.custoEco}
            tone="primary"
          />
          <SplitBar
            label="Curadores"
            pct={r.metaOperacional > 0 ? Math.round((r.streamsExt / r.metaOperacional) * 100) : 0}
            streams={r.streamsExt}
            custo={r.custoExt}
            tone="muted"
          />
          {r.streamsOrganic > 0 && (
            <SplitBar
              label="Rádio"
              pct={r.splitOrganicPct}
              streams={r.streamsOrganic}
              custo={r.custoOrganic}
              tone="muted"
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Curva de entrega</CardTitle>
        </CardHeader>
        <CardContent>
          <CurvaEntregaChart curva={r.curva} inercia={r.inercia} />
        </CardContent>
      </Card>
    </div>
  );
}

// KPIs locais (KpiHero/Kpi/KpiQuiet/KpiClient) consolidados em @/components/ui/kpi


function SplitBar({
  label, pct, streams, custo, tone,
}: { label: string; pct: number; streams: number; custo: number; tone: "primary" | "muted" }) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{label}</div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={tone === "primary" ? "h-full bg-primary" : "h-full bg-muted-foreground/40"}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>{pct}% · {formatInt(streams)} streams</span>
        <span className="text-foreground font-semibold">{formatBRL(custo)}</span>
      </div>
    </div>
  );
}

// CurvaEntregaChart vive em @/components/shared/CurvaEntregaChart e é
// compartilhado entre Calculadora (admin) e Portal do Cliente.


