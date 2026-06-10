// Alertas — histórico paginado de notificações operacionais com ciclo de vida.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertCircle, AlertTriangle, Info, Filter, CheckCheck, CheckCircle2, ChevronDown, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { NotificationDomain, NotificationType } from "@/hooks/useNotifications";
import { friendlyNotification } from "@/lib/notificationCopy";
import { humanizeError } from "@/lib/operationalCopy";

const DOMAIN_LABEL: Record<string, string> = {
  bot: "Robô",
  ocr: "OCR",
  queue: "Fila",
  curator: "Curadoria",
  system: "Sistema",
  financeiro: "Financeiro",
  security: "Segurança",
  ai: "IA",
  geral: "Geral",
};

interface Row {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  action_url: string | null;
  read: boolean;
  status: "open" | "resolved" | "dismissed";
  resolved_at: string | null;
  created_at: string;
  metadata: Record<string, any> | null;
}

const PAGE_SIZE = 50;

export function AlertasHistorico() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [domain, setDomain] = useState<string>("all");
  const [severity, setSeverity] = useState<string>("all");
  const [readState, setReadState] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("open");

  const load = async (reset = false) => {
    setLoading(true);
    const from = reset ? 0 : page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let q = supabase
      .from("notifications")
      .select("id, type, title, message, action_url, read, status, resolved_at, created_at, metadata")
      .order("created_at", { ascending: false })
      .range(from, to);

    if (severity !== "all") q = q.eq("type", severity as NotificationType);
    if (readState === "unread") q = q.eq("read", false);
    if (readState === "read") q = q.eq("read", true);
    if (domain !== "all") q = q.eq("metadata->>domain", domain);
    if (statusFilter !== "all") q = q.eq("status", statusFilter);

    const { data, error } = await q;
    if (!error && data) {
      const newRows = data as Row[];
      setRows(reset ? newRows : [...rows, ...newRows]);
      setHasMore(newRows.length === PAGE_SIZE);
      setPage(reset ? 1 : page + 1);
    }
    setLoading(false);
  };

  useEffect(() => {
    setPage(0);
    setRows([]);
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain, severity, readState, statusFilter]);

  const stats = useMemo(() => {
    const c = rows.filter((r) => !r.read && r.type === "critical" && r.status === "open").length;
    const w = rows.filter((r) => !r.read && r.type === "warning" && r.status === "open").length;
    const i = rows.filter((r) => !r.read && r.type === "info" && r.status === "open").length;
    return { c, w, i };
  }, [rows]);

  const markAllRead = async () => {
    setRows((prev) => prev.map((r) => ({ ...r, read: true })));
    await supabase.rpc("mark_all_notifications_read" as any, { p_user_id: null });
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Críticos abertos" value={stats.c} tone="critical" />
        <StatCard label="Alertas abertos" value={stats.w} tone="warning" />
        <StatCard label="Infos abertos" value={stats.i} tone="info" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 p-3 rounded-2xl bg-card border border-border">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Abertos</SelectItem>
            <SelectItem value="resolved">Resolvidos</SelectItem>
            <SelectItem value="dismissed">Arquivados</SelectItem>
            <SelectItem value="all">Todos status</SelectItem>
          </SelectContent>
        </Select>
        <Select value={domain} onValueChange={setDomain}>
          <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos domínios</SelectItem>
            {Object.entries(DOMAIN_LABEL).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={severity} onValueChange={setSeverity}>
          <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas severidades</SelectItem>
            <SelectItem value="critical">Crítico</SelectItem>
            <SelectItem value="warning">Alerta</SelectItem>
            <SelectItem value="info">Info</SelectItem>
          </SelectContent>
        </Select>
        <Select value={readState} onValueChange={setReadState}>
          <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="unread">Não lidos</SelectItem>
            <SelectItem value="read">Lidos</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" className="h-8 text-xs gap-1.5" onClick={markAllRead}>
          <CheckCheck className="h-3.5 w-3.5" />
          Marcar todas
        </Button>
      </div>

      {/* List */}
      <div className="rounded-2xl bg-card border border-border overflow-hidden">
        <ScrollArea className="max-h-[600px]">
          {rows.length === 0 && !loading ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              Nenhuma notificação encontrada
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((n) => <Item key={n.id} n={n} />)}
            </ul>
          )}
        </ScrollArea>
        {hasMore && (
          <div className="p-3 border-t border-border">
            <Button
              variant="ghost"
              className="w-full h-9 text-xs"
              onClick={() => load(false)}
              disabled={loading}
            >
              {loading ? "Carregando..." : "Carregar mais"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: "critical" | "warning" | "info" }) {
  const color =
    tone === "critical" ? "text-destructive"
    : tone === "warning" ? "text-amber-500"
    : "text-primary";
  return (
    <div className="rounded-2xl bg-card border border-border p-4">
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={cn("text-2xl font-semibold mt-1", color)}>{value}</div>
    </div>
  );
}

function Item({ n }: { n: Row }) {
  const [open, setOpen] = useState(false);
  const isResolved = n.status === "resolved";
  const friendly = friendlyNotification(n as any);

  const Icon = isResolved
    ? CheckCircle2
    : n.type === "critical"
    ? AlertCircle
    : n.type === "warning"
    ? AlertTriangle
    : Info;
  const iconColor = isResolved
    ? "text-emerald-500"
    : n.type === "critical"
    ? "text-destructive"
    : n.type === "warning"
    ? "text-amber-500"
    : "text-primary";
  const bar = isResolved
    ? "bg-emerald-500"
    : n.type === "critical"
    ? "bg-destructive"
    : n.type === "warning"
    ? "bg-amber-500"
    : "bg-primary";
  const domain = (n.metadata?.domain as NotificationDomain) ?? "geral";
  const occ = n.metadata?.occurrences ?? 1;
  const actionHref = friendly.actionUrl ?? n.action_url ?? null;
  const actionLabel = friendly.actionLabel ?? (actionHref ? "Abrir" : null);

  // Nível 2: sistema funcionando? ação necessária?
  const showStatusRow = !isResolved && (
    typeof friendly.systemWorking === "boolean" ||
    typeof friendly.actionRequired === "boolean" ||
    friendly.nextAttempt
  );

  return (
    <li className="flex gap-3 px-4 py-3">
      <div className={cn("w-1 rounded-full self-stretch shrink-0", bar, (n.read || isResolved) && "opacity-40")} />
      <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", iconColor)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className={cn(
            "text-sm leading-tight",
            isResolved
              ? "text-muted-foreground line-through decoration-muted-foreground/40"
              : !n.read
              ? "font-semibold text-foreground"
              : "text-muted-foreground"
          )}>
            {friendly.title}
          </p>
          {isResolved && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 font-medium shrink-0">
              Resolvido
            </span>
          )}
          {n.status === "dismissed" && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
              Arquivado
            </span>
          )}
          {occ > 1 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
              ×{occ}
            </span>
          )}
        </div>

        {/* Nível 2 — o que aconteceu + impacto */}
        {(friendly.message || friendly.impact) && (
          <p className="text-xs text-muted-foreground mt-1">
            {friendly.message}
            {friendly.impact && (
              <> <span className="text-foreground/70">Impacto:</span> {friendly.impact}</>
            )}
          </p>
        )}

        {isResolved && n.metadata?.resolution_message && (
          <p className="text-xs text-emerald-500/80 mt-1 italic">
            ✓ {n.metadata.resolution_message}
          </p>
        )}

        {/* Nível 2 — status estruturado */}
        {showStatusRow && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px]">
            {typeof friendly.systemWorking === "boolean" && (
              <span className={cn(
                "inline-flex items-center gap-1",
                friendly.systemWorking ? "text-success" : "text-destructive",
              )}>
                <span className="font-semibold">Sistema:</span>
                {friendly.systemWorking ? "funcionando" : "afetado"}
              </span>
            )}
            {typeof friendly.actionRequired === "boolean" && (
              <span className={cn(
                "inline-flex items-center gap-1",
                friendly.actionRequired ? "text-warning" : "text-muted-foreground",
              )}>
                <span className="font-semibold">Ação:</span>
                {friendly.actionRequired ? "necessária" : "não precisa"}
              </span>
            )}
            {friendly.nextAttempt && (
              <span className="text-muted-foreground">
                <span className="font-semibold">Próxima tentativa:</span> {friendly.nextAttempt}
              </span>
            )}
          </div>
        )}

        {/* Linha inferior — domínio, tempo, ações */}
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70 font-medium">
            {DOMAIN_LABEL[domain] ?? domain}
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span className="text-[11px] text-muted-foreground/70">{timeAgo(n.created_at)}</span>
          {isResolved && n.resolved_at && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-[11px] text-emerald-500/70">resolvido {timeAgo(n.resolved_at)}</span>
            </>
          )}

          <div className="flex-1" />

          {actionHref && actionLabel && !isResolved && (
            actionHref.startsWith("/") ? (
              <Link
                to={actionHref}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
              >
                {actionLabel} <ArrowRight className="h-3 w-3" />
              </Link>
            ) : (
              <a
                href={actionHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
              >
                {actionLabel} <ArrowRight className="h-3 w-3" />
              </a>
            )
          )}

          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/80 hover:text-foreground"
              >
                Ver detalhes
                <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="w-full mt-2">
              <TechnicalDetails n={n} />
            </CollapsibleContent>
          </Collapsible>
        </div>
      </div>
    </li>
  );
}

