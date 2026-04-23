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
 *  - Header fica STICKY logo abaixo do topbar global (top-14 = 56px).
 *  - Subtítulo escondido (já temos título dinâmico no topbar).
 *  - Ações deslizam horizontalmente (scroll-x) — nada corta na borda direita.
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
        // Mobile: sticky logo abaixo do topbar (h-14). Background sólido para
        // não vazar conteúdo por baixo durante o scroll.
        "sticky top-14 z-20 -mx-4 md:mx-0 px-4 md:px-0 py-2 md:py-0",
        "bg-background/95 backdrop-blur md:bg-transparent md:backdrop-blur-none",
        "border-b border-border md:border-0",
        // Layout: stack no mobile (título em cima, ações em scroll embaixo)
        "flex flex-col md:flex-row md:items-end md:justify-between gap-2 md:gap-4 mb-2 w-full min-w-0",
        className,
      )}
    >
      <div className="space-y-1 min-w-0 flex-1">
        {kicker && (
          <div className="hidden md:inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-bold">
            {Icon && <Icon className="h-3 w-3 text-primary" />}
            {kicker}
          </div>
        )}
        <h1 className="text-lg md:text-3xl font-semibold tracking-tight leading-tight break-words">
          {title}
        </h1>
        <p className="hidden md:block text-sm text-muted-foreground max-w-2xl">{subtitle}</p>
      </div>
      {actions && (
        <div
          className={cn(
            // Mobile: scroll horizontal sem barra → nenhuma ação some na borda
            "flex items-center gap-2 -mx-4 px-4 md:mx-0 md:px-0",
            "overflow-x-auto md:overflow-visible md:flex-wrap md:flex-nowrap md:shrink-0",
            "[&::-webkit-scrollbar]:hidden [scrollbar-width:none]",
            // Garante que cada filho não encolha e mantém o ritmo dos botões
            "[&>*]:shrink-0",
          )}
        >
          {actions}
        </div>
      )}
    </header>
  );
}
