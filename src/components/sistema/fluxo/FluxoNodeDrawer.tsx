// FluxoNodeDrawer — painel lateral COMPLETO de explicação de cada etapa.
// 7 seções: Resumo, Variáveis, Processo, Decisões, Saída, Qualidade, Alertas, Logs explicados.
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import {
  Sliders, Workflow, GitBranch, Package, Gauge, AlertTriangle, ScrollText,
  Clock, CheckCircle2, XCircle, Wrench, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";
import type { FluxoNodeData, KV, DecisionItem, AlertItem, LogPretty } from "./types";

function StatusDot({ status }: { status: string }) {
  const cls = status === "error" || status === "failed"
    ? "bg-destructive"
    : status === "running"
    ? "bg-warning animate-pulse"
    : status === "warning"
    ? "bg-warning"
    : "bg-success";
  return <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", cls)} />;
}

export function FluxoNodeDrawer({
  node, open, onOpenChange,
}: {
  node: FluxoNodeData | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  if (!node) return null;
  const Icon = node.icon;
  const d = node.details;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto nx-scroll">
        <SheetHeader className="text-left mb-3">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-elevated flex items-center justify-center shrink-0">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <SheetTitle className="text-lg leading-tight">{node.label}</SheetTitle>
              <SheetDescription className="text-xs">
                {node.shortLabel}
                {node.inputCount != null && <> · entrou: <b className="text-foreground">{node.inputCount}</b></>}
                {node.outputCount != null && <> · saiu: <b className="text-foreground">{node.outputCount}</b></>}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        {/* RESUMO */}
        {d.summary && (
          <div className="mb-5 bg-primary/5 border border-primary/20 rounded-lg p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Info className="h-3 w-3 text-primary" />
              <span className="text-[10px] uppercase tracking-wider font-bold text-primary">O que esta etapa faz</span>
            </div>
            <p className="text-xs text-foreground/90 leading-relaxed">{d.summary}</p>
          </div>
        )}

        <div className="space-y-5">
          {/* VARIÁVEIS UTILIZADAS */}
          <Section icon={Sliders} label="Variáveis utilizadas" hint="Parâmetros, limites e filtros">
            <KVList items={d.variables} />
          </Section>

          {/* PROCESSO EXECUTADO */}
          <Section icon={Workflow} label="Processo executado" hint="O que o sistema fez, passo a passo">
            {d.process.length === 0 ? (
              <Empty>Sem etapas registradas</Empty>
            ) : (
              <ol className="space-y-1.5">
                {d.process.map((step, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-xs text-foreground/90">
                    <span className="mt-0.5 h-4 w-4 rounded-full bg-elevated text-[10px] font-bold flex items-center justify-center shrink-0 text-primary">
                      {idx + 1}
                    </span>
                    <span className="leading-snug">{step}</span>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          {/* DECISÕES TOMADAS */}
          <Section icon={GitBranch} label="Decisões tomadas" hint="O que foi aceito, descartado e por quê">
            {d.decisions.length === 0 ? (
              <Empty>Nenhuma decisão registrada nesta execução</Empty>
            ) : (
              <ul className="space-y-2">
                {d.decisions.map((dec, idx) => (
                  <DecisionRow key={idx} dec={dec} />
                ))}
              </ul>
            )}
          </Section>

          {/* SAÍDA DETALHADA */}
          <Section icon={Package} label="Saída detalhada" hint="O que essa etapa entregou">
            <KVList items={d.output} highlight />
          </Section>

          {/* QUALIDADE DOS DADOS */}
          <Section icon={Gauge} label="Qualidade dos dados" hint="Volume, médias e aproveitamento">
            <KVList items={d.quality} />
          </Section>

          {/* ALERTAS */}
          {d.alerts.length > 0 && (
            <Section icon={AlertTriangle} label="Alertas" hint="Coisas que precisam de atenção" tone="error">
              <ul className="space-y-1.5">
                {d.alerts.map((a, idx) => <AlertRow key={idx} alert={a} />)}
              </ul>
            </Section>
          )}

          {/* LOG EXPLICADO */}
          <Section icon={ScrollText} label="Logs explicados" hint={`${d.logs.length} eventos recentes — em linguagem simples`}>
            {d.logs.length === 0 ? (
              <Empty>Nenhum log nesta janela</Empty>
            ) : (
              <ul className="space-y-1.5 max-h-[320px] overflow-y-auto nx-scroll pr-1">
                {d.logs.map((l, idx) => <LogRow key={idx} log={l} />)}
              </ul>
            )}
          </Section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// =============== Sub-componentes ===============

function Section({
  icon: Icon, label, hint, children, tone,
}: {
  icon: any; label: string; hint?: string; children: React.ReactNode; tone?: "default" | "error";
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={cn("h-3.5 w-3.5", tone === "error" ? "text-destructive" : "text-primary")} />
        <h4 className={cn("text-xs uppercase tracking-wider font-bold", tone === "error" ? "text-destructive" : "text-foreground")}>
          {label}
        </h4>
        {hint && <span className="text-[10px] text-muted-foreground truncate">· {hint}</span>}
      </div>
      {children}
    </div>
  );
}

function KVList({ items, highlight }: { items: KV[]; highlight?: boolean }) {
  if (items.length === 0) return <Empty>Sem dados nesta execução</Empty>;
  return (
    <ul className="space-y-1">
      {items.map((i, idx) => (
        <li key={idx} className="flex items-start justify-between gap-3 text-xs py-1 border-b border-border/40 last:border-0">
          <div className="min-w-0">
            <span className="text-muted-foreground">{i.label}</span>
            {i.hint && <p className="text-[10px] text-muted-foreground/70 truncate">{i.hint}</p>}
          </div>
          <span className={cn("font-bold tabular-nums shrink-0 text-right", highlight ? "text-primary" : "text-foreground")}>
            {i.value}
          </span>
        </li>
      ))}
    </ul>
  );
}

function DecisionRow({ dec }: { dec: DecisionItem }) {
  const cfg = dec.kind === "aceito"
    ? { Icon: CheckCircle2, color: "text-success", bg: "bg-success/10", border: "border-success/30", label: "Aceito" }
    : dec.kind === "descartado"
    ? { Icon: XCircle, color: "text-destructive", bg: "bg-destructive/10", border: "border-destructive/30", label: "Descartado" }
    : { Icon: Wrench, color: "text-warning", bg: "bg-warning/10", border: "border-warning/30", label: "Ajustado" };
  return (
    <li className={cn("rounded-lg border p-2.5", cfg.bg, cfg.border)}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <cfg.Icon className={cn("h-3.5 w-3.5 shrink-0", cfg.color)} />
          <span className={cn("text-[10px] uppercase font-bold tracking-wider", cfg.color)}>{cfg.label}</span>
          <span className="text-xs font-semibold text-foreground truncate">· {dec.label}</span>
        </div>
        {dec.count != null && (
          <span className="text-xs font-bold text-foreground tabular-nums shrink-0">{dec.count}</span>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug">{dec.reason}</p>
    </li>
  );
}

function AlertRow({ alert }: { alert: AlertItem }) {
  const cfg = alert.level === "error"
    ? { color: "text-destructive", bg: "bg-destructive/10", border: "border-destructive/30" }
    : alert.level === "warning"
    ? { color: "text-warning", bg: "bg-warning/10", border: "border-warning/30" }
    : { color: "text-primary", bg: "bg-primary/10", border: "border-primary/30" };
  return (
    <li className={cn("text-xs rounded-lg p-2.5 border flex items-start gap-2", cfg.bg, cfg.border)}>
      <AlertTriangle className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", cfg.color)} />
      <div className="min-w-0">
        <p className={cn("font-medium break-words", cfg.color)}>{alert.message}</p>
        {alert.hint && <p className="text-[11px] text-muted-foreground mt-0.5">{alert.hint}</p>}
      </div>
    </li>
  );
}

function LogRow({ log }: { log: LogPretty }) {
  return (
    <li className="text-xs border border-border rounded-lg p-2 bg-card">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <StatusDot status={log.status} />
          <span className="font-mono text-[10px] uppercase text-muted-foreground tracking-wider">{log.status}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground tabular-nums shrink-0">
          {log.durationMs != null && <span>{(log.durationMs / 1000).toFixed(1)}s</span>}
          <Clock className="h-2.5 w-2.5" />
          <span>{timeAgo(log.ts)}</span>
        </div>
      </div>
      <p className="text-foreground/95 break-words leading-snug font-medium">{log.pretty}</p>
      {log.raw && log.raw !== log.pretty && (
        <p className="text-[10px] text-muted-foreground/70 mt-0.5 font-mono break-words leading-snug">
          {log.raw}
        </p>
      )}
    </li>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground italic">{children}</p>;
}
