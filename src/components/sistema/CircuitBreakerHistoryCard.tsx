// Histórico de bloqueios temporários do Spotify (últimos 30 dias).
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { ShieldAlert } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { humanizeFunctionName, humanizeError } from "@/lib/operationalCopy";

type LogRow = {
  id: string;
  app_id: string;
  opened_at: string;
  blocked_until: string;
  retry_after_sec: number;
  caused_by: string | null;
  source_function: string | null;
};

export function CircuitBreakerHistoryCard() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const { data } = await supabase
        .from("spotify_circuit_breaker_log")
        .select("*")
        .gte("opened_at", cutoff)
        .order("opened_at", { ascending: false })
        .limit(50);
      if (!cancelled) {
        setRows((data ?? []) as LogRow[]);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const total = rows.length;
  const avgBlock = total
    ? Math.round(rows.reduce((a, r) => a + (r.retry_after_sec || 0), 0) / total)
    : 0;
  const bySource = rows.reduce<Record<string, number>>((acc, r) => {
    const k = r.source_function || "desconhecido";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  const topSources = Object.entries(bySource).sort((a, b) => b[1] - a[1]).slice(0, 5);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-amber-500" />
          Bloqueios temporários do Spotify — últimos 30 dias
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3 text-xs">
          <div>
            <div className="text-muted-foreground">Bloqueios</div>
            <div className="text-xl font-semibold">{total}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Pausa média</div>
            <div className="text-xl font-semibold">{avgBlock < 60 ? `${avgBlock}s` : `${Math.round(avgBlock / 60)} min`}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Áreas afetadas</div>
            <div className="text-xl font-semibold">{Object.keys(bySource).length}</div>
          </div>
        </div>

        {loading ? (
          <div className="text-xs text-muted-foreground">Carregando…</div>
        ) : total === 0 ? (
          <div className="text-xs text-muted-foreground">
            Nenhum bloqueio nos últimos 30 dias — Spotify está respondendo normalmente.
          </div>
        ) : (
          <>
            {topSources.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Onde aconteceu</div>
                <div className="flex flex-wrap gap-1.5">
                  {topSources.map(([name, count]) => (
                    <Badge key={name} variant="outline" className="text-xs">
                      {humanizeFunctionName(name)} · {count}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-1 max-h-64 overflow-y-auto pr-1 nx-scroll">
              {rows.slice(0, 10).map((r) => (
                <div key={r.id} className="flex items-center justify-between text-xs border-b border-border/40 py-1.5 gap-3">
                  <div className="flex flex-col min-w-0">
                    <span className="font-medium truncate">{humanizeFunctionName(r.source_function)}</span>
                    {r.caused_by && (
                      <span className="text-muted-foreground truncate max-w-[300px]">{humanizeError(r.caused_by)}</span>
                    )}
                  </div>
                  <div className="text-right text-muted-foreground shrink-0">
                    <div>pausa de {r.retry_after_sec < 60 ? `${r.retry_after_sec}s` : `${Math.round(r.retry_after_sec / 60)} min`}</div>
                    <div>{formatDistanceToNow(new Date(r.opened_at), { addSuffix: true, locale: ptBR })}</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
