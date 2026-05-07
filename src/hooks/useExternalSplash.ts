import { useLoading } from "@/contexts/LoadingContext";

/**
 * Hook que devolve um onClick para anchors externos (target="_blank").
 * Ao clicar, dispara o splash global (logo N + barra) por ~800ms,
 * dando a sensação de "carregando" antes de abrir o link.
 */
export function useExternalSplash(ms: number = 800) {
  const { triggerSplash } = useLoading();
  return () => triggerSplash(ms);
}
