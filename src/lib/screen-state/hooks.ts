import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import {
  getScreenEntry,
  resetScreenState,
  setScreenField,
  subscribeScreen,
} from "./store";
import { getScreenConfig } from "./registry";

/**
 * useScreenField — campo persistido por tela (CONTEXT).
 * Lembra entre navegações até o TTL da rota expirar.
 */
export function useScreenField<T>(
  screenId: string,
  field: string,
  initial: T,
): [T, (v: T | ((prev: T) => T)) => void] {
  const ttl = getScreenConfig(screenId).ttl;
  const [value, setValue] = useState<T>(() => {
    const e = getScreenEntry(screenId);
    return (e?.state?.[field] as T) ?? initial;
  });

  useEffect(() => {
    return subscribeScreen(screenId, (e) => {
      const next = (e?.state?.[field] as T | undefined) ?? initial;
      setValue((prev) => (Object.is(prev, next) ? prev : next));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenId, field]);

  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
        setScreenField(screenId, field, next, ttl);
        return next;
      });
    },
    [screenId, field, ttl],
  );

  return [value, set];
}

/**
 * useFlowField — campo de tela de FLUXO (wizard / onboarding / sucesso).
 * Em PUSH/REPLACE para a rota atual, reseta tudo. Em POP, mantém.
 */
export function useFlowField<T>(
  screenId: string,
  field: string,
  initial: T,
): [T, (v: T | ((prev: T) => T)) => void] {
  const navType = useNavigationType();
  const location = useLocation();
  const cleared = useRef(false);

  // Reset uma vez quando a tela monta via navegação nova
  if (!cleared.current) {
    cleared.current = true;
    if (navType !== "POP") resetScreenState(screenId);
  }

  const [value, setValue] = useState<T>(() => {
    const e = getScreenEntry(screenId);
    return (e?.state?.[field] as T) ?? initial;
  });

  useEffect(() => {
    return subscribeScreen(screenId, (e) => {
      const next = (e?.state?.[field] as T | undefined) ?? initial;
      setValue((prev) => (Object.is(prev, next) ? prev : next));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenId, field, location.pathname]);

  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
        // TTL = sessão (grande), mas tela é resetada em PUSH novo
        setScreenField(screenId, field, next, 24 * 60 * 60_000);
        return next;
      });
    },
    [screenId, field],
  );

  return [value, set];
}
