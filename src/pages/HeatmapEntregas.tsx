import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Calendar, Activity, Flame, Music, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { AnalyticsTabs } from "@/components/AnalyticsTabs";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

type Mode = "count" | "plays";

export default function HeatmapEntregas({ embedded = false }: { embedded?: boolean } = {}) {
  const [mode, setMode] = useState<Mode>("plays");
  const [days, setDays] = useState<30 | 60 | 90>(30);

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["heatmap_logs", days],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - days);
      const { data, error } = await supabase
        .from("curator_deal_logs")
        .select("created_at, total_plays, is_initial_capture_event")
        .gte("created_at", since.toISOString())
        .eq("is_initial_capture_event", false);
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

  // Top 3 janelas
  const topWindows = useMemo(() => {
    const all: { day: number; hour: number; value: number }[] = [];
    matrix.forEach((row, d) => row.forEach((v, h) => { if (v > 0) all.push({ day: d, hour: h, value: v }); }));
    return all.sort((a, b) => b.value - a.value).slice(0, 3);
  }, [matrix]);

  return (
    <div className="space-y-6">
      {!embedded && (
        <>
          <PageHeader title="Heatmap de entregas" subtitle="Janelas de entrega" />
          <AnalyticsTabs />
        </>
      )}

      {/* === DESTAQUE: PICO === */}
      <Card className="p-5 border-primary/30 bg-primary/5">
        <div className="flex min-w-0 items-start gap-4">
          <div className="h-10 w-10 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
            <Flame className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold">Janela de pico</div>
            <div className="text-2xl font-semibold mt-0.5">
              {peak.value > 0 ? `${DAYS[peak.day]}, ${String(peak.hour).padStart(2, "0")}h` : "Sem dados"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {peak.value > 0
                ? `${formatNumber(peak.value)} ${mode === "count" ? "logs" : "plays"} nesta janela nos últimos ${days} dias`
                : `Nenhum log nos últimos ${days} dias`}
            </div>
          </div>
          {topWindows.length > 1 && (
            <div className="hidden md:flex flex-col gap-1 text-right border-l border-border pl-4">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Top 3</div>
              {topWindows.map((w, i) => (
                <div key={i} className="text-xs">
                  <span className="text-muted-foreground">{i + 1}.</span>{" "}
                  <span className="font-medium">{DAYS[w.day]} {String(w.hour).padStart(2, "0")}h</span>{" "}
                  <span className="text-muted-foreground tabular-nums">· {formatNumber(w.value)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* === CONTROLES === */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5" />
            <span className="tabular-nums"><strong className="text-foreground">{formatNumber(totals.count)}</strong> logs</span>
          </div>
          <span className="text-muted-foreground/40">·</span>
          <div className="flex items-center gap-1.5">
            <Music className="h-3.5 w-3.5" />
            <span className="tabular-nums"><strong className="text-foreground">{formatNumber(totals.plays)}</strong> plays</span>
          </div>
        </div>
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-card rounded-lg border border-border">
            {(["plays", "count"] as Mode[]).map((m) => (
              <Button
                key={m}
                size="sm"
                variant={mode === m ? "default" : "ghost"}
                onClick={() => setMode(m)}
                className="h-7 text-xs"
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
                className="h-7 text-xs"
              >
                {d}d
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* === GRID === */}
      <Card className="p-4 overflow-x-auto overscroll-x-contain scrollbar-none sm:p-5">
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
                <Fragment key={`row-${d}`}>
                  <div className="text-[11px] text-muted-foreground pr-2 flex items-center justify-end h-8">
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
                </Fragment>
              ))}
            </div>
          </div>
        )}

        {!isLoading && totals.count === 0 && (
          <div className="text-center py-8 text-sm text-muted-foreground">
            Sem entregas nos últimos {days} dias.
          </div>
        )}

        <div className="mt-4 pt-3 border-t border-border flex items-start gap-2 text-[11px] text-muted-foreground">
          <Info className="h-3 w-3 mt-0.5 shrink-0" />
          <p>
            Quadrados mais escuros = mais entregas naquela janela. Use o pico pra programar releases logo antes
            e cobranças logo depois. Janelas anormais (madrugada) podem indicar automação no lado do curador.
          </p>
        </div>
      </Card>
    </div>
  );
}
