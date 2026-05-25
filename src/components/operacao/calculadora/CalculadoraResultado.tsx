import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBRL, formatInt, computePhaseDays, type CampaignResult } from "@/lib/campaignEngine";
import { TrendingUp, Wallet, Zap, Layers, Coins, Info } from "lucide-react";
import { CurvaEntregaChart } from "@/components/shared/CurvaEntregaChart";

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
      {/* Headline — ocupa 2 colunas no desktop, tipografia maior, acento primary */}
      <KpiHero
        icon={TrendingUp}
        label="Meta"
        value={formatInt(r.meta)}
        hint="streams totais planejados"
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
        <KpiClient
          icon={Coins}
          label="Cliente paga"
          value={formatBRL(clientTotal)}
          hint={`custo ${formatBRL(r.custoTotal)} · margem ${formatBRL(clientTotal - r.custoTotal)}`}
        />
      ) : (
        <KpiQuiet
          icon={Wallet}
          label="Custo"
          value={formatBRL(r.custoTotal)}
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
          <CurvaEntregaChart curva={r.curva} inercia={r.inercia} />
        </CardContent>
      </Card>
    </div>
  );
}

/** KPI headline — destaque máximo, ocupa 2 colunas no desktop */
function KpiHero({ icon: Icon, label, value, hint }: { icon: any; label: string; value: string; hint?: string }) {
  return (
    <div className="md:col-span-2 rounded-2xl border border-border border-l-2 border-l-primary bg-card p-4 relative overflow-hidden">
      {/* glow sutil verde no canto — cockpit feel */}
      <div className="absolute -top-12 -right-12 h-32 w-32 rounded-full bg-primary/10 blur-2xl pointer-events-none" aria-hidden />
      <div className="relative flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] font-semibold text-primary">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="relative text-3xl md:text-4xl font-semibold mt-1.5 tabular-nums tracking-tight text-foreground">
        {value}
      </div>
      {hint && <div className="relative text-xs text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}

/** KPI secundário — leitura tática */
function Kpi({ icon: Icon, label, value, hint }: { icon: any; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="text-xl font-semibold mt-1 tabular-nums text-foreground">{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

/** KPI terciário — referência financeira, peso reduzido */
function KpiQuiet({ icon: Icon, label, value, hint }: { icon: any; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground/80">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="text-lg font-medium mt-1 tabular-nums text-muted-foreground">{value}</div>
      {hint && <div className="text-xs text-muted-foreground/70 mt-0.5">{hint}</div>}
    </div>
  );
}

/** KPI cliente — destaca o valor cobrado, com borda primary suave */
function KpiClient({ icon: Icon, label, value, hint }: { icon: any; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-primary/40 bg-primary/5 p-4">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider font-semibold text-primary">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="text-xl font-semibold mt-1 tabular-nums text-foreground">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
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

// CurvaEntregaChart vive em @/components/shared/CurvaEntregaChart e é
// compartilhado entre Calculadora (admin) e Portal do Cliente.


