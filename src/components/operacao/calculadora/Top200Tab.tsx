import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { formatInt } from "@/lib/campaignEngine";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { TrendingDown, RefreshCw, Calendar } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/errors";

type Row = {
  position: number;
  artist: string | null;
  track: string | null;
  streams_day: number;
  chart_date: string;
};

export function Top200Tab({ onPick }: { onPick?: (streamsDay: number, position: number) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [chartDate, setChartDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    // pega o snapshot mais recente
    const { data: latest } = await supabase
      .from("raw_chart_daily")
      .select("chart_date")
      .eq("chart_name", "top200_br")
      .order("chart_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latest?.chart_date) {
      setRows([]);
      setChartDate(null);
      setLoading(false);
      return;
    }

    const { data } = await supabase
      .from("raw_chart_daily")
      .select("position, artist, track, streams_day, chart_date")
      .eq("chart_name", "top200_br")
      .eq("chart_date", latest.chart_date)
      .order("position", { ascending: true });

    setRows((data ?? []) as Row[]);
    setChartDate(latest.chart_date);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-kworb-charts");
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Falha no sync");
      toast({ title: "Top 200 atualizado", description: `${data.rows} faixas · ${data.date}` });
      await load();
    } catch (e: unknown) {
      toast({ title: "Erro ao sincronizar", description: getErrorMessage(e) , variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  const headerActions = (
    <div className="flex items-center gap-3">
      {chartDate && (
        <span className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Calendar className="h-3 w-3" /> {chartDate}
        </span>
      )}
      <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}>
        <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncing ? "animate-spin" : ""}`} />
        {syncing ? "Sincronizando..." : "Sincronizar agora"}
      </Button>
    </div>
  );

  if (loading) return <Skeleton className="h-64" />;

  if (!rows.length) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingDown className="h-4 w-4" /> Sem dados do Top 200 ainda
            </CardTitle>
            <CardDescription>
              Sincronize com o kworb pra puxar o snapshot mais recente do Top 200 BR.
            </CardDescription>
          </div>
          {headerActions}
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Top 200 Brasil</h3>
          <p className="text-xs text-muted-foreground">Fonte: kworb · Clique em "Usar como meta" pra herdar streams/dia da posição.</p>
        </div>
        <div className="shrink-0">{headerActions}</div>
      </div>

      <div className="rounded-2xl border border-border overflow-hidden">
        <div className="overflow-x-auto nx-scroll">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left w-12">#</th>
                <th className="px-3 py-2 text-left">Artista · Faixa</th>
                <th className="px-3 py-2 text-right whitespace-nowrap">Streams/dia</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.position} className="border-t border-border hover:bg-accent/20">
                  <td className="px-3 py-2 font-medium tabular-nums">{r.position}</td>
                  <td className="px-3 py-2 min-w-0 max-w-[280px]">
                    <div className="truncate">
                      <span className="font-medium">{r.artist ?? "—"}</span>
                      <span className="text-muted-foreground"> · {r.track ?? "—"}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{formatInt(r.streams_day)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
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
      </div>
    </div>
  );
}
