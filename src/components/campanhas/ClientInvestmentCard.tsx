import { Card, CardContent } from "@/components/ui/card";
import { formatInt, formatBRL } from "@/lib/campaignEngine";
import { Sparkles, TrendingUp, CalendarDays, Coins } from "lucide-react";

type Props = {
  meta: number;
  days: number;
  effectiveDays?: number;
  pricePerStreamSell?: number;
  clientPriceTotal?: number;
};

/**
 * Card "Investimento" pro portal do cliente. Mostra SÓ:
 *  - meta de streams · duração · investimento total · investimento por stream
 * NÃO mostra split eco/ext, custos internos, pricing operacional ou margem.
 */
export function ClientInvestmentCard({ meta, days, effectiveDays, pricePerStreamSell, clientPriceTotal }: Props) {
  const hasPrice = !!clientPriceTotal && clientPriceTotal > 0;
  // fallback: recomputar caso snapshot antigo sem clientPriceTotal mas com pricePerStreamSell
  const total = hasPrice
    ? clientPriceTotal!
    : pricePerStreamSell
      ? Math.round(meta * pricePerStreamSell * 100) / 100
      : 0;
  const perStream = pricePerStreamSell ?? (meta > 0 ? total / meta : 0);

  if (total <= 0) return null;

  return (
    <Card className="relative overflow-hidden border-primary/30 bg-gradient-to-br from-primary/[0.06] via-card to-card mb-6">
      <div className="absolute -top-20 -right-20 h-56 w-56 rounded-full bg-primary/15 blur-3xl pointer-events-none" aria-hidden />
      <div className="absolute -bottom-16 -left-16 h-40 w-40 rounded-full bg-primary/10 blur-2xl pointer-events-none" aria-hidden />
      <CardContent className="relative p-6 md:p-8">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] font-semibold text-primary mb-4">
          <Sparkles className="h-3.5 w-3.5" />
          Investimento da campanha
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr_1fr] gap-6 md:gap-8 items-end">
          {/* Headline: valor total */}
          <div>
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
              <Coins className="h-3 w-3" />
              Valor total
            </div>
            <div className="text-4xl md:text-5xl font-semibold tabular-nums tracking-tight text-foreground">
              {formatBRL(total)}
            </div>
            {perStream > 0 && (
              <div className="text-xs text-muted-foreground mt-1.5 tabular-nums">
                R$ {perStream.toFixed(3).replace(".", ",")} por stream
              </div>
            )}
          </div>

          <div className="md:border-l md:border-border/60 md:pl-8">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
              <TrendingUp className="h-3 w-3" />
              Streams contratados
            </div>
            <div className="text-2xl md:text-3xl font-semibold tabular-nums text-foreground">
              {formatInt(meta)}
            </div>
            <div className="text-xs text-muted-foreground mt-1.5">meta total da campanha</div>
          </div>

          <div className="md:border-l md:border-border/60 md:pl-8">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
              <CalendarDays className="h-3 w-3" />
              Duração
            </div>
            <div className="text-2xl md:text-3xl font-semibold tabular-nums text-foreground">
              {days}d
            </div>
            <div className="text-xs text-muted-foreground mt-1.5">contratado{effectiveDays && effectiveDays !== days ? ` · plano real: ${effectiveDays}d` : ""}</div>
          </div>
        </div>

        <p className="text-[10px] text-muted-foreground/80 mt-6 leading-relaxed">
          Valor fechado para esta campanha. A NexEngine assume a execução, curadoria e monitoramento
          até o cumprimento integral da meta de streams contratada.
        </p>
      </CardContent>
    </Card>
  );
}
