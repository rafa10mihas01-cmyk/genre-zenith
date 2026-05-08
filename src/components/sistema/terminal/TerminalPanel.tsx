// TerminalPanel — terminal visual conectado ao agente VPS via ops_agent_commands.
// Realtime: assina updates da tabela e renderiza stdout/stderr ao vivo.
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Terminal as TerminalIcon, Send, Loader2, AlertTriangle, RefreshCw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";
import { toast } from "@/hooks/use-toast";

type Cmd = {
  id: string;
  kind: string;
  command: string | null;
  status: string;
  stdout: string | null;
  stderr: string | null;
  exit_code: number | null;
  created_at: string;
  finished_at: string | null;
  duration_ms: number | null;
};

const QUICK = [
  { label: "PM2 list", cmd: "pm2_list" },
  { label: "Métricas servidor", cmd: "refresh_server_metrics" },
  { label: "Restart bot", cmd: "restart_spotify_bot", confirm: true },
];

export function TerminalPanel() {
  const [history, setHistory] = useState<Cmd[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const outRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    const { data } = await supabase
      .from("ops_agent_commands")
      .select("id,kind,command,status,stdout,stderr,exit_code,created_at,finished_at,duration_ms")
      .order("created_at", { ascending: false })
      .limit(40);
    setHistory((data ?? []) as Cmd[]);
  };

  useEffect(() => { void load(); }, []);

  // Realtime nos comandos
  useEffect(() => {
    const channel = supabase
      .channel("ops-terminal")
      .on("postgres_changes", { event: "*", schema: "public", table: "ops_agent_commands" }, () => {
        void load();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    outRef.current?.scrollTo({ top: outRef.current.scrollHeight });
  }, [history, activeId]);

  const active = history.find((c) => c.id === activeId) ?? history[0];

  const runQuick = async (action: string, confirm = false) => {
    if (confirm && !window.confirm(`Confirma executar "${action}" no servidor?`)) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("ops-action-execute", {
        body: { action, confirmed: confirm },
      });
      if (error) throw error;
      toast({ title: "Comando enfileirado", description: data?.message ?? action });
      await load();
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  const runShell = async () => {
    const cmd = input.trim();
    if (!cmd) return;
    if (!window.confirm(`Executar no servidor:\n\n${cmd}`)) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("ops-action-execute", {
        body: { action: "shell_exec", payload: { command: cmd }, confirmed: true },
      });
      if (error) throw error;
      toast({ title: "Comando enfileirado" });
      setInput("");
      await load();
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      {/* Aviso de agente */}
      <div className="nx-card border border-warning/30 bg-warning/5 p-3 text-xs text-foreground/90 flex items-start gap-2">
        <ShieldAlert className="h-4 w-4 text-warning mt-0.5 shrink-0" />
        <div>
          <p className="font-semibold">Terminal protegido</p>
          <p className="text-muted-foreground">
            Comandos shell exigem o agente VPS rodando e o secret <code className="text-foreground/80">OPS_AGENT_TOKEN</code> configurado.
            Sem agente, comandos ficam enfileirados como "queued". Veja <code className="text-foreground/80">docs/OPS_AGENT_CONTRACT.md</code>.
          </p>
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2">
        {QUICK.map((q) => (
          <Button key={q.cmd} size="sm" variant="outline" disabled={busy}
            onClick={() => runQuick(q.cmd, q.confirm)}>
            {q.label}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={load} className="ml-auto">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-3 h-[calc(100vh-340px)] min-h-[400px]">
        {/* Histórico */}
        <div className="nx-card p-2 overflow-hidden flex flex-col">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold px-2 py-1.5">Últimos comandos</p>
          <ScrollArea className="flex-1">
            <div className="space-y-1 px-1">
              {history.length === 0 && <p className="text-xs text-muted-foreground p-2">Nenhum comando ainda.</p>}
              {history.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setActiveId(c.id)}
                  className={cn(
                    "w-full text-left p-2 rounded-md text-xs transition-colors",
                    (activeId ?? history[0]?.id) === c.id ? "bg-primary/10" : "hover:bg-foreground/5",
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <StatusDot status={c.status} />
                    <span className="font-mono truncate flex-1">{c.command ?? c.kind}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{timeAgo(c.created_at)}</p>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Output */}
        <div className="nx-card p-0 overflow-hidden flex flex-col">
          <div className="border-b border-border px-3 py-2 flex items-center gap-2 text-xs">
            <TerminalIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-mono text-foreground truncate flex-1">{active?.command ?? active?.kind ?? "—"}</span>
            {active && <StatusDot status={active.status} showLabel />}
            {active?.duration_ms != null && <span className="text-muted-foreground tabular-nums">{active.duration_ms}ms</span>}
            {active?.exit_code != null && <span className="text-muted-foreground tabular-nums">exit {active.exit_code}</span>}
          </div>
          <ScrollArea className="flex-1">
            <div ref={outRef} className="p-3 font-mono text-xs leading-relaxed">
              {!active && <p className="text-muted-foreground">Selecione um comando ou execute um abaixo.</p>}
              {active?.status === "queued" && (
                <p className="text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Aguardando agente VPS pegar o comando…</p>
              )}
              {active?.stdout && <pre className="whitespace-pre-wrap text-foreground/90">{active.stdout}</pre>}
              {active?.stderr && <pre className="whitespace-pre-wrap text-destructive mt-2">{active.stderr}</pre>}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Input shell */}
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void runShell(); }}
          placeholder="$ comando shell (ex: pm2 status)"
          className="font-mono"
          disabled={busy}
        />
        <Button onClick={runShell} disabled={busy || !input.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

function StatusDot({ status, showLabel }: { status: string; showLabel?: boolean }) {
  const map: Record<string, { color: string; label: string }> = {
    queued: { color: "bg-muted-foreground/40", label: "Enfileirado" },
    picked: { color: "bg-warning", label: "Pego" },
    running: { color: "bg-warning animate-pulse", label: "Executando" },
    success: { color: "bg-success", label: "OK" },
    error: { color: "bg-destructive", label: "Erro" },
    timeout: { color: "bg-destructive", label: "Timeout" },
    cancelled: { color: "bg-muted-foreground", label: "Cancelado" },
  };
  const m = map[status] ?? { color: "bg-muted", label: status };
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-2 w-2 rounded-full shrink-0", m.color)} />
      {showLabel && <span className="text-muted-foreground">{m.label}</span>}
    </span>
  );
}
