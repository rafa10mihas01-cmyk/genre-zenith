import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Radio, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatInt } from "@/lib/campaignEngine";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

type RadioRow = {
  campaign_id: string;
  current_plays_7d: number;
  prior_plays_7d: number;
  delta_48h: number;
  last_captured_at: string;
  prior_captured_at: string | null;
};

type Props = {
  campaignId: string;
  /** Meta planejada da rádio (snapshot.streamsOrganic) — pode ser 0. */
  metaPlanned?: number;
};

/**
 * Card admin-interno: mostra plays REAIS de Rádio Spotify capturados pelo bot
 * (linha `spotify_playlist_id = 'radio'` dos sources do SfA), com delta 48h.
 *
 * Cliente NÃO vê — fica só no CampanhaExecucao (não no PlanoCampanhaPublico).
 */
export function RadioCollectedCard({ campaignId, metaPlanned = 0 }: Props) {
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

  const delta = data.delta_48h ?? 0;
  const pctMeta = metaPlanned > 0
    ? Math.min(999, Math.round((data.current_plays_7d / metaPlanned) * 100))
    : null;
  const DeltaIcon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const deltaTone = delta > 0
    ? "text-primary"
    : delta < 0
      ? "text-destructive"
      : "text-muted-foreground";

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
                Coletado pelo bot · janela 7d
              </div>
            </div>
          </div>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            atualizado há {formatDistanceToNow(new Date(data.last_captured_at), { locale: ptBR })}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-md border border-border/40 bg-background/40 px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Plays atuais</div>
            <div className="text-[20px] font-semibold tabular-nums leading-none mt-1">
              {formatInt(data.current_plays_7d)}
            </div>
          </div>

          <div className="rounded-md border border-border/40 bg-background/40 px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Δ 48h</div>
            <div className={`text-[20px] font-semibold tabular-nums leading-none mt-1 flex items-center gap-1 ${deltaTone}`}>
              <DeltaIcon className="h-4 w-4" />
              {delta > 0 ? "+" : ""}{formatInt(delta)}
            </div>
            {data.prior_captured_at && (
              <div className="text-[10px] text-muted-foreground/70 mt-1 truncate">
                vs {formatDistanceToNow(new Date(data.prior_captured_at), { locale: ptBR, addSuffix: false })} atrás
              </div>
            )}
          </div>

          <div className="rounded-md border border-border/40 bg-background/40 px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {metaPlanned > 0 ? "% da meta" : "Meta"}
            </div>
            <div className="text-[20px] font-semibold tabular-nums leading-none mt-1">
              {pctMeta != null ? `${pctMeta}%` : "—"}
            </div>
            {metaPlanned > 0 && (
              <div className="text-[10px] text-muted-foreground/70 mt-1">
                de {formatInt(metaPlanned)}
              </div>
            )}
            {metaPlanned === 0 && (
              <div className="text-[10px] text-muted-foreground/70 mt-1">
                não planejada
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
