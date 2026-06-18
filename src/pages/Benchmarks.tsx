import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BarChart3, RefreshCw, TrendingUp, TrendingDown, Minus, Users, ListMusic } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { AnalyticsTabs } from "@/components/AnalyticsTabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type BenchmarkRow = {
  genre_id: string;
  sample_size: number;
  followers_p50: number | null;
  followers_p75: number | null;
  followers_p90: number | null;
  tracks_p50: number | null;
  tracks_p75: number | null;
  tracks_p90: number | null;
  avg_growth_pct_30d: number | null;
  plays_per_follower_estimate: number;
  calculated_at: string;
  genres: { nome: string; slug: string | null } | null;
};

function GrowthBadge({ pct }: { pct: number | null }) {
  if (pct === null || pct === undefined) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <Minus className="h-3 w-3" /> sem dados
      </span>
    );
  }
  const positive = pct > 0.5;
  const negative = pct < -0.5;
  const Icon = positive ? TrendingUp : negative ? TrendingDown : Minus;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-medium",
        positive && "text-success",
        negative && "text-destructive",
        !positive && !negative && "text-muted-foreground",
      )}
    >
      <Icon className="h-3 w-3" />
      {pct > 0 ? "+" : ""}
      {pct.toFixed(1)}% / 30d
    </span>
  );
}

function PercentileTriad({
  p50,
  p75,
  p90,
  unit,
  format = formatNumber,
}: {
  p50: number | null;
  p75: number | null;
  p90: number | null;
  unit: string;
  format?: (n: number) => string;
}) {
  if (!p90) {
    return <div className="text-[11px] text-muted-foreground">sem amostra suficiente</div>;
  }
  const cells: Array<{ label: string; hint: string; val: number | null; emphasis?: boolean }> = [
    { label: "Típica", hint: "metade fica abaixo", val: p50 },
    { label: "Forte", hint: "top 25%", val: p75, emphasis: true },
    { label: "Topo", hint: "top 10%", val: p90 },
  ];
  return (
    <div className="grid grid-cols-3 divide-x divide-border rounded-lg border border-border bg-muted/20">
      {cells.map((c) => (
        <div key={c.label} className="px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {c.label}
          </div>
          <div
            className={cn(
              "mt-0.5 text-base font-semibold tabular-nums",
              c.emphasis ? "text-foreground" : "text-foreground/80",
            )}
          >
            {c.val != null ? format(c.val) : "—"}
            <span className="ml-1 text-[10px] font-normal text-muted-foreground">{unit}</span>
          </div>
          <div className="mt-0.5 text-[10px] text-muted-foreground/80">{c.hint}</div>
        </div>
      ))}
    </div>
  );
}

