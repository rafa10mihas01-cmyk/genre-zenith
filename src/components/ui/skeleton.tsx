import { cn } from "@/lib/utils";

/**
 * Skeleton — placeholder de carregamento.
 *
 * Fade-in com atraso de 250ms: se os dados chegarem antes (caso comum),
 * o esqueleto nunca aparece, evitando o "flash de card vazio" que dava
 * sensação de bug em todas as páginas.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("skeleton-fade rounded-md bg-muted", className)}
      {...props}
    />
  );
}

export { Skeleton };
