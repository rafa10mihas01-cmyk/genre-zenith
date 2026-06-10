/**
 * FormModal — padrão único de modal do sistema.
 *
 * Estrutura:
 *   [header fixo: ícone + título + descrição + botão fechar]
 *   [abas opcionais]
 *   [conteúdo scrollável: max-h-[70vh]]
 *   [footer fixo: ações alinhadas à direita]
 *
 * Uso:
 *   <FormModal
 *     open={open}
 *     onOpenChange={setOpen}
 *     icon={<Users className="h-4 w-4" />}
 *     iconTone="clientes"
 *     title="Novo cliente"
 *     description="Ficha completa do contratante."
 *     size="md"
 *     footer={
 *       <>
 *         <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
 *         <Button onClick={onSubmit}>Criar cliente</Button>
 *       </>
 *     }
 *   >
 *     <FormGrid>
 *       <FormField label="Nome" required>
 *         <Input ... />
 *       </FormField>
 *       <FormField label="Tipo">
 *         <Select ... />
 *       </FormField>
 *     </FormGrid>
 *   </FormModal>
 *
 * Regras:
 *  - Header não scrolla. Footer não scrolla. Apenas o miolo.
 *  - Botão primário sempre à direita, "Cancelar" à esquerda dele.
 *  - Labels SEMPRE acima do input.
 *  - Use `iconTone` pra cor de domínio (sutil, só no ring/bg do ícone).
 *  - NÃO mude lógica de negócio ao migrar um modal — apenas a apresentação.
 */

import * as React from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { cn } from "@/lib/utils";

export type FormModalSize = "sm" | "md" | "lg" | "xl";

export type FormModalTone =
  | "default"
  | "clientes"
  | "curadores"
  | "campanhas"
  | "deals"
  | "comunidade"
  | "playlists"
  | "sistema";

const SIZE_CLASSES: Record<FormModalSize, string> = {
  sm: "sm:max-w-[420px]",
  md: "sm:max-w-[560px]",
  lg: "sm:max-w-[760px]",
  xl: "sm:max-w-[960px]",
};

const TONE_CLASSES: Record<FormModalTone, string> = {
  default: "bg-primary/10 text-primary ring-primary/20",
  clientes: "bg-[hsl(217_91%_60%/0.12)] text-[hsl(217_91%_70%)] ring-[hsl(217_91%_60%/0.25)]",
  curadores: "bg-[hsl(270_70%_60%/0.12)] text-[hsl(270_70%_75%)] ring-[hsl(270_70%_60%/0.25)]",
  campanhas: "bg-[hsl(38_92%_55%/0.12)] text-[hsl(38_92%_65%)] ring-[hsl(38_92%_55%/0.25)]",
  deals: "bg-primary/10 text-primary ring-primary/25",
  comunidade: "bg-[hsl(330_80%_62%/0.12)] text-[hsl(330_80%_72%)] ring-[hsl(330_80%_62%/0.25)]",
  playlists: "bg-[hsl(215_25%_55%/0.14)] text-[hsl(215_25%_75%)] ring-[hsl(215_25%_55%/0.25)]",
  sistema: "bg-muted text-muted-foreground ring-border",
};

export interface FormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  iconTone?: FormModalTone;
  size?: FormModalSize;
  /** Conteúdo opcional renderizado entre header e o miolo scrollável (ex: abas). */
  topSlot?: React.ReactNode;
  /** Botões de ação. Já vêm alinhados à direita com gap. */
  footer?: React.ReactNode;
  /** Esconde visualmente o título (mantém acessibilidade). */
  hideHeader?: boolean;
  /** Impede fechar (esc/overlay/x). Útil durante submit. */
  preventClose?: boolean;
  /** Classe extra no DialogContent. */
  className?: string;
  /** Classe extra no miolo scrollável. */
  bodyClassName?: string;
  children?: React.ReactNode;
}

export function FormModal({
  open,
  onOpenChange,
  title,
  description,
  icon,
  iconTone = "default",
  size = "md",
  topSlot,
  footer,
  hideHeader,
  preventClose,
  className,
  bodyClassName,
  children,
}: FormModalProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (preventClose && !next) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        onInteractOutside={(e) => {
          if (preventClose) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (preventClose) e.preventDefault();
        }}
        className={cn(
          "p-0 gap-0 overflow-hidden border-border/60 bg-card",
          "max-h-[92dvh] flex flex-col",
          SIZE_CLASSES[size],
          className,
        )}
      >
        {hideHeader ? (
          <VisuallyHidden.Root>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </VisuallyHidden.Root>
        ) : (
          <header className="flex items-start gap-3 px-5 py-4 border-b border-border/60 bg-card">
            {icon ? (
              <span
                className={cn(
                  "shrink-0 h-9 w-9 rounded-lg grid place-items-center ring-1",
                  TONE_CLASSES[iconTone],
                )}
                aria-hidden="true"
              >
                {icon}
              </span>
            ) : null}
            <div className="min-w-0 flex-1 pr-8">
              <DialogTitle className="text-base font-semibold leading-tight text-foreground">
                {title}
              </DialogTitle>
              {description ? (
                <DialogDescription className="mt-1 text-[13px] leading-snug text-muted-foreground">
                  {description}
                </DialogDescription>
              ) : null}
            </div>
          </header>
        )}

        {topSlot ? <div className="border-b border-border/60 bg-card">{topSlot}</div> : null}

        <div
          className={cn(
            "flex-1 overflow-y-auto px-6 py-5",
            bodyClassName,
          )}
        >
          {children}
        </div>

        {footer ? (
          <footer className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border/60 bg-card">
            {footer}
          </footer>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers de layout interno (opcionais — usar quando fizer sentido) */
/* ------------------------------------------------------------------ */

export function FormGrid({
  children,
  cols = 2,
  className,
}: {
  children: React.ReactNode;
  cols?: 1 | 2 | 3;
  className?: string;
}) {
  const colsClass =
    cols === 1
      ? "grid-cols-1"
      : cols === 2
        ? "grid-cols-1 sm:grid-cols-2"
        : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
  return <div className={cn("grid gap-4", colsClass, className)}>{children}</div>;
}

export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      {title ? (
        <header className="space-y-0.5">
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
            {title}
          </h3>
          {description ? (
            <p className="text-[12px] text-muted-foreground/80">{description}</p>
          ) : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export interface FormFieldProps {
  label?: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  className?: string;
  /** Se true ocupa 2 colunas dentro de FormGrid cols=2. */
  span?: 1 | 2 | "full";
  children: React.ReactNode;
}

export function FormField({
  label,
  htmlFor,
  required,
  hint,
  error,
  span = 1,
  className,
  children,
}: FormFieldProps) {
  const spanClass =
    span === "full" || span === 2 ? "sm:col-span-2" : "";
  return (
    <div className={cn("flex flex-col gap-1.5", spanClass, className)}>
      {label ? (
        <label
          htmlFor={htmlFor}
          className="text-[12px] font-medium text-foreground"
        >
          {label}
          {required ? <span className="text-primary ml-0.5">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="text-[11px] text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-muted-foreground/80">{hint}</p>
      ) : null}
    </div>
  );
}
