import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Sparkles, Handshake, ListMusic, BarChart3, Target, TrendingUp, AlertTriangle, ArrowUpRight, Gauge } from "lucide-react";
import { useSidebarContext, SidebarAlert } from "@/contexts/SidebarContext";
import { useSidebar } from "@/components/ui/sidebar";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Painel inteligente do sidebar (estilo Stripe/Vercel).
 *
 * 3 blocos:
 * 1. KPIs contextuais (vêm do SidebarContext, alimentados pela página atual)
 * 2. Quick Actions (atalhos contextuais por rota)
 * 3. Alertas globais (Apify bloqueado, baixo volume) — só aparecem se houver
 *
 * Quando o sidebar está colapsado: tudo some exceto os ícones das Quick Actions.
 */

type QuickAction = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  to: string;
};

/**
 * Mapa estático de Quick Actions por rota — todos apontam para fluxos VIVOS
 * pós-Fase 1. Removidos todos os atalhos do velho autopilot/coleta Apify
 * (`?tab=coleta|insights|replicacao|cover-queue`).
 */
const QUICK_ACTIONS_BY_ROUTE: Record<string, QuickAction[]> = {
  "/": [
    { label: "Negociações", icon: Handshake, to: "/deals" },
    { label: "Playlists", icon: ListMusic, to: "/catalogo" },
    { label: "Analytics", icon: BarChart3, to: "/analytics" },
  ],
  "/cerebro": [
    { label: "Analytics", icon: BarChart3, to: "/analytics" },
    { label: "Negociações", icon: Handshake, to: "/deals" },
    { label: "Playlists", icon: ListMusic, to: "/catalogo" },
  ],
  "/deals": [
    { label: "Curadores", icon: Sparkles, to: "/deals?tab=library" },
    { label: "Comparar", icon: TrendingUp, to: "/deals/comparar" },
    { label: "Analytics", icon: BarChart3, to: "/analytics" },
  ],
  "/playlist-deals": [
    { label: "Curadores", icon: Sparkles, to: "/deals?tab=library" },
    { label: "Comparar", icon: TrendingUp, to: "/deals/comparar" },
    { label: "Analytics", icon: BarChart3, to: "/analytics" },
  ],
  "/catalogo": [
    { label: "Performance", icon: TrendingUp, to: "/performance" },
    { label: "Negociações", icon: Handshake, to: "/deals" },
    { label: "Campanhas", icon: Target, to: "/campanhas" },
  ],
  "/analytics": [
    { label: "Performance", icon: TrendingUp, to: "/performance" },
    { label: "Valuation", icon: Gauge, to: "/valuation" },
    { label: "Playlists", icon: ListMusic, to: "/catalogo" },
  ],
  "/performance": [
    { label: "Valuation", icon: Gauge, to: "/valuation" },
    { label: "Playlists", icon: ListMusic, to: "/catalogo" },
    { label: "Negociações", icon: Handshake, to: "/deals" },
  ],
  "/valuation": [
    { label: "Performance", icon: TrendingUp, to: "/performance" },
    { label: "Playlists", icon: ListMusic, to: "/catalogo" },
    { label: "Negociações", icon: Handshake, to: "/deals" },
  ],
  "/campanhas": [
    { label: "Playlists", icon: ListMusic, to: "/catalogo" },
    { label: "Negociações", icon: Handshake, to: "/deals" },
    { label: "Analytics", icon: BarChart3, to: "/analytics" },
  ],
  "/configuracoes": [
    { label: "Analytics", icon: BarChart3, to: "/analytics" },
    { label: "Negociações", icon: Handshake, to: "/deals" },
    { label: "Playlists", icon: ListMusic, to: "/catalogo" },
  ],
};

function getActionsForPath(pathname: string): QuickAction[] {
  // Match exato primeiro, depois prefixo.
  if (QUICK_ACTIONS_BY_ROUTE[pathname]) return QUICK_ACTIONS_BY_ROUTE[pathname];
  const match = Object.keys(QUICK_ACTIONS_BY_ROUTE).find(
    (k) => k !== "/" && pathname.startsWith(k),
  );
  return match ? QUICK_ACTIONS_BY_ROUTE[match] : QUICK_ACTIONS_BY_ROUTE["/"];
}

const INTENT_CLS: Record<NonNullable<import("@/contexts/SidebarContext").SidebarKpi["intent"]>, string> = {
  default: "text-sidebar-foreground",
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
};

const ALERT_INTENT_CLS: Record<SidebarAlert["intent"], string> = {
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  info: "border-primary/30 bg-primary/10 text-primary",
};

export function SidebarSmartPanel() {
  const { kpis, alerts, setAlerts } = useSidebarContext();
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const navigate = useNavigate();

  const actions = getActionsForPath(location.pathname);

  // ----- Alertas globais: 1 query leve, polling 60s -----
  // Não duplica nada das páginas porque é um check que NINGUÉM mais faz.
  useEffect(() => {
    let cancelled = false;
    const checkSystem = async () => {
      const next: SidebarAlert[] = [];
      try {
        // Apify descontinuado — coleta agora 100% via Spotify Web API.


        // Baixo volume nas últimas 24h?
        const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const { count } = await supabase
          .from("search_results")
          .select("id", { count: "exact", head: true })
          .gte("first_seen_at", since);
        if ((count ?? 0) < 50) {
          next.push({
            id: "low-volume",
            label: `Baixo volume 24h (${count ?? 0})`,
            intent: "info",
            to: "/analytics",
          });
        }
      } catch {
        // Falha silenciosa — alertas são best-effort.
      }
      if (!cancelled) setAlerts(next);
    };
    checkSystem();
    const t = setInterval(checkSystem, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [setAlerts]);

  const handleNav = (to: string) => {
    navigate(to);
    if (isMobile) setOpenMobile(false);
  };

  // ----- COLAPSADO: só ícones das ações (mantém utilidade) -----
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 px-1 pt-2 pb-1">
        {actions.map((a) => (
          <button
            key={a.to}
            onClick={() => handleNav(a.to)}
            title={a.label}
            className="h-8 w-8 rounded-md flex items-center justify-center text-sidebar-foreground/60 hover:text-primary hover:bg-sidebar-accent/60 transition-colors"
            aria-label={a.label}
          >
            <a.icon className="h-4 w-4" />
          </button>
        ))}
        {alerts.length > 0 && (
          <button
            onClick={() => alerts[0]?.to && handleNav(alerts[0].to)}
            title={alerts.map((a) => a.label).join(" • ")}
            className="h-8 w-8 mt-1 rounded-md flex items-center justify-center text-warning hover:bg-warning/10 transition-colors relative"
            aria-label="Alertas"
          >
            <AlertTriangle className="h-4 w-4" />
            <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-warning" />
          </button>
        )}
      </div>
    );
  }

  // ----- EXPANDIDO -----
  return (
    <div className="px-3 pt-3 pb-2 space-y-3">
      {/* === KPIs CONTEXTUAIS === */}
      {kpis.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40 px-1">
            Contexto
          </div>
          <div className="rounded-lg bg-sidebar-accent/70 border border-sidebar-border divide-y divide-sidebar-border/60">
            {kpis.slice(0, 4).map((k) => (
              <div key={k.label} className="flex items-center justify-between px-2.5 py-1.5">
                <span className="text-[11px] text-sidebar-foreground/85 truncate">{k.label}</span>
                <span className={cn("text-[13px] font-bold tabular-nums", k.intent && k.intent !== "default" ? INTENT_CLS[k.intent] : "text-sidebar-foreground")}>
                  {k.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* === QUICK ACTIONS === */}
      <div className="space-y-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40 px-1">
          Ações rápidas
        </div>
        <div className="grid grid-cols-3 gap-1">
          {actions.map((a) => (
            <button
              key={a.to}
              onClick={() => handleNav(a.to)}
              title={a.label}
              className="h-12 rounded-md flex flex-col items-center justify-center gap-0.5 text-sidebar-foreground/70 hover:text-primary hover:bg-sidebar-accent/60 border border-sidebar-border/60 transition-colors"
            >
              <a.icon className="h-3.5 w-3.5" />
              <span className="text-[9px] leading-none truncate max-w-full px-1">{a.label.split(" ")[0]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* === ALERTAS === */}
      {alerts.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-warning/80 px-1">
            Alertas
          </div>
          <div className="space-y-1">
            {alerts.map((a) => (
              <button
                key={a.id}
                onClick={() => a.to && handleNav(a.to)}
                className={cn(
                  "w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md border text-[11px] transition-colors hover:opacity-80 text-left",
                  ALERT_INTENT_CLS[a.intent],
                )}
              >
                <AlertTriangle className="h-3 w-3 shrink-0" />
                <span className="truncate flex-1">{a.label}</span>
                {a.to && <ArrowUpRight className="h-3 w-3 shrink-0 opacity-60" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
