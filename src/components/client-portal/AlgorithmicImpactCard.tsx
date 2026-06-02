import { Card, CardContent } from "@/components/ui/card";
import { Sparkles } from "lucide-react";

interface AlgorithmicImpactCardProps {
  /** Streams contratados / meta (snapshot.meta ou campaign.goal_plays). */
  goalPlays: number;
  /** Valor cobrado do cliente (clientPriceTotal). */
  valorCobrado: number;
  /** Streams já entregues (para usar como base quando em andamento). */
  totalDelivered?: number;
  /**
   * Tipo do cliente. Só "label" (gravadora) recebe a narrativa de
   * expansão orgânica — artista/produtor/manager veem apenas o garantido,
   * pois o orgânico fica com a engine (NexEngine).
   */
  clientType?: string | null;
}

const EXPANSION_RATE = 0.18;
const ORG = "hsl(217 91% 60%)";

const fmtInt = (n: number) =>
  new Intl.NumberFormat("pt-BR").format(Math.round(n));
const fmtBRLDecimal = (n: number) =>
  `R$ ${n.toFixed(3).replace(".", ",")}`;

/**
 * "Impacto algorítmico estimado" — versão compacta/premium.
 * Para gravadora: mostra Garantido + Orgânico estimado = Potencial total.
 * Para os demais (artista/produtor/manager): mostra só o garantido + CPS direto.
 */
