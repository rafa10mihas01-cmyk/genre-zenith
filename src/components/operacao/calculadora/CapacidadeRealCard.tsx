import { useState } from "react";
import { Loader2, Target, AlertTriangle, Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatInt } from "@/lib/campaignEngine";
import { useEcoRealCapacity } from "@/hooks/useEcoRealCapacity";

interface Props {
  genre: string;
  dailyNeed: number;
  multiplier: number;
}

/**
 * Mostra a "capacidade real entregável" para o operador antes de fechar a
 * campanha: lista de playlists que serão usadas, posição que vai ocupar e
 * cap_dia esperado de cada uma. Tudo respeitando a projeção (saves × mult/30
 * × % posição) com tolerância de 10% acima do dailyNeed por playlist.
 *
 * Usa exatamente o mesmo algoritmo de `replan-campaign-eco` / `approve-campaign-plan`
 * via `useEcoRealCapacity` — o que aparece aqui é o que vai rodar no servidor.
 */
export function CapacidadeRealCard({ genre, dailyNeed, multiplier }: Props) {
  const cap = useEcoRealCapacity(genre, dailyNeed, multiplier);
  const [expanded, setExpanded] = useState(false);

  if (!genre?.trim() || dailyNeed <= 0) return null;

  if (cap.loading) {
    return (
      <div className="mt-3 rounded-lg border border-border/40 bg-muted/10 px-3 py-2.5 text-[11px] text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-3 w-3 animate-spin" /> Calculando capacidade real…
      </div>
    );
  }

  if (!cap.genreResolved) {
    return (
      <div className="mt-3 rounded-lg border border-border/40 bg-muted/10 px-3 py-2.5 text-[11px] text-muted-foreground">
        Gênero "{genre}" não encontrado no catálogo — não consigo projetar a entrega.
      </div>
    );
  }

  const coverage = dailyNeed > 0 ? Math.round((cap.coveredDaily / dailyNeed) * 100) : 0;
  const surplus = cap.coveredDaily - dailyNeed;
  const surplusPct = dailyNeed > 0 ? Math.round((surplus / dailyNeed) * 100) : 0;

  const status: "ok" | "over" | "under" =
    cap.remainingDaily > 0 ? "under" : surplusPct > Math.round(cap.tolerance * 100) ? "over" : "ok";

  const statusBorder =
    status === "ok" ? "border-primary/30 bg-primary/5"
    : status === "over" ? "border-amber-500/40 bg-amber-500/5"
    : "border-destructive/40 bg-destructive/5";

  return (
    <div className={cn("mt-3 rounded-lg border px-3.5 py-3", statusBorder)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
          <Target className="h-3 w-3" />
          Capacidade real entregável
        </div>
        <span className={cn(
          "text-[11px] font-medium tabular-nums",
          status === "ok" ? "text-primary"
          : status === "over" ? "text-amber-600 dark:text-amber-400"
          : "text-destructive",
        )}>
          {coverage}% da meta diária
        </span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <Box label="Você pediu" value={`${formatInt(dailyNeed)}/dia`} accent="text-foreground" />
        <Box
          label="Sistema entrega"
          value={`${formatInt(Math.round(cap.coveredDaily))}/dia`}
          accent={status === "ok" ? "text-primary" : status === "over" ? "text-amber-600 dark:text-amber-400" : "text-destructive"}
        />
      </div>

      {status === "under" && (
        <div className="mt-2 flex items-start gap-1.5 text-[11px] text-destructive">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          <span>
            Faltam <strong className="tabular-nums">{formatInt(cap.remainingDaily)}/dia</strong>.
            Pool atual ({cap.poolSize} playlists do gênero + vizinhos) não cobre a meta. Reduza a meta ou aumente o split externo.
          </span>
        </div>
      )}
      {status === "over" && (
        <div className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          <span>
            Entregaria <strong className="tabular-nums">+{formatInt(surplus)}/dia</strong> ({surplusPct}% acima).
            Considere baixar a meta pra esse número ou tirar a última playlist.
          </span>
        </div>
      )}
      {status === "ok" && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-primary">
          <Check className="h-3 w-3" />
          <span>Encaixe dentro da tolerância de {Math.round(cap.tolerance * 100)}%. Posições respeitam a projeção real.</span>
        </div>
      )}

      {cap.allocations.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="mt-3 w-full flex items-center justify-between text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>{cap.allocations.length} playlist{cap.allocations.length === 1 ? "" : "s"} no plano</span>
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {expanded && (
            <div className="mt-2 space-y-1 max-h-64 overflow-y-auto pr-1">
              {cap.allocations.map(a => (
                <div
                  key={a.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-background/40 px-2.5 py-1.5 text-[11px]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-foreground">{a.name ?? a.id.slice(0, 8)}</div>
                    <div className="text-[10px] text-muted-foreground tabular-nums">
                      {formatInt(a.followers)} saves
                      {a.source === "neighbor" && <span className="text-amber-600 dark:text-amber-400"> · vizinho</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-foreground tabular-nums font-medium">#{a.position}</div>
                    <div className="text-[10px] text-muted-foreground tabular-nums">{formatInt(Math.round(a.cap_dia))}/dia</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Box({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border/40 bg-background/40 px-2.5 py-2">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={cn("text-[15px] font-semibold tabular-nums leading-none", accent)}>{value}</span>
    </div>
  );
}
