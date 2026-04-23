import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * ScrollToTop — reseta scroll no topo ao mudar de rota.
 * Evita a sensação de "página rolada" ao navegar entre módulos.
 * NÃO atua em mudança de query/hash; apenas no pathname.
 */
export default function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    // scroll instantâneo (não animado) para sensação de app nativo
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
    // também tenta scrollar o <main> (caso tenha overflow próprio)
    const main = document.querySelector("main");
    if (main) main.scrollTop = 0;
  }, [pathname]);
  return null;
}
