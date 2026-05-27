import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Brain, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

/**
 * BrainFreshnessCard — quantos gêneros foram analisados nas últimas 24h
 * vs total ativo. Sinal de "o cérebro está rodando?".
 */
export function BrainFreshnessCard() {
  const [data, setData] = useState<{ fresh: number; stale: number; total: number } | null>(null);

  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const [{ count: total }, { count: fresh }] = await Promise.all([
        supabase.from("genres").select("id", { count: "exact", head: true }).eq("ativo", true),
        supabase.from("genre_models").select("id", { count: "exact", head: true }).gte("ultima_analise", since),
      ]);
      const t = total ?? 0;
      const f = fresh ?? 0;
      setData({ fresh: f, stale: Math.max(0, t - f), total: t });
    })();
  }, []);

  const pct = data && data.total > 0 ? Math.round((data.fresh / data.total) * 100) : 0;
  const tone = pct >= 70 ? "text-success" : pct >= 40 ? "text-warning" : "text-destructive";
  const barTone = pct >= 70 ? "bg-success" : pct >= 40 ? "bg-warning" : "bg-destructive";

  return (
    <Link to="/analytics" className="nx-card-hover p-5 flex flex-col gap-4 group h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
            Cérebro hoje
          </span>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>

      {!data ? (
        <div className="h-24 rounded-md bg-muted/40 animate-pulse" />
      ) : (
        <>
          <div className="grid grid-cols-3 rounded-xl border border-border/60 bg-muted/10 overflow-hidden divide-x divide-border/60">
            <div className="flex flex-col items-center justify-center text-center py-4 px-2">
              <div className={cn("text-xl font-bold tabular-nums leading-none", tone)}>
                {data.fresh}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-2">Analisados</div>
            </div>
            <div className="flex flex-col items-center justify-center text-center py-4 px-2">
              <div className={cn(
                "text-xl font-bold tabular-nums leading-none",
                data.stale === 0 ? "text-foreground" : "text-warning",
              )}>
                {data.stale}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-2">Pendentes</div>
            </div>
            <div className="flex flex-col items-center justify-center text-center py-4 px-2">
              <div className={cn("text-xl font-bold tabular-nums leading-none", tone)}>
                {pct}%
              </div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-2">Cobertura</div>
            </div>
          </div>

          <div className="h-1.5 w-full bg-muted/40 rounded-full overflow-hidden">
            <div
              className={cn("h-full transition-all", barTone)}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>

          <div className="text-[11px] text-muted-foreground text-center">
            {data.total === 0
              ? "Nenhum gênero ativo cadastrado."
              : data.stale > 0
              ? `${data.fresh} de ${data.total} gêneros analisados nas últimas 24h.`
              : `Todos os ${data.total} gêneros atualizados.`}
          </div>
        </>
      )}
    </Link>
  );
}
