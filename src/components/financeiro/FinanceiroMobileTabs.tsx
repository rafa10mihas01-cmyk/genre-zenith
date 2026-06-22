// Tabs mobile do /financeiro — renderiza dentro de cada view (logo abaixo do KPI strip).
import { useSearchParams } from "react-router-dom";
import { Wallet, DollarSign, Receipt, TrendingUp, Settings as SettingsIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "visao",   label: "Visão",  icon: Wallet },
  { id: "receita", label: "Receita", icon: DollarSign },
  { id: "custo",   label: "Custo",  icon: Receipt },
  { id: "margem",  label: "Margem", icon: TrendingUp },
  { id: "config",  label: "Config", icon: SettingsIcon },
];

export function FinanceiroMobileTabs() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "visao";
  const setTab = (v: string) => {
    const next = new URLSearchParams(params);
    next.set("tab", v);
    setParams(next, { replace: true });
  };

  return (
    <div className="grid grid-cols-5 gap-1.5 sm:hidden">
      {TABS.map((t) => {
        const Icon = t.icon;
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-pressed={active}
            className={cn(
              "rounded-xl border px-0.5 py-2 flex flex-col items-center justify-center gap-1 min-w-0 transition-colors",
              active
                ? "border-primary/60 bg-primary/10 text-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="text-[10px] font-medium leading-tight truncate w-full text-center">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
