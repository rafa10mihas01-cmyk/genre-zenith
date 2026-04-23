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
  const { theme } = useTheme();
  const resolved =
    variant === "auto" ? (theme === "dark" ? "dark" : "light") : variant;

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
      className={cn("shrink-0 select-none", className)}
      draggable={false}
    />
  );
}
