import { BookOpen, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { PAGE_MANUALS, type PageManualData } from "@/content/pageManuals";
import { cn } from "@/lib/utils";

/**
 * PageManual — botão de ajuda contextual (ícone "?") ao lado do título da página.
 *
 * Renderiza um botão discreto que, ao ser clicado, abre um painel lateral
 * (Sheet) com o manual da página: o que ela é, como usar, como NÃO usar.
 *
 * Uso (via PageHeader):
 *   <PageHeader title="..." subtitle="..." manualKey="clientes" />
 *
 * O conteúdo vive em src/content/pageManuals.ts — uma chave por página.
 * Se a chave não existir, o botão simplesmente não é renderizado.
 */

export interface PageManualProps {
  manualKey: string;
  /** Cor de domínio opcional pro accent do ícone. */
  accentColor?: string;
  className?: string;
}

export function PageManual({ manualKey, accentColor, className }: PageManualProps) {
  const manual = PAGE_MANUALS[manualKey];
  if (!manual) return null;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "h-7 w-7 shrink-0 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60",
            className,
          )}
          aria-label={`Abrir manual: ${manual.title}`}
          title="Manual desta página"
        >
          <HelpCircle className="h-4 w-4" />
        </Button>
      </SheetTrigger>

      <SheetContent
        side="right"
        className="w-full sm:max-w-md p-0 flex flex-col gap-0 bg-card border-l border-border"
      >
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border space-y-2 text-left">
          <SheetTitle className="flex items-center gap-2.5 text-base font-semibold">
            <BookOpen
              className="h-4 w-4 shrink-0"
              style={accentColor ? { color: accentColor } : undefined}
            />
            <span className="truncate">{manual.title}</span>
          </SheetTitle>
          <SheetDescription className="text-[13px] leading-relaxed text-muted-foreground">
            {manual.subtitle}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {manual.sections.map((section, i) => (
            <ManualSectionBlock key={i} heading={section.heading} body={section.body} />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ManualSectionBlock({
  heading,
  body,
}: {
  heading: string;
  body: string | string[];
}) {
  const items = Array.isArray(body) ? body : [body];
  return (
    <section className="space-y-2">
      <h3 className="text-[13px] font-semibold text-foreground tracking-tight">
        {heading}
      </h3>
      <div className="space-y-2 text-[13px] leading-relaxed text-muted-foreground">
        {items.map((line, idx) => {
          const trimmed = line.trim();
          const isBullet = trimmed.startsWith("• ") || trimmed.startsWith("- ");
          if (isBullet) {
            return (
              <p key={idx} className="pl-1">
                {trimmed.replace(/^[-•]\s*/, "• ")}
              </p>
            );
          }
          return <p key={idx}>{line}</p>;
        })}
      </div>
    </section>
  );
}
