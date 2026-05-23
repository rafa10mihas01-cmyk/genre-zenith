import { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LayoutDashboard, ListMusic, LineChart, Wallet, ScrollText, Network, Upload } from "lucide-react";
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
  goal?: number;
  daysElapsed?: number;
  daysTotal?: number;
  lastUpdateAt?: string | null;
  tab: CampaignHubTabId;
  onTabChange: (t: CampaignHubTabId) => void;
  slots: Partial<Record<CampaignHubTabId, ReactNode>>;
  hiddenTabs?: CampaignHubTabId[];
  heroExtraActions?: ReactNode;
};

export function CampaignHub({
  camp, mode, delivered, goal, daysElapsed, daysTotal, lastUpdateAt,
  tab, onTabChange, slots, hiddenTabs = [], heroExtraActions,
}: Props) {
  const tabs: TabDef[] = [
    { id: "overview",  label: "Visão geral",  icon: LayoutDashboard, content: slots.overview  ?? null },
    { id: "playlists", label: "Playlists",    icon: ListMusic,       content: slots.playlists ?? null },
    { id: "curve",     label: "Distribuição", icon: LineChart,       content: slots.curve     ?? null },
    { id: "operacao",  label: "Entregas",     icon: Network,         content: slots.operacao  ?? null },
    { id: "proofs",    label: "Provas",       icon: ScrollText,      content: slots.proofs    ?? null },
    { id: "upload",    label: "Importar",     icon: Upload,          content: slots.upload    ?? null },
    { id: "finance",   label: "Financeiro",   icon: Wallet,          content: slots.finance   ?? null, internalOnly: true },
    { id: "logs",      label: "Logs",         icon: ScrollText,      content: slots.logs      ?? null, internalOnly: true },
  ];

  // Tabs sem conteúdo são ocultas.
  const visible = tabs.filter(t => !hiddenTabs.includes(t.id) && (mode === "internal" || !t.internalOnly) && t.content != null);
  const activeTab = visible.some((t) => t.id === tab) ? tab : visible[0]?.id;

  return (
    <div className="campaign-hub">
      <CampaignHero
        camp={camp}
        mode={mode}
        delivered={delivered}
        goal={goal}
        daysElapsed={daysElapsed}
        daysTotal={daysTotal}
        lastUpdateAt={lastUpdateAt}
        extraActions={heroExtraActions}
      />


      <Tabs value={activeTab} onValueChange={(v) => onTabChange(v as CampaignHubTabId)}>
        <div className={cn(
          "sticky top-[120px] z-20 -mx-4 md:-mx-6 px-4 md:px-6",
          "border-b border-border bg-background/85 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70",
        )}>
          <TabsList className="h-11 bg-transparent gap-1 p-0 rounded-none">
            {visible.map((t) => {
              const Icon = t.icon;
              return (
                <TabsTrigger
                  key={t.id}
                  value={t.id}
                  className={cn(
                    "gap-1.5 px-3 h-11 rounded-none border-b-2 border-transparent bg-transparent",
                    "data-[state=active]:bg-transparent data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none",
                    "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t.label}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

        <div className="pt-6">
          {visible.map((t) => (
            <TabsContent key={t.id} value={t.id} className="mt-0 scroll-mt-32">
              {t.content}
            </TabsContent>
          ))}
        </div>
      </Tabs>
    </div>
  );
}