export function AlgorithmicImpactCard({
  goalPlays,
  valorCobrado,
  totalDelivered,
  clientType,
}: AlgorithmicImpactCardProps) {
  if (!goalPlays || goalPlays <= 0) return null;
  if (!valorCobrado || valorCobrado <= 0) return null;

  const isLabel = clientType === "label";

  const garantido =
    totalDelivered && totalDelivered > 0 ? totalDelivered : goalPlays;
  const expansao = Math.round(goalPlays * EXPANSION_RATE);
  const potencialTotal = isLabel ? garantido + expansao : garantido;

  const cpsDireto = valorCobrado / goalPlays;
  const cpsEfetivo = isLabel ? valorCobrado / potencialTotal : cpsDireto;

  const pctGarantido = potencialTotal > 0 ? (garantido / potencialTotal) * 100 : 0;
  const pctExpansao = potencialTotal > 0 ? (expansao / potencialTotal) * 100 : 0;

  return (
    <Card>
      <CardContent className="space-y-4">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5" style={{ color: isLabel ? ORG : "hsl(var(--primary))" }} />
          <h3 className="text-[13px] font-semibold text-foreground tracking-tight">
            {isLabel ? "Impacto algorítmico estimado" : "Entrega contratada"}
          </h3>
          {isLabel && (
            <span
              className="ml-1 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{ color: ORG, backgroundColor: "hsl(217 91% 60% / 0.12)" }}
            >
              estimativa
            </span>
          )}
        </div>

        {isLabel ? (
          <>
            {/* Desktop: equação visual — Garantido + Orgânico = Potencial total */}
            <div className="hidden sm:flex sm:items-start sm:gap-4 lg:gap-6">
              <div className="flex-1 min-w-0">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-medium mb-2">
                  Garantido
                </div>
                <div className="text-2xl font-semibold tabular-nums text-foreground leading-none">
                  {fmtInt(garantido)}
                </div>
                <div className="text-[10px] text-muted-foreground mt-1.5">streams contratados</div>
              </div>

              <div
                className="hidden md:flex items-center text-2xl font-light leading-none select-none pt-5"
                style={{ color: "hsl(var(--muted-foreground) / 0.4)" }}
                aria-hidden
              >
                +
              </div>

              <div className="flex-1 min-w-0">
                <div
                  className="text-[10px] uppercase tracking-[0.14em] font-medium mb-2"
                  style={{ color: ORG }}
                >
                  Orgânico estimado
                </div>
                <div
                  className="text-2xl font-semibold tabular-nums leading-none"
                  style={{ color: ORG }}
                >
                  +{fmtInt(expansao)}
                </div>
                <div className="text-[10px] text-muted-foreground mt-1.5">
                  Radio · Autoplay · Mixes
                </div>
              </div>

              <div
                className="hidden md:flex items-center text-2xl font-light leading-none select-none pt-5"
                style={{ color: "hsl(var(--muted-foreground) / 0.4)" }}
                aria-hidden
              >
                =
              </div>

              <div className="flex-1 min-w-0 text-right pl-3 border-l border-border/60">
                <div className="text-[10px] uppercase tracking-[0.14em] text-primary/80 font-semibold mb-2">
                  Potencial total
                </div>
                <div className="text-3xl font-bold tabular-nums text-primary leading-none">
                  {fmtInt(potencialTotal)}
                </div>
                <div className="text-[10px] text-muted-foreground mt-1.5">streams</div>
              </div>
            </div>

            {/* Mobile */}
            <div className="sm:hidden divide-y divide-border/60 -mt-1">
              <ImpactRow label="Garantido" labelColor="hsl(var(--muted-foreground))" value={fmtInt(garantido)} valueColor="hsl(var(--foreground))" unit="streams" big={false} />
              <ImpactRow label="+ Orgânico estimado" labelColor={ORG} value={`+${fmtInt(expansao)}`} valueColor={ORG} unit="streams" big={false} />
              <ImpactRow label="Potencial total" labelColor="hsl(var(--muted-foreground))" value={fmtInt(potencialTotal)} valueColor="hsl(var(--primary))" unit="streams" big />
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
          </>
        ) : (
          // Artista / produtor / manager: só garantido, sem orgânico
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-medium mb-2">
                Streams garantidos
              </div>
              <div className="text-3xl font-bold tabular-nums text-primary leading-none">
                {fmtInt(garantido)}
              </div>
              <div className="text-[10px] text-muted-foreground mt-1.5">entregues via curadoria</div>
            </div>
          </div>
        )}

        {/* Custo efetivo */}
        <div className="flex items-baseline justify-between gap-3 pt-3 border-t border-border">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {isLabel ? "Custo efetivo" : "Custo por stream"}
          </div>
          <div className="flex items-baseline gap-2">
            {isLabel && (
              <span className="text-[11px] text-muted-foreground line-through tabular-nums">
                {fmtBRLDecimal(cpsDireto)}
              </span>
            )}
            <span className="text-base font-semibold tabular-nums text-primary">
              {fmtBRLDecimal(cpsEfetivo)}
            </span>
            <span className="text-[10px] text-muted-foreground">/ stream</span>
          </div>
        </div>

        {/* Disclaimer */}
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          {isLabel
            ? `Estimativa baseada em campanhas similares. Expansão orgânica não é garantida. Entrega garantida: ${fmtInt(garantido)} streams.`
            : `Entrega garantida: ${fmtInt(garantido)} streams via inserção em playlists de curadoria.`}
        </p>
      </CardContent>
    </Card>
  );
}

function ImpactRow({
  label,
  labelColor,
  value,
  valueColor,
  unit,
  big,
}: {
  label: string;
  labelColor: string;
  value: string;
  valueColor: string;
  unit: string;
  big?: boolean;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-baseline gap-3 py-2.5 first:pt-0 last:pb-0">
      <div
        className="text-[10px] uppercase tracking-[0.12em] font-medium leading-tight"
        style={{ color: labelColor }}
      >
        {label}
      </div>
      <div className="flex items-baseline gap-1.5 justify-end">
        <span
          className={
            "tabular-nums leading-none " +
            (big ? "text-2xl font-bold" : "text-xl font-semibold")
          }
          style={{ color: valueColor }}
        >
          {value}
        </span>
        <span className="text-[10px] text-muted-foreground leading-none">{unit}</span>
      </div>
    </div>
  );
}

