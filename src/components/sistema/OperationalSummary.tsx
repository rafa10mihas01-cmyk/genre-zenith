// Prioridade 2 — bloco "RESUMO OPERACIONAL".
// Cinco linhas curtas de status: Spotify · Bots · Filas · Crons · VPS.
// Apenas verde/amarelo/vermelho — sem números longos nem JSON.
import { useEffect, useState } from "react";
import { Music2, Bot, ListChecks, Workflow, Server, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Tone = "ok" | "warn" | "bad";
type Row = { icon: typeof Music2; label: string; tone: Tone; detail: string };

const TONE_BG: Record<Tone, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  bad: "bg-destructive",
};
const TONE_TEXT: Record<Tone, string> = {
  ok: "text-success",
  warn: "text-warning",
  bad: "text-destructive",
};
const TONE_LABEL: Record<Tone, string> = {
  ok: "saudável",
  warn: "atenção",
  bad: "crítico",
};

export function OperationalSummary() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

      const [token, hb, queueRes, failedQueue, cronStale, vpsRes] = await Promise.all([
        supabase.rpc("get_spotify_token_status").maybeSingle(),
        supabase.from("bot_heartbeats").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("playlist_execution_jobs").select("id", { count: "exact", head: true }).in("status", ["pending", "claimed"]),
        supabase.from("playlist_execution_jobs").select("id", { count: "exact", head: true }).eq("status", "failed").gte("updated_at", new Date(Date.now() - 24 * 3600_000).toISOString()),
        supabase.from("cron_health").select("job_name, status, ran_at").gte("ran_at", new Date(Date.now() - 6 * 3600_000).toISOString()),
        supabase.from("vps_nodes").select("status, last_heartbeat_at"),
      ]);

      // Spotify
      const tok = token.data as any;
      const tokenExpired = tok?.expires_at ? new Date(tok.expires_at) <= new Date() : true;
      const spotify: Row = {
        icon: Music2,
        label: "Spotify",
        tone: tokenExpired ? "bad" : "ok",
        detail: tokenExpired ? "Reconectar conta" : "Token válido",
      };

      // Bots
      const lastHb = hb.data?.created_at;
      const botTone: Tone = !lastHb ? "bad" : lastHb < twoHoursAgo ? "bad" : lastHb < oneHourAgo ? "warn" : "ok";
      const bots: Row = {
        icon: Bot,
        label: "Bots",
        tone: botTone,
        detail: botTone === "ok" ? "Recebendo sinal" : botTone === "warn" ? "Sinal lento" : "Sem sinal recente",
      };

      // Filas
      const pending = queueRes.count ?? 0;
      const failed = failedQueue.count ?? 0;
      const filaTone: Tone = failed > 0 ? "bad" : pending > 50 ? "warn" : "ok";
      const filas: Row = {
        icon: ListChecks,
        label: "Filas",
        tone: filaTone,
        detail: filaTone === "ok"
          ? pending === 0 ? "Vazia" : `${pending} na fila`
          : filaTone === "warn" ? `${pending} aguardando`
          : `${failed} com falha`,
      };

      // Crons — conta jobs distintos com status 'error' nas últimas 6h
      const cronRows = (cronStale.data ?? []) as Array<{ job_name: string; status: string; ran_at: string }>;
      const failedJobs = new Set(cronRows.filter((c) => c.status === "error").map((c) => c.job_name));
      const cronTone: Tone = failedJobs.size > 0 ? "bad" : "ok";
      const crons: Row = {
        icon: Workflow,
        label: "Crons",
        tone: cronTone,
        detail: cronTone === "ok" ? "Todos rodando" : `${failedJobs.size} com falha`,
      };

      // VPS
      const vpsRows = (vpsRes.data ?? []) as Array<{ status: string; last_heartbeat_at: string | null }>;
      const active = vpsRows.filter((v) => v.status === "active");
      const offline = active.filter((v) => !v.last_heartbeat_at || v.last_heartbeat_at < fifteenMinAgo).length;
      const vpsTone: Tone = offline > 0 ? "bad" : active.length === 0 ? "warn" : "ok";
      const vps: Row = {
        icon: Server,
        label: "VPS",
        tone: vpsTone,
        detail: vpsTone === "ok"
          ? `${active.length} online`
          : vpsTone === "warn" ? "Nenhum ativo"
          : `${offline} offline`,
      };

      if (!cancelled) setRows([spotify, bots, filas, crons, vps]);
    };
    load();
    const t = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  if (!rows) {
    return (
      <div className="nx-card p-4 flex items-center gap-2 text-sm text-muted-foreground border border-border">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando resumo…
      </div>
    );
  }

  return (
    <div className="nx-card border border-border overflow-hidden">
      <header className="px-5 py-3 border-b border-border">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Resumo operacional</h3>
      </header>
      <ul className="divide-y divide-border/60">
        {rows.map((r) => {
          const Icon = r.icon;
          return (
            <li key={r.label} className="px-5 py-2.5 flex items-center gap-3">
              <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-sm font-medium text-foreground flex-1">{r.label}</span>
              <span className="text-xs text-muted-foreground">{r.detail}</span>
              <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold capitalize", TONE_TEXT[r.tone])}>
                <span className={cn("h-2 w-2 rounded-full", TONE_BG[r.tone])} />
                {TONE_LABEL[r.tone]}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
