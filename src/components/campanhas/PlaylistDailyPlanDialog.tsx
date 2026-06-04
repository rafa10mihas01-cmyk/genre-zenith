import { useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatInt } from "@/lib/campaignEngine";
import { buildEcoPlaylistPlan, distributeEcoPositions, chartTierFromTopPosition } from "@/lib/campaignOperationalPlan";
import type { CampaignSnapshot } from "@/lib/campaignSnapshot";
import { Download, Printer, Music } from "lucide-react";
import { cn } from "@/lib/utils";

type EcoAlloc = {
  id: string;
  planned_streams: number;
  start_day: number;
  managed_playlists?: { name: string; cover_url: string | null; followers: number } | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allocation: EcoAlloc | null;
  allAllocations: EcoAlloc[];
  snapshot: CampaignSnapshot;
  startedAt: string;
  campaignTitle: string;
  engagementMultiplier?: number;
};

function dateLabel(startedAt: string, day: number) {
  const base = new Date(startedAt);
  base.setDate(base.getDate() + day - 1);
  return base.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", weekday: "short" });
}

export function PlaylistDailyPlanDialog({
  open,
  onOpenChange,
  allocation,
  allAllocations,
  snapshot,
  startedAt,
  campaignTitle,
  engagementMultiplier = 35,
}: Props) {
  const plan = useMemo(() => {
    if (!allocation) return null;
    const top = (snapshot as any)?.music?.top200Position ?? (snapshot as any)?.music?.top200Pos ?? null;
    const positions = distributeEcoPositions(
      allAllocations.map(a => ({
        id: a.id,
        planned_streams: a.planned_streams,
        followers: a.managed_playlists?.followers ?? 0,
        genreSource: ((a as any).genre_source as "primary" | "affinity" | null) ?? "primary",
      })),
      snapshot.days,
      engagementMultiplier,
      { chartTier: chartTierFromTopPosition(top) },
    );
    const all = buildEcoPlaylistPlan(snapshot, allAllocations as any, {
      startedAt,
      engagementMultiplier,
      positions,
    });
    return all.find(p => p.allocationId === allocation.id) ?? null;
  }, [allocation, allAllocations, snapshot, startedAt, engagementMultiplier]);

  if (!allocation || !plan) return null;

  const activeDays = plan.daily.filter(v => v > 0).length;
  const peakDay = plan.daily.reduce((acc, v, i) => v > acc.v ? { v, i } : acc, { v: 0, i: 0 });
  const maxDay = Math.max(...plan.daily, 1);

  function handlePrint() {
    window.print();
  }

  function handleExport() {
    if (!plan) return;
    const rows: Array<Array<string | number>> = [
      ["dia", "data", "streams", "acumulado"],
    ];
    let cum = 0;
    plan.daily.forEach((v, i) => {
      cum += v;
      rows.push([i + 1, dateLabel(startedAt, i + 1), v, cum]);
    });
    const csv = rows.map(r => r.join(";")).join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `playlist-${plan.playlistName.replace(/\s+/g, "-").toLowerCase()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  let cumulative = 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col print:max-w-none print:max-h-none print:shadow-none print:border-0">
        <DialogHeader>
          <div className="flex items-start gap-3">
            {plan.coverUrl ? (
              <img src={plan.coverUrl} alt="" className="w-14 h-14 rounded-lg object-cover" />
            ) : (
              <div className="w-14 h-14 rounded-lg bg-muted grid place-items-center">
                <Music className="h-5 w-5 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate">{plan.playlistName}</DialogTitle>
              <DialogDescription>
                {formatInt(plan.followers)} saves · campanha {campaignTitle}
              </DialogDescription>
            </div>
            <div className="flex gap-2 print:hidden">
              <Button size="sm" variant="outline" onClick={handleExport}>
                <Download className="h-4 w-4 mr-1.5" /> CSV
              </Button>
              <Button size="sm" variant="outline" onClick={handlePrint}>
                <Printer className="h-4 w-4 mr-1.5" /> Imprimir
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="grid grid-cols-4 gap-2 mt-2">
          <Stat label="Total planejado" value={formatInt(plan.totalStreams)} />
          <Stat label="Início" value={`D${plan.startDay}`} hint={dateLabel(startedAt, plan.startDay)} />
          <Stat label="Dias ativos" value={`${activeDays}/${snapshot.days}`} />
          <Stat label="Pico" value={formatInt(peakDay.v)} hint={`D${peakDay.i + 1}`} />
        </div>

        <div className="flex-1 overflow-auto mt-3 rounded-lg border border-border">
          <table className="w-full text-xs border-separate border-spacing-0">
            <thead className="sticky top-0 bg-card z-10 text-muted-foreground">
              <tr>
                <th className="text-left font-medium py-2 px-3 border-b border-border w-16">Dia</th>
                <th className="text-left font-medium py-2 px-3 border-b border-border w-32">Data</th>
                <th className="text-right font-medium py-2 px-3 border-b border-border w-32">Streams</th>
                <th className="py-2 px-3 border-b border-border">Distribuição</th>
                <th className="text-right font-medium py-2 px-3 border-b border-border w-32">Acumulado</th>
              </tr>
            </thead>
            <tbody>
              {plan.daily.map((v, i) => {
                cumulative += v;
                const day = i + 1;
                const isStart = day === plan.startDay;
                const isPeak = day === peakDay.i + 1 && v > 0;
                const widthPct = (v / maxDay) * 100;
                return (
                  <tr key={day} className={cn(
                    "hover:bg-elevated/60",
                    v === 0 && "text-muted-foreground/50",
                    isStart && "bg-primary/5",
                  )}>
                    <td className="py-1.5 px-3 border-b border-border/30 tabular-nums font-medium">
                      D{day}
                      {isStart && <span className="ml-1 text-[9px] text-primary">●</span>}
                    </td>
                    <td className="py-1.5 px-3 border-b border-border/30 text-muted-foreground">
                      {dateLabel(startedAt, day)}
                    </td>
                    <td className={cn(
                      "py-1.5 px-3 border-b border-border/30 text-right tabular-nums font-semibold",
                      isPeak && "text-primary",
                    )}>
                      {formatInt(v)}
                    </td>
                    <td className="py-1.5 px-3 border-b border-border/30">
                      <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${widthPct}%`, opacity: v === 0 ? 0 : 1 }} />
                      </div>
                    </td>
                    <td className="py-1.5 px-3 border-b border-border/30 text-right tabular-nums text-muted-foreground">
                      {formatInt(cumulative)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-elevated/30 p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-base font-semibold tabular-nums mt-0.5">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground tabular-nums">{hint}</div>}
    </div>
  );
}
