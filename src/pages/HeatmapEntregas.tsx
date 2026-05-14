import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Calendar, Activity, Flame } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

type Mode = "count" | "plays";

export default function HeatmapEntregas() {
  const [mode, setMode] = useState<Mode>("count");
  const [days, setDays] = useState<30 | 60 | 90>(30);

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["heatmap_logs", days],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - days);
      const { data, error } = await supabase
        .from("curator_deal_logs")
        .select("created_at, total_plays, is_baseline")
        .gte("created_at", since.toISOString())
        .eq("is_baseline", false);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { matrix, max, totals } = useMemo(() => {
    const m: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    let total = 0;
    let totalPlays = 0;
    logs.forEach((l: any) => {
      const d = new Date(l.created_at);
      const day = d.getDay();
      const hour = d.getHours();
      const value = mode === "count" ? 1 : Number(l.total_plays ?? 0);
      m[day][hour] += value;
      total += 1;
      totalPlays += Number(l.total_plays ?? 0);
    });
    let mx = 0;
    m.forEach((row) => row.forEach((v) => { if (v > mx) mx = v; }));
    return { matrix: m, max: mx, totals: { count: total, plays: totalPlays } };
  }, [logs, mode]);

  const peak = useMemo(() => {
    let best = { day: 0, hour: 0, value: 0 };
    matrix.forEach((row, d) => {
      row.forEach((v, h) => {
        if (v > best.value) best = { day: d, hour: h, value: v };
      });
    });
    return best;
  }, [matrix]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Heatmap de entregas"
        subtitle="Identifique os dias e horários em que curadores mais reportam plays"
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 p-1 bg-card rounded-lg border border-border">
          {(["count", "plays"] as Mode[]).map((m) => (
            <Button
              key={m}
              size="sm"
              variant={mode === m ? "default" : "ghost"}
              onClick={() => setMode(m)}
            >
              {m === "count" ? "Nº de logs" : "Plays entregues"}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-1 p-1 bg-card rounded-lg border border-border">
          {([30, 60, 90] as const).map((d) => (
            <Button
              key={d}
              size="sm"
              variant={days === d ? "default" : "ghost"}
              onClick={() => setDays(d)}
            >
              {d}d
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">Logs registrados</div>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="mt-2 text-2xl font-semibold">{formatNumber(totals.count)}</div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">Plays totais</div>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="mt-2 text-2xl font-semibold">{formatNumber(totals.plays)}</div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">Janela de pico</div>
            <Flame className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-2 text-base font-semibold">
            {peak.value > 0 ? `${DAYS[peak.day]} ${String(peak.hour).padStart(2, "0")}h` : "—"}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {peak.value > 0 ? `${formatNumber(peak.value)} ${mode === "count" ? "logs" : "plays"}` : "Sem dados"}
          </div>
        </Card>
      </div>

      <Card className="p-5 overflow-x-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Dia da semana × hora local</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>menos</span>
            <div className="flex gap-0.5">
              {[0.1, 0.25, 0.5, 0.75, 1].map((o) => (
                <div
                  key={o}
                  className="h-3 w-3 rounded-sm bg-primary"
                  style={{ opacity: o }}
                />
              ))}
            </div>
            <span>mais</span>
          </div>
        </div>

        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="min-w-[760px]">
            <div className="grid" style={{ gridTemplateColumns: "40px repeat(24, 1fr)" }}>
              <div />
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="text-[10px] text-muted-foreground text-center pb-1"
                >
                  {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
                </div>
              ))}
              {DAYS.map((day, d) => (
                <>
                  <div
                    key={`l-${d}`}
                    className="text-[11px] text-muted-foreground pr-2 flex items-center justify-end h-8"
                  >
                    {day}
                  </div>
                  {HOURS.map((h) => {
                    const v = matrix[d][h];
                    const opacity = max > 0 ? Math.max(0, v / max) : 0;
                    const isPeak = v === peak.value && v > 0;
                    return (
                      <div
                        key={`${d}-${h}`}
                        className={cn(
                          "h-8 m-px rounded-sm transition relative group",
                          v === 0 ? "bg-muted/30" : "bg-primary",
                          isPeak && "ring-2 ring-primary/60",
                        )}
                        style={{ opacity: v === 0 ? 1 : 0.15 + opacity * 0.85 }}
                        title={`${day} ${String(h).padStart(2, "0")}h — ${formatNumber(v)} ${mode === "count" ? "logs" : "plays"}`}
                      />
                    );
                  })}
                </>
              ))}
            </div>
          </div>
        )}

        {!isLoading && totals.count === 0 && (
          <div className="text-center py-8 text-sm text-muted-foreground">
            Nenhum log de entrega nos últimos {days} dias.
          </div>
        )}
      </Card>
    </div>
  );
}
