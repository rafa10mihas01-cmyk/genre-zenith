import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Brain, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

/**
 * BrainFreshnessCard — quantos gêneros foram analisados nas últimas 24h
 * vs total ativo. Sinal de "o cérebro está rodando?".
 */
export function BrainFreshnessCard() {
  const [data, setData] = useState<{ fresh: number; stale: number; total: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const [{ count: total }, { count: fresh }] = await Promise.all([
        supabase.from("genres").select("id", { count: "exact", head: true }).eq("ativo", true),
        supabase.from("genre_models").select("id", { count: "exact", head: true }).gte("ultima_analise", since),
      ]);
      const t = total ?? 0;
      const f = fresh ?? 0;
      setData({ fresh: f, stale: Math.max(0, t - f), total: t });
      setLoading(false);
    })();
  }, []);

  const pct = data && data.total > 0 ? Math.round((data.fresh / data.total) * 100) : 0;
  const tone = pct >= 70 ? "text-success" : pct >= 40 ? "text-warning" : "text-destructive";

  return (
    <Link to="/cerebro" className="block group">
      <Card className="p-4 md:p-5 hover:bg-muted/30 transition-colors h-full">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-primary" />
            <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
              Cérebro hoje
            </span>
          </div>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>

        {loading || !data ? (
          <div className="h-12 rounded bg-muted/40 animate-pulse" />
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className={`text-3xl font-bold tabular-nums leading-none ${tone}`}>
                {data.fresh}
              </span>
              <span className="text-sm text-muted-foreground tabular-nums">
                /{data.total}
              </span>
            </div>
            <div className="text-[11px] text-muted-foreground mt-2">
              {data.stale > 0
                ? `${data.stale} gênero${data.stale > 1 ? "s" : ""} sem análise em 24h`
                : "todos atualizados"}
            </div>
          </>
        )}
      </Card>
    </Link>
  );
}
