import { Card, CardContent } from "@/components/ui/card";
import { Sparkles } from "lucide-react";

interface AlgorithmicImpactCardProps {
  /** Streams contratados / meta (snapshot.meta ou campaign.goal_plays). */
  goalPlays: number;
  /** Valor cobrado do cliente (clientPriceTotal). */
  valorCobrado: number;
  /** Streams já entregues (para usar como base quando em andamento). */
  totalDelivered?: number;
}

const EXPANSION_RATE = 0.18;
const ORG = "hsl(217 91% 60%)";

const fmtInt = (n: number) =>
  new Intl.NumberFormat("pt-BR").format(Math.round(n));
const fmtBRLDecimal = (n: number) =>
  `R$ ${n.toFixed(3).replace(".", ",")}`;

/**
 * "Impacto algorítmico estimado" — versão compacta/premium.
 * Mesmas regras de cálculo (expansão orgânica 18%), só visualmente mais fino.
 */
export function AlgorithmicImpactCard({
  goalPlays,
  valorCobrado,
  totalDelivered,
}: AlgorithmicImpactCardProps) {
  if (!goalPlays || goalPlays <= 0) return null;
  if (!valorCobrado || valorCobrado <= 0) return null;

  const garantido =
    totalDelivered && totalDelivered > 0 ? totalDelivered : goalPlays;
  const expansao = Math.round(goalPlays * EXPANSION_RATE);
  const potencialTotal = garantido + expansao;

  const cpsDireto = valorCobrado / goalPlays;
  const cpsEfetivo = valorCobrado / potencialTotal;

  const pctGarantido = potencialTotal > 0 ? (garantido / potencialTotal) * 100 : 0;
  const pctExpansao = potencialTotal > 0 ? (expansao / potencialTotal) * 100 : 0;

  return (
    <Card>
      <CardContent className="space-y-4">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5" style={{ color: ORG }} />
          <h3 className="text-[13px] font-semibold text-foreground tracking-tight">
            Impacto algorítmico estimado
          </h3>
          <span
            className="ml-1 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
            style={{ color: ORG, backgroundColor: "hsl(217 91% 60% / 0.12)" }}
          >

            estimativa
          </span>
        </div>

        {/* Mobile: linhas empilhadas / Desktop: grid 3 colunas */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 sm:items-end">
          <div className="flex sm:block items-baseline justify-between gap-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground sm:mb-1">
              Garantido
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-base sm:text-lg font-semibold tabular-nums text-foreground leading-none">
                {fmtInt(garantido)}
              </span>
              <span className="text-[10px] text-muted-foreground sm:hidden">streams</span>
            </div>
            <div className="hidden sm:block text-[10px] text-muted-foreground mt-1">streams</div>
          </div>
          <div className="flex sm:block items-baseline justify-between gap-3">
            <div className="text-[10px] uppercase tracking-wider sm:mb-1" style={{ color: ORG }}>
              + Orgânico estimado
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-base sm:text-lg font-semibold tabular-nums leading-none" style={{ color: ORG }}>
                +{fmtInt(expansao)}
              </span>
            </div>
            <div className="hidden sm:block text-[10px] text-muted-foreground mt-1">
              Radio · Autoplay · Mixes
            </div>
          </div>
          <div className="flex sm:block items-baseline justify-between gap-3 sm:text-right pt-2 sm:pt-0 border-t sm:border-0 border-border">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground sm:mb-1">
              Potencial total
            </div>
            <div className="flex items-baseline gap-1 sm:justify-end">
              <span className="text-lg sm:text-xl font-bold tabular-nums text-primary leading-none">
                {fmtInt(potencialTotal)}
              </span>
              <span className="text-[10px] text-muted-foreground sm:hidden">streams</span>
            </div>
            <div className="hidden sm:block text-[10px] text-muted-foreground mt-1">streams</div>
          </div>
        </div>

        {/* Barra compacta */}
        <div className="space-y-1.5">
          <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div className="h-full bg-primary" style={{ width: `${pctGarantido}%` }} />
            <div className="h-full" style={{ width: `${pctExpansao}%`, background: ORG }} />
          </div>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
              Garantido {Math.round(pctGarantido)}%
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: ORG }} />
              Orgânico {Math.round(pctExpansao)}%
            </span>
          </div>
        </div>

        {/* Custo efetivo — inline, sem caixa */}
        <div className="flex items-baseline justify-between gap-3 pt-3 border-t border-border">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Custo efetivo
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] text-muted-foreground line-through tabular-nums">
              {fmtBRLDecimal(cpsDireto)}
            </span>
            <span className="text-base font-semibold tabular-nums text-primary">
              {fmtBRLDecimal(cpsEfetivo)}
            </span>
            <span className="text-[10px] text-muted-foreground">/ stream</span>
          </div>
        </div>

        {/* Disclaimer */}
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Estimativa baseada em campanhas similares. Expansão orgânica não é
          garantida. Entrega garantida: {fmtInt(garantido)} streams.
        </p>
      </CardContent>
    </Card>
  );
}