// Nível 3 — só pra equipe técnica, escondido por padrão.
function TechnicalDetails({ n }: { n: Row }) {
  const meta = n.metadata ?? {};
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <DetailRow label="Título original" value={n.title} />
        <DetailRow label="Severidade" value={n.type} />
        <DetailRow label="Status" value={n.status} />
        <DetailRow label="Tipo interno" value={(meta as any).kind ?? "—"} />
        <DetailRow label="Chave de dedup" value={(meta as any).dedupe_key ?? "—"} />
        <DetailRow label="Origem" value={(meta as any).source ?? "—"} />
        <DetailRow label="Criado em" value={new Date(n.created_at).toLocaleString("pt-BR")} />
        {n.resolved_at && <DetailRow label="Resolvido em" value={new Date(n.resolved_at).toLocaleString("pt-BR")} />}
      </div>
      {n.message && n.message !== friendlyNotification(n as any).message && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-0.5">Mensagem original</div>
          <p className="text-[11px] text-muted-foreground break-words">{humanizeError(n.message)}</p>
        </div>
      )}
      <details className="text-[10px]">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">Payload bruto (JSON)</summary>
        <pre className="mt-1 p-2 rounded bg-background border border-border overflow-auto max-h-40 text-[10px] leading-tight">
{JSON.stringify(meta, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{label}</span>
      <span className="text-foreground/90 break-words">{value}</span>
    </div>
  );
}
