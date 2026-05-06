import { cn } from "@/lib/utils";
import { ReactNode } from "react";

/**
 * PageHeader — padrão GLOBAL e OBRIGATÓRIO de cabeçalho de página.
 *
 * Regras (não-negociáveis):
 *  - title    = O QUE é a página (substantivo, direto, sem emojis, sem saudações)
 *  - subtitle = O QUE o usuário FAZ nela (verbo no infinitivo / função objetiva)
 *  - kicker   = nome curto do módulo (caps, opcional). Ex: "Módulo de Operação"
 *  - actions  = botões/ações primárias da página (alinhadas à direita)
 *
 * Mobile:
 *  - Mantém título + ações visíveis; o título trunca antes de empurrar botões.
 *  - Subtítulo fica oculto para preservar altura e área útil.
 *  - Ações mantêm shrink-0 e scroll horizontal interno se houver muitas ações.
 *
 * Proibido: emojis, "Bom dia/Olá", linguagem emocional, variações de estilo.
 *
 * Toda página NOVA e EXISTENTE deve usar este componente.
 */
export interface PageHeaderProps {
  title: string;
  subtitle: string;
  kicker?: string;
  icon?: any;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  subtitle,
  kicker,
  icon: Icon,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex",
        "sticky top-0 z-40 -mx-4 md:-mx-6 lg:-mx-8 px-4 md:px-6 lg:px-8 py-4 md:py-3",
        "bg-background/90 backdrop-blur-md supports-[backdrop-filter]:bg-background/75",
        "border-b border-border/60",
        "flex-row items-center justify-between gap-3 md:gap-4 mb-3 md:mb-4 w-full min-w-0 overflow-hidden",
        className,
      )}
    >
      <div className="space-y-1 min-w-0 flex-1 overflow-hidden">
        {kicker && (
          <div className="hidden md:inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-bold">
            {Icon && <Icon className="h-3 w-3 text-primary" />}
            {kicker}
          </div>
        )}
        <h1 className="text-[19px] sm:text-3xl md:text-3xl font-semibold tracking-tight leading-tight truncate min-w-0">
          {title}
        </h1>
        <p className="hidden md:block text-sm text-muted-foreground max-w-2xl">{subtitle}</p>
      </div>
      {actions && (
        <div
          className={cn(
            "flex items-center justify-end gap-2 shrink-0 min-w-0 max-w-[56%] overflow-x-auto scrollbar-none",
            "md:max-w-none md:overflow-visible md:flex-wrap md:flex-nowrap",
            "[&>*]:h-9 [&>*]:px-3 [&>*]:text-[13px] sm:[&>*]:px-4 sm:[&>*]:text-sm [&>*]:shrink-0",
          )}
        >
          {actions}
        </div>
      )}
    </header>
  );
}
