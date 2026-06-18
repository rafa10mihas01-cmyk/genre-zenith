/* eslint-disable react-refresh/only-export-components -- co-located helpers/variants/hooks; split would force a large refactor with no runtime benefit (HMR only) */
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/**
 * Contexto GLOBAL de loading do app.
 *
 * Dois contadores independentes:
 *  • count    → tasks "soft" (queries de página). Dirige o TopProgressBar fino.
 *  • bootCount → tasks de BOOT (auth init + chunks Suspense). Dirige o SplashLoader.
 *
 * O splash NÃO usa mais timer fixo: ele liga quando bootCount > 0 e desliga
 * assim que TODO chunk pendente termina + auth deixa de estar loading.
 */

type LoadingCtx = {
  isLoading: boolean;
  start: () => () => void;
  withLoading: <T,>(promise: Promise<T>) => Promise<T>;
  /** True enquanto qualquer task de boot estiver pendente (auth | Suspense). */
  isSplashing: boolean;
  /** Marca início de uma task de boot. Retorna função de stop idempotente. */
  startBoot: () => () => void;
  /** Mostra o splash full-screen por X ms (útil ao abrir links externos). */
  triggerSplash: (ms?: number) => void;
};

const Ctx = createContext<LoadingCtx | null>(null);

export function LoadingProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0);
  // Começa em 1: cobre o intervalo entre o primeiro render do Provider e o
  // mount do AuthProvider/RouteFallback. Decrementa no próximo tick.
  const [bootCount, setBootCount] = useState(1);
  const [manualSplash, setManualSplash] = useState(false);
  const manualTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Decrementa o boot inicial assim que a árvore monta — a partir daí, quem
  // mantém o splash ligado é Suspense (RouteFallback) e Auth (ProtectedRoute).
  useEffect(() => {
    const t = setTimeout(() => setBootCount((c) => Math.max(0, c - 1)), 0);
    return () => clearTimeout(t);
  }, []);

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
    try { return await promise; } finally { stop(); }
  }, [start]);

  const startBoot = useCallback<LoadingCtx["startBoot"]>(() => {
    setBootCount((c) => c + 1);
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      setBootCount((c) => Math.max(0, c - 1));
    };
  }, []);

  const triggerSplash = useCallback((ms: number = 800) => {
    setManualSplash(true);
    if (manualTimer.current) clearTimeout(manualTimer.current);
    manualTimer.current = setTimeout(() => setManualSplash(false), ms);
  }, []);

  // Perf: memoiza o value pra evitar re-render global de TODA tela consumidora
  // a cada render do provider (antes: objeto novo a cada render).
  const value = useMemo(
    () => ({
      isLoading: count > 0,
      start,
      withLoading,
      isSplashing: bootCount > 0 || manualSplash,
      startBoot,
      triggerSplash,
    }),
    [count, bootCount, manualSplash, start, withLoading, startBoot, triggerSplash],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLoading() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLoading deve ser usado dentro de <LoadingProvider>");
  return v;
}

/**
 * Mantém uma task de boot ativa enquanto `active` for true.
 * Usado por RouteFallback (Suspense) e ProtectedRoute (auth) pra unificar
 * todos os loaders de boot em um único splash.
 */
export function useBootGate(active: boolean) {
  const { startBoot } = useLoading();
  useEffect(() => {
    if (!active) return;
    const stop = startBoot();
    return stop;
  }, [active, startBoot]);
}