import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { isFlowRoute, purgeExpired, resetScreenState } from "@/lib/screen-state";

/**
 * ScreenStateManager — orquestra ciclo de vida do screen-state global.
 * - Em PUSH/REPLACE para uma rota de FLUXO, zera o state daquela rota.
 * - Roda purgeExpired() periodicamente pra evitar state fantasma e leak.
 *
 * Não renderiza nada.
 */
export default function ScreenStateManager() {
  const { pathname } = useLocation();
  const navType = useNavigationType();
  const lastPath = useRef(pathname);

  useEffect(() => {
    if (navType !== "POP" && isFlowRoute(pathname)) {
      resetScreenState(pathname);
    }
    lastPath.current = pathname;
  }, [pathname, navType]);

  useEffect(() => {
    const id = setInterval(purgeExpired, 60_000);
    return () => clearInterval(id);
  }, []);

  return null;
}
