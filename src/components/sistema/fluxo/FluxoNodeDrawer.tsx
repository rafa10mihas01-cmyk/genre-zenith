// FluxoNodeDrawer — painel lateral de cada etapa.
// Topo: Saúde + Insights + Comparação + Ações + Origem dos dados (camada de inteligência).
// Abaixo: 7 seções clássicas (Resumo, Variáveis, Processo, Decisões, Saída, Qualidade, Alertas, Logs).
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  Sliders, Workflow, GitBranch, Package, Gauge, AlertTriangle, ScrollText,
  Clock, CheckCircle2, XCircle, Wrench, Info, Activity, Sparkles, ArrowRightLeft,
  Zap, Database, Loader2, ArrowUp, ArrowDown, Minus, ExternalLink, Table2, FunctionSquare, Cloud, HardDrive,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { FluxoNodeData, KV, DecisionItem, AlertItem, LogPretty } from "./types";
import { getErrorMessage } from "@/lib/errors";
import {
  buildStepIntel, readStepDiff, commitStepSnapshot,
  healthBadgeClass, healthBarClass, type StepAction, type DataSource, type StepHealth, type StepDiff,
} from "./fluxoInsights";

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
  // intel + diff calculados antes do early-return para manter ordem dos hooks
  const intel = useMemo(() => (node ? buildStepIntel(node) : null), [node]);
  const [diff, setDiff] = useState<StepDiff>({ hasBaseline: false });

  useEffect(() => {
    if (!node || !open) return;
    setDiff(readStepDiff(node));
    // grava snapshot APÓS leitura, com leve delay pra não destruir o baseline da sessão
    const t = setTimeout(() => commitStepSnapshot(node), 1500);
    return () => clearTimeout(t);
  }, [node, open]);

  if (!node || !intel) return null;
  const Icon = node.icon;
  const d = node.details;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto nx-scroll">
        <SheetHeader className="text-left mb-3">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-elevated flex items-center justify-center shrink-0">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <SheetTitle className="text-lg leading-tight">{node.label}</SheetTitle>
                <HealthBadge health={intel.health} />
              </div>
              <SheetDescription className="text-xs">
                {node.shortLabel}
                {node.inputCount != null && <> · entrou: <b className="text-foreground">{node.inputCount}</b></>}
                {node.outputCount != null && <> · saiu: <b className="text-foreground">{node.outputCount}</b></>}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        {/* ============ CAMADA DE INTELIGÊNCIA ============ */}
        <div className="space-y-3 mb-5">
          <HealthCard health={intel.health} />
          <InsightsCard insights={intel.insights} />
          <ComparisonCard diff={diff} node={node} />
          <ActionsCard actions={intel.actions} />
          <SourcesCard sources={intel.sources} />
        </div>

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
          <Section icon={Sliders} label="Variáveis utilizadas" hint="Parâmetros, limites e filtros">
            <KVList items={d.variables} />
          </Section>

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

          <Section icon={Package} label="Saída detalhada" hint="O que essa etapa entregou">
            <KVList items={d.output} highlight />
          </Section>

          <Section icon={Gauge} label="Qualidade dos dados" hint="Volume, médias e aproveitamento">
            <KVList items={d.quality} />
          </Section>

          {d.alerts.length > 0 && (
            <Section icon={AlertTriangle} label="Alertas" hint="Coisas que precisam de atenção" tone="error">
              <ul className="space-y-1.5">
                {d.alerts.map((a, idx) => <AlertRow key={idx} alert={a} />)}
              </ul>
            </Section>
          )}

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

// =============== Inteligência: Saúde / Insights / Comparação / Ações / Origem ===============

function HealthBadge({ health }: { health: StepHealth }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] uppercase tracking-wider font-bold",
      healthBadgeClass(health.level),
    )}>
      <Activity className="h-2.5 w-2.5" />
      {health.label}
    </span>
  );
}

