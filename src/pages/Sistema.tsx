// Sistema — painel de observabilidade completo.
// Tabs no padrão visual do app (border-b + ícone + label), igual Operação / Playlist Deals / Comunidade.
import { Activity, Workflow, Music2, HeartPulse, Bot, Bell } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { useScreenField } from "@/lib/screen-state";
import { cn } from "@/lib/utils";
import { AoVivoPainel } from "@/components/sistema/AoVivoPainel";
import { FluxoVisual } from "@/components/sistema/fluxo/FluxoVisual";
import { ColetaPanel } from "@/components/sistema/ColetaPanel";
import { SaudeSistema } from "@/components/sistema/SaudeSistema";
import { RoboAoVivo } from "@/components/sistema/RoboAoVivo";
import { AlertasHistorico } from "@/components/sistema/AlertasHistorico";

type SistemaTab = "fluxo" | "ao-vivo" | "robo" | "coleta" | "saude" | "alertas";

const TABS: { id: SistemaTab; label: string; icon: typeof Activity }[] = [
  { id: "fluxo", label: "Fluxo", icon: Workflow },
  { id: "ao-vivo", label: "Ao Vivo", icon: Activity },
  { id: "robo", label: "Robô", icon: Bot },
  { id: "coleta", label: "Coleta", icon: Music2 },
  { id: "saude", label: "Saúde", icon: HeartPulse },
  { id: "alertas", label: "Alertas", icon: Bell },
];

export default function Sistema() {
  const [tab, setTab] = useScreenField<SistemaTab>("/sistema", "tab", "fluxo");

  return (
    <PageContainer>
      <PageHeader
        title="Sistema"
        subtitle="Acompanhar o pipeline em tempo real"
      />

      {/* TABS — mesmo padrão visual de Operação / Playlist Deals */}
      <div className="sticky top-0 z-30 -mt-px bg-background/95 supports-[backdrop-filter]:bg-background/80 backdrop-blur-md flex items-center gap-1 border-b border-border overflow-x-auto overscroll-x-contain touch-pan-x [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-4 md:-mx-6 px-4 md:px-6">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "px-4 h-10 inline-flex items-center gap-2 text-sm font-medium border-b-2 transition-colors -mb-px shrink-0 whitespace-nowrap",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="min-h-[480px] animate-tab-in">
        {tab === "fluxo" && <FluxoVisual />}
        {tab === "ao-vivo" && <AoVivoPainel />}
        {tab === "robo" && <RoboAoVivo />}
        {tab === "coleta" && <ColetaPanel />}
        {tab === "saude" && <SaudeSistema />}
        {tab === "alertas" && <AlertasHistorico />}
      </div>
    </PageContainer>
  );
}
