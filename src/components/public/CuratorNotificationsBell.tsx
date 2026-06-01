import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Bell,
  Trophy,
  Flame,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Handshake,
  Info,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

/**
 * CuratorNotificationsBell — sino do portal público do curador.
 *
 * Combina DUAS fontes:
 *   A) Notificações derivadas dos `stats` (meta, ritmo, atraso) — sem backend
 *   B) Notificações persistidas em `notifications` para o user_id do curador
 *      (lidas via edge function `curator-portal-notifications` usando o public_token)
 *
 * Notificações B com `metadata.category = 'new_deal'` viram cards "Novo deal criado"
 * com link direto pro portal daquele deal.
 */

export type CuratorNotifInput = {
  target: number;
  dailyGoal: number;
  earned: number;
  pct: number;
  todayPlays: number;
  todayPct: number;
  hasBaseline: boolean;
  isOverdue: boolean;
  vel: number | null;
  eta: number | null;
  daysRunning: number;
  lastImportAt: Date | null;
};

type Severity = "success" | "primary" | "info" | "warning";

type DerivedNotif = {
  source: "derived";
  id: string;
  severity: Severity;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
};

type RemoteNotif = {
  source: "remote";
  id: string;
  severity: Severity;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  createdAt: string;
  read: boolean;
  actionUrl?: string | null;
  category?: string | null;
  dealId?: string | null;
};

type Notif = DerivedNotif | RemoteNotif;

