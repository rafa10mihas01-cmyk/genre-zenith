import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Padrão: verde "soft" — sinaliza ação sem dominar a tela.
        // É o que deve ser usado em 90% dos CTAs.
        default:
          "bg-primary/12 text-primary border border-primary/30 hover:bg-primary/18 hover:border-primary/50 active:bg-primary/15",
        // Verde sólido — usar SOMENTE em ações raras, críticas, de submit final
        // (ex: "Confirmar pagamento", "Fechar deal"). Não usar em listas/cards.
        solid:
          "bg-primary/90 text-primary-foreground shadow-sm hover:bg-primary active:bg-primary/95",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        // Alias mantido para compatibilidade — equivale ao default soft.
        soft:
          "bg-primary/12 text-primary border border-primary/30 hover:bg-primary/18 hover:border-primary/50",
        premium:
          "bg-[hsl(var(--elevated))] text-foreground border border-primary/25 shadow-sm transition-all duration-200 hover:border-primary/45 hover:text-primary hover:bg-[hsl(var(--elevated))]/80",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
