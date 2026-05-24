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

const fmtInt = (n: number) =>
  new Intl.NumberFormat("pt-BR").format(Math.round(n));

const fmtBRLDecimal = (n: number) =>
  `R$ ${n.toFixed(3).replace(".", ",")}`;

/**
 * Seção "Impacto algorítmico estimado" — só renderiza se houver
 * goal_plays > 0 E valor_cobrado > 0. Estimativa baseada em expansão
 * orgânica de 18% (Radio / Autoplay / Mixes / Descobertas).
 */
export function AlgorithmicImpactCard({
  goalPlays,
  valorCobrado,
  totalDelivered,
}: AlgorithmicImpactCardProps) {
  if (!goalPlays || goalPlays <= 0) return null;
  if (!valorCobrado || valorCobrado <= 0) return null;

  // Entrega garantida: meta contratada (ou entregue até agora se já estiver rodando)
  const garantido =
    totalDelivered && totalDelivered > 0 ? totalDelivered : goalPlays;
  const expansao = Math.round(goalPlays * EXPANSION_RATE);
  const potencialTotal = garantido + expansao;

  const cpsDireto = valorCobrado / goalPlays;
  const cpsEfetivo = valorCobrado / potencialTotal;

  const pctGarantido = potencialTotal > 0 ? (garantido / potencialTotal) * 100 : 0;
  const pctExpansao = potencialTotal > 0 ? (expansao / potencialTotal) * 100 : 0;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5 sm:p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[hsl(217_91%_60%)]" />
          <h3 className="text-sm font-semibold text-foreground">
            Impacto algorítmico estimado
          </h3>
          <span className="ml-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[hsl(217_91%_60%)]/15 text-[hsl(217_91%_60%)]">
            estimativa
          </span>
        </div>

        {/* 3 linhas */}
        <div className="space-y-2.5">
          {/* Garantido */}
          <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-secondary/40">
            <div className="text-sm text-foreground">Entrega direta garantida</div>
            <div className="text-base font-semibold tabular-nums text-foreground">
              {fmtInt(garantido)} streams
            </div>
          </div>

          {/* Expansão orgânica */}
          <div className="flex items-start justify-between px-3 py-2.5 rounded-lg bg-[hsl(217_91%_60%)]/[0.08] border border-[hsl(217_91%_60%)]/20">
            <div>
              <div className="text-sm text-[hsl(217_91%_60%)] font-medium">
                + Expansão orgânica estimada
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                Radio, Autoplay, Mixes, Descobertas
              </div>
            </div>
            <div className="text-base font-semibold tabular-nums text-[hsl(217_91%_60%)]">
              + {fmtInt(expansao)} streams
            </div>
          </div>

          {/* Potencial total */}
          <div className="flex items-center justify-between px-3 py-3 rounded-lg bg-secondary">
            <div className="text-sm font-semibold text-foreground">
              Potencial total
            </div>
            <div className="text-lg font-bold tabular-nums text-primary">
              {fmtInt(potencialTotal)} streams
            </div>
          </div>
        </div>

        {/* Custo efetivo */}
        <div className="rounded-lg border border-border bg-background/40 p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
            Custo efetivo estimado
          </div>
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-sm text-muted-foreground line-through tabular-nums">
              {fmtBRLDecimal(cpsDireto)}
            </span>
            <span className="text-2xl font-bold tabular-nums text-primary">
              {fmtBRLDecimal(cpsEfetivo)}
            </span>
            <span className="text-[11px] text-muted-foreground">por stream</span>
          </div>
        </div>

        {/* Barras */}
        <div className="space-y-2">
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full bg-primary"
              style={{ width: `${pctGarantido}%` }}
            />
            <div
              className="h-full bg-[hsl(217_91%_70%)]"
              style={{ width: `${pctExpansao}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-primary" />
              <span>Garantido {Math.round(pctGarantido)}%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-[hsl(217_91%_70%)]" />
              <span>Orgânico {Math.round(pctExpansao)}%</span>
            </div>
          </div>
        </div>

        {/* Disclaimer */}
        <p className="text-[10px] leading-relaxed text-muted-foreground pt-1 border-t border-border">
          Estimativa baseada em campanhas similares da plataforma. Expansão
          orgânica não é garantida — representa comportamento histórico de
          campanhas com movimentação equivalente. Entrega garantida:{" "}
          {fmtInt(garantido)} streams.
        </p>
      </CardContent>
    </Card>
  );
}