type RemoteRow = {
  id: string;
  type: "critical" | "warning" | "info";
  title: string;
  message: string;
  action_url: string | null;
  read: boolean;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

function mapRemoteSeverity(t: RemoteRow["type"]): Severity {
  if (t === "critical") return "warning";
  if (t === "warning") return "warning";
  return "info";
}

function iconForCategory(category: string | null | undefined, severity: Severity) {
  if (category === "new_deal") return Handshake;
  if (severity === "warning") return AlertCircle;
  return Info;
}

function buildDerived(s: CuratorNotifInput): DerivedNotif[] {
  const out: DerivedNotif[] = [];

  if (!s.hasBaseline) {
    out.push({
      source: "derived",
      id: "waiting-baseline",
      severity: "info",
      icon: Sparkles,
      title: "Aguardando primeira coleta",
      description:
        "Assim que o primeiro print for processado, suas notificações de meta começam a aparecer aqui.",
    });
    return out;
  }

  const isDone = s.target > 0 && s.earned >= s.target;

  if (isDone) {
    out.push({
      source: "derived",
      id: "goal-hit",
      severity: "success",
      icon: Trophy,
      title: "Meta total atingida",
      description: `Você entregou ${s.earned.toLocaleString("pt-BR")} de ${s.target.toLocaleString("pt-BR")} plays. Trabalho concluído.`,
    });
  } else if (s.target > 0 && s.pct >= 80) {
    const remaining = Math.max(0, s.target - s.earned);
    out.push({
      source: "derived",
      id: "almost-there",
      severity: "primary",
      icon: Flame,
      title: `${s.pct}% da meta — falta pouco`,
      description: `Restam ${remaining.toLocaleString("pt-BR")} plays para concluir. Mantenha o ritmo.`,
    });
  }

  if (!isDone && s.dailyGoal > 0 && s.todayPlays >= s.dailyGoal) {
    out.push({
      source: "derived",
      id: "today-ok",
      severity: "info",
      icon: CheckCircle2,
      title: "Meta diária batida hoje",
      description: `${s.todayPlays.toLocaleString("pt-BR")} plays hoje (combinado: ${s.dailyGoal.toLocaleString("pt-BR")}/dia).`,
    });
  }

  const daysSinceLast = s.lastImportAt
    ? Math.floor((Date.now() - s.lastImportAt.getTime()) / (1000 * 60 * 60 * 24))
    : Infinity;
  const stale = s.lastImportAt !== null && daysSinceLast >= 3;

  if (!isDone && (s.isOverdue || stale)) {
    const reason = s.isOverdue
      ? "O ciclo semanal virou e nenhum print novo foi processado."
      : `Último envio há ${daysSinceLast} dias — atualize com um print recente.`;
    out.push({
      source: "derived",
      id: "overdue",
      severity: "warning",
      icon: AlertTriangle,
      title: "Atualização pendente",
      description: reason,
    });
  }

  return out;
}

const SEVERITY_STYLES: Record<Severity, { dot: string; iconWrap: string; iconColor: string }> = {
  success: { dot: "bg-success", iconWrap: "bg-success/10 border-success/30", iconColor: "text-success" },
  primary: { dot: "bg-primary", iconWrap: "bg-primary/10 border-primary/30", iconColor: "text-primary" },
  info: { dot: "bg-blue-400", iconWrap: "bg-blue-500/10 border-blue-500/30", iconColor: "text-blue-400" },
  warning: { dot: "bg-warning", iconWrap: "bg-warning/10 border-warning/30", iconColor: "text-warning" },
};

export function CuratorNotificationsBell({
  stats,
  publicToken,
  dealId,
}: {
  stats: CuratorNotifInput;
  publicToken?: string | null;
  dealId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [remote, setRemote] = useState<RemoteNotif[]>([]);
  const [userId, setUserId] = useState<string | null>(null);

  const mapRow = useCallback((r: RemoteRow): RemoteNotif => {
    const meta = (r.metadata ?? {}) as { category?: string; deal_id?: string };
    const severity = mapRemoteSeverity(r.type);
    const isNewDeal = meta.category === "new_deal";
    return {
      source: "remote",
      id: r.id,
      severity,
      icon: iconForCategory(meta.category, severity),
      title: isNewDeal ? "Novo deal criado" : r.title,
      description: r.message,
      createdAt: r.created_at,
      read: r.read,
      actionUrl: r.action_url ?? (isNewDeal && meta.deal_id ? `/c/${meta.deal_id}` : null),
      category: meta.category ?? null,
      dealId: meta.deal_id ?? null,
    };
  }, []);

  const fetchRemote = useCallback(async () => {
    if (!publicToken) return;
    try {
      const { data, error } = await supabase.functions.invoke("curator-portal-notifications", {
        body: { action: "list", public_token: publicToken, limit: 20 },
      });
      if (error) return;
      const res = data as { ok: boolean; user_id?: string; notifications?: RemoteRow[] };
      if (!res?.ok || !Array.isArray(res.notifications)) return;
      if (res.user_id) setUserId(res.user_id);
      setRemote(res.notifications.map(mapRow));
    } catch {
      /* portal silencioso — falha de notificação não bloqueia UX */
    }
  }, [publicToken, mapRow]);

  // Carga inicial
  useEffect(() => {
    fetchRemote();
  }, [fetchRemote]);

  // Realtime: substitui polling de 60s por canal postgres_changes filtrado
  // pelo user_id do curador. INSERT vira nova notificação, UPDATE atualiza
  // o flag `read` quando outro device marcar como lida.
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`curator-notif-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as RemoteRow;
          setRemote((prev) =>
            prev.some((n) => n.id === row.id) ? prev : [mapRow(row), ...prev].slice(0, 20),
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as RemoteRow;
          setRemote((prev) => prev.map((n) => (n.id === row.id ? { ...n, read: row.read } : n)));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, mapRow]);

  const markRead = useCallback(
    async (id: string) => {
      setRemote((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
      if (!publicToken) return;
      try {
        await supabase.functions.invoke("curator-portal-notifications", {
          body: { action: "mark_read", public_token: publicToken, notification_id: id },
        });
      } catch {
        /* otimista — refetch corrige no próximo ciclo */
      }
    },
    [publicToken],
  );

  const derived = useMemo(() => buildDerived(stats), [stats]);

  // Ordem final: remotas (mais recentes primeiro), depois derivadas.
  // Se não houver nada, fallback positivo.
  const notifications: Notif[] = useMemo(() => {
    const merged: Notif[] = [...remote, ...derived];
    if (merged.length === 0) {
      merged.push({
        source: "derived",
        id: "on-track",
        severity: "info",
        icon: Sparkles,
        title: "Tudo no ritmo",
        description:
          stats.pct > 0
            ? `${stats.pct}% concluído. Continue enviando os prints nos prazos do ciclo.`
            : "Aguardando o próximo print pra atualizar o progresso.",
      });
    }
    return merged;
  }, [remote, derived, stats.pct]);

  // Badge: remotas não lidas + derivadas acionáveis (success/primary/warning)
  const unreadRemote = remote.filter((r) => !r.read).length;
  const actionableDerived = derived.filter(
    (n) => n.severity === "success" || n.severity === "primary" || n.severity === "warning",
  ).length;
  const badgeCount = unreadRemote + actionableDerived;
  const hasAlert =
    remote.some((r) => !r.read && r.severity === "warning") ||
    derived.some((n) => n.severity === "warning");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9 rounded-md text-muted-foreground hover:text-foreground hover:bg-elevated/60"
          aria-label="Notificações"
        >
          <Bell className="h-[18px] w-[18px]" />
          {badgeCount > 0 && (
            <span
              className={cn(
                "absolute top-1.5 right-1.5 min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-bold leading-none flex items-center justify-center text-white",
                hasAlert ? "bg-warning" : "bg-primary",
              )}
            >
              {badgeCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[360px] p-0 bg-card border-border"
      >
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Acompanhamento</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Avisos do sistema e status da sua campanha
          </p>
        </div>

        <ul className="max-h-[480px] overflow-y-auto divide-y divide-border">
          {notifications.map((n) => {
            const Icon = n.icon;
            const styles = SEVERITY_STYLES[n.severity];
            const isRemote = n.source === "remote";
            const unread = isRemote && !n.read;
            const href = isRemote ? n.actionUrl : null;

            const inner = (
              <>
                <div
                  className={cn(
                    "h-9 w-9 rounded-full border flex items-center justify-center shrink-0",
                    styles.iconWrap,
                  )}
                >
                  <Icon className={cn("h-4 w-4", styles.iconColor)} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", styles.dot)} />
                    <p className={cn("text-[13px] font-semibold leading-tight truncate", unread ? "text-foreground" : "text-foreground")}>
                      {n.title}
                    </p>
                    {unread && (
                      <span className="ml-auto text-[9px] font-bold uppercase tracking-wider text-primary">
                        novo
                      </span>
                    )}
                  </div>
                  <p className="text-[11.5px] text-muted-foreground leading-snug mt-1">
                    {n.description}
                  </p>
                  {isRemote && href && (
                    <div className="mt-1.5 inline-flex items-center gap-1 text-[10.5px] text-primary font-medium">
                      Abrir portal do deal <ExternalLink className="h-3 w-3" />
                    </div>
                  )}
                </div>
              </>
            );

            const baseClass = cn(
              "px-4 py-3 flex items-start gap-3 transition-colors w-full text-left",
              unread ? "bg-primary/[0.04]" : "",
              isRemote ? "hover:bg-elevated/60 cursor-pointer" : "hover:bg-elevated/40",
            );

            if (isRemote && href) {
              return (
                <li key={`${n.source}-${n.id}`}>
                  <a
                    href={href}
                    onClick={() => markRead(n.id)}
                    className={baseClass}
                  >
                    {inner}
                  </a>
                </li>
              );
            }
            if (isRemote) {
              return (
                <li key={`${n.source}-${n.id}`}>
                  <button onClick={() => markRead(n.id)} className={baseClass}>
                    {inner}
                  </button>
                </li>
              );
            }
            return (
              <li key={`${n.source}-${n.id}`} className={baseClass}>
                {inner}
              </li>
            );
          })}
        </ul>

        <div className="px-4 py-2.5 border-t border-border bg-elevated/30">
          <p className="text-[10px] text-muted-foreground text-center">
            Atualizado em tempo real conforme você envia os prints
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
