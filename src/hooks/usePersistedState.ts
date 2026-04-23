import { useCallback, useEffect, useRef, useState } from "react";

/**
 * usePersistedState — useState com persistência automática em sessionStorage.
 *
 * Mantém estado entre reloads E navegações dentro da mesma aba do navegador.
 * Usa sessionStorage (não localStorage) pra cada aba do navegador ter seu próprio contexto,
 * comportamento esperado em apps tipo Notion/Spotify.
 *
 * Uso:
 *   const [tab, setTab] = usePersistedState("operacao:tab", "playlists");
 *   const [filter, setFilter] = usePersistedState("operacao:filter", "todas");
 */
export function usePersistedState<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const isFirstRender = useRef(true);

  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw == null) return initial;
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    // não grava no primeiro render (já veio do storage)
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // quota cheia / modo privado: ignora silenciosamente
    }
  }, [key, value]);

  const set = useCallback(
    (v: T | ((prev: T) => T)) => setValue(v),
    [],
  );

  return [value, set];
}
