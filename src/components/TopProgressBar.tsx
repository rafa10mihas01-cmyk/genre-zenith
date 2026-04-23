import { useLoading } from "@/contexts/LoadingContext";
import { cn } from "@/lib/utils";

/**
 * Barra fina (2px) no TOPO absoluto da viewport, padrão YouTube/Linear/Vercel.
 * - Visível enquanto há qualquer tarefa global em andamento (isLoading) OU splash ativo.
 * - z-index altíssimo para ficar acima de TUDO (modal, sidebar, etc).
 * - Verde Spotify, com glow sutil.
 * - Animação indeterminada (faixa que desliza em loop).
 */
export function TopProgressBar() {
  const { isLoading, isSplashing } = useLoading();
  const active = isLoading || isSplashing;

  return (
    <div
      aria-hidden={!active}
      className={cn(
        "fixed top-0 left-0 right-0 h-[2px] z-[100] pointer-events-none",
        "transition-opacity duration-200",
        active ? "opacity-100" : "opacity-0",
      )}
    >
      {/* Trilho transparente */}
      <div className="relative h-full w-full overflow-hidden">
        {/* Faixa que desliza em loop */}
        <div
          className={cn(
            "absolute inset-y-0 left-0 w-full origin-left",
            "bg-gradient-to-r from-transparent via-primary to-transparent",
            "animate-nx-indeterminate",
          )}
          style={{
            boxShadow: "0 0 8px hsl(var(--primary) / 0.6)",
          }}
        />
      </div>
    </div>
  );
}
