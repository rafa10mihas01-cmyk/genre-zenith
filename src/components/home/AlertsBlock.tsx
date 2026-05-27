import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, ArrowRight, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ProactiveAlertsCard } from "./ProactiveAlertsCard";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export function AlertsBlock() {
  const [unread, setUnread] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { count } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("read", false);
      if (!cancelled) setUnread(count ?? 0);
    }
    load();
    const i = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(i); };
  }, []);

  const has = (unread ?? 0) > 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2">
        <ProactiveAlertsCard />
      </div>
      <Link
        to="/sistema?tab=alertas"
        className={cn(
          "nx-card-hover p-4 lg:p-5 group h-full flex flex-row lg:flex-col items-stretch gap-4 lg:gap-3",
          has && "border-warning/40",
        )}
      >
        <div className="flex-1 flex flex-col gap-3 min-w-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell className={cn("h-4 w-4", has ? "text-warning" : "text-muted-foreground")} />
              <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
                Notificações
              </span>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 lg:group-hover:opacity-100 transition-opacity hidden lg:inline-flex" />
          </div>
          <div className={cn("text-4xl font-bold tabular-nums", has ? "text-warning" : "text-muted-foreground")}>
            {unread === null ? "—" : formatNumber(unread)}
          </div>
          <div className="text-xs text-muted-foreground mt-auto flex items-center gap-1.5">
            {has ? (
              "não lidas"
            ) : (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-success" /> tudo lido
              </>
            )}
          </div>
        </div>
        {/* Âncora visual mobile: sino grande ringado */}
        <div className="lg:hidden flex items-center justify-center shrink-0">
          <div className={cn(
            "h-14 w-14 rounded-full flex items-center justify-center border",
            has ? "border-warning/40 bg-warning/10" : "border-border/60 bg-muted/20",
          )}>
            <Bell className={cn("h-6 w-6", has ? "text-warning" : "text-muted-foreground")} />
          </div>
        </div>
      </Link>
    </div>
  );
}
