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
        "flex items-end justify-between gap-4 flex-wrap",
        className,
      )}
    >
      <div className="space-y-1 min-w-0">
        {kicker && (
          <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-bold">
            {Icon && <Icon className="h-3 w-3 text-primary" />}
            {kicker}
          </div>
        )}
        <h1 className="text-3xl font-bold tracking-tight leading-tight">
          {title}
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">{subtitle}</p>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
