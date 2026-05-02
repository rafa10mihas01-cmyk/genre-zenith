import { Check, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DraftBannerProps {
  onRestore: () => void;
  onDiscard: () => void;
  className?: string;
}

/** Banner exibido no topo do form quando existe rascunho não restaurado. */
export function DraftBanner({ onRestore, onDiscard, className }: DraftBannerProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-primary/30 bg-primary/5 p-3 flex items-center justify-between gap-3",
        className,
      )}
    >
      <div className="text-xs">
        <div className="font-medium text-foreground">Rascunho não salvo</div>
        <div className="text-muted-foreground">
          Você tem informações de uma sessão anterior. Continuar ou descartar?
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive"
          onClick={onDiscard}
        >
          <Trash2 className="h-3 w-3" />
          Descartar
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={onRestore}
        >
          <RotateCcw className="h-3 w-3" />
          Continuar
        </Button>
      </div>
    </div>
  );
}

interface DraftIndicatorProps {
  lastSavedAt: number | null;
  className?: string;
}

/** Pequeno indicador "Rascunho salvo" exibido junto ao header do form. */
export function DraftIndicator({ lastSavedAt, className }: DraftIndicatorProps) {
  if (!lastSavedAt) return null;
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 text-[10px] text-muted-foreground",
        className,
      )}
      title={`Salvo em ${new Date(lastSavedAt).toLocaleTimeString("pt-BR")}`}
    >
      <Check className="h-2.5 w-2.5 text-primary" />
      Rascunho salvo
    </div>
  );
}
