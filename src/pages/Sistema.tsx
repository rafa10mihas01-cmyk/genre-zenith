// Sistema — cockpit de observabilidade reorganizado em 4 abas:
//  - Visão Geral: Fluxo + Saúde + Ao Vivo + Alertas (cockpit único)
//  - Motores: Robô · Coleta · Execução (sub-abas internas)
//  - Avançado: Aprendizado · SEO · Infraestrutura (admin)
//  - Configurações: conexões + equipe + conta
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  Activity, Workflow, Music2, HeartPulse, Bot, Bell, ListPlus,
  Settings as SettingsIcon, Server, Brain, FlaskConical, LayoutDashboard, Cpu, Wrench,
} from "lucide-react";
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
import { SeoLessonsPanel } from "@/components/sistema/SeoLessonsPanel";
import { SpotifyReconnectBanner } from "@/components/sistema/SpotifyReconnectBanner";

type SistemaTab = "visao-geral" | "motores" | "avancado" | "configuracoes";
type MotorSub = "robo" | "coleta" | "execucao";
type AvancadoSub = "aprendizado" | "seo" | "infra";

type TabDef = { id: SistemaTab; label: string; icon: typeof Activity; adminOnly?: boolean };

const TABS: TabDef[] = [
  { id: "visao-geral", label: "Visão Geral", icon: LayoutDashboard },
  { id: "motores", label: "Motores", icon: Cpu },
  { id: "avancado", label: "Avançado", icon: Wrench, adminOnly: true },
  { id: "configuracoes", label: "Configurações", icon: SettingsIcon },
];

// Mapeamento dos antigos tab ids (deep-links legados) para o novo layout.
const LEGACY_TAB_MAP: Record<string, { tab: SistemaTab; motor?: MotorSub; avancado?: AvancadoSub; section?: string }> = {
  "fluxo": { tab: "visao-geral", section: "fluxo" },
  "ao-vivo": { tab: "visao-geral", section: "ao-vivo" },
  "saude": { tab: "visao-geral", section: "saude" },
  "alertas": { tab: "visao-geral", section: "alertas" },
  "robo": { tab: "motores", motor: "robo" },
  "coleta": { tab: "motores", motor: "coleta" },
  "execucao": { tab: "motores", motor: "execucao" },
  "aprendizado": { tab: "avancado", avancado: "aprendizado" },
  "seo": { tab: "avancado", avancado: "seo" },
  "infra": { tab: "avancado", avancado: "infra" },
  "configuracoes": { tab: "configuracoes" },
};

export default function Sistema() {
  const [tab, setTab] = useScreenField<SistemaTab>("/sistema", "tab", "visao-geral");
  const [motorSub, setMotorSub] = useState<MotorSub>("robo");
  const [avancadoSub, setAvancadoSub] = useState<AvancadoSub>("aprendizado");
  const { isAdmin } = useUserRole();
  const visibleTabs = TABS.filter((t) => !t.adminOnly || isAdmin);
  const location = useLocation();

  // Deep-link: aceita tanto os novos ids quanto os antigos.
  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const raw = sp.get("tab");
    if (!raw) return;
    if (TABS.some((x) => x.id === raw)) {
      setTab(raw as SistemaTab);
      return;
    }
    const legacy = LEGACY_TAB_MAP[raw];
    if (legacy) {
      setTab(legacy.tab);
      if (legacy.motor) setMotorSub(legacy.motor);
      if (legacy.avancado) setAvancadoSub(legacy.avancado);
      if (legacy.section) {
        // rola até a seção dentro de Visão Geral
        setTimeout(() => {
          document.getElementById(`section-${legacy.section}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 200);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  const currentAllowed = visibleTabs.some((t) => t.id === tab);
  const activeTab = currentAllowed ? tab : "visao-geral";

  return (
    <PageContainer>
      <PageHeader domain="system" title="Sistema" subtitle="Cockpit de observabilidade" />

      <SpotifyReconnectBanner />

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
        {activeTab === "visao-geral" && (
          <div className="space-y-8">
            <section id="section-fluxo">
              <SectionHeader icon={Workflow} title="Fluxo do sistema" subtitle="Pipeline em tempo real" />
              <FluxoVisual />
            </section>
            <section id="section-alertas">
              <SectionHeader icon={Bell} title="Alertas" subtitle="Eventos críticos recentes" />
              <AlertasHistorico />
            </section>
            <section id="section-saude">
              <SectionHeader icon={HeartPulse} title="Saúde geral" subtitle="KPIs agregados" />
              <SaudeSistema />
            </section>
            <section id="section-ao-vivo">
              <SectionHeader icon={Activity} title="Ao vivo" subtitle="Feed de eventos do agora" />
              <AoVivoPainel />
            </section>
          </div>
        )}

        {activeTab === "motores" && (
          <div className="space-y-4">
            <SubTabs<MotorSub>
              value={motorSub}
              onChange={setMotorSub}
              options={[
                { id: "robo", label: "Robô", icon: Bot },
                { id: "coleta", label: "Coleta", icon: Music2 },
                { id: "execucao", label: "Execução", icon: ListPlus },
              ]}
            />
            {motorSub === "robo" && <RoboAoVivo />}
            {motorSub === "coleta" && <ColetaPanel />}
            {motorSub === "execucao" && <ExecucaoPanel />}
          </div>
        )}

        {activeTab === "avancado" && isAdmin && (
          <div className="space-y-4">
            <SubTabs
              value={avancadoSub}
              onChange={setAvancadoSub}
              options={[
                { id: "aprendizado", label: "Aprendizado", icon: Brain },
                { id: "seo", label: "SEO", icon: FlaskConical },
                { id: "infra", label: "Infraestrutura", icon: Server },
              ]}
            />
            {avancadoSub === "aprendizado" && <AdminAprendizado embedded />}
            {avancadoSub === "seo" && <SeoLessonsPanel />}
            {avancadoSub === "infra" && <Infraestrutura embedded />}
          </div>
        )}

        {activeTab === "configuracoes" && <Settings embedded />}
      </div>
    </PageContainer>
  );
}

function SectionHeader({ icon: Icon, title, subtitle }: { icon: typeof Activity; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <div className="h-8 w-8 rounded-md bg-muted/40 border border-border flex items-center justify-center">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div>
        <h2 className="text-[15px] font-semibold leading-tight text-foreground">{title}</h2>
        <p className="text-[12px] text-muted-foreground leading-tight">{subtitle}</p>
      </div>
    </div>
  );
}

function SubTabs<T extends string>(props: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string; icon: typeof Activity }[];
}) {
  const { value, onChange, options } = props;
  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-muted/30 border border-border">
      {options.map((o) => {
        const Icon = o.icon;
        const active = value === o.id;
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            className={cn(
              "px-3 h-8 inline-flex items-center gap-2 text-[13px] font-medium rounded-md transition-colors",
              active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
