// Sistema — painel de observabilidade completo.
// 4 abas: Ao Vivo, Cérebro, Coleta, Saúde. Tudo em PT-BR, com realtime.
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Activity, Brain, Music2, HeartPulse } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { usePersistedState } from "@/hooks/usePersistedState";
import { AoVivoFeed } from "@/components/sistema/AoVivoFeed";
import { CerebroHistorico } from "@/components/sistema/CerebroHistorico";
import { ColetaPanel } from "@/components/sistema/ColetaPanel";
import { SaudeSistema } from "@/components/sistema/SaudeSistema";

export default function Sistema() {
  const [tab, setTab] = usePersistedState<string>("sistema:tab", "ao-vivo");

  return (
    <PageContainer>
      <PageHeader
        kicker="Módulo de Sistema"
        icon={Activity}
        title="Sistema"
        subtitle="Acompanhe em tempo real tudo que acontece nos bastidores: coleta, cérebro, criação e saúde geral."
      />

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="grid grid-cols-4 w-full max-w-2xl mb-4">
          <TabsTrigger value="ao-vivo" className="gap-1.5">
            <Activity className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Ao Vivo</span>
            <span className="sm:hidden">Vivo</span>
          </TabsTrigger>
          <TabsTrigger value="cerebro" className="gap-1.5">
            <Brain className="h-3.5 w-3.5" />
            Cérebro
          </TabsTrigger>
          <TabsTrigger value="coleta" className="gap-1.5">
            <Music2 className="h-3.5 w-3.5" />
            Coleta
          </TabsTrigger>
          <TabsTrigger value="saude" className="gap-1.5">
            <HeartPulse className="h-3.5 w-3.5" />
            Saúde
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ao-vivo" className="mt-0">
          <AoVivoFeed />
        </TabsContent>

        <TabsContent value="cerebro" className="mt-0">
          <CerebroHistorico />
        </TabsContent>

        <TabsContent value="coleta" className="mt-0">
          <ColetaPanel />
        </TabsContent>

        <TabsContent value="saude" className="mt-0">
          <SaudeSistema />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
