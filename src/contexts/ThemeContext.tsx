import { createContext, useContext, useEffect, useState, ReactNode } from "react";

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
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  root.style.colorScheme = resolved;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // V3 Spec §3.3: dark é o tema padrão e único do /admin.
  const [theme] = useState<Theme>("dark");

  useEffect(() => {
    applyTheme("dark");
    try { localStorage.setItem(STORAGE_KEY, "dark"); } catch { /* noop */ }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme: "dark", setTheme: () => applyTheme("dark") }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
