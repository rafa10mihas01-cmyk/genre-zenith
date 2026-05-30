import { useState } from "react";
import { Clock, RefreshCcw, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Props = {
  dealState: string | null;
  baselineCapturedAt: string | null;
  dealId: string | null;
};

/**
 * Banner exibido na tela de execução enquanto o deal está em "awaiting_baseline".
 * O bot precisa tirar a 1ª foto do Spotify for Artists antes da campanha ativar.
 * Enquanto isso o curador NÃO recebe o link — não tem o que mandar pra ele.
 */
export function BaselineAwaitingBanner({ dealState, baselineCapturedAt, dealId }: Props) {
  const [retrying, setRetrying] = useState(false);

  if (!dealState) return null;

  // Baseline já chegou: mostra confirmação compacta (só nos primeiros minutos depois)
  if (baselineCapturedAt) {
    const captured = new Date(baselineCapturedAt);
    const ageMin = (Date.now() - captured.getTime()) / 60_000;
    if (ageMin > 60) return null; // depois de 1h some, ficou velho
    return (
      <div className="rounded-2xl border border-primary/30 bg-primary/5 px-5 py-3 flex items-center gap-3">
        <CheckCircle2 className="h-5 w-5 text-primary" />
        <div className="flex-1 text-sm">
          <span className="font-medium text-foreground">Baseline capturada — campanha ativada.</span>
          <span className="text-muted-foreground ml-2">
            {captured.toLocaleString("pt-BR")}. Agora pode mandar o link pro curador.
          </span>
        </div>
      </div>
    );
  }

  if (dealState !== "awaiting_baseline") return null;

  async function retry() {
    if (!dealId) return;
    setRetrying(true);
    try {
      const { error } = await supabase.functions.invoke("bot-collect-queue", {
        body: { deal_id: dealId, priority: "baseline" },
      });
      if (error) throw error;
      toast.success("Baseline reenfileirada. Aguarde o robô.");
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao reexecutar baseline");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-5 py-4 flex items-start gap-4">
      <Clock className="h-5 w-5 text-amber-400 mt-0.5 shrink-0" />
      <div className="flex-1 space-y-1">
        <div className="text-sm font-medium text-foreground">
          Aguardando bot capturar baseline
        </div>
        <div className="text-xs text-muted-foreground leading-relaxed">
          O robô vai abrir o Spotify for Artists e tirar a foto inicial das playlists que
          já tocam essa música. A campanha ativa automaticamente quando a foto chegar.
          Só depois disso você manda o link pro curador.
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={retry}
        disabled={retrying}
        className="shrink-0"
      >
        <RefreshCcw className={`h-3.5 w-3.5 mr-2 ${retrying ? "animate-spin" : ""}`} />
        Reexecutar
      </Button>
    </div>
  );
}
