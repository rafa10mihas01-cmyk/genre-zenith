// FluxoNodeDrawer — painel lateral com input/output/regras/logs/erros do nó.
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { ArrowDownToLine, ArrowUpFromLine, ShieldCheck, Terminal, AlertTriangle, CheckCircle2, Loader2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";
import type { FluxoNodeData } from "./types";

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
  node,
  open,
  onOpenChange,
}: {
  node: FluxoNodeData | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  if (!node) return null;
  const Icon = node.icon;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto nx-scroll">
        <SheetHeader className="text-left mb-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-elevated flex items-center justify-center">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <SheetTitle className="text-lg">{node.label}</SheetTitle>
              <SheetDescription className="text-xs">{node.shortLabel} · {node.description}</SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="space-y-5">
          {/* INPUT */}
          <Section icon={ArrowDownToLine} label="Entrada" hint="O que chegou nesta etapa">
            {node.details.input.length === 0 ? (
              <Empty>Sem entradas registradas</Empty>
            ) : (
              <ul className="space-y-1">
                {node.details.input.map((i, idx) => (
                  <Row key={idx} label={i.label} value={i.value} />
                ))}
              </ul>
            )}
          </Section>

          {/* OUTPUT */}
          <Section icon={ArrowUpFromLine} label="Saída" hint="O que saiu desta etapa">
            {node.details.output.length === 0 ? (
              <Empty>Sem saídas registradas</Empty>
            ) : (
              <ul className="space-y-1">
                {node.details.output.map((i, idx) => (
                  <Row key={idx} label={i.label} value={i.value} highlight />
                ))}
              </ul>
            )}
          </Section>

          {/* REGRAS */}
          <Section icon={ShieldCheck} label="Regras aplicadas" hint="Como o sistema decide o que passa">
            {node.details.rules.length === 0 ? (
              <Empty>Sem regras configuradas</Empty>
            ) : (
              <ul className="space-y-1.5">
                {node.details.rules.map((r, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="h-3 w-3 text-success/70 mt-0.5 shrink-0" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* LOGS */}
          <Section icon={Terminal} label="Logs reais" hint={`Últimas ${Math.min(node.details.logs.length, 15)} execuções desta etapa`}>
            {node.details.logs.length === 0 ? (
              <Empty>Nenhum log nas últimas 24h</Empty>
            ) : (
              <ul className="space-y-1 max-h-[280px] overflow-y-auto nx-scroll pr-1">
                {node.details.logs.map((l, idx) => (
                  <li key={idx} className="text-xs border border-border rounded-lg p-2 bg-card">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <StatusDot status={l.status} />
                        <span className="font-mono text-[10px] uppercase text-muted-foreground tracking-wider">{l.status}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground tabular-nums shrink-0">
                        {l.durationMs != null && <span>{(l.durationMs / 1000).toFixed(1)}s</span>}
                        <Clock className="h-2.5 w-2.5" />
                        <span>{timeAgo(l.ts)}</span>
                      </div>
                    </div>
                    <p className="text-foreground/90 break-words leading-snug">{l.message}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* ERROS */}
          {node.details.errors.length > 0 && (
            <Section icon={AlertTriangle} label="Erros detectados" hint="Problemas ativos nesta etapa" tone="error">
              <ul className="space-y-1.5">
                {node.details.errors.map((e, idx) => (
                  <li key={idx} className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-lg p-2 flex items-start gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span className="break-words">{e}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

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
        {hint && <span className="text-[10px] text-muted-foreground">· {hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <li className="flex items-center justify-between gap-3 text-xs py-1 border-b border-border/40 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-bold tabular-nums", highlight ? "text-primary" : "text-foreground")}>{value}</span>
    </li>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground italic">{children}</p>;
}
