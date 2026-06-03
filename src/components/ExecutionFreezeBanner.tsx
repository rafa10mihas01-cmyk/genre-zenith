import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Snowflake } from "lucide-react";

/**
 * Banner global exibido enquanto `system_flags.execution_frozen = true`.
 * Indica que o disparo automático (planner + worker) está pausado.
 * Demais funções (campanhas, planejamento, manual, métricas) seguem normais.
 */
export function ExecutionFreezeBanner() {
  const [frozen, setFrozen] = useState<{ reason: string | null; at: string | null } | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { data } = await supabase
        .from("system_flags")
        .select("execution_frozen, execution_frozen_reason, execution_frozen_at")
        .eq("singleton_key", "app")
        .maybeSingle();
      if (!mounted) return;
      if (data?.execution_frozen) {
        setFrozen({
          reason: (data as any).execution_frozen_reason ?? null,
          at: (data as any).execution_frozen_at ?? null,
        });
      } else {
        setFrozen(null);
      }
    };
    load();
    const ch = supabase
      .channel("system_flags_freeze")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "system_flags" },
        () => load(),
      )
      .subscribe();
    const t = setInterval(load, 60_000);
    return () => {
      mounted = false;
      clearInterval(t);
      supabase.removeChannel(ch);
    };
  }, []);

  if (!frozen) return null;

  return (
    <div
      role="status"
      className="w-full bg-amber-500/10 border-b border-amber-500/40 text-amber-200 px-4 py-2 flex items-center gap-2 text-sm"
    >
      <Snowflake className="h-4 w-4 shrink-0" />
      <span className="font-medium">Execução automática pausada pelo operador.</span>
      <span className="text-amber-200/70 truncate hidden md:inline">
        {frozen.reason ?? "EXECUTION_FROZEN = true"}
      </span>
    </div>
  );
}
