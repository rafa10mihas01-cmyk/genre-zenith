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
    <div className="max-xl:h-[57px] max-xl:shrink-0 xl:contents">
      <header
        className={cn(
          "flex",
          "max-xl:fixed max-xl:top-14 max-xl:left-0 max-xl:right-0 max-xl:z-40 max-xl:h-[57px] max-xl:px-4 max-xl:py-0",
          "xl:sticky xl:top-0 xl:z-40 xl:-mt-8 xl:-mx-6 xl:px-6 xl:py-3",
          "bg-background/90 backdrop-blur-md supports-[backdrop-filter]:bg-background/75",
          "border-b border-border/60",
          "flex-row items-center justify-between gap-3 md:gap-4 w-auto min-w-0 overflow-hidden",
          className,
        )}
      >
        <div className="space-y-1 min-w-0 flex-1 overflow-hidden">
          {kicker && (
            <div className="hidden xl:inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-bold">
              {Icon && <Icon className="h-3 w-3 text-primary" />}
              {kicker}
            </div>
          )}
          <h1 className="text-[19px] sm:text-2xl xl:text-3xl font-semibold tracking-tight leading-tight truncate min-w-0">
            {title}
          </h1>
          <p className="hidden xl:block text-sm text-muted-foreground max-w-2xl">{subtitle}</p>
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
    </div>
  );
}
