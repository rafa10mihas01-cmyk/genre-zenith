import { cn } from "@/lib/utils";
import { ReactNode } from "react";

/**
 * PageContainer — wrapper padrão de TODAS as páginas internas.
 *
 * Regras:
 *  - Largura total disponível (sem max-w artificial). O AppLayout já controla
 *    o padding lateral; aqui não adicionamos nenhum.
 *  - Espaçamento vertical consistente (space-y-6) igual ao Cérebro.
 *  - `w-full` explícito para evitar colapso em flex/grid pais.
 *
 * NÃO usar `max-w-[Xpx] mx-auto` em páginas — usar este componente.
 */
export function PageContainer({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "w-full space-y-6 pb-6",
        className,
      )}
    >
      {children}
    </div>
  );
}
