import { useEffect, useMemo, useState } from "react";
import { Bell, AlertTriangle, AlertCircle, Info, CheckCheck, BellRing, BellOff, Settings2 } from "lucide-react";
import { AlertPreferencesDialog } from "@/components/AlertPreferencesDialog";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useNotifications,
  type NotificationRow,
  type NotificationDomain,
} from "@/hooks/useNotifications";
import { timeAgo } from "@/lib/format";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { enablePush, disablePush, pushEnabled, pushSupport } from "@/lib/browserPush";
import { toast } from "sonner";

type Tab = "all" | "critical" | "bot" | "curator" | "system";

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

function getDomain(n: NotificationRow): NotificationDomain {
  return (n.metadata?.domain as NotificationDomain) ?? "geral";
}

function typeStyles(type: NotificationRow["type"]) {
  if (type === "critical")
    return {
      icon: AlertCircle,
      bar: "bg-destructive",
      iconColor: "text-destructive",
      bg: "bg-destructive/5",
    };
  if (type === "warning")
    return {
      icon: AlertTriangle,
      bar: "bg-amber-500",
      iconColor: "text-amber-500",
      bg: "bg-amber-500/5",
    };
  return {
    icon: Info,
    bar: "bg-primary",
    iconColor: "text-primary",
    bg: "bg-primary/5",
  };
}

export function NotificationsBell() {
  const { items, unreadCount, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("all");
  const [pushOn, setPushOn] = useState(false);
  const [pushAvail, setPushAvail] = useState(true);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    setPushOn(pushEnabled());
    setPushAvail(pushSupport() !== "unsupported");
  }, [open]);

  const togglePush = async () => {
    if (pushOn) {
      disablePush();
      setPushOn(false);
      toast.success("Alertas do navegador desativados");
    } else {
      const ok = await enablePush();
      setPushOn(ok);
      if (ok) toast.success("Alertas do navegador ativados", {
        description: "Você receberá críticos mesmo com a aba em background.",
      });
      else toast.error("Permissão negada", {
        description: "Habilite notificações deste site nas configurações do navegador.",
      });
    }
  };

  const { critical, warnings, infos } = useMemo(() => {
    let c = 0, w = 0, i = 0;
    for (const n of items) {
      if (n.read) continue;
      if (n.type === "critical") c++;
      else if (n.type === "warning") w++;
      else i++;
    }
    return { critical: c, warnings: w, infos: i };
  }, [items]);

  const filtered = useMemo(() => {
    if (tab === "all") return items;
    if (tab === "critical") return items.filter((n) => n.type === "critical");
    if (tab === "bot") return items.filter((n) => ["bot", "ocr", "queue"].includes(getDomain(n)));
    if (tab === "curator") return items.filter((n) => ["curator", "financeiro"].includes(getDomain(n)));
    if (tab === "system") return items.filter((n) => ["system", "security", "ai"].includes(getDomain(n)));
    return items;
  }, [items, tab]);

  const handleClick = async (n: NotificationRow) => {
    if (!n.read) await markRead(n.id);
    if (n.action_url) {
      setOpen(false);
      if (n.action_url.startsWith("http")) window.open(n.action_url, "_blank");
      else nav(n.action_url);
    }
  };

  const TabBtn = ({ id, label, count }: { id: Tab; label: string; count?: number }) => (
    <button
      onClick={() => setTab(id)}
      className={cn(
        "px-2.5 h-7 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5",
        tab === id
          ? "bg-elevated text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-elevated/60"
      )}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span className={cn(
          "min-w-[16px] h-[16px] px-1 rounded-full text-[10px] flex items-center justify-center leading-none",
          id === "critical" ? "bg-destructive text-destructive-foreground" : "bg-muted text-muted-foreground"
        )}>
          {count > 9 ? "9+" : count}
        </span>
      )}
    </button>
  );

  return (
    <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9 rounded-md text-muted-foreground hover:text-foreground hover:bg-elevated/60"
          aria-label={`Notificações${unreadCount > 0 ? ` (${unreadCount} não lidas)` : ""}`}
        >
          <Bell className="h-[18px] w-[18px]" />
          {unreadCount > 0 && (
            <span
              className={cn(
                "absolute top-1 right-1 min-w-[16px] h-[16px] px-1 rounded-full",
                critical > 0 ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground",
                "text-[10px] font-semibold flex items-center justify-center leading-none ring-2 ring-background"
              )}
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[400px] max-w-[calc(100vw-1rem)] p-0 border-border bg-popover"
      >
        <div className="px-4 py-3 border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Notificações</h3>
              <p className="text-[11px] text-muted-foreground">
                {critical > 0 && <span className="text-destructive">{critical} críticos</span>}
                {critical > 0 && (warnings > 0 || infos > 0) && <span className="mx-1">·</span>}
                {warnings > 0 && <span className="text-amber-500">{warnings} alertas</span>}
                {warnings > 0 && infos > 0 && <span className="mx-1">·</span>}
                {infos > 0 && <span>{infos} infos</span>}
                {unreadCount === 0 && <span>Tudo em dia</span>}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {pushAvail && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  onClick={togglePush}
                  title={pushOn ? "Desativar alertas do navegador" : "Ativar alertas do navegador"}
                >
                  {pushOn ? <BellRing className="h-3.5 w-3.5 text-primary" /> : <BellOff className="h-3.5 w-3.5" />}
                  <span className="hidden sm:inline">{pushOn ? "Push on" : "Push off"}</span>
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => { setOpen(false); setPrefsOpen(true); }}
                title="Preferências de alerta"
                aria-label="Preferências de alerta"
              >
                <Settings2 className="h-3.5 w-3.5" />
              </Button>
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => markAllRead()}
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Marcar todas
                </Button>
              )}
            </div>
          </div>
          <div className="flex gap-1 overflow-x-auto -mx-1 px-1 scrollbar-none">
            <TabBtn id="all" label="Tudo" />
            <TabBtn id="critical" label="Críticos" count={critical} />
            <TabBtn id="bot" label="Robô" />
            <TabBtn id="curator" label="Curadoria" />
            <TabBtn id="system" label="Sistema" />
          </div>
        </div>

        <ScrollArea className="max-h-[440px]">
          {filtered.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Bell className="h-6 w-6 mx-auto text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">
                {tab === "all" ? "Sem notificações" : "Nada nesta aba"}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((n) => {
                const s = typeStyles(n.type);
                const Icon = s.icon;
                const domain = getDomain(n);
                const occ = n.metadata?.occurrences ?? 1;
                return (
                  <li key={n.id}>
                    <button
                      onClick={() => handleClick(n)}
                      className={cn(
                        "w-full text-left flex gap-3 px-4 py-3 transition-colors",
                        "hover:bg-elevated/60",
                        !n.read && s.bg
                      )}
                    >
                      <div className={cn("w-1 rounded-full self-stretch shrink-0", s.bar, n.read && "opacity-30")} />
                      <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", s.iconColor)} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={cn("text-sm leading-tight truncate", !n.read ? "font-semibold text-foreground" : "text-muted-foreground")}>
                            {n.title}
                          </p>
                          {!n.read && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />}
                          {occ > 1 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                              ×{occ}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70 font-medium">
                            {DOMAIN_LABEL[domain] ?? domain}
                          </span>
                          <span className="text-muted-foreground/40">·</span>
                          <span className="text-[11px] text-muted-foreground/70">{timeAgo(n.created_at)}</span>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
    <AlertPreferencesDialog open={prefsOpen} onOpenChange={setPrefsOpen} />
    </>
  );
}
