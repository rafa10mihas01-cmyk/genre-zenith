import { useLoading } from "@/contexts/LoadingContext";
import { NexEngineLogo } from "@/components/NexEngineLogo";
import { cn } from "@/lib/utils";

/**
 * Splash full-screen com logo "N" centralizado + barra animada embaixo.
 * Aparece na primeira carga do app e em toda troca de rota (mín. 600ms).
 *
 * Visual: fundo escuro sólido (sem distração), logo com pulse suave,
 * barra fina indeterminada logo abaixo. Some com fade rápido.
 */
export function SplashLoader() {
  const { isSplashing } = useLoading();

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
        {/* Logo N com pulse */}
        <div className="animate-nx-logo-pulse">
          <NexEngineLogo variant="mark" size={64} />
        </div>

        {/* Barra indeterminada — 160px de largura, 3px alta, rounded */}
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
