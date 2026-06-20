// Sistema — cockpit de observabilidade reorganizado:
//   Saúde · Aprendizado · Alertas · Motores · Configurações · Dev (admin)
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  Activity, Workflow, Music2, HeartPulse, Bot, Bell, ListPlus,
  Settings as SettingsIcon, Server, Brain, FlaskConical, Wrench, Flag, ShieldAlert, Gauge, ClipboardCheck, ChevronRight, Radar,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { PageContainer } from "@/components/PageContainer";
import { useScreenField } from "@/lib/screen-state";
import { useUserRole } from "@/hooks/useUserRole";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { timeAgo } from "@/lib/format";
import { humanizeError, humanizeFunctionName, humanizeLogMessage } from "@/lib/operationalCopy";

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
import { SystemKpis } from "@/components/sistema/SystemKpis";
import { FeatureFlagsPanel } from "@/components/sistema/FeatureFlagsPanel";
import { OperationalHealthCard } from "@/components/home/OperationalHealthCard";
import { CircuitBreakerHistoryCard } from "@/components/sistema/CircuitBreakerHistoryCard";
import { BrainFreshnessCard } from "@/components/home/BrainFreshnessCard";
import { EngineHealthGrid } from "@/components/cockpit/EngineHealthGrid";
import { CapacidadePanel } from "@/components/sistema/CapacidadePanel";
import { SpotifyPilotPanel } from "@/components/sistema/SpotifyPilotPanel";
import { ManualDistribuicoesPanel } from "@/components/sistema/ManualDistribuicoesPanel";
import { SpotifyAppsPanel } from "@/components/sistema/SpotifyAppsPanel";
import { SpotifyAccessBlocksPanel } from "@/components/sistema/SpotifyAccessBlocksPanel";
import { SpotifyBalancerOverviewPanel } from "@/components/sistema/SpotifyBalancerOverviewPanel";
import { ExecutiveStatusBar } from "@/components/sistema/ExecutiveStatusBar";
import { AttentionInbox } from "@/components/sistema/AttentionInbox";
import { OperationalSummary } from "@/components/sistema/OperationalSummary";
import { NocPanel } from "@/components/sistema/NocPanel";

type SistemaTab = "saude" | "capacidade" | "aprendizado" | "alertas" | "noc" | "motores" | "configuracoes" | "dev";
type MotorSub = "robo" | "coleta" | "execucao" | "manual" | "fluxo" | "ao-vivo";
type DevSub = "infra" | "flags" | "seo" | "spotify";

type TabDef = { id: SistemaTab; label: string; icon: typeof Activity; adminOnly?: boolean };

const TABS: TabDef[] = [
  { id: "saude", label: "Saúde", icon: HeartPulse },
  { id: "capacidade", label: "Capacidade", icon: Gauge },
  { id: "aprendizado", label: "Aprendizado", icon: Brain },
  { id: "alertas", label: "Alertas", icon: Bell },
  { id: "noc", label: "Observabilidade", icon: Radar, adminOnly: true },
  { id: "motores", label: "Motores", icon: Bot },
  { id: "configuracoes", label: "Configurações", icon: SettingsIcon },
  { id: "dev", label: "Dev", icon: Wrench, adminOnly: true },
];

// Legacy deep-links → novo layout.
const LEGACY_TAB_MAP: Record<string, { tab: SistemaTab; motor?: MotorSub; dev?: DevSub }> = {
  "visao-geral": { tab: "saude" },
  "fluxo": { tab: "motores", motor: "fluxo" },
  "ao-vivo": { tab: "motores", motor: "ao-vivo" },
  "saude": { tab: "saude" },
  "alertas": { tab: "alertas" },
  "robo": { tab: "motores", motor: "robo" },
  "coleta": { tab: "motores", motor: "coleta" },
  "execucao": { tab: "motores", motor: "execucao" },
  "aprendizado": { tab: "aprendizado" },
  "avancado": { tab: "dev" },
  "seo": { tab: "dev", dev: "seo" },
  "infra": { tab: "dev", dev: "infra" },
  "flags": { tab: "dev", dev: "flags" },
  "configuracoes": { tab: "configuracoes" },
};

