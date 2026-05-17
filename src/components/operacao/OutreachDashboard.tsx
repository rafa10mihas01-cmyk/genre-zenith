import { useEffect, useMemo, useState } from "react";
import { Mail, MessageCircle, TrendingUp, Users, CheckCircle2, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Range = "7d" | "30d" | "all";

type LogRow = {
  id: string;
  event_type: string;
  channel: string | null;
  sent_at: string;
};

type CuratorRow = {
  pipeline_status: string;
};

function rangeStart(r: Range): Date | null {
  if (r === "all") return null;
  const days = r === "7d" ? 7 : 30;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export function OutreachDashboard() {
  const [range, setRange] = useState<Range>("30d");
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [curators, setCurators] = useState<CuratorRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const since = rangeStart(range);
      const q1 = supabase
        .from("curator_outreach_log")
        .select("id, event_type, channel, sent_at")
        .order("sent_at", { ascending: false });
      const logsQ = since ? q1.gte("sent_at", since.toISOString()) : q1;
      const [logsRes, curatorsRes] = await Promise.all([
        logsQ,
        supabase.from("external_curators").select("pipeline_status"),
      ]);
      if (cancelled) return;
      setLogs((logsRes.data ?? []) as LogRow[]);
      setCurators((curatorsRes.data ?? []) as CuratorRow[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [range]);

  const stats = useMemo(() => {
    const sent = logs.filter((l) => l.event_type === "sent" || l.event_type === "followup_1" || l.event_type === "followup_2").length;
    const emails = logs.filter((l) => l.channel === "email" && (l.event_type === "sent" || l.event_type.startsWith("followup"))).length;
    const replied = logs.filter((l) => l.event_type === "replied").length;
    const opened = logs.filter((l) => l.event_type === "opened").length;
    const respRate = sent > 0 ? (replied / sent) * 100 : 0;
    const openRate = emails > 0 ? (opened / emails) * 100 : 0;
    const negociando = curators.filter((c) => c.pipeline_status === "negociando").length;
    const fechado = curators.filter((c) => c.pipeline_status === "fechado").length;
    const ativos = curators.filter((c) => !["blacklist","sem_resposta"].includes(c.pipeline_status)).length;
    return { sent, emails, replied, opened, respRate, openRate, negociando, fechado, ativos };
  }, [logs, curators]);

  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Outreach</h3>
          <p className="text-[11px] text-muted-foreground">Métricas de contato com curadores</p>
        </div>
        <div className="inline-flex items-center gap-0.5 bg-elevated rounded-lg p-0.5">
          {(["7d","30d","all"] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn(
                "h-7 px-2.5 text-[11px] font-medium rounded-md transition-colors",
                range === r ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r === "7d" ? "7 dias" : r === "30d" ? "30 dias" : "Tudo"}
            </button>
          ))}
        </div>
      </div>
      <div className={cn("grid grid-cols-2 md:grid-cols-6 gap-2", loading && "opacity-60")}>
        <Tile icon={<Send className="h-3.5 w-3.5" />} label="Enviados" value={stats.sent} />
        <Tile icon={<Mail className="h-3.5 w-3.5" />} label="Respostas" value={stats.replied} tone="primary" />
        <Tile icon={<TrendingUp className="h-3.5 w-3.5" />} label="Taxa resp." value={`${stats.respRate.toFixed(0)}%`} tone="primary" />
        <Tile icon={<MessageCircle className="h-3.5 w-3.5" />} label="Negociando" value={stats.negociando} tone="warning" />
        <Tile icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="Fechados" value={stats.fechado} tone="primary" />
        <Tile icon={<Users className="h-3.5 w-3.5" />} label="Ativos" value={stats.ativos} />
      </div>
    </div>
  );
}

function Tile({
  icon, label, value, tone,
}: { icon: React.ReactNode; label: string; value: number | string; tone?: "primary" | "warning" }) {
  return (
    <div className="rounded-xl bg-elevated/50 border border-border/60 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em] text-muted-foreground font-medium">
        {icon} {label}
      </div>
      <div className={cn(
        "text-xl font-bold tabular-nums mt-1",
        tone === "primary" && "text-primary",
        tone === "warning" && "text-warning",
        !tone && "text-foreground",
      )}>
        {value}
      </div>
    </div>
  );
}
