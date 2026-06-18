/* eslint-disable react-refresh/only-export-components -- co-located helpers/variants/hooks; split would force a large refactor with no runtime benefit (HMR only) */
import * as React from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type Theme = "light" | "dark" | "system";

type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (t: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);
const STORAGE_KEY = "nexengine.theme";

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(resolved: "light" | "dark") {
  const root = document.documentElement;
  // Desabilita transições durante a troca para evitar "fade" arrastado em todos os elementos.
  // Técnica usada pelo next-themes / theme-change.
  const css = document.createElement("style");
  css.appendChild(
    document.createTextNode(
      `*,*::before,*::after{transition:none !important;animation:none !important;}`
    )
  );
  document.head.appendChild(css);

  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  root.style.colorScheme = resolved;

  // Sincroniza a cor da status bar do iOS/Android com o tema atual.
  // Sem isso, o "notch" fica preto fixo mesmo no tema claro.
  const themeColor = resolved === "dark" ? "#050505" : "#ffffff";
  // Remove TODAS as meta theme-color (incluindo as com media query do index.html)
  // para garantir que a barra de status do iOS/Android siga o tema escolhido pelo
  // usuário no app — independentemente da preferência do sistema.
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((el) => el.parentNode?.removeChild(el));
  const meta = document.createElement("meta");
  meta.name = "theme-color";
  meta.content = themeColor;
  document.head.appendChild(meta);

  // Força reflow + remove o bloqueio no próximo frame.
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  window.getComputedStyle(css).opacity;
  requestAnimationFrame(() => {
    document.head.removeChild(css);
  });
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return "dark";
    return (localStorage.getItem(STORAGE_KEY) as Theme) ?? "dark";
  });
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() =>
    theme === "system" ? getSystemTheme() : (theme as "light" | "dark")
  );

  useEffect(() => {
    const resolved = theme === "system" ? getSystemTheme() : (theme as "light" | "dark");
    setResolvedTheme(resolved);
    applyTheme(resolved);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const resolved = mq.matches ? "dark" : "light";
      setResolvedTheme(resolved);
      applyTheme(resolved);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);

  // Perf: memoiza o value pra evitar re-render global em toda tela.
  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}