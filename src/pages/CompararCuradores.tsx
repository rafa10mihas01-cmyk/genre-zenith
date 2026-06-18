import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Users, ArrowRight, X, Trophy, Minus, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCuratorBrain } from "@/hooks/useCuratorBrain";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const formatPct = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${Math.round(v)}%`;

const formatBRL = (v: number | null | undefined) =>
  v === null || v === undefined
    ? "—"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

const formatCPP = (v: number | null | undefined) => {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  const opts =
    v < 0.01
      ? { minimumFractionDigits: 4, maximumFractionDigits: 4 }
      : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", ...opts }).format(v);
};

type CuratorPickerProps = {
  selectedId: string | null;
  excludeId?: string | null;
  onSelect: (id: string) => void;
  onClear: () => void;
  label: string;
};

function CuratorPicker({ selectedId, excludeId, onSelect, onClear, label }: CuratorPickerProps) {
  const [search, setSearch] = useState("");

  const { data: curators = [], isLoading } = useQuery({
    queryKey: ["curators_picker", search],
    enabled: !selectedId,
    queryFn: async () => {
      let q = supabase.from("curators").select("id, name").order("name").limit(20);
      if (search.trim()) q = q.ilike("name", `%${search.trim()}%`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).filter((c) => c.id !== excludeId);
    },
  });

  const { data: selected } = useQuery({
    queryKey: ["curator_pick", selectedId],
    enabled: !!selectedId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("curators")
        .select("id, name")
        .eq("id", selectedId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  if (selectedId && selected) {
    return (
      <div className="flex items-center justify-between p-3 rounded-xl bg-card border border-border">
        <div>
          <div className="text-[11px] text-muted-foreground">{label}</div>
          <div className="text-sm font-medium mt-0.5">{selected.name}</div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClear}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <Card className="p-3 space-y-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <Input
        placeholder="Buscar curador…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="h-8 text-sm"
      />
      <div className="max-h-48 overflow-auto space-y-1">
        {isLoading ? (
          <Skeleton className="h-8 w-full" />
        ) : curators.length === 0 ? (
          <div className="text-xs text-muted-foreground p-2">Vazio.</div>
        ) : (
          curators.map((c) => (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-accent transition"
            >
              {c.name}
            </button>
          ))
        )}
      </div>
    </Card>
  );
}

type MetricRowProps = {
  label: string;
  a: number | null | undefined;
  b: number | null | undefined;
  format?: (v: number | null | undefined) => string;
  higherIsBetter?: boolean;
  unit?: string;
};

function MetricRow({ label, a, b, format = (v) => String(v ?? "—"), higherIsBetter = true, unit }: MetricRowProps) {
  const aNum = typeof a === "number" ? a : null;
  const bNum = typeof b === "number" ? b : null;
  let winner: "a" | "b" | null = null;
  if (aNum !== null && bNum !== null && aNum !== bNum) {
    const aWins = higherIsBetter ? aNum > bNum : aNum < bNum;
    winner = aWins ? "a" : "b";
  }
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-2.5 border-b border-border last:border-0">
      <div
        className={cn(
          "text-sm text-right tabular-nums",
          winner === "a" && "font-semibold text-success",
        )}
      >
        {format(a)}
        {winner === "a" && <Trophy className="inline h-3 w-3 ml-1 -mt-0.5" />}
      </div>
      <div className="text-[11px] text-muted-foreground text-center min-w-[100px]">
        {label}
        {unit && <div className="text-[10px] opacity-60">{unit}</div>}
      </div>
      <div
        className={cn(
          "text-sm text-left tabular-nums",
          winner === "b" && "font-semibold text-success",
        )}
      >
        {winner === "b" && <Trophy className="inline h-3 w-3 mr-1 -mt-0.5" />}
        {format(b)}
      </div>
    </div>
  );
}

function CuratorColumn({ id }: { id: string }) {
  const { data: brain, isLoading } = useCuratorBrain(id);
  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (!brain) {
    return (
      <Card className="p-4 text-center text-xs text-muted-foreground">
        Cérebro não calculado para este curador.
      </Card>
    );
  }
  return (
    <Card className="p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">{brain.identity?.nome ?? "—"}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {brain.identity?.playlists_count ?? 0} playlists ·{" "}
            {formatNumber(brain.identity?.total_followers_alcance ?? 0)} seguidores
          </div>
        </div>
        <Link
          to={`/curadores/${id}`}
          className="text-[11px] text-primary inline-flex items-center gap-1 hover:underline"
        >
          Detalhes <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
      {brain.signals.length > 0 && (
        <div className="text-[11px] text-destructive">
          {brain.signals.length} sinal(is) ativos
        </div>
      )}
    </Card>
  );
}

export default function CompararCuradores() {
  const [aId, setAId] = useState<string | null>(null);
  const [bId, setBId] = useState<string | null>(null);

  const { data: brainA } = useCuratorBrain(aId ?? undefined);
  const { data: brainB } = useCuratorBrain(bId ?? undefined);

  const winnerOverall = useMemo(() => {
    if (!brainA || !brainB) return null;
    let scoreA = 0;
    let scoreB = 0;
    const cmp = (a: number | null, b: number | null, higherBetter = true) => {
      if (a === null || b === null) return;
      if (a === b) return;
      const aWins = higherBetter ? a > b : a < b;
      if (aWins) scoreA++;
      else scoreB++;
    };
    cmp(brainA.trust_score, brainB.trust_score);
    cmp(brainA.delivery_rate_pct, brainB.delivery_rate_pct);
    cmp(brainA.on_time_rate_pct, brainB.on_time_rate_pct);
    cmp(brainA.confidence_score, brainB.confidence_score);
    cmp(brainA.avg_cpp, brainB.avg_cpp, false);
    cmp(brainA.signals.length, brainB.signals.length, false);
    if (scoreA === scoreB) return null;
    return scoreA > scoreB ? "a" : "b";
  }, [brainA, brainB]);

  return (
    <div className="space-y-8">
      <PageHeader
        domain="curators"
        title="Comparar curadores"
        subtitle="Comparativo"
      />

      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-center gap-4">
        <CuratorPicker
          selectedId={aId}
          excludeId={bId}
          onSelect={setAId}
          onClear={() => setAId(null)}
          label="Curador A"
        />
        <ArrowRight className="hidden md:block h-5 w-5 text-muted-foreground mx-auto rotate-90 md:rotate-0" />
        <CuratorPicker
          selectedId={bId}
          excludeId={aId}
          onSelect={setBId}
          onClear={() => setBId(null)}
          label="Curador B"
        />
      </div>

      {!aId || !bId ? (
        <Card className="p-12 text-center">
          <Users className="h-10 w-10 mx-auto mb-3 text-muted-foreground opacity-50" />
          <div className="text-sm font-medium">Selecione 2 curadores para comparar</div>
          <div className="text-xs text-muted-foreground mt-1">
            A análise mostra quem vence em cada métrica do cérebro.
          </div>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            <CuratorColumn id={aId} />
            <CuratorColumn id={bId} />
          </div>

          {winnerOverall && brainA && brainB && (
            <Card className="p-4 flex items-center justify-center gap-2 text-sm">
              <Trophy className="h-4 w-4 text-success" />
              <span className="font-medium text-success">
                {winnerOverall === "a" ? brainA.identity?.nome : brainB.identity?.nome}
              </span>
              <span className="text-muted-foreground">leva mais métricas no comparativo</span>
            </Card>
          )}

          {brainA && brainB && (
            <Card className="p-5">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Métricas
              </div>
              <MetricRow label="Trust score" a={brainA.trust_score} b={brainB.trust_score} format={(v) => `${v ?? "—"}/100`} />
              <MetricRow label="Confiança" a={brainA.confidence_score} b={brainB.confidence_score} format={(v) => `${v ?? "—"}/100`} />
              <MetricRow label="Taxa de entrega" a={brainA.delivery_rate_pct} b={brainB.delivery_rate_pct} format={formatPct} />
              <MetricRow label="No prazo" a={brainA.on_time_rate_pct} b={brainB.on_time_rate_pct} format={formatPct} />
              <MetricRow label="CPP médio" a={brainA.avg_cpp} b={brainB.avg_cpp} format={formatCPP} higherIsBetter={false} />
              <MetricRow
                label="Sinais ativos"
                a={brainA.signals.length}
                b={brainB.signals.length}
                higherIsBetter={false}
              />
              <MetricRow
                label="Capacidade média/deal"
                a={brainA.capacity_avg_per_deal}
                b={brainB.capacity_avg_per_deal}
                format={(v) => (v === null || v === undefined ? "—" : formatNumber(Math.round(v)))}
              />

              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-4 mb-2">
                Histórico
              </div>
              <MetricRow
                label="Deals totais"
                a={brainA.reliability?.total_deals}
                b={brainB.reliability?.total_deals}
                format={(v) => formatNumber(v ?? 0)}
              />
              <MetricRow
                label="Deals fechados"
                a={brainA.reliability?.closed_deals}
                b={brainB.reliability?.closed_deals}
                format={(v) => formatNumber(v ?? 0)}
              />
              <MetricRow
                label="Plays entregues"
                a={brainA.economics?.total_delivered_plays}
                b={brainB.economics?.total_delivered_plays}
                format={(v) => formatNumber(v ?? 0)}
              />
              <MetricRow
                label="Investido"
                a={brainA.economics?.total_invested}
                b={brainB.economics?.total_invested}
                format={formatBRL}
                higherIsBetter={false}
              />
            </Card>
          )}
        </>
      )}
    </div>
  );
}
