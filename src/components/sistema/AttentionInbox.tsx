// Prioridade 1 — bloco "PRECISA DA SUA ATENÇÃO".
// Centraliza incidentes que exigem ação imediata: notificações abertas
// (critical/warning), VPS offline e apps Spotify bloqueados.
// Se não há nada: mostra estado verde compacto.
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { AlertOctagon, AlertTriangle, CheckCircle2, Loader2, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { timeAgo } from "@/lib/format";
import { humanizeError, humanizeFunctionName } from "@/lib/operationalCopy";
import { friendlyNotification } from "@/lib/notificationCopy";

type Incident = {
  id: string;
  severity: "critical" | "warning";
  title: string;
  impact: string;
  actionUrl?: string;
  actionLabel?: string;
  when: string;
  count?: number;
};

// Apenas falhas de infraestrutura / operação técnica entram aqui.
// Eventos de negócio (deal encerrado, campanha encerrada, meta atingida,
// decisões de campanha, etc.) NÃO são incidentes e vão pra /alertas.
const INFRA_DOMAINS = new Set(["system", "bot", "infra", "spotify"]);
const BUSINESS_KINDS = new Set([
  "campaign_plan_decision",
  "deal_overdue",
  "deal_stale_no_snapshot",
  "deadline_overdue",
  "deadline_d_minus_5",
  "algorithmic_in",
  "deal_closed",
  "campaign_closed",
  "goal_reached",
  "curator_response",
]);

const RECENT_INCIDENT_WINDOW_MS = 24 * 60 * 60 * 1000;

export function AttentionInbox() {
  const [items, setItems] = useState<Incident[] | null>(null);
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const oneDayAgo = new Date(Date.now() - RECENT_INCIDENT_WINDOW_MS).toISOString();
      const [notifs, vpsRes] = await Promise.all([
        supabase
          .from("notifications")
          .select("*")
          .eq("status", "open")
          .in("type", ["critical", "warning"])
          .gte("created_at", oneDayAgo)
          .order("type", { ascending: true })
          .order("created_at", { ascending: false })
          .limit(20),
        supabase.from("vps_nodes").select("id, hostname, last_heartbeat_at, status"),
      ]);

      const list: Incident[] = [];

      // VPS offline (derivado em tempo real)
      const vpsRows = (vpsRes.data ?? []) as Array<{ id: string; hostname?: string | null; last_heartbeat_at: string | null; status: string }>;
      vpsRows
        .filter((v) => v.status === "active" && (!v.last_heartbeat_at || v.last_heartbeat_at < fifteenMinAgo))
        .forEach((v) =>
          list.push({
            id: `vps:${v.id}`,
            severity: "critical",
            title: `Servidor de coleta offline${v.hostname ? ` — ${v.hostname}` : ""}`,
            impact: "As coletas que dependem desse servidor estão paradas.",
            actionUrl: "/sistema?tab=dev",
            actionLabel: "Ver infraestrutura",
            when: v.last_heartbeat_at ?? new Date().toISOString(),
          })
        );

      // Notificações abertas — só falhas técnicas reais
      (notifs.data ?? []).forEach((n: any) => {
        const meta = (n.metadata ?? {}) as Record<string, any>;
        const domain = String(meta.domain ?? "").toLowerCase();
        const kind = String(meta.kind ?? "");
        // Exclui eventos de negócio e domínios não-infra
        if (BUSINESS_KINDS.has(kind)) return;
        if (!domain || !INFRA_DOMAINS.has(domain)) return;
        const copy = friendlyNotification(n);
        const rawActionUrl = copy.actionUrl ?? n.action_url ?? undefined;
        const currentUrl = `${location.pathname}${location.search}`;
        const actionUrl = rawActionUrl === currentUrl ? "/sistema?tab=alertas" : rawActionUrl;
        list.push({
          id: `notif:${n.id}`,
          severity: n.type === "critical" ? "critical" : "warning",
          title: copy.title ?? humanizeFunctionName(kind),
          impact: copy.impact ?? copy.message ?? humanizeError(n.message),
          actionUrl,
          actionLabel: actionUrl === "/sistema?tab=alertas" ? "Detalhes" : copy.actionLabel ?? "Resolver",
          when: n.created_at,
        });
      });

      // Consolida alertas repetidos do mesmo tipo (mesmo título)
      const grouped = new Map<string, Incident>();
      for (const inc of list) {
        const key = `${inc.severity}::${inc.title}`;
        const existing = grouped.get(key);
        if (!existing) {
          grouped.set(key, { ...inc, count: 1 });
        } else {
          existing.count = (existing.count ?? 1) + 1;
          if (inc.when > existing.when) existing.when = inc.when;
        }
      }
      const final = Array.from(grouped.values());

      // Crítico primeiro, mais recente primeiro
      final.sort((a, b) => {
        if (a.severity !== b.severity) return a.severity === "critical" ? -1 : 1;
        return a.when < b.when ? 1 : -1;
      });

      if (!cancelled) setItems(final);
    };
    load();
    const t = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [location.pathname, location.search]);

  if (items === null) {
    return (
      <div className="nx-card p-5 flex items-center gap-2 text-sm text-muted-foreground border border-border">
        <Loader2 className="h-4 w-4 animate-spin" /> Buscando incidentes…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="nx-card border border-success/30 bg-success/5 p-4 flex items-center gap-3">
        <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
        <div>
          <p className="text-sm font-semibold text-success leading-tight">Nenhuma ação necessária no momento</p>
          <p className="text-xs text-muted-foreground mt-0.5">O sistema está saudável.</p>
        </div>
      </div>
    );
  }

  const critical = items.filter((i) => i.severity === "critical").length;
  const warning = items.length - critical;

  return (
    <div className="nx-card border-2 border-destructive/40 bg-destructive/5 overflow-hidden">
      <header className="px-5 py-3 flex items-center gap-3 border-b border-destructive/20">
        <AlertOctagon className="h-5 w-5 text-destructive" />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold uppercase tracking-wider text-destructive">Precisa da sua atenção</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {critical > 0 && <span className="text-destructive font-medium">{critical} crítico{critical === 1 ? "" : "s"}</span>}
            {critical > 0 && warning > 0 && <span> · </span>}
            {warning > 0 && <span className="text-warning font-medium">{warning} aviso{warning === 1 ? "" : "s"}</span>}
          </p>
        </div>
      </header>
      <ul className="divide-y divide-border/50">
        {items.slice(0, 8).map((i) => {
          const Icon = i.severity === "critical" ? AlertOctagon : AlertTriangle;
          const tone = i.severity === "critical" ? "text-destructive" : "text-warning";
          return (
            <li key={i.id} className="px-5 py-3 flex items-start gap-3">
              <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", tone)} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground leading-snug">
                  {i.count && i.count > 1 ? `${i.count}× ` : ""}{i.title}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{i.impact}</p>
                <p className="text-[10px] text-muted-foreground/70 mt-1 tabular-nums">{timeAgo(i.when)}</p>
              </div>
              {i.actionUrl && (
                <Button asChild size="sm" variant={i.severity === "critical" ? "destructive" : "outline"} className="h-7 text-[11px] shrink-0">
                  <Link to={i.actionUrl}>
                    {i.actionLabel ?? "Ver"} <ChevronRight className="h-3 w-3 ml-0.5" />
                  </Link>
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {items.length > 8 && (
        <footer className="px-5 py-2 border-t border-destructive/20 text-center">
          <Link to="/sistema?tab=alertas" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            Ver todos os {items.length} incidentes <ChevronRight className="h-3 w-3" />
          </Link>
        </footer>
      )}
    </div>
  );
}
