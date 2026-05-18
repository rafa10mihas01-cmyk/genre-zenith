import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Grid3x3, Download, ExternalLink, Link2, Check } from "lucide-react";
import { formatInt } from "@/lib/campaignEngine";
import type { CampaignSnapshot } from "@/lib/campaignSnapshot";
import { buildEcoPlaylistPlan, type DailyPlaylistPlan } from "@/lib/campaignOperationalPlan";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

type EcoAlloc = {
  id: string;
  planned_streams: number;
  start_day: number;
  managed_playlists?: { name: string; cover_url: string | null; followers: number } | null;
};

type Props = {
  snapshot: CampaignSnapshot;
  startedAt: string;
  allocations: EcoAlloc[];
  engagementMultiplier?: number;
  campaignId?: string;
  showShare?: boolean;
};

function dateLabel(startedAt: string, day: number) {
  const base = new Date(startedAt);
  base.setDate(base.getDate() + day - 1);
  return base.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function CampaignFullPlanCard({ snapshot, startedAt, allocations, engagementMultiplier = 30, campaignId, showShare = true }: Props) {
  const [showZeros, setShowZeros] = useState(false);
  const [copied, setCopied] = useState(false);

  function copyShareLink() {
    if (!campaignId) return;
    const url = `${window.location.origin}/campanhas/${campaignId}/plano`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    toast({ title: "Link copiado", description: "Cole onde quiser enviar este plano." });
    setTimeout(() => setCopied(false), 2000);
  }

  const plans = useMemo<DailyPlaylistPlan[]>(
    () => buildEcoPlaylistPlan(snapshot, allocations as any, { engagementMultiplier, startedAt }),
    [snapshot, allocations, engagementMultiplier],
  );

  const days = snapshot.days;
  const dailyTotals = useMemo(() => {
    const arr = Array.from({ length: days }, () => 0);
    for (const p of plans) for (let i = 0; i < days; i++) arr[i] += p.daily[i] ?? 0;
    return arr;
  }, [plans, days]);

  function handleExport() {
    const head = ["playlist", "saves", "total", ...Array.from({ length: days }, (_, i) => `D${i + 1}`)];
    const rows = [head.join(";")];
    for (const p of plans) {
      rows.push([
        `"${p.playlistName.replace(/"/g, '""')}"`,
        p.followers,
        p.totalStreams,
        ...p.daily,
      ].join(";"));
    }
    rows.push(["TOTAL/DIA", "", dailyTotals.reduce((s, v) => s + v, 0), ...dailyTotals].join(";"));
    const blob = new Blob([`\uFEFF${rows.join("\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `plano-campanha.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (plans.length === 0) return null;

  return (
    <Card className="mt-4">
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-sm flex items-center gap-2">
            <Grid3x3 className="h-4 w-4 text-primary" /> Plano completo da campanha
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Matriz dia × playlist · cada célula = streams previstos naquele dia.
            Variação natural ±22% (playlist real nunca entrega o mesmo todo dia).
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setShowZeros(s => !s)}>
            {showZeros ? "Esconder zeros" : "Mostrar zeros"}
          </Button>
          <Button size="sm" variant="outline" onClick={handleExport}>
            <Download className="h-4 w-4 mr-1.5" /> CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="max-h-[560px] overflow-auto">
            <table className="text-[11px] border-separate border-spacing-0 min-w-full">
              <thead className="sticky top-0 z-20 bg-card text-muted-foreground">
                <tr>
                  <th className="sticky left-0 z-30 bg-card text-left font-medium py-2 px-3 border-b border-r border-border min-w-[220px]">
                    Playlist
                  </th>
                  <th className="text-right font-medium py-2 px-2 border-b border-border w-20">Total</th>
                  {Array.from({ length: days }, (_, i) => (
                    <th key={i} className="text-right font-medium py-2 px-2 border-b border-border whitespace-nowrap min-w-[64px]">
                      <div className="tabular-nums">D{i + 1}</div>
                      <div className="text-[9px] text-muted-foreground/70 font-normal">{dateLabel(startedAt, i + 1)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plans.map((p, rowIdx) => (
                  <tr key={p.allocationId} className={cn("hover:bg-primary/5", rowIdx % 2 === 1 && "bg-elevated/20")}>
                    <td className={cn("sticky left-0 z-10 py-1.5 px-3 border-b border-r border-border/30", rowIdx % 2 === 1 ? "bg-elevated/40" : "bg-card")}>
                      <div className="flex items-center gap-2">
                        {p.coverUrl ? (
                          <img src={p.coverUrl} alt="" className="w-6 h-6 rounded object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-6 h-6 rounded bg-muted flex-shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="font-medium truncate">{p.playlistName}</div>
                          <div className="text-[9px] text-muted-foreground tabular-nums">
                            {formatInt(p.followers)} saves · cap {formatInt(p.capDia)}/dia
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="text-right tabular-nums font-semibold py-1.5 px-2 border-b border-border/30">
                      {formatInt(p.totalStreams)}
                    </td>
                    {p.daily.map((v, i) => {
                      const isStart = i + 1 === p.startDay;
                      const intensity = p.capDia > 0 ? Math.min(1, v / p.capDia) : 0;
                      return (
                        <td
                          key={i}
                          className={cn(
                            "text-right tabular-nums py-1.5 px-2 border-b border-border/30 whitespace-nowrap",
                            v === 0 && (showZeros ? "text-muted-foreground/40" : "text-transparent select-none"),
                            isStart && "ring-1 ring-inset ring-primary/40",
                          )}
                          style={v > 0 ? { backgroundColor: `hsl(var(--primary) / ${0.06 + intensity * 0.22})` } : undefined}
                          title={isStart ? `Entrada D${p.startDay}` : undefined}
                        >
                          {v > 0 ? formatInt(v) : "0"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 z-20 bg-card font-semibold">
                <tr>
                  <td className="sticky left-0 z-30 bg-card py-2 px-3 border-t-2 border-r border-border text-foreground">
                    Total / dia
                  </td>
                  <td className="text-right tabular-nums py-2 px-2 border-t-2 border-border text-primary">
                    {formatInt(dailyTotals.reduce((s, v) => s + v, 0))}
                  </td>
                  {dailyTotals.map((v, i) => (
                    <td key={i} className="text-right tabular-nums py-2 px-2 border-t-2 border-border text-foreground whitespace-nowrap">
                      {formatInt(v)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">
          Dica: a coluna com borda verde marca o dia de entrada de cada playlist (D1 da playlist). A intensidade da cor mostra quão perto do cap diário (followers × 12%) a entrega está.
        </p>
      </CardContent>
    </Card>
  );
}
