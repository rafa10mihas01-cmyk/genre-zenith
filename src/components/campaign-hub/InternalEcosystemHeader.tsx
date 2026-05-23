import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ListMusic } from "lucide-react";
import { formatBRL, formatInt } from "@/lib/campaignEngine";
import type { CampaignSnapshot } from "@/lib/campaignSnapshot";
import type { EcoAllocation } from "./types";
import { cn } from "@/lib/utils";

type EcoSnap = {
  managed_playlist_id: string;
  plays_24h: number | null;
  plays_7d: number | null;
  plays_28d: number | null;
  captured_at: string;
};

export function InternalEcosystemHeader({
  snapshot,
  allocations,
  snaps,
}: {
  snapshot: CampaignSnapshot;
  allocations: EcoAllocation[];
  snaps: EcoSnap[];
}) {
  const latestByPl = new Map<string, EcoSnap>();
  for (const s of snaps) {
    if (!latestByPl.has(s.managed_playlist_id)) latestByPl.set(s.managed_playlist_id, s);
  }

  const planned = allocations.reduce((s, a) => s + Number(a.planned_streams || 0), 0);
  const delivered = allocations.reduce((s, a) => {
    const sn = latestByPl.get(a.managed_playlist_id);
    return s + Number(sn?.plays_28d ?? sn?.plays_7d ?? sn?.plays_24h ?? 0);
  }, 0);

  const days = Math.max(1, snapshot.days || 1);
  const cpsInt = snapshot.streamsEco > 0 ? snapshot.custoEco / snapshot.streamsEco : 0;
  const custoPlanejado = +(planned * cpsInt).toFixed(2);
  const cobertura = snapshot.streamsEco > 0 ? (planned / snapshot.streamsEco) * 100 : 0;

  const deltaStreams = planned - snapshot.streamsEco;
  const deltaCusto = custoPlanejado - snapshot.custoEco;

  return (
    <Card>
      <CardHeader className="space-y-1 pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <ListMusic className="h-4 w-4 text-primary" /> Ecossistema interno
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Alvo do snapshot: <strong className="text-foreground tabular-nums">{formatInt(snapshot.streamsEco)}</strong> streams ·{" "}
          <strong className="text-foreground">{formatBRL(snapshot.custoEco)}</strong>. Entregue até agora:{" "}
          <strong className="text-foreground tabular-nums">{formatInt(delivered)}</strong>.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
          <KPI label="Streams totais" value={formatInt(planned)} delta={deltaStreams} />
          <KPI label="Diário necessário" value={formatInt(Math.round(planned / days))} />
          <KPI label="Custo" value={formatBRL(custoPlanejado)} delta={deltaCusto} isCurrency />
          <KPI label="Cobertura" value={`${cobertura.toFixed(0)}%`} />
          <KPI label="Playlists" value={String(allocations.length)} />
        </div>
      </CardContent>
    </Card>
  );
}

function KPI({ label, value, delta, isCurrency }: { label: string; value: string; delta?: number; isCurrency?: boolean }) {
  const showDelta = delta != null && Math.abs(delta) > (isCurrency ? 0.5 : 1);
  return (
    <div className="rounded-lg border border-border bg-elevated/30 p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-base font-semibold tabular-nums mt-0.5">{value}</div>
      {showDelta && (
        <div className={cn("text-[10px] tabular-nums mt-0.5", delta! > 0 ? "text-warning" : "text-primary")}>
          {delta! > 0 ? "+" : ""}{isCurrency ? formatBRL(delta!) : formatInt(delta!)} vs snapshot
        </div>
      )}
    </div>
  );
}
