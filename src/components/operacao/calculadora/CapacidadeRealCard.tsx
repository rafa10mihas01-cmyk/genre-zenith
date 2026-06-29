import { useState } from "react";
import { Loader2, Target, AlertTriangle, Check, ChevronDown, ChevronUp, ArrowUpRight, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatInt } from "@/lib/campaignEngine";
import { useEcoRealCapacity } from "@/hooks/useEcoRealCapacity";

interface Props {
  genre: string;
  dailyNeed: number;
  multiplier: number;
  clientProfile?: "gravadora" | "artista";
  /** spotify_track_id da faixa do catálogo (quando aplicável). Quando
   *  fornecido, o planner lê a posição atual da faixa em cada playlist do
   *  pool e classifica cada allocation como keep/reposition/insert — assim
   *  o operador vê o trabalho que o catálogo já fez antes de aprovar. */
  spotifyTrackId?: string | null;
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
export function CapacidadeRealCard({ genre, dailyNeed, multiplier, clientProfile, spotifyTrackId }: Props) {
  const mode = clientProfile === "gravadora" ? "balanced" : "cascade";
  const cap = useEcoRealCapacity(genre, dailyNeed, multiplier, undefined, mode, spotifyTrackId ?? null);
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
          Capacidade
        </div>
        {status === "enxuto" && (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 text-primary px-2 py-0.5 text-[10px] font-medium">
            <Check className="h-2.5 w-2.5" /> Capacidade suficiente
          </span>
        )}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <Box label="Necessário" value={`${formatInt(dailyNeed)}/dia`} accent="text-foreground" />
        <Box
          label="Entrega"
          value={`${formatInt(Math.round(cap.coveredDaily))}/dia`}
          accent={statusAccent}
          delta={dailyNeed > 0 ? Math.round((cap.coveredDaily / dailyNeed - 1) * 100) : null}
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

      {/* Resumo de ações — só aparece quando há presença real do catálogo. */}
      {spotifyTrackId && cap.allocations.length > 0 && (cap.summary.keep + cap.summary.reposition) > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <span className="text-muted-foreground uppercase tracking-wide text-[10px]">Catálogo · estado atual</span>
          {cap.summary.keep > 0 && (
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <Check className="h-3 w-3" />
              <strong className="tabular-nums font-medium">{cap.summary.keep}</strong> manter
            </span>
          )}
          {cap.summary.reposition > 0 && (
            <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
              <ArrowUpRight className="h-3 w-3" />
              <strong className="tabular-nums font-medium">{cap.summary.reposition}</strong> reposicionar
            </span>
          )}
          {cap.summary.insert > 0 && (
            <span className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400">
              <Plus className="h-3 w-3" />
              <strong className="tabular-nums font-medium">{cap.summary.insert}</strong> inserir
            </span>
          )}
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
              {cap.allocations.map(a => {
                const actionMeta =
                  a.action === "keep"
                    ? { label: `Manter #${a.position}`, color: "text-emerald-600 dark:text-emerald-400", Icon: Check }
                    : a.action === "reposition"
                      ? { label: `Reposicionar #${a.previousPosition} → #${a.position}`, color: "text-amber-600 dark:text-amber-400", Icon: ArrowUpRight }
                      : { label: `Inserir #${a.position}`, color: "text-sky-600 dark:text-sky-400", Icon: Plus };
                const ActionIcon = actionMeta.Icon;
                return (
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
                    <div className="text-right shrink-0 flex flex-col items-end gap-0.5">
                      <span className={cn("inline-flex items-center gap-1 text-[10px] font-medium", actionMeta.color)}>
                        <ActionIcon className="h-2.5 w-2.5" />
                        {actionMeta.label}
                      </span>
                      <div className="text-[10px] text-muted-foreground tabular-nums">{formatInt(Math.round(a.cap_dia))}/dia</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

    </div>
  );
}

function Box({ label, value, accent, delta }: { label: string; value: string; accent?: string; delta?: number | null }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border/40 bg-background/40 px-2.5 py-2">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="flex items-baseline gap-1.5">
        <span className={cn("text-[15px] font-semibold tabular-nums leading-none", accent)}>{value}</span>
        {typeof delta === "number" && Number.isFinite(delta) && delta !== 0 && (
          <span className={cn("text-[10px] font-medium tabular-nums", delta > 0 ? "text-primary" : "text-destructive")}>
            {delta > 0 ? "+" : ""}{delta}%
          </span>
        )}
      </div>
    </div>
  );
}
