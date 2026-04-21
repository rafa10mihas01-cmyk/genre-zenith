import { cn } from "@/lib/utils";

/**
 * NexEngine logomark — "N" angular italicizado com linhas de velocidade.
 * Geometria limpa: duas pernas inclinadas + diagonal central + 3 speed lines.
 */
export function NexEngineLogo({
  className,
  size = 40,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-label="NexEngine"
    >
      {/* Linhas de velocidade à esquerda — 3 traços, do mais curto ao mais longo */}
      <rect x="2"  y="32" width="22" height="6" fill="hsl(var(--primary))" />
      <rect x="0"  y="48" width="30" height="6" fill="hsl(var(--primary))" />
      <rect x="6"  y="64" width="20" height="6" fill="hsl(var(--primary))" />

      {/* Perna esquerda do N (italicizada — inclinada para a direita) */}
      <polygon
        points="44,90 56,90 70,10 58,10"
        fill="hsl(var(--primary))"
      />

      {/* Diagonal central do N (do topo-esquerdo ao base-direito) */}
      <polygon
        points="58,10 72,10 104,90 90,90"
        fill="hsl(var(--primary))"
      />

      {/* Perna direita do N (italicizada) */}
      <polygon
        points="92,90 104,90 118,10 106,10"
        fill="hsl(var(--primary))"
      />
    </svg>
  );
}
