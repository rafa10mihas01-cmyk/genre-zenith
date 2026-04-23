import { useState } from "react";
import { Bell, AlertTriangle, AlertCircle, Info, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNotifications, type NotificationRow } from "@/hooks/useNotifications";
import { timeAgo } from "@/lib/format";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

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
  const nav = useNavigate();

  const handleClick = async (n: NotificationRow) => {
    if (!n.read) await markRead(n.id);
    if (n.action_url) {
      setOpen(false);
      // Suporta rotas internas e URLs absolutas
      if (n.action_url.startsWith("http")) window.open(n.action_url, "_blank");
      else nav(n.action_url);
    }
  };

  return (
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
                "bg-destructive text-destructive-foreground text-[10px] font-semibold",
                "flex items-center justify-center leading-none",
                "ring-2 ring-background"
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
        className="w-[360px] max-w-[calc(100vw-1rem)] p-0 border-border bg-popover"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Notificações</h3>
            <p className="text-xs text-muted-foreground">
              {unreadCount > 0 ? `${unreadCount} não lidas` : "Tudo em dia"}
            </p>
          </div>
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

        <ScrollArea className="max-h-[420px]">
          {items.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Bell className="h-6 w-6 mx-auto text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">Nenhuma notificação ainda</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((n) => {
                const s = typeStyles(n.type);
                const Icon = s.icon;
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
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                        <p className="text-[11px] text-muted-foreground/70 mt-1">{timeAgo(n.created_at)}</p>
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
  );
}
