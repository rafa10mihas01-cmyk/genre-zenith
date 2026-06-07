import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Radio, ListMusic, Users, Globe, TrendingDown, TrendingUp } from "lucide-react";
import { formatBRL, formatInt } from "@/lib/campaignEngine";
import type { CampaignSnapshot } from "@/lib/campaignSnapshot";
import { supabase } from "@/integrations/supabase/client";
import { useRadioCollected } from "@/hooks/useRadioCollected";
import { cn } from "@/lib/utils";

type Props = {
  campaignId: string;
  snapshot: CampaignSnapshot;
  /** Bloco 1 (Resumo) é renderizado externamente pelo ClientPriceEditor. Aqui só
   *  expomos os blocos 2–5 com a composição auditável. */
  clientPriceTotal: number;
};

type SourceRow = {
  key: string;
  label: string;
  icon: typeof Radio;
  cost: number;
  streams: number;
  /** marca interna pra ajudar a saber se é parte do Ecossistema */
  bucket: "eco" | "curators" | "external";
  /** subtítulo opcional */
  hint?: string;
};

export function FinanceTab({ campaignId, snapshot, clientPriceTotal }: Props) {
  const { data: radio } = useRadioCollected(campaignId);
  const [curatorCost, setCuratorCost] = useState<number>(0);
  const [curatorStreams, setCuratorStreams] = useState<number>(0);
  const [loadingCurators, setLoadingCurators] = useState(true);

  useEffect(() => {
    let active = true;
    setLoadingCurators(true);
    void (async () => {
      // Considera apenas deals reais (com curator_id) — exclui shadow deals internos.
      const { data } = await supabase
        .from("curator_deals")
        .select("cost, reconciled_streams_7d, reconciled_total_plays, curator_id")
        .eq("campaign_id", campaignId);
      if (!active) return;
      const rows = (data ?? []).filter((d: any) => d.curator_id != null);
      const cost = rows.reduce((s, d: any) => s + (Number(d.cost) || 0), 0);
      const streams = rows.reduce(
        (s, d: any) => s + (Number(d.reconciled_streams_7d) || Number(d.reconciled_total_plays) || 0),
        0,
      );
      setCuratorCost(cost);
      setCuratorStreams(streams);
      setLoadingCurators(false);
    })();
    return () => { active = false; };
  }, [campaignId]);

  // ---------- BASES DE CÁLCULO ----------
  const cppEco = snapshot.streamsEco > 0 ? snapshot.custoEco / snapshot.streamsEco : 0;
  const radioDelta = Math.max(0, radio?.radio_delta ?? 0);
  const radioCost = radioDelta * cppEco;

  // Playlist Própria = Eco - Rádio (Rádio é parte do Eco mas exibimos separadamente).
  const ownStreams = Math.max(0, snapshot.streamsEco - radioDelta);
  const ownCost = Math.max(0, snapshot.custoEco - radioCost);

  const externalStreams = snapshot.streamsExt;
  const externalCost = snapshot.custoExt;

  const rows: SourceRow[] = [
    {
      key: "own", label: "Playlist Própria", icon: ListMusic,
      cost: ownCost, streams: ownStreams, bucket: "eco",
      hint: "Inventário gerenciado",
    },
    {
      key: "radio", label: "Rádio Spotify", icon: Radio,
      cost: radioCost, streams: radioDelta, bucket: "eco",
      hint: "Herda CPP do Ecossistema",
    },
    {
      key: "curators", label: "Curadores", icon: Users,
      cost: curatorCost, streams: curatorStreams, bucket: "curators",
      hint: "Deals fechados (curator_deals)",
    },
    {
      key: "external", label: "Externo", icon: Globe,
      cost: externalCost, streams: externalStreams, bucket: "external",
      hint: "Pacote externo planejado",
    },
  ];

  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const totalStreams = rows.reduce((s, r) => s + r.streams, 0);
  const margem = clientPriceTotal - totalCost;
  const margemPct = clientPriceTotal > 0 ? Math.round((margem / clientPriceTotal) * 100) : 0;

  // Bloco 4 — Rentabilidade: ordena por menor CPP (excluindo zeros).
  const rentabilidade = [...rows]
    .map((r) => ({ ...r, cpp: r.streams > 0 ? r.cost / r.streams : null }))
    .sort((a, b) => {
      if (a.cpp == null) return 1;
      if (b.cpp == null) return -1;
      return a.cpp - b.cpp;
    });
  const bestKey = rentabilidade.find((r) => r.cpp != null && r.streams > 0)?.key ?? null;

  return (
    <div className="space-y-6">
      {/* BLOCO 1 — Resumo compacto (4 KPIs em linha) */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <CompactKpi label="Cliente paga" value={formatBRL(clientPriceTotal)} />
        <CompactKpi label="Seu custo" value={formatBRL(totalCost)} sub={`${formatInt(totalStreams)} streams`} />
        <CompactKpi
          label="Margem"
          value={formatBRL(margem)}
          tone={margem > 0 ? "positive" : margem < 0 ? "negative" : "neutral"}
        />
        <CompactKpi
          label="% Margem"
          value={`${margemPct}%`}
          tone={margemPct > 0 ? "positive" : margemPct < 0 ? "negative" : "neutral"}
        />
      </section>

      {/* BLOCO 2 — Composição do custo */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-baseline justify-between">
            <div>
              <h3 className="text-sm font-semibold">Composição do custo</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Cada linha mostra quanto saiu, o que foi entregue e o CPP real
              </p>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</div>
              <div className="text-base font-semibold tabular-nums">{formatBRL(totalCost)}</div>
            </div>
          </div>

          <div className="space-y-1">
            <BucketHeader label="Ecossistema" />
            <CostRow row={rows[0]} loading={false} />
            <CostRow row={rows[1]} loading={!radio} />
            <SubtotalRow
              label="Total Ecossistema"
              cost={rows[0].cost + rows[1].cost}
              streams={rows[0].streams + rows[1].streams}
            />

            <BucketHeader label="Curadores" className="mt-4" />
            <CostRow row={rows[2]} loading={loadingCurators} />
            <SubtotalRow label="Total Curadores" cost={rows[2].cost} streams={rows[2].streams} />

            <BucketHeader label="Externo" className="mt-4" />
            <CostRow row={rows[3]} loading={false} />
            <SubtotalRow label="Total Externo" cost={rows[3].cost} streams={rows[3].streams} />
          </div>
        </CardContent>
      </Card>

      {/* BLOCO 3 — Entrega por fonte */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold">Entrega por fonte</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Participação de cada fonte nos streams totais entregues
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {rows.map((r) => {
              const pct = totalStreams > 0 ? (r.streams / totalStreams) * 100 : 0;
              return (
                <div key={r.key} className="rounded-md border border-border/40 bg-background/40 p-3">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <r.icon className="h-3 w-3" />
                    {r.label}
                  </div>
                  <div className="text-xl font-semibold tabular-nums mt-1">
                    {formatInt(r.streams)}
                  </div>
                  <div className="mt-2 h-1.5 w-full rounded-full bg-elevated/40 overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                  <div className="text-[10px] text-muted-foreground/80 mt-1 tabular-nums">
                    {pct.toFixed(1)}% do total
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* BLOCO 4 — Rentabilidade */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold">Rentabilidade por fonte</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Ordenado por menor CPP — fonte mais eficiente em destaque
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/40">
                  <th className="text-left font-medium py-2">Fonte</th>
                  <th className="text-right font-medium py-2">Streams</th>
                  <th className="text-right font-medium py-2">Custo</th>
                  <th className="text-right font-medium py-2">CPP</th>
                </tr>
              </thead>
              <tbody>
                {rentabilidade.map((r) => {
                  const isBest = r.key === bestKey;
                  return (
                    <tr key={r.key} className="border-b border-border/20 last:border-0">
                      <td className="py-2.5">
                        <div className="flex items-center gap-2">
                          <r.icon className={cn("h-3.5 w-3.5", isBest ? "text-primary" : "text-muted-foreground")} />
                          <span className={cn(isBest && "font-semibold text-primary")}>{r.label}</span>
                          {isBest && (
                            <span className="text-[9px] uppercase tracking-wider text-primary border border-primary/40 bg-primary/10 rounded-full px-1.5 py-0.5">
                              melhor
                            </span>
                          )}
                        </div>
                      </td>
                      <td className={cn("text-right tabular-nums py-2.5", isBest && "text-primary font-semibold")}>
                        {formatInt(r.streams)}
                      </td>
                      <td className={cn("text-right tabular-nums py-2.5", isBest && "text-primary font-semibold")}>
                        {formatBRL(r.cost)}
                      </td>
                      <td className={cn("text-right tabular-nums py-2.5", isBest && "text-primary font-semibold")}>
                        {r.cpp != null ? `R$ ${r.cpp.toFixed(4)}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* BLOCO 5 — Rádio (card específico) */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                <Radio className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">Rádio Spotify</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Entrega medida pelo crescimento desde a baseline da campanha
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <RadioMini label="Baseline" value={radio?.start_plays_7d != null ? formatInt(radio.start_plays_7d) : "—"} />
            <RadioMini label="Atual" value={radio?.current_plays_7d != null ? formatInt(radio.current_plays_7d) : "—"} />
            <RadioMini label="Entregue" value={`+${formatInt(radioDelta)}`} highlight />
            <RadioMini label="CPP herdado" value={cppEco > 0 ? `R$ ${cppEco.toFixed(4)}` : "—"} />
            <RadioMini label="Custo" value={cppEco > 0 ? formatBRL(radioCost) : "—"} />
          </div>

          <p className="text-[11px] text-muted-foreground border-l-2 border-primary/40 pl-3 py-1">
            A Rádio utiliza o mesmo CPP do Ecossistema e faz parte da entrega interna.
            Não tem tarifa própria — o custo é derivado do delta × CPP eco.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- componentes auxiliares ----------

function CompactKpi({
  label, value, sub, tone = "neutral",
}: { label: string; value: string; sub?: string; tone?: "positive" | "negative" | "neutral" }) {
  return (
    <div className="rounded-md border border-border/40 bg-background/40 px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn(
        "text-xl font-semibold tabular-nums mt-1",
        tone === "positive" && "text-primary",
        tone === "negative" && "text-destructive",
      )}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-muted-foreground/70 mt-0.5">{sub}</div>}
    </div>
  );
}

function BucketHeader({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn("text-[10px] uppercase tracking-wider text-muted-foreground pb-1 border-b border-border/30", className)}>
      {label}
    </div>
  );
}

function CostRow({ row, loading }: { row: SourceRow; loading: boolean }) {
  const cpp = row.streams > 0 ? row.cost / row.streams : null;
  return (
    <div className="grid grid-cols-12 gap-2 py-2 items-center border-b border-border/15 last:border-0">
      <div className="col-span-5 flex items-center gap-2 min-w-0">
        <row.icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{row.label}</div>
          {row.hint && <div className="text-[10px] text-muted-foreground/70 truncate">{row.hint}</div>}
        </div>
      </div>
      <div className="col-span-3 text-right tabular-nums text-sm">
        {loading ? <span className="text-muted-foreground/40">…</span> : formatBRL(row.cost)}
      </div>
      <div className="col-span-2 text-right tabular-nums text-xs text-muted-foreground">
        {loading ? "…" : `${formatInt(row.streams)} str`}
      </div>
      <div className="col-span-2 text-right tabular-nums text-xs text-muted-foreground">
        {cpp != null ? `R$ ${cpp.toFixed(4)}` : "—"}
      </div>
    </div>
  );
}

function SubtotalRow({ label, cost, streams }: { label: string; cost: number; streams: number }) {
  const cpp = streams > 0 ? cost / streams : null;
  return (
    <div className="grid grid-cols-12 gap-2 py-1.5 items-center bg-elevated/20 px-2 rounded">
      <div className="col-span-5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
      <div className="col-span-3 text-right tabular-nums text-sm font-semibold">{formatBRL(cost)}</div>
      <div className="col-span-2 text-right tabular-nums text-xs text-muted-foreground">{formatInt(streams)} str</div>
      <div className="col-span-2 text-right tabular-nums text-xs text-muted-foreground">
        {cpp != null ? `R$ ${cpp.toFixed(4)}` : "—"}
      </div>
    </div>
  );
}

function RadioMini({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={cn(
      "rounded-md border px-3 py-2.5",
      highlight ? "border-primary/40 bg-primary/5" : "border-border/40 bg-background/40",
    )}>
      <div className={cn("text-[10px] uppercase tracking-wider", highlight ? "text-primary/80" : "text-muted-foreground")}>{label}</div>
      <div className={cn("text-lg font-semibold tabular-nums mt-1", highlight && "text-primary")}>{value}</div>
    </div>
  );
}
