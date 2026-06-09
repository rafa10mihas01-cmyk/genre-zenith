import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Voltar padronizado: tenta navigate(-1) primeiro (preserva filtros/scroll
 * da lista de origem). Se a página foi aberta direto (sem histórico),
 * cai para a rota pai lógica.
 */
export function useBackOrFallback(fallback: string) {
  const navigate = useNavigate();
  return useCallback(() => {
    // history.length > 1 não basta porque cresce com hot reload. Usa key.
    // Se key === "default", o usuário entrou direto nesta URL → fallback.
    const isInitialEntry =
      typeof window !== "undefined" &&
      (window.history.state == null || window.history.state?.idx === 0);
    if (isInitialEntry) navigate(fallback, { replace: true });
    else navigate(-1);
  }, [navigate, fallback]);
}
