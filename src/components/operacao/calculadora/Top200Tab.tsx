import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { formatInt } from "@/lib/campaignEngine";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { TrendingDown } from "lucide-react";

type Row = { position: number; streams_day: number; captured_at: string };

export function Top200Tab({ onPick }: { onPick?: (streamsDay: number, position: number) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("chart_position_benchmarks")
        .select("position, streams_day, captured_at")
        .eq("database", "br")
        .order("captured_at", { ascending: false })
        .order("position", { ascending: true })
        .limit(200);
      // Deduplica por posição mantendo o mais recente
      const seen = new Set<number>();
      const dedup: Row[] = [];
      for (const r of (data ?? []) as Row[]) {
        if (!seen.has(r.position)) {
          seen.add(r.position);
          dedup.push(r);
        }
      }
      dedup.sort((a, b) => a.position - b.position);
      setRows(dedup);
      setLoading(false);
    })();
  }, []);

  if (loading) return <Skeleton className="h-64" />;

  if (!rows.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingDown className="h-4 w-4" /> Sem dados do Top 200 ainda
          </CardTitle>
          <CardDescription>
            Importe um snapshot do Top 200 BR (posição → streams/dia) para alimentar a calculadora.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          A importação fica disponível para administradores em uma próxima fase.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="rounded-2xl border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">#</th>
            <th className="px-3 py-2 text-right">Streams/dia</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.position} className="border-t border-border hover:bg-accent/20">
              <td className="px-3 py-2 font-medium">{r.position}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatInt(r.streams_day)}</td>
              <td className="px-3 py-2 text-right">
                {onPick && (
                  <button
                    onClick={() => onPick(r.streams_day, r.position)}
                    className="text-xs text-primary hover:underline"
                  >
                    Usar como meta →
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
