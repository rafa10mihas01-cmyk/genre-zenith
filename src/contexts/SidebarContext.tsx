/* eslint-disable react-refresh/only-export-components -- co-located helpers/variants/hooks; split would force a large refactor with no runtime benefit (HMR only) */
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * Contexto global do Smart Sidebar.
 * - Cada página (Home, Cérebro, Criação, Operação, Performance) registra seus KPIs aqui no mount.
 * - O sidebar lê esses KPIs e renderiza o bloco dinâmico contextual.
 * - Alertas globais (Apify bloqueado etc) são gerenciados separadamente via setAlerts.
 *
 * REGRA: as páginas NÃO ficam acopladas ao sidebar. Elas só "publicam" KPIs.
 * Se o sidebar mudar de formato, as páginas continuam funcionando.
 */

export type SidebarKpi = {
  label: string;
  value: string | number;
  /** Ícone opcional do lucide-react (componente). */
  intent?: "default" | "primary" | "success" | "warning" | "danger";
};

export type SidebarAlert = {
  id: string;
  /** Curto, 1 linha. Ex: "Coleta pausada (Apify)". */
  label: string;
  intent: "warning" | "danger" | "info";
  /** Rota destino quando o usuário clica. */
  to?: string;
};

type SidebarContextValue = {
  kpis: SidebarKpi[];
  alerts: SidebarAlert[];
  setKpis: (kpis: SidebarKpi[]) => void;
  clearKpis: () => void;
  setAlerts: (alerts: SidebarAlert[]) => void;
};

const Ctx = createContext<SidebarContextValue | null>(null);

export function SidebarContextProvider({ children }: { children: ReactNode }) {
  const [kpis, setKpisState] = useState<SidebarKpi[]>([]);
  const [alerts, setAlertsState] = useState<SidebarAlert[]>([]);

  const setKpis = useCallback((next: SidebarKpi[]) => setKpisState(next), []);
  const clearKpis = useCallback(() => setKpisState([]), []);
  const setAlerts = useCallback((next: SidebarAlert[]) => setAlertsState(next), []);

  const value = useMemo(
    () => ({ kpis, alerts, setKpis, clearKpis, setAlerts }),
    [kpis, alerts, setKpis, clearKpis, setAlerts],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSidebarContext() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSidebarContext deve ser usado dentro de SidebarContextProvider");
  return ctx;
}

/**
 * Hook de conveniência: cada página chama isso UMA vez para publicar seus KPIs no sidebar.
 * Limpa automaticamente ao desmontar — sidebar volta ao default.
 *
 * Ex.: useSetSidebarKpis([{ label: "Prontos", value: 12, intent: "primary" }, ...])
 */
export function useSetSidebarKpis(kpis: SidebarKpi[]) {
  const { setKpis, clearKpis } = useSidebarContext();
  // Serializa para evitar reset infinito quando o array é recriado a cada render.
  const serialized = JSON.stringify(kpis);
  useEffect(() => {
    setKpis(kpis);
    return () => clearKpis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized, setKpis, clearKpis]);
}