import { cn } from "@/lib/utils";

/**
 * NexEngine logomark — "N" angular/agressivo com linhas de velocidade à esquerda.
 * Construído como SVG para escalar perfeitamente em qualquer tamanho.
 *
 * Estrutura (referência oficial):
 *  - 3 linhas de velocidade horizontais à esquerda (curtas, médias, longas)
 *  - Perna esquerda do "N" (diagonal vertical inclinada)
 *  - Diagonal central conectando topo-esquerdo a base-direita
 *  - Perna direita do "N" com seta/ponta superior agressiva
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
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-label="NexEngine"
    >
      {/* Linhas de velocidade à esquerda */}
      <path
        d="M2 38 L26 38"
        stroke="hsl(var(--primary))"
        strokeWidth="6"
        strokeLinecap="square"
      />
      <path
        d="M8 52 L30 52"
        stroke="hsl(var(--primary))"
        strokeWidth="6"
        strokeLinecap="square"
      />
      <path
        d="M2 66 L26 66"
        stroke="hsl(var(--primary))"
        strokeWidth="6"
        strokeLinecap="square"
      />

      {/* "N" angular — preenchido para parecer agressivo/sólido */}
      {/* Perna esquerda do N */}
      <path
        d="M34 88 L34 22 L48 22 L48 60 L34 60 Z"
        fill="hsl(var(--primary))"
      />
      {/* Diagonal central (topo-esq → base-dir) */}
      <path
        d="M40 22 L58 22 L78 88 L60 88 Z"
        fill="hsl(var(--primary))"
      />
      {/* Perna direita com ponta de seta no topo */}
      <path
        d="M66 88 L66 40 L52 12 L80 12 L80 88 Z"
        fill="hsl(var(--primary))"
      />
    </svg>
  );
}
