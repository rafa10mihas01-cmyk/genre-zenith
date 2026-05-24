import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/contexts/ThemeContext";
import logoLight from "@/assets/nexengine-logo.png";
import logoDark from "@/assets/nexengine-logo-dark.png";
import logoMark from "@/assets/nexengine-mark.png";

/**
 * NexEngine logomark — official brand asset.
 *
 * Variants:
 *  • "auto" (default) → escolhe light/dark conforme o tema atual
 *  • "light"          → para fundos claros (texto escuro + Engine verde)
 *  • "dark"           → para fundos escuros (texto branco + Engine verde)
 *  • "mark"           → apenas o símbolo "N" verde (sem o texto)
 *
 * As proporções dos arquivos originais são preservadas via auto-height.
 */

export type NexEngineLogoVariant = "auto" | "light" | "dark" | "mark";

// Aspect ratios reais dos arquivos finais (para evitar layout shift)
const ASPECT_FULL = 1489 / 473; // logo completo
const ASPECT_MARK = 732 / 473;  // só o símbolo

let logosPreloaded = false;

function preloadLogos() {
  if (typeof window === "undefined" || logosPreloaded) return;
  logosPreloaded = true;

  [logoLight, logoDark, logoMark].forEach((src) => {
    const img = new Image();
    img.src = src;
    img.decode?.().catch(() => undefined);
  });
}

export function NexEngineLogo({
  className,
  size = 40,
  variant = "auto",
}: {
  className?: string;
  /** altura em px */
  size?: number;
  variant?: NexEngineLogoVariant;
}) {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    preloadLogos();
  }, []);

  const resolved =
    variant === "auto" ? resolvedTheme : variant;

  const src =
    resolved === "mark" ? logoMark : resolved === "dark" ? logoDark : logoLight;
  const aspect = resolved === "mark" ? ASPECT_MARK : ASPECT_FULL;

  const height = size;
  const width = Math.round(size * aspect);

  return (
    <img
      src={src}
      alt="NexEngine"
      width={width}
      height={height}
      loading="eager"
      decoding="sync"
      {...({ fetchpriority: "high" } as any)}
      className={cn("shrink-0 select-none", className)}
      draggable={false}
    />
  );
}
