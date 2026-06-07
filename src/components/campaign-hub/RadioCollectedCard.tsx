import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Radio } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL, formatInt } from "@/lib/campaignEngine";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

type RadioRow = {
  campaign_id: string;
  start_plays_7d: number | null;
  start_captured_at: string | null;
  current_plays_7d: number;
  last_captured_at: string;
  radio_delta: number;
};

type Props = {
  campaignId: string;
  /** CPP do Ecossistema próprio — Rádio herda esta tarifa. */
  cppEco?: number;
  /** Mantido p/ compat. Não usado: Rádio agora compara com baseline da campanha. */
  metaPlanned?: number;
};

/**
 * Rádio Spotify — baseline ancorada na ativação da campanha.
 *
 * Pergunta que responde: "Quando a campanha começou, a Rádio estava em X.
 * Hoje está em Y. Logo a Rádio entregou (Y − X) plays pra essa campanha."
 *
 * Custo: herda o mesmo CPP do Ecossistema (sem CPP próprio).
 */
export function RadioCollectedCard({ campaignId, cppEco = 0 }: Props) {
  const [data, setData] = useState<RadioRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data: rows } = await (supabase as any)
        .from("campaign_radio_collected")
        .select("*")
        .eq("campaign_id", campaignId)
        .maybeSingle();
      if (!active) return;
      setData((rows as RadioRow | null) ?? null);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [campaignId]);

  if (loading || !data) return null;

  const start = data.start_plays_7d ?? null;
  const current = data.current_plays_7d ?? 0;
  const delta = Math.max(0, data.radio_delta ?? 0);
  const custoRadio = cppEco > 0 ? delta * cppEco : 0;

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center">
              <Radio className="h-3.5 w-3.5 text-primary" />
            </div>
            <div>
              <div className="text-sm font-semibold leading-none">Rádio Spotify</div>
              <div className="text-[11px] text-muted-foreground mt-1">
                Entrega desde o início da campanha · janela 7d
              </div>
            </div>
          </div>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            atualizado há {formatDistanceToNow(new Date(data.last_captured_at), { locale: ptBR })}
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="rounded-md border border-border/40 bg-background/40 px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Início</div>
            <div className="text-[20px] font-semibold tabular-nums leading-none mt-1">
              {start != null ? formatInt(start) : "—"}
            </div>
            {data.start_captured_at && (
              <div className="text-[10px] text-muted-foreground/70 mt-1 truncate">
                {formatDistanceToNow(new Date(data.start_captured_at), { locale: ptBR, addSuffix: true })}
              </div>
            )}
            {start == null && (
              <div className="text-[10px] text-muted-foreground/70 mt-1">
                aguardando baseline
              </div>
            )}
          </div>

          <div className="rounded-md border border-border/40 bg-background/40 px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Atual</div>
            <div className="text-[20px] font-semibold tabular-nums leading-none mt-1">
              {formatInt(current)}
            </div>
          </div>

          <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wide text-primary/80">Entregue</div>
            <div className="text-[20px] font-semibold tabular-nums leading-none mt-1 text-primary">
              +{formatInt(delta)}
            </div>
            <div className="text-[10px] text-muted-foreground/70 mt-1">
              atual − início
            </div>
          </div>

          <div className="rounded-md border border-border/40 bg-background/40 px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Custo</div>
            <div className="text-[20px] font-semibold tabular-nums leading-none mt-1">
              {cppEco > 0 ? formatBRL(custoRadio) : "—"}
            </div>
            <div className="text-[10px] text-muted-foreground/70 mt-1">
              {cppEco > 0 ? `CPP eco R$ ${cppEco.toFixed(3)}` : "CPP eco indisponível"}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
