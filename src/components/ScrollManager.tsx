import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { isFlowRoute } from "@/lib/screen-state";

/**
 * ScrollManager — gerencia scroll entre rotas como app nativo.
 *
 * Comportamento:
 *  - Navegação NOVA (PUSH/REPLACE): scroll vai pro topo (instantâneo).
 *  - Navegação BACK/FORWARD (POP): restaura a posição que o usuário tinha
 *    quando saiu daquela página.
 *  - Salva continuamente a posição da página atual em sessionStorage,
 *    debounced no scroll, e na hora de sair do path.
 *
 * Diferente do reset bruto: dá sensação de continuidade e contexto preservado.
 */
const STORAGE_KEY = "nx:scroll-positions";

function readPositions(): Record<string, number> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}
function writePositions(map: Record<string, number>) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export default function ScrollManager() {
  const { pathname } = useLocation();
  const navType = useNavigationType(); // "PUSH" | "REPLACE" | "POP"
  const lastPath = useRef<string>(pathname);

  // Salva a posição do path anterior antes de aplicar a nova rota
  useEffect(() => {
    const prev = lastPath.current;
    if (prev !== pathname) {
      const positions = readPositions();
      positions[prev] = window.scrollY;
      writePositions(positions);
    }

    // Aplica scroll da nova rota
    if (navType === "POP") {
      const positions = readPositions();
      const y = positions[pathname] ?? 0;
      // dois rAF: garante que o conteúdo foi pintado antes de scrollar
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.scrollTo({ top: y, left: 0, behavior: "instant" as ScrollBehavior });
        });
      });
    } else {
      // navegação nova → topo, comportamento de app
      window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
    }

    lastPath.current = pathname;
  }, [pathname, navType]);

  // Salva continuamente (debounced) a posição da página corrente
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const positions = readPositions();
        positions[pathname] = window.scrollY;
        writePositions(positions);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [pathname]);

  return null;
}
