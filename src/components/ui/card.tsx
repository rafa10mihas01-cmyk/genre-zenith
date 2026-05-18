import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Card padronizado do NexEngine.
 *
 * Padding interno e radius alinhados ao .nx-card global:
 *   - Padding: 16px (mobile) → 20px (md+)
 *   - Radius:  16px (rounded-2xl)
 *   - Border:  hairline (rgba branco 4%)
 *   - Sombra:  --shadow-soft
 *
 * Estrutura interna padrão:
 *   <Card>
 *     <CardHeader>     ← ícone + título + descrição
 *       <CardTitle />
 *       <CardDescription />
 *     </CardHeader>
 *     <CardContent />  ← conteúdo principal (números, listas, etc)
 *     <CardFooter />   ← ações
 *   </Card>
 *
 * Todos os slots usam o MESMO padding horizontal/vertical do card,
 * garantindo que TODOS os elementos internos fiquem no mesmo eixo
 * vertical em qualquer card do sistema.
 */
const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      // Alinhado ao .nx-card global (mesmo gradiente, sombra e borda).
      // Assim todo <Card/> shadcn fica indistinguível de um .nx-card.
      "nx-card",
      // text-card-foreground preservado pra compatibilidade com slots internos
      "text-card-foreground",
      className,
    )}
    {...props}
  />
));
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-col gap-1.5",
        "p-4 md:p-5",
        className,
      )}
      {...props}
    />
  ),
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn(
        "text-base font-semibold leading-tight tracking-tight",
        className,
      )}
      {...props}
    />
  ),
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-muted-foreground leading-snug", className)} {...props} />
  ),
);
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("p-4 md:p-5 pt-0 md:pt-0", className)}
      {...props}
    />
  ),
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex items-center p-4 md:p-5 pt-0 md:pt-0", className)}
      {...props}
    />
  ),
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
