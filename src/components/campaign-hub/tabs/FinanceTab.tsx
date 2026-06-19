// Fase 14.1 — FinanceTab da Campanha consome EXCLUSIVAMENTE v_campaign_overview
// (via useCampaignOverview). Zero recálculo aqui. Os números aqui DEVEM ser
// idênticos aos exibidos em Cliente, Financeiro e Cockpit pra essa campanha.
import { Card, CardContent } from "@/components/ui/card";
import { Radio, ListMusic, Users } from "lucide-react";
import { formatBRL, formatInt } from "@/lib/campaignEngine";
import type { CampaignSnapshot } from "@/lib/campaignSnapshot";
import { useCampaignOverview } from "@/hooks/useCampaignOverview";
import { cn } from "@/lib/utils";

type Props = {
  campaignId: string;
  snapshot: CampaignSnapshot;
  clientPriceTotal: number;
  /** Mantido por compatibilidade — Rádio agora vive na Composição do custo. */
  onOpenRadioMonitoring?: () => void;
};

export function FinanceTab({ campaignId }: Props) {
  const { data: ov } = useCampaignOverview(campaignId);

  const cobrado = ov?.contratado ?? 0;
  const totalCost = ov?.custo_operacional ?? 0;
  const margem = ov?.margem_prevista ?? 0;
  const margemPct = ov?.margem_pct ?? 0;

  const curadoresCost = ov?.custo_curadores_diretos ?? 0;
  const ecoCost = ov?.custo_eco ?? 0;
  const externosCost = ov?.custo_externos ?? 0;

  return (
    <div className="space-y-6">
      {/* BLOCO 1 — KPIs */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <CompactKpi label="Cliente paga" value={formatBRL(cobrado)} accent="revenue" />
        <CompactKpi label="Seu custo" value={formatBRL(totalCost)} accent="cost" />
        <CompactKpi
          label="Margem"
          value={formatBRL(margem)}
          tone={margem > 0 ? "positive" : margem < 0 ? "negative" : "neutral"}
          accent="margin"
        />
        <CompactKpi
          label="% Margem"
          value={`${Math.round(margemPct)}%`}
          tone={margemPct > 0 ? "positive" : margemPct < 0 ? "negative" : "neutral"}
          accent="margin"
        />
      </section>

      {/* BLOCO 2 — Composição do custo (3 eixos canônicos) */}
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
              label="Ecossistema (playlists próprias)"
              cost={ecoCost}
              streams={ov?.eco_total ?? 0}
            />
            <CostBlock
              icon={Radio}
              label="Pacotes externos"
              cost={externosCost}
              streams={ov?.externos_items_total ?? 0}
            />
            <CostBlock
              icon={Users}
              label="Curadores diretos"
              cost={curadoresCost}
              streams={ov?.deals_total ?? 0}
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
          {formatInt(streams)} {streams === 1 ? "entrega" : "entregas"}
        </div>
      </div>
    </div>
  );
}
