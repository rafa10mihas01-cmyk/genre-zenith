import { useEffect, useRef, useState } from "react";
import { useLoading } from "@/contexts/LoadingContext";
import { NexEngineLogo } from "@/components/NexEngineLogo";
import { cn } from "@/lib/utils";

/**
 * Splash full-screen com logo "N" centralizado + barra animada embaixo.
 *
 * Threshold anti-flicker: o splash só monta se `isSplashing` permanecer true
 * por >= 50ms. Em navegações rápidas (chunk já cacheado), o boot termina
 * antes do timer disparar e o splash nunca aparece — evita o "double layer"
 * de overlay piscando sobre conteúdo já renderizado.
 */
const SHOW_DELAY_MS = 50;

export function SplashLoader() {
  const { isSplashing } = useLoading();
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isSplashing) {
      if (visible) return;
      if (timerRef.current) return;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setVisible(true);
      }, SHOW_DELAY_MS);
    } else {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (visible) setVisible(false);
    }
    return () => {
      // cleanup só ao desmontar — o else acima cobre os toggles
    };
  }, [isSplashing, visible]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Não renderiza nada até o threshold disparar — zero custo de DOM.
  if (!visible && !isSplashing) return null;
  if (!visible) return null;

  return (
    <div
      aria-hidden={!isSplashing}
      role="status"
      className={cn(
        "fixed inset-0 z-[90] flex flex-col items-center justify-center",
        "bg-background",
        "transition-opacity duration-300",
        isSplashing ? "opacity-100" : "opacity-0 pointer-events-none",
      )}
    >
      {/* Glow sutil verde atrás do logo */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 50% 40% at 50% 50%, hsl(141 76% 48% / 0.10) 0%, transparent 70%)",
        }}
      />

      <div className="relative flex flex-col items-center gap-6">
        <div className="animate-nx-logo-pulse">
          <NexEngineLogo variant="mark" size={64} />
        </div>

        <div className="relative h-[3px] w-40 overflow-hidden rounded-full bg-elevated">
          <div
            className={cn(
              "absolute inset-y-0 left-0 w-full origin-left rounded-full",
              "bg-gradient-to-r from-transparent via-primary to-transparent",
              "animate-nx-indeterminate",
            )}
            style={{ boxShadow: "0 0 6px hsl(var(--primary) / 0.5)" }}
          />
        </div>
      </div>

      <span className="sr-only">Carregando...</span>
    </div>
  );
}
