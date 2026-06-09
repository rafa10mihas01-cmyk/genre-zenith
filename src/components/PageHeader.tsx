import { cn } from "@/lib/utils";
import { ElementType, ReactNode } from "react";
import { PageManual } from "@/components/PageManual";


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
export type PageDomain =
  | "clients" | "curators" | "campaigns" | "deals"
  | "community" | "playlists" | "system";

export interface PageHeaderProps {
  title: string;
  subtitle: string;
  kicker?: string;
  icon?: ElementType;
  actions?: ReactNode;
  /** Cor de domínio: barra à esquerda do título + ícone do kicker tingido. */
  domain?: PageDomain;
  /**
   * Chave do manual contextual desta página (ver src/content/pageManuals.ts).
   * Quando definida, mostra um botão "?" ao lado do título que abre um
   * painel lateral com o manual.
   */
  manualKey?: string;
  className?: string;
}


export function PageHeader({
  title,
  subtitle,
  kicker,
  icon: Icon,
  actions,
  domain,
  manualKey,
  className,
}: PageHeaderProps) {

  const domainColor = domain ? `hsl(var(--domain-${domain}))` : undefined;
  return (
    <div className="h-[88px] shrink-0 lg:h-[120px] -mt-4 md:-mt-6 lg:-mt-8 -mb-4 md:-mb-5 lg:-mb-6">
      <header
        style={{
          // Mobile: ancora o PageHeader logo abaixo do topbar global,
          // respeitando a safe-area (notch) que infla o topbar no iOS.
          ["--nx-topbar-h" as string]: "calc(3.5rem + env(safe-area-inset-top, 0px))",
        }}
        className={cn(
          "flex",
          "max-lg:fixed max-lg:top-[var(--nx-topbar-h)] max-lg:left-0 max-lg:right-0 max-lg:z-40 max-lg:h-[88px] max-lg:px-2 md:max-lg:px-3 max-lg:pt-4 max-lg:pb-2",
          "max-lg:bg-background/90 max-lg:backdrop-blur-md max-lg:supports-[backdrop-filter]:bg-background/75",
          "lg:fixed lg:top-14 lg:left-[var(--sidebar-width)] lg:right-0 lg:z-40 lg:h-[120px] lg:px-4 lg:pt-7 lg:pb-4 lg:bg-background",
          "peer-data-[state=collapsed]:lg:left-[var(--sidebar-width-icon)]",
          "border-b border-border/60",
          "flex-row items-center justify-between gap-3 md:gap-4 w-auto min-w-0 overflow-hidden",
          className,
        )}
      >
        {/* Barra colorida de domínio (3px, full height do header).
            Opacidade baixa pra acentuar sem roubar a cena. */}
        {domainColor && (
          <span
            aria-hidden
            className="absolute left-0 top-0 bottom-0 w-[3px] opacity-40"
            style={{ backgroundColor: domainColor }}
          />
        )}
        <div className="space-y-1 min-w-0 flex-1 overflow-hidden">
          {kicker && (
            <div className="hidden lg:inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-bold">
              {Icon && (
                <Icon
                  className={cn("h-3 w-3", !domainColor && "text-primary")}
                  style={domainColor ? { color: domainColor } : undefined}
                />
              )}
              {kicker}
            </div>
          )}
          <div className="flex items-center gap-1.5 min-w-0">
            <h1 className="text-[19px] sm:text-2xl lg:text-3xl font-semibold tracking-tight leading-tight truncate min-w-0">
              {title}
            </h1>
            {manualKey && (
              <PageManual manualKey={manualKey} accentColor={domainColor} />
            )}
          </div>
          <p className="block text-[12px] lg:text-sm text-muted-foreground max-w-2xl truncate lg:whitespace-normal">{subtitle}</p>

        </div>
        {actions && (
          <div
            className={cn(
              "flex items-center justify-end gap-2 shrink-0 min-w-0 max-w-[58%] overflow-x-auto overflow-y-hidden scrollbar-none",
              "lg:max-w-none lg:overflow-visible lg:flex-wrap lg:flex-nowrap",
              "max-lg:[&_button]:max-w-[56vw] max-lg:[&_button]:overflow-hidden max-lg:[&_button]:text-ellipsis",
              "[&_button]:h-9 [&_button]:px-3 [&_button]:text-[13px] sm:[&_button]:px-4 sm:[&_button]:text-sm [&_button]:shrink-0",
            )}
          >
            {actions}
          </div>
        )}
      </header>
    </div>
  );
}
