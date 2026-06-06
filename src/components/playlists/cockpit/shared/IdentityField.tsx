import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export function IdentityField({ label, field, managedId, current, suggestion, score, onApplied }: {
  label: string;
  field: "name" | "description";
  managedId: string;
  current: string;
  suggestion: string | null;
  score?: number | null;
  onApplied?: () => void;
}) {
  const [applying, setApplying] = useState(false);
  const hasSugg = !!suggestion && suggestion.trim() !== current.trim();

  async function apply() {
    if (!suggestion) return;
    setApplying(true);
    try {
      const { data, error } = await supabase.functions.invoke("apply-playlist-identity", {
        body: { playlist_id: managedId, [field]: suggestion },
      });
      let serverError: string | null = null;
      let status: number | null = null;
      if (error && (error as any).context) {
        try {
          const ctx = (error as any).context as Response;
          status = ctx.status ?? null;
          const b = await ctx.clone().json().catch(() => null);
          serverError = b?.error ?? null;
        } catch { /* */ }
      }
      if (error || data?.ok === false) {
        toast({
          title: status ? `Erro ${status}` : "Falha ao aplicar",
          description: serverError ?? data?.error ?? error?.message ?? "erro desconhecido",
          variant: "destructive",
        });
        return;
      }
      toast({ title: `${label} atualizado no Spotify` });
      onApplied?.();
    } finally {
      setApplying(false);
    }
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</span>
        {score != null && (
          <span
            title="SEO — quanto o nome combina com termos do nicho"
            className={cn(
              "text-xs font-semibold tabular-nums cursor-help",
              score >= 60 ? "text-primary" : score >= 30 ? "text-warning" : "text-destructive",
            )}
          >{score}/100</span>
        )}
      </div>
      <div className="space-y-2">
        <div>
          <div className="text-[10px] text-muted-foreground mb-1">Atual</div>
          <div className="text-sm bg-elevated/60 rounded-md px-3 py-2 text-foreground/80">{current || "— vazio —"}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-primary" /> Sugestão da IA
          </div>
          <div className={cn(
            "text-sm rounded-md px-3 py-2",
            hasSugg ? "bg-primary/10 border border-primary/30 text-foreground" : "bg-elevated/40 text-muted-foreground italic",
          )}>
            {suggestion || "sem ajuste sugerido"}
          </div>
        </div>
      </div>
      {hasSugg && (
        <div className="flex justify-between items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              navigator.clipboard.writeText(suggestion!);
              toast({ title: "Copiado", description: "Cole onde quiser." });
            }}
            className="h-7 text-xs text-muted-foreground gap-1"
          >
            Copiar
          </Button>
          <Button
            size="sm"
            onClick={apply}
            disabled={applying}
            className="gap-1.5 h-7"
          >
            {applying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            Aplicar no Spotify
          </Button>
        </div>
      )}
    </Card>
  );
}
