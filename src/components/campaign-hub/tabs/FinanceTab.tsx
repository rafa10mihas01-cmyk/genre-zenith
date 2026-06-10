import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Radio, ListMusic, Users } from "lucide-react";
import { formatBRL, formatInt } from "@/lib/campaignEngine";
import type { CampaignSnapshot } from "@/lib/campaignSnapshot";
import { supabase } from "@/integrations/supabase/client";
import { usePricingSettings } from "@/hooks/usePricingSettings";
import { plannedRadioStreams } from "@/lib/plannedRadio";
import { cn } from "@/lib/utils";

type Props = {
  campaignId: string;
  snapshot: CampaignSnapshot;
  clientPriceTotal: number;
  /** Mantido por compatibilidade — Rádio agora vive na Composição do custo. */
  onOpenRadioMonitoring?: () => void;
};

export function FinanceTab({ campaignId, snapshot, clientPriceTotal }: Props) {
  const { settings } = usePricingSettings();
  const [curatorCost, setCuratorCost] = useState<number>(0);
  const [curatorStreams, setCuratorStreams] = useState<number>(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data } = await supabase
        .from("curator_deals")
        .select("cost, reconciled_total_plays, curator_id")
        .eq("campaign_id", campaignId);
      if (!active) return;
      const rows = (data ?? []).filter((d: any) => d.curator_id != null);
      setCuratorCost(rows.reduce((s, d: any) => s + (Number(d.cost) || 0), 0));
      setCuratorStreams(
        rows.reduce(
          (s, d: any) => s + (Number(d.reconciled_total_plays) || 0),
          0,
        ),
      );
    })();
    return () => { active = false; };
  }, [campaignId]);

  // 3 buckets INDEPENDENTES:
  //   1. Playlist Própria = streamsEco × pricing.eco (R$ 0,01/stream = 10k/milhão)
  //   2. Rádio            = streamsOrganic × pricing.eco (mesma taxa do eco)
  //   3. Curadores        = SOMA dos curator_deals reais (cada curador tem seu preço próprio)
  //                         Sem deal = custo zero. Não usa estimativa genérica.
  const cppEco = settings.cost_per_stream_eco;

  const ownPlaylistsStreams = Math.max(0, snapshot.streamsEco);
  const ownPlaylistsCost = ownPlaylistsStreams * cppEco;

  const radioStreams = plannedRadioStreams(snapshot);
  const radioCost = radioStreams * cppEco;

  const curadoresCost = curatorCost;
  const curadoresStreams = curatorStreams;

  const totalCost = ownPlaylistsCost + radioCost + curadoresCost;
  const margem = clientPriceTotal - totalCost;
  const margemPct = clientPriceTotal > 0 ? Math.round((margem / clientPriceTotal) * 100) : 0;


  return (
    <div className="space-y-6">
      {/* BLOCO 1 — KPIs */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <CompactKpi label="Cliente paga" value={formatBRL(clientPriceTotal)} accent="revenue" />
        <CompactKpi label="Seu custo" value={formatBRL(totalCost)} accent="cost" />
        <CompactKpi
          label="Margem"
          value={formatBRL(margem)}
          tone={margem > 0 ? "positive" : margem < 0 ? "negative" : "neutral"}
          accent="margin"
        />
        <CompactKpi
          label="% Margem"
          value={`${margemPct}%`}
          tone={margemPct > 0 ? "positive" : margemPct < 0 ? "negative" : "neutral"}
          accent="margin"
        />
      </section>

      {/* BLOCO 2 — Composição do custo (3 buckets reais) */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold">Composição do custo</h3>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</div>
              <div className="text-base font-semibold tabular-nums">{formatBRL(totalCost)}</div>
            </div>
          </div>

          <div className="space-y-2">
            <CostBlock
              icon={ListMusic}
              label="Playlist Própria"
              cost={ownPlaylistsCost}
              streams={ownPlaylistsStreams}
            />
            <CostBlock
              icon={Radio}
              label="Rádio"
              cost={radioCost}
              streams={radioStreams}
            />
            <CostBlock
              icon={Users}
              label="Curadores"
              cost={curadoresCost}
              streams={curadoresStreams}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CompactKpi({
  label, value, tone = "neutral", accent,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative" | "neutral";
  accent?: "revenue" | "cost" | "margin";
}) {
  const accentBar =
    accent === "revenue"
      ? "before:bg-[hsl(217_91%_60%)]"
      : accent === "cost"
        ? "before:bg-[hsl(38_92%_55%)]"
        : accent === "margin"
          ? "before:bg-primary"
          : "before:bg-border";
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border border-border bg-card px-4 py-3.5",
        "before:absolute before:inset-y-0 before:left-0 before:w-[3px]",
        accentBar,
      )}
    >
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
        {label}
      </div>
      <div
        className={cn(
          "text-xl font-semibold tabular-nums mt-1 text-foreground",
          tone === "positive" && "text-primary",
          tone === "negative" && "text-destructive",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function CostBlock({
  icon: Icon, label, cost, streams,
}: { icon: typeof Radio; label: string; cost: number; streams: number }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border/40 bg-background/40 px-4 py-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium truncate">{label}</span>
      </div>
      <div className="text-right shrink-0">
        <div className="text-base font-semibold tabular-nums">{formatBRL(cost)}</div>
        <div className="text-[11px] text-muted-foreground tabular-nums">
          {formatInt(streams)} streams planejados
        </div>
      </div>
    </div>
  );
}
