// ThroughputCard — métricas operacionais em tempo real lidas de ops_metrics.
// Janela: últimos 60 minutos. Mostra: throughput de uploads, snapshots,
// latência média OCR, taxa de erro.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Activity, Camera, Brain, AlertTriangle, Clock, Loader2 } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

type Row = {
  scope: string;
  operation: string;
  status: string;
  duration_ms: number | null;
};

type Stats = {
  uploads: number;
  ocrRuns: number;
  ocrErrors: number;
  ocrAvgMs: number | null;
  ocrP95Ms: number | null;
  recoverRuns: number;
  totalErrors: number;
  errorRate: number;
};

function summarize(rows: Row[]): Stats {
  const ocr = rows.filter((r) => r.scope === "ocr");
  const ocrOk = ocr.filter((r) => r.status === "success" || r.status === "partial");
  const ocrErr = ocr.filter((r) => r.status === "error" || r.status === "timeout");
  const durations = ocrOk.map((r) => r.duration_ms ?? 0).filter((n) => n > 0).sort((a, b) => a - b);
  const avg = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
  const p95 = durations.length ? durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))] : null;
  const uploads = rows.filter((r) => r.operation === "bot-upload-print").length;
  const recover = rows.filter((r) => r.operation === "cron-recover-print-batches").length;
  const totalErrors = rows.filter((r) => r.status === "error" || r.status === "timeout").length;
  return {
    uploads,
    ocrRuns: ocr.length,
    ocrErrors: ocrErr.length,
    ocrAvgMs: avg,
    ocrP95Ms: p95,
    recoverRuns: recover,
    totalErrors,
    errorRate: rows.length ? totalErrors / rows.length : 0,
  };
}

export function ThroughputCard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const sinceIso = new Date(Date.now() - 60 * 60_000).toISOString();
    const { data } = await supabase
      .from("ops_metrics")
      .select("scope,operation,status,duration_ms")
      .gte("created_at", sinceIso)
      .limit(2000);
    setStats(summarize((data ?? []) as Row[]));
    setLoading(false);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  if (loading || !stats) {
    return (
      <div className="nx-card p-4 flex items-center justify-center text-xs text-muted-foreground gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Calculando throughput…
      </div>
    );
  }

  const errPct = (stats.errorRate * 100).toFixed(1);
  const errTone = stats.errorRate > 0.2 ? "text-destructive" : stats.errorRate > 0.05 ? "text-warning" : "text-success";

  return (
    <div>
      <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-bold mb-2 flex items-center gap-1.5">
        <Activity className="h-3 w-3" /> Throughput · última hora
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat icon={Camera} label="Uploads" value={stats.uploads} hint="prints recebidos" />
        <Stat icon={Brain} label="OCR rodou" value={stats.ocrRuns} hint={`${stats.ocrErrors} erro(s)`} />
        <Stat
          icon={Clock}
          label="OCR latência"
          value={stats.ocrAvgMs ? `${(stats.ocrAvgMs / 1000).toFixed(1)}s` : "—"}
          hint={stats.ocrP95Ms ? `p95 ${(stats.ocrP95Ms / 1000).toFixed(1)}s` : "sem dados"}
        />
        <Stat
          icon={AlertTriangle}
          label="Taxa erro"
          value={`${errPct}%`}
          hint={`${stats.totalErrors}/${stats.totalErrors + (stats.ocrRuns + stats.uploads + stats.recoverRuns - stats.totalErrors)} ops`}
          tone={errTone}
        />
      </div>
    </div>
  );
}

function Stat({
  icon: Icon, label, value, hint, tone,
}: { icon: any; label: string; value: number | string; hint: string; tone?: string }) {
  return (
    <div className="nx-card border border-border p-3 flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[10px] uppercase tracking-wider font-bold">{label}</span>
      </div>
      <span className={cn("text-xl font-bold tabular-nums leading-none", tone ?? "text-foreground")}>
        {typeof value === "number" ? formatNumber(value) : value}
      </span>
      <span className="text-[10px] text-muted-foreground">{hint}</span>
    </div>
  );
}
