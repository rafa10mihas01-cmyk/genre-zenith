import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

/**
 * Contexto GLOBAL de loading do app.
 *
 * Modelo: contador de "tarefas em andamento". Cada chamada a `start()` retorna
 * uma função `stop()`. Enquanto contador > 0, o app está "carregando".
 *
 * Componentes exibidos pelo AppLayout:
 *  • TopProgressBar  — barra fina no topo (estilo YouTube), sempre que ativo
 *  • SplashLoader    — overlay com logo N + barra; só na 1ª carga e troca de rota
 *
 * Como usar em qualquer página:
 *   const { withLoading } = useLoading();
 *   await withLoading(supabase.from(...).select(...));
 *
 * Ou manualmente:
 *   const { start } = useLoading();
 *   const stop = start();
 *   try { ... } finally { stop(); }
 */

type LoadingCtx = {
  /** True enquanto houver qualquer tarefa em andamento */
  isLoading: boolean;
  /** Marca início de uma tarefa. Retorna função para encerrar. */
  start: () => () => void;
  /** Embrulha uma promise marcando start/stop automaticamente. */
  withLoading: <T,>(promise: Promise<T>) => Promise<T>;
  /** True enquanto o splash full-screen está ativo (1ª carga / troca de rota). */
  isSplashing: boolean;
  /** Mostra o splash full-screen por X ms (padrão 800ms). Útil ao abrir links externos. */
  triggerSplash: (ms?: number) => void;
};

const Ctx = createContext<LoadingCtx | null>(null);

export function LoadingProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0);
  const [isSplashing, setSplashing] = useState(true); // primeira carga
  const splashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const location = useLocation();

  const start = useCallback<LoadingCtx["start"]>(() => {
    setCount((c) => c + 1);
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      setCount((c) => Math.max(0, c - 1));
    };
  }, []);

  const withLoading = useCallback<LoadingCtx["withLoading"]>(async (promise) => {
    const stop = start();
    try {
      return await promise;
    } finally {
      stop();
    }
  }, [start]);

  // SPLASH: ativa automaticamente em toda troca de rota e no primeiro mount.
  // Permanece visível por no mínimo 350ms (evita flicker em rotas instantâneas)
  // e some assim que o tempo mínimo passa.
  useEffect(() => {
    setSplashing(true);
    if (splashTimer.current) clearTimeout(splashTimer.current);
    splashTimer.current = setTimeout(() => setSplashing(false), 600);
    return () => {
      if (splashTimer.current) clearTimeout(splashTimer.current);
    };
  }, [location.pathname]);

  const triggerSplash = useCallback((ms: number = 800) => {
    setSplashing(true);
    if (splashTimer.current) clearTimeout(splashTimer.current);
    splashTimer.current = setTimeout(() => setSplashing(false), ms);
  }, []);

  return (
    <Ctx.Provider
      value={{
        isLoading: count > 0,
        start,
        withLoading,
        isSplashing,
        triggerSplash,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useLoading() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLoading deve ser usado dentro de <LoadingProvider>");
  return v;
}
