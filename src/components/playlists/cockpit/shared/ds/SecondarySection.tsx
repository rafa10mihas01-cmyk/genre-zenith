// SecondarySection — bloco colapsável padrão para a área secundária da aba (Fase 7D / D1).
// Mantém peso visual baixo: hairline border, padding compacto, chevron sutil.
import { ReactNode } from "react";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";

export function SecondarySection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="border border-border/60 rounded-xl">
      <CollapsibleTrigger className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left group">
        <span className="text-[11px] uppercase tracking-[0.2em] font-semibold text-muted-foreground group-hover:text-foreground transition-colors">
          {title}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-4 pb-4 pt-1">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
