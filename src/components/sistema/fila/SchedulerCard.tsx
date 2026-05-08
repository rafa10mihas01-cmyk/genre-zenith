// SchedulerCard — botão "Rodar scheduler agora" + KPIs operacionais (throughput, avg, crash).
import { useState } from "react";
import { Play, Gauge, AlertOctagon, Repeat2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Stats = {
  throughputPerMin: number;
  crashRate: number;
  retriesTotal: number;
  avgMs: number;
  avgByType: Map<string, number>;
};

function fmtDur(ms: number): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}min`;
}

export function SchedulerCard({ stats, onRan }: { stats: Stats; onRan?: () => void }) {
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("jobs-scheduler", { body: {} });
      if (error) throw error;
      const enq = data?.enqueued ?? {};
      const total = Object.values(enq).reduce((a: number, b) => a + Number(b ?? 0), 0);
      const detail = Object.entries(enq)
        .filter(([, n]) => Number(n) > 0)
        .map(([k, n]) => `${k.replace("spotify.", "")}:${n}`)
        .join(" · ") || "nenhum job pendente";
      toast.success(`Scheduler executado · ${total} jobs · ${detail}`);
      onRan?.();
    } catch (e) {
      console.error(e);
      toast.error(`Falha no scheduler: ${(e as Error)?.message ?? "erro"}`);
    } finally { setRunning(false); }
  };

  const items: Array<{ icon: typeof Gauge; label: string; value: string; tone?: string; hint?: string }> = [
    { icon: Gauge,        label: "Throughput", value: `${stats.throughputPerMin.toFixed(2)}/min`, hint: "última hora" },
    { icon: Repeat2,      label: "Retries 24h", value: String(stats.retriesTotal), hint: "tentativas extras" },
    { icon: AlertOctagon, label: "Crash rate",  value: `${stats.crashRate.toFixed(1)}%`,
      tone: stats.crashRate > 10 ? "destructive" : stats.crashRate > 3 ? "warn" : "ok",
      hint: "falhas / total" },
  ];

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2 text-[13px]">
          <Play className="h-4 w-4 text-primary" />
          Scheduler operacional
        </CardTitle>
        <Button size="sm" onClick={run} disabled={running} className="gap-1.5">
          <Play className={cn("h-3.5 w-3.5", running && "animate-pulse")} />
          {running ? "Rodando…" : "Rodar agora"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {items.map(({ icon: Icon, label, value, tone, hint }) => (
            <div key={label} className="rounded-xl border border-border bg-[hsl(var(--elevated))] px-3 py-2.5">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                <Icon className="h-3.5 w-3.5" /> {label}
              </div>
              <div className={cn(
                "mt-1 font-mono text-[18px] tabular-nums",
                tone === "destructive" && "text-rose-400",
                tone === "warn" && "text-amber-400",
                tone === "ok" && "text-emerald-400",
              )}>{value}</div>
              {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
            </div>
          ))}
        </div>

        {stats.avgByType.size > 0 && (
          <div className="space-y-1.5">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Tempo médio por tipo</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
              {Array.from(stats.avgByType.entries()).sort((a, b) => b[1] - a[1]).map(([type, ms]) => (
                <div key={type} className="flex items-center justify-between rounded-lg border border-border bg-[hsl(var(--elevated))] px-3 py-1.5">
                  <span className="font-mono text-[11px] truncate">{type}</span>
                  <Badge variant="outline" className="text-[10px] tabular-nums">{fmtDur(ms)}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="text-[11px] text-muted-foreground leading-relaxed">
          O scheduler enfileira automaticamente:
          <span className="text-foreground/80"> coletas de deals com janela vencida</span>,
          <span className="text-foreground/80"> refresh de artistas com cooldown 6h</span> e
          <span className="text-foreground/80"> print batches pendentes</span>.
          Use a chamada manual sempre que quiser forçar uma rodada agora — o
          <code className="font-mono mx-1 px-1 rounded bg-muted/30">dedupe_key</code>
          impede que o mesmo trabalho seja enfileirado duas vezes.
        </div>
      </CardContent>
    </Card>
  );
}