function HealthCard({ health }: { health: StepHealth }) {
  return (
    <div className={cn(
      "rounded-xl border-2 p-3.5",
      health.level === "excelente" && "border-success/30 bg-success/[0.04]",
      health.level === "atencao" && "border-warning/40 bg-warning/[0.04]",
      health.level === "problema" && "border-destructive/40 bg-destructive/[0.04]",
      health.level === "neutro" && "border-border bg-card",
    )}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5">
          <Activity className={cn(
            "h-3.5 w-3.5",
            health.level === "excelente" && "text-success",
            health.level === "atencao" && "text-warning",
            health.level === "problema" && "text-destructive",
            health.level === "neutro" && "text-muted-foreground",
          )} />
          <span className="text-[10px] uppercase tracking-widest font-bold text-foreground">Saúde da etapa</span>
        </div>
        <span className={cn(
          "text-xs font-bold tabular-nums",
          health.level === "excelente" && "text-success",
          health.level === "atencao" && "text-warning",
          health.level === "problema" && "text-destructive",
        )}>
          {health.score}/100
        </span>
      </div>

      {/* Barra de score */}
      <div className="h-1.5 rounded-full bg-elevated overflow-hidden mb-2.5">
        <div
          className={cn("h-full rounded-full transition-all duration-500", healthBarClass(health.level))}
          style={{ width: `${health.score}%` }}
        />
      </div>

      {health.reasons.length > 0 && (
        <ul className="space-y-1">
          {health.reasons.map((r, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[11px] text-foreground/85 leading-snug">
              <span className={cn(
                "mt-1 h-1 w-1 rounded-full shrink-0",
                health.level === "excelente" && "bg-success",
                health.level === "atencao" && "bg-warning",
                health.level === "problema" && "bg-destructive",
                health.level === "neutro" && "bg-muted-foreground/50",
              )} />
              {r}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function InsightsCard({ insights }: { insights: string[] }) {
  if (insights.length === 0) return null;
  return (
    <div className="rounded-xl border border-primary/25 bg-primary/[0.04] p-3.5">
      <div className="flex items-center gap-1.5 mb-2">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <span className="text-[10px] uppercase tracking-widest font-bold text-primary">Insights automáticos</span>
      </div>
      <ul className="space-y-1.5">
        {insights.map((i, idx) => (
          <li key={idx} className="text-[12px] text-foreground/90 leading-snug flex items-start gap-2">
            <span className="text-primary mt-0.5">→</span>
            <span>{i}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function deltaPiece(label: string, delta: number | null | undefined, suffix = "") {
  if (delta == null) return null;
  const Icon = delta > 0 ? ArrowUp : delta < 0 ? ArrowDown : Minus;
  const color = delta > 0
    ? "text-success"
    : delta < 0
    ? "text-destructive"
    : "text-muted-foreground";
  const sign = delta > 0 ? "+" : "";
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("inline-flex items-center gap-0.5 font-bold tabular-nums", color)}>
        <Icon className="h-3 w-3" />
        {sign}{delta}{suffix}
      </span>
    </div>
  );
}

function ComparisonCard({ diff, node }: { diff: StepDiff; node: FluxoNodeData }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5">
          <ArrowRightLeft className="h-3.5 w-3.5 text-foreground/70" />
          <span className="text-[10px] uppercase tracking-widest font-bold text-foreground">Comparação</span>
        </div>
        {diff.hasBaseline && diff.baselineAgeMs != null && (
          <span className="text-[10px] text-muted-foreground tabular-nums">
            vs há {Math.max(1, Math.round(diff.baselineAgeMs / 60000))}min
          </span>
        )}
      </div>

      {!diff.hasBaseline ? (
        <p className="text-[11px] text-muted-foreground italic">
          Primeira visita nesta sessão — abrirei comparação na próxima vez que reabrir esta etapa.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {deltaPiece("Entrou", diff.inDelta) ?? <EmptyDelta label="Entrou" />}
          {deltaPiece("Saiu", diff.outDelta) ?? <EmptyDelta label="Saiu" />}
          {diff.errorsDelta !== undefined ? (
            deltaPiece("Erros", diff.errorsDelta)
          ) : (
            <EmptyDelta label="Erros" />
          )}
        </div>
      )}
    </div>
  );
}

function EmptyDelta({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-muted-foreground/60">—</span>
    </div>
  );
}

function ActionsCard({ actions }: { actions: StepAction[] }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);

  const handle = async (a: StepAction) => {
    if (a.kind === "link" && a.to) {
      navigate(a.to);
      return;
    }
    if (a.kind === "scroll" && a.selector) {
      const el = document.querySelector(a.selector);
      if (el) (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "start" });
      else toast.info("Item não está visível nesta tela");
      return;
    }
    if (a.kind === "copy" && a.text) {
      try { await navigator.clipboard.writeText(a.text); toast.success("Copiado"); } catch { toast.error("Não consegui copiar"); }
      return;
    }
    if (a.kind === "invoke" && a.fn) {
      setBusy(a.id);
      try {
        const { error } = await supabase.functions.invoke(a.fn, { body: a.payload ?? {} });
        if (error) throw error;
        toast.success(`${a.label} executado`);
      } catch (e: unknown) {
        toast.error(`Falha em "${a.label}"`, { description: getErrorMessage(e) ?? "Erro desconhecido" });
      } finally {
        setBusy(null);
      }
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <div className="flex items-center gap-1.5 mb-2.5">
        <Zap className="h-3.5 w-3.5 text-warning" />
        <span className="text-[10px] uppercase tracking-widest font-bold text-foreground">Ações rápidas</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <Button
            key={a.id}
            size="sm"
            variant={(a.variant as any) ?? "outline"}
            className="h-8 gap-1.5 text-xs"
            onClick={() => handle(a)}
            disabled={busy === a.id}
            title={a.hint}
          >
            {busy === a.id ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : a.kind === "link" ? (
              <ExternalLink className="h-3 w-3" />
            ) : a.kind === "invoke" ? (
              <Zap className="h-3 w-3" />
            ) : null}
            {a.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function sourceIcon(type: DataSource["type"]) {
  switch (type) {
    case "table": return Table2;
    case "function": return FunctionSquare;
    case "api": return Cloud;
    case "storage": return HardDrive;
  }
}

function SourcesCard({ sources }: { sources: DataSource[] }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <div className="flex items-center gap-1.5 mb-2">
        <Database className="h-3.5 w-3.5 text-foreground/70" />
        <span className="text-[10px] uppercase tracking-widest font-bold text-foreground">Origem dos dados</span>
      </div>
      <ul className="space-y-1.5">
        {sources.map((s, i) => {
          const SIcon = sourceIcon(s.type);
          return (
            <li key={i} className="flex items-start gap-2 text-[11px]">
              <span className="mt-0.5 h-5 w-5 rounded bg-elevated flex items-center justify-center shrink-0">
                <SIcon className="h-3 w-3 text-foreground/70" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  <span className="text-[9px] uppercase tracking-wider font-bold text-muted-foreground">
                    {s.type}
                  </span>
                  <span className="font-mono text-[11px] text-foreground break-all">{s.name}</span>
                </div>
                {s.detail && <p className="text-[10px] text-muted-foreground leading-snug">{s.detail}</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// =============== Sub-componentes clássicos (mantidos) ===============

function Section({
  icon: Icon, label, hint, children, tone,
}: {
  icon: LucideIcon; label: string; hint?: string; children: React.ReactNode; tone?: "default" | "error";
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
