import { NexEngineLogo } from "@/components/NexEngineLogo";
import { cn } from "@/lib/utils";

/**
 * Loader full-screen com logo "N" + barra indeterminada.
 * Mesma identidade visual do SplashLoader, mas usado direto em páginas
 * (sem depender do contexto global). Para telas de carregamento inicial
 * de páginas públicas (curador, cliente, membro).
 */
export function PageLoader({ className }: { className?: string }) {
  return (
    <div
      role="status"
      className={cn(
        "min-h-screen w-full flex flex-col items-center justify-center bg-background relative",
        className,
      )}
    >
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