export default function Benchmarks() {
  const queryClient = useQueryClient();
  const [sortBy, setSortBy] = useState<"sample" | "followers" | "growth">("sample");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["genre_benchmarks_all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("genre_benchmarks")
        .select(
          "genre_id, sample_size, followers_p50, followers_p75, followers_p90, tracks_p50, tracks_p75, tracks_p90, avg_growth_pct_30d, plays_per_follower_estimate, calculated_at, genres ( nome, slug )",
        )
        .order("sample_size", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as BenchmarkRow[];
    },
  });

  const recalc = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke("genre-benchmarks-calc", { body: {} });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Benchmarks recalculados");
      queryClient.invalidateQueries({ queryKey: ["genre_benchmarks_all"] });
    },
    onError: (e: Error) => toast.error(e?.message ?? "Falha ao recalcular"),
  });

  const sorted = useMemo(() => {
    const arr = [...rows];
    if (sortBy === "followers") arr.sort((a, b) => (b.followers_p50 ?? 0) - (a.followers_p50 ?? 0));
    else if (sortBy === "growth") arr.sort((a, b) => (b.avg_growth_pct_30d ?? -999) - (a.avg_growth_pct_30d ?? -999));
    else arr.sort((a, b) => b.sample_size - a.sample_size);
    return arr;
  }, [rows, sortBy]);

  const totals = useMemo(() => {
    const totalSample = rows.reduce((acc, r) => acc + (r.sample_size ?? 0), 0);
    const avgFollowersP50 =
      rows.length > 0
        ? rows.reduce((acc, r) => acc + (r.followers_p50 ?? 0), 0) / rows.length
        : 0;
    const lastUpdate = rows.reduce(
      (acc, r) => (r.calculated_at > acc ? r.calculated_at : acc),
      "",
    );
    return { totalSample, avgFollowersP50, lastUpdate };
  }, [rows]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Benchmarks de gênero"
        subtitle="Percentis por nicho"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => recalc.mutate()}
            disabled={recalc.isPending}
          >
            <RefreshCw className={cn("h-4 w-4 mr-2", recalc.isPending && "animate-spin")} />
            Recalcular
          </Button>
        }
      />
      <AnalyticsTabs />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">Gêneros analisados</div>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="mt-2 text-2xl font-semibold">{rows.length}</div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">Amostra total (playlists)</div>
            <ListMusic className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="mt-2 text-2xl font-semibold">{formatNumber(totals.totalSample)}</div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">Mediana média (p50)</div>
            <Users className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="mt-2 text-2xl font-semibold">{formatNumber(Math.round(totals.avgFollowersP50))}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">seguidores</div>
        </Card>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground mr-2">Ordenar por:</span>
          {(["sample", "followers", "growth"] as const).map((k) => (
            <Button
              key={k}
              size="sm"
              variant={sortBy === k ? "default" : "outline"}
              onClick={() => setSortBy(k)}
            >
              {k === "sample" ? "Amostra" : k === "followers" ? "Seguidores" : "Crescimento"}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground/80">Como ler:</span>
          <span><strong className="text-foreground/80">Típica</strong> = mediana do nicho</span>
          <span><strong className="text-foreground/80">Forte</strong> = melhor que 75%</span>
          <span><strong className="text-foreground/80">Topo</strong> = top 10%</span>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      ) : sorted.length === 0 ? (
        <Card className="p-12 text-center">
          <BarChart3 className="h-10 w-10 mx-auto mb-3 text-muted-foreground opacity-50" />
          <div className="text-sm font-medium">Sem benchmarks</div>
          <div className="text-xs text-muted-foreground mt-1">
            Clique em "Recalcular" para processar a base atual de playlists.
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {sorted.map((row) => (
            <Card key={row.genre_id} className="p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-semibold capitalize">
                    {row.genres?.nome ?? "Sem nome"}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {formatNumber(row.sample_size)} playlists na amostra ·{" "}
                    {new Date(row.calculated_at).toLocaleDateString("pt-BR")}
                  </div>
                </div>
                <GrowthBadge pct={row.avg_growth_pct_30d ? Number(row.avg_growth_pct_30d) : null} />
              </div>

              <div className="space-y-3">
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-medium mb-1.5 text-muted-foreground">
                    <Users className="h-3.5 w-3.5" /> Seguidores por playlist
                  </div>
                  <PercentileTriad
                    p50={row.followers_p50}
                    p75={row.followers_p75}
                    p90={row.followers_p90}
                    unit="seg."
                  />
                </div>
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-medium mb-1.5 text-muted-foreground">
                    <ListMusic className="h-3.5 w-3.5" /> Faixas por playlist
                  </div>
                  <PercentileTriad
                    p50={row.tracks_p50}
                    p75={row.tracks_p75}
                    p90={row.tracks_p90}
                    unit="faixas"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-border pt-3 text-[11px] text-muted-foreground">
                <span>Plays / seguidor (estimado)</span>
                <span className="font-medium text-foreground tabular-nums">
                  {Number(row.plays_per_follower_estimate).toFixed(3)}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