export default function Sistema() {
  const [tab, setTab] = useScreenField<SistemaTab>("/sistema", "tab", "saude");
  const [motorSub, setMotorSub] = useState<MotorSub>("robo");
  const [devSub, setDevSub] = useState<DevSub>("infra");
  const { isAdmin } = useUserRole();
  const visibleTabs = TABS.filter((t) => !t.adminOnly || isAdmin);
  const location = useLocation();

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
      if (legacy.dev) setDevSub(legacy.dev);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  const currentAllowed = visibleTabs.some((t) => t.id === tab);
  const activeTab = currentAllowed ? tab : "saude";

  return (
    <PageContainer>
      <PageHeader domain="system" title="Sistema" subtitle="Cockpit de observabilidade" />

      <SpotifyReconnectBanner />

      {/* Desktop: underline rail */}
      <div className="hidden sm:block sticky top-0 z-30 -mt-px bg-background/95 supports-[backdrop-filter]:bg-background/80 backdrop-blur-md border-b border-border -mx-4 md:-mx-6">
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

      {/* Mobile: cards na mesma régua (todos numa linha) */}
      <div
        className="grid gap-1 sm:hidden mb-4"
        style={{ gridTemplateColumns: `repeat(${visibleTabs.length}, minmax(0, 1fr))` }}
      >
        {visibleTabs.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          const shortLabel =
            t.id === "saude" ? "Saúde" :
            t.id === "capacidade" ? "Capac" :
            t.id === "aprendizado" ? "Aprend" :
            t.id === "alertas" ? "Alerta" :
            t.id === "noc" ? "NOC" :
            t.id === "motores" ? "Motor" :
            t.id === "configuracoes" ? "Config" :
            "Dev";
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={active}
              className={cn(
                "rounded-lg border px-0 py-2 flex flex-col items-center justify-center gap-1 min-w-0 transition-colors",
                active
                  ? "border-primary/60 bg-primary/10 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="text-[9px] font-medium leading-tight truncate w-full text-center px-0.5">{shortLabel}</span>
            </button>
          );
        })}
      </div>


      <div className="min-h-[480px] animate-tab-in">
        {activeTab === "saude" && (
          <div className="space-y-8">
            {/* PRIORIDADE 1 — incidentes que exigem ação imediata */}
            <ExecutiveStatusBar />
            <AttentionInbox />

            {/* PRIORIDADE 2 — operação (resumo em uma olhada) */}
            <OperationalSummary />

            {/* PRIORIDADE 3 — diagnóstico técnico e analítico (final da página) */}
            <details className="group">
              <summary className="cursor-pointer list-none flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground font-bold hover:text-foreground py-2">
                <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
                Diagnóstico detalhado
              </summary>
              <div className="space-y-8 mt-4">
                <SystemKpis />
                <section>
                  <SectionHeader icon={HeartPulse} title="Saúde geral" subtitle="KPIs agregados do sistema" />
                  <SaudeSistema />
                </section>
                <section>
                  <SectionHeader icon={Activity} title="Saúde operacional" subtitle="Status dos motores principais" />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <OperationalHealthCard />
                    <BrainFreshnessCard />
                  </div>
                </section>
                <section>
                  <SectionHeader icon={ShieldAlert} title="Circuit breaker" subtitle="Aberturas do CB do Spotify nos últimos 30 dias" />
                  <CircuitBreakerHistoryCard />
                </section>
                <section>
                  <SectionHeader icon={ShieldAlert} title="Balanceador Spotify" subtitle="Capacity Score, Health Score e limites por App — fonte única (Fase 16)" />
                  <SpotifyBalancerOverviewPanel />
                </section>
                <section>
                  <SectionHeader icon={ShieldAlert} title="Apps Spotify" subtitle="Quais apps estão saudáveis, em atenção ou bloqueados agora" />
                  <SpotifyAppsPanel />
                </section>
                <section>
                  <SectionHeader icon={ShieldAlert} title="Apps sem acesso" subtitle="Apps em Development Mode bloqueando usuários e playlists específicos" />
                  <SpotifyAccessBlocksPanel />
                </section>
                <section>
                  <SectionHeader icon={Workflow} title="Motor editorial" subtitle="Saúde do pipeline de curadoria" />
                  <EngineHealthGrid />
                </section>
              </div>
            </details>

            {/* PRIORIDADE 4 — logs (sempre por último) */}
            <section>
              <SectionHeader icon={Activity} title="Atividade recente" subtitle="Últimos eventos da coleta" />
              <AtividadeRecente />
            </section>
          </div>
        )}

        {activeTab === "capacidade" && <CapacidadePanel />}

        {activeTab === "aprendizado" && <AdminAprendizado embedded />}

        {activeTab === "alertas" && <AlertasHistorico />}

        {activeTab === "noc" && isAdmin && <NocPanel />}

        {activeTab === "motores" && (
          <div className="space-y-4">
            <SubTabs<MotorSub>
              value={motorSub}
              onChange={setMotorSub}
              options={[
                { id: "robo", label: "Robô", icon: Bot },
                { id: "coleta", label: "Coleta", icon: Music2 },
                { id: "execucao", label: "Execução", icon: ListPlus },
                { id: "manual", label: "Manual", icon: ClipboardCheck },
                { id: "fluxo", label: "Fluxo", icon: Workflow },
                { id: "ao-vivo", label: "Ao vivo", icon: Activity },
              ]}
            />
            {motorSub === "robo" && <RoboAoVivo />}
            {motorSub === "coleta" && <ColetaPanel />}
            {motorSub === "execucao" && <ExecucaoPanel />}
            {motorSub === "manual" && <ManualDistribuicoesPanel />}
            {motorSub === "fluxo" && <FluxoVisual />}
            {motorSub === "ao-vivo" && <AoVivoPainel />}
          </div>
        )}

        {activeTab === "configuracoes" && <Settings embedded />}

        {activeTab === "dev" && isAdmin && (
          <div className="space-y-4">
            <SubTabs<DevSub>
              value={devSub}
              onChange={setDevSub}
              options={[
                { id: "infra", label: "Infraestrutura", icon: Server },
                { id: "flags", label: "Feature flags", icon: Flag },
                { id: "seo", label: "SEO", icon: FlaskConical },
                { id: "spotify", label: "Spotify (piloto)", icon: Music2 },
              ]}
            />
            {devSub === "infra" && <Infraestrutura embedded />}
            {devSub === "flags" && <FeatureFlagsPanel />}
            {devSub === "seo" && <SeoLessonsPanel />}
            {devSub === "spotify" && <SpotifyPilotPanel />}
          </div>
        )}
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

type LogRow = { id: string; acao: string; status: string; mensagem: string | null; created_at: string };

function AtividadeRecente() {
  const [rows, setRows] = useState<LogRow[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data } = await supabase
        .from("collection_logs")
        .select("id,acao,status,mensagem,created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (!cancelled) setRows((data ?? []) as LogRow[]);
    }
    load();
    const i = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(i); };
  }, []);

  if (rows === null) return <div className="nx-card p-6 text-center text-xs text-muted-foreground">Carregando…</div>;
  if (rows.length === 0) return <div className="nx-card p-6 text-center text-xs text-muted-foreground">Sem atividade registrada.</div>;

  return (
    <div className="nx-card overflow-hidden">
      <ul className="divide-y divide-border max-h-[560px] overflow-y-auto">
        {rows.map(l => {
          const tone =
            l.status === "sucesso" ? "text-primary bg-primary/10"
            : l.status === "erro" ? "text-destructive bg-destructive/10"
            : "text-warning bg-warning/10";
          const friendly = humanizeLogMessage(l.acao, l.status, l.mensagem);
          const hasTechnical = l.mensagem && (l.mensagem.startsWith("{") || l.mensagem.startsWith("[") || /\n\s*at\s/.test(l.mensagem));
          return (
            <li key={l.id} className="flex items-start gap-3 px-4 py-3">
              <span className={cn("h-7 w-7 rounded-full flex items-center justify-center shrink-0 mt-0.5", tone)}>
                <Activity className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-foreground leading-snug">{friendly}</div>
                {hasTechnical && (
                  <details className="mt-1">
                    <summary className="text-[10px] text-muted-foreground/70 cursor-pointer hover:text-foreground">Ver detalhes técnicos</summary>
                    <pre className="text-[10px] text-muted-foreground mt-1 p-2 bg-muted/30 rounded overflow-x-auto max-h-32">{l.mensagem}</pre>
                  </details>
                )}
              </div>
              <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                {timeAgo(l.created_at)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
