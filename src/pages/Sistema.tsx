// Sistema — painel de observabilidade completo.
// Tabs no padrão visual do app (border-b + ícone + label), igual Operação / Playlist Deals / Comunidade.
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { Activity, Workflow, Music2, HeartPulse, Bot, Bell, ListPlus, Settings as SettingsIcon, Server, Brain } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { useScreenField } from "@/lib/screen-state";
import { useUserRole } from "@/hooks/useUserRole";
import { cn } from "@/lib/utils";
import { AoVivoPainel } from "@/components/sistema/AoVivoPainel";
import { FluxoVisual } from "@/components/sistema/fluxo/FluxoVisual";
import { ColetaPanel } from "@/components/sistema/ColetaPanel";
import { SaudeSistema } from "@/components/sistema/SaudeSistema";
import { RoboAoVivo } from "@/components/sistema/RoboAoVivo";
import { AlertasHistorico } from "@/components/sistema/AlertasHistorico";
import { ExecucaoPanel } from "@/components/sistema/ExecucaoPanel";
import Settings from "@/pages/Settings";
import Infraestrutura from "@/pages/Infraestrutura";
import AdminAprendizado from "@/pages/AdminAprendizado";

type SistemaTab =
  | "fluxo" | "robo" | "coleta" | "execucao" | "ao-vivo" | "saude" | "aprendizado" | "alertas" | "infra" | "configuracoes";

type TabDef = { id: SistemaTab; label: string; icon: typeof Activity; adminOnly?: boolean };

const TABS: TabDef[] = [
  { id: "fluxo", label: "Fluxo", icon: Workflow },
  { id: "robo", label: "Robô", icon: Bot },
  { id: "coleta", label: "Coleta", icon: Music2 },
  { id: "execucao", label: "Execução", icon: ListPlus },
  { id: "ao-vivo", label: "Ao Vivo", icon: Activity },
  { id: "saude", label: "Saúde", icon: HeartPulse },
  { id: "aprendizado", label: "Aprendizado", icon: Brain, adminOnly: true },
  { id: "alertas", label: "Alertas", icon: Bell },
  { id: "infra", label: "Infraestrutura", icon: Server, adminOnly: true },
  { id: "configuracoes", label: "Configurações", icon: SettingsIcon },
];

export default function Sistema() {
  const [tab, setTab] = useScreenField<SistemaTab>("/sistema", "tab", "fluxo");
  const { isAdmin } = useUserRole();
  const visibleTabs = TABS.filter((t) => !t.adminOnly || isAdmin);
  const location = useLocation();

  // Deep-link via ?tab= (sidebar Admin > Infra > submenus apontam pra cá).
  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const t = sp.get("tab") as SistemaTab | null;
    if (t && TABS.some((x) => x.id === t)) setTab(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  const currentAllowed = visibleTabs.some((t) => t.id === tab);
  const activeTab = currentAllowed ? tab : "fluxo";

  return (
    <PageContainer>
      <PageHeader
        domain="system"
        title="Sistema"
        subtitle="Tempo real"
      />

      <div className="sticky top-0 z-30 -mt-px bg-background/95 supports-[backdrop-filter]:bg-background/80 backdrop-blur-md border-b border-border -mx-4 md:-mx-6">
        <div className="nx-tab-rail items-center gap-1 px-4 md:px-6">
          {visibleTabs.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "px-4 h-10 inline-flex items-center gap-2 text-sm font-medium border-b-2 transition-colors -mb-px shrink-0 whitespace-nowrap",
                  active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-[480px] animate-tab-in">
        {activeTab === "fluxo" && <FluxoVisual />}
        {activeTab === "ao-vivo" && <AoVivoPainel />}
        {activeTab === "robo" && <RoboAoVivo />}
        {activeTab === "coleta" && <ColetaPanel />}
        {activeTab === "execucao" && <ExecucaoPanel />}
        {activeTab === "saude" && <SaudeSistema />}
        {activeTab === "aprendizado" && <AdminAprendizado embedded />}
        {activeTab === "alertas" && <AlertasHistorico />}
        {activeTab === "infra" && <Infraestrutura embedded />}
        {activeTab === "configuracoes" && <Settings embedded />}
      </div>
    </PageContainer>
  );
}
