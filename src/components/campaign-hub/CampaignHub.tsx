import { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LayoutDashboard, Users, LineChart, Wallet, ScrollText, Network, Upload, Flag, Activity, History, Radar } from "lucide-react";
import { cn } from "@/lib/utils";
import { CampaignHero } from "./CampaignHero";
import type { CampaignHubCampaign, CampaignHubMode, CampaignHubTabId } from "./types";

type TabDef = {
  id: CampaignHubTabId;
  label: string;
  icon: typeof LayoutDashboard;
  content: ReactNode;
  internalOnly?: boolean;
};

type Props = {
  camp: CampaignHubCampaign;
  mode: CampaignHubMode;
  delivered?: number;
  deliveryBreakdown?: { curators: number; ecosystem: number; organic: number } | null;
  goal?: number;
  daysElapsed?: number;
  daysTotal?: number;
  lastUpdateAt?: string | null;
  tab: CampaignHubTabId;
  onTabChange: (t: CampaignHubTabId) => void;
  slots: Partial<Record<CampaignHubTabId, ReactNode>>;
  hiddenTabs?: CampaignHubTabId[];
  heroExtraActions?: ReactNode;
  heroExtraActionsAfter?: ReactNode;
  kpis?: ReactNode;
  progressSection?: ReactNode;
};

export function CampaignHub({
  camp, mode, delivered, deliveryBreakdown, goal, daysElapsed, daysTotal, lastUpdateAt,
  tab, onTabChange, slots, hiddenTabs = [], heroExtraActions, heroExtraActionsAfter, kpis, progressSection,
}: Props) {
  const clientAllowedTabs: CampaignHubTabId[] = ["overview", "playlists", "monitoramento", "upload", "history"];
  const tabs: TabDef[] = [
    { id: "overview",  label: "Visão geral",  icon: LayoutDashboard, content: slots.overview  ?? null },
    { id: "playlists", label: "Curadores",    icon: Users,           content: slots.playlists ?? null },
    { id: "curve",     label: "Distribuição", icon: LineChart,    content: slots.curve     ?? null },
    { id: "operacao",  label: "Entregas",     icon: Network,         content: slots.operacao  ?? null },
    { id: "monitoramento", label: "Monitoramento", icon: Radar,      content: slots.monitoramento ?? null },
    { id: "baseline",  label: "Baseline",     icon: Flag,            content: slots.baseline  ?? null, internalOnly: true },
    { id: "upload",    label: "Importar",     icon: Upload,          content: slots.upload    ?? null },
    { id: "finance",   label: "Financeiro",   icon: Wallet,          content: slots.finance   ?? null, internalOnly: true },
    { id: "execucao",  label: "Execução",     icon: Activity,        content: slots.execucao  ?? null, internalOnly: true },
    { id: "history",   label: "Histórico",    icon: History,         content: slots.history   ?? null },
    { id: "logs",      label: "Logs",         icon: ScrollText,      content: slots.logs      ?? null, internalOnly: true },
  ];

  // Tabs sem conteúdo são ocultas.
  const visible = tabs.filter(t => {
    if (hiddenTabs.includes(t.id)) return false;
    if (mode === "client" && !clientAllowedTabs.includes(t.id)) return false;
    if (mode !== "internal" && t.internalOnly) return false;
    return t.content != null;
  });
  const activeTab = visible.some((t) => t.id === tab) ? tab : visible[0]?.id;

  return (
    <div className={cn(
      "campaign-hub flex min-h-0 flex-col bg-background",
      mode === "internal" ? "h-full overflow-hidden" : "h-auto overflow-visible",
    )}>
      <CampaignHero
        camp={camp}
        mode={mode}
        delivered={delivered}
        deliveryBreakdown={deliveryBreakdown}
        goal={goal}
        daysElapsed={daysElapsed}
        daysTotal={daysTotal}
        lastUpdateAt={lastUpdateAt}
        extraActions={heroExtraActions}
        extraActionsAfter={heroExtraActionsAfter}
        hideProgress={!!progressSection}
      />

      {kpis && (
        <div className="shrink-0 px-4 pt-4 pb-2 md:px-6">
          {kpis}
        </div>
      )}

      <Tabs
        value={activeTab}
        onValueChange={(v) => onTabChange(v as CampaignHubTabId)}
        className={cn(
          "flex min-h-0 flex-1 flex-col nx-scroll",
          mode === "internal" ? "overflow-y-auto overflow-x-hidden overscroll-contain" : "overflow-visible",
        )}
      >
        <div className={cn("shrink-0 px-2 md:px-6 bg-background")}>
          {/* Mobile: grid dinâmico — todas as abas visíveis cabem numa única régua */}
          <div className="sm:hidden pt-2 pb-3">
            <TabsList
              className="grid gap-1.5 h-auto bg-transparent p-0 rounded-none w-full"
              style={{ gridTemplateColumns: `repeat(${Math.max(visible.length, 1)}, minmax(0, 1fr))` }}
            >
              {visible.map((t) => {
                const Icon = t.icon;
                return (
                  <TabsTrigger
                    key={t.id}
                    value={t.id}
                    aria-label={t.label}
                    className={cn(
                      "flex flex-col items-center justify-center gap-1 rounded-xl border px-0.5 py-2 h-auto transition-colors leading-none",
                      "border-border bg-card text-muted-foreground hover:text-foreground",
                      "data-[state=active]:border-primary data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none",
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="text-[9.5px] font-medium leading-none truncate max-w-full">{t.label}</span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>


          {/* Desktop / tablet: underline tabs */}
          <div className="hidden sm:block border-b border-border">
            <div className="h-11 overflow-x-auto overflow-y-hidden overscroll-x-contain overscroll-y-none scrollbar-none [touch-action:pan-x]">
              <TabsList className="h-11 min-h-11 items-stretch bg-transparent gap-1 p-0 rounded-none w-max min-w-full justify-start">
                {visible.map((t) => {
                  const Icon = t.icon;
                  return (
                    <TabsTrigger
                      key={t.id}
                      value={t.id}
                      className={cn(
                        "m-0 h-11 min-h-11 max-h-11 gap-1.5 rounded-none border-b-2 border-transparent bg-transparent px-3 py-0 leading-none shrink-0 whitespace-nowrap box-border",
                        "data-[state=active]:bg-transparent data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none",
                        "text-muted-foreground transition-colors hover:text-foreground hover:[transform:none] active:[transform:none] focus-visible:[transform:none]",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {t.label}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </div>
          </div>
        </div>

        {progressSection && (
          <div className="px-4 pt-3 md:px-6">
            {progressSection}
          </div>
        )}



        <div className="px-4 pt-6 pb-[calc(64px+env(safe-area-inset-bottom)+24px)] md:px-6 lg:pb-8">
          {visible.map((t) => (
            <TabsContent
              key={t.id}
              value={t.id}
              forceMount
              className="mt-0 scroll-mt-32 data-[state=inactive]:hidden"
            >
              {t.content}
            </TabsContent>
          ))}
        </div>
      </Tabs>
    </div>
  );
}
