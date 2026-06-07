import { useState } from "react";
import { Loader2, Target, AlertTriangle, Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatInt } from "@/lib/campaignEngine";
import { useEcoRealCapacity } from "@/hooks/useEcoRealCapacity";

interface Props {
  genre: string;
  dailyNeed: number;
  multiplier: number;
  clientProfile?: "gravadora" | "artista";
}

/**
 * Mostra a "capacidade real entregável" para o operador antes de fechar a
 * campanha: lista de playlists que serão usadas, posição que vai ocupar e
 * cap_dia esperado de cada uma. Tudo respeitando a projeção (saves × mult/30
 * × % posição) com tolerância de 10% acima do dailyNeed por playlist.
 *
 * Usa exatamente o mesmo algoritmo de `replan-campaign-eco` / `approve-campaign-plan`
 * via `useEcoRealCapacity` — o que aparece aqui é o que vai rodar no servidor.
 * Quando o cliente é gravadora/label, ativa o modo "balanced" (70% primária /
 * 30% vizinho) pra reduzir a contagem de playlists.
 */
export function CapacidadeRealCard({ genre, dailyNeed, multiplier, clientProfile }: Props) {
  const mode = clientProfile === "gravadora" ? "balanced" : "cascade";
  const cap = useEcoRealCapacity(genre, dailyNeed, multiplier, undefined, mode);
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
  const used = cap.allocations.length;
  const poolUnused = Math.max(0, cap.poolSize - used);

  // Estados alinhados ao early-stop de 95% do planner.
  // ≥95% = plano enxuto (esperado); 70-94% = parcial; <70% = insuficiente.
  const status: "enxuto" | "parcial" | "insuficiente" =
    coverage >= 95 ? "enxuto" : coverage >= 70 ? "parcial" : "insuficiente";

  const statusBorder =
    status === "enxuto" ? "border-primary/30 bg-primary/5"
    : status === "parcial" ? "border-amber-500/40 bg-amber-500/5"
    : "border-destructive/40 bg-destructive/5";

  const statusAccent =
    status === "enxuto" ? "text-primary"
    : status === "parcial" ? "text-amber-600 dark:text-amber-400"
    : "text-destructive";

  return (
    <div className={cn("mt-3 rounded-lg border px-3.5 py-3", statusBorder)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
          <Target className="h-3 w-3" />
          Capacidade real entregável
        </div>
        <span className={cn("text-[11px] font-medium tabular-nums", statusAccent)}>
          {coverage}% da meta diária
        </span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <Box label="Você pediu" value={`${formatInt(dailyNeed)}/dia`} accent="text-foreground" />
        <Box
          label="Sistema entrega"
          value={`${formatInt(Math.round(cap.coveredDaily))}/dia`}
          accent={statusAccent}
        />
      </div>

      {status === "enxuto" && (
        <div className="mt-2 flex items-start gap-1.5 text-[11px] text-primary">
          <Check className="h-3 w-3 mt-0.5 shrink-0" />
          <span>
            Plano enxuto: usa <strong className="tabular-nums">{used}</strong> de{" "}
            <strong className="tabular-nums">{cap.poolSize}</strong> playlists do pool.
            {poolUnused > 0 && (
              <> As outras <strong className="tabular-nums">{poolUnused}</strong> ficam de fora — entregariam ruído (&lt;5 plays/dia) e poluiriam o plano.</>
            )}
          </span>
        </div>
      )}
      {status === "parcial" && (
        <div className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          <span>
            Pool quase esgotado: <strong className="tabular-nums">{used}</strong> de{" "}
            <strong className="tabular-nums">{cap.poolSize}</strong> playlists, cobrindo {coverage}%.
            Considere afrouxar o gênero (mais vizinhos) ou aumentar o split de curadores.
          </span>
        </div>
      )}
      {status === "insuficiente" && (
        <div className="mt-2 flex items-start gap-1.5 text-[11px] text-destructive">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          <span>
            Pool insuficiente: só <strong className="tabular-nums">{coverage}%</strong> da meta com{" "}
            <strong className="tabular-nums">{cap.poolSize}</strong> playlists do gênero + vizinhos.
            Reduza a meta ou troque o gênero.
          </span>
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
