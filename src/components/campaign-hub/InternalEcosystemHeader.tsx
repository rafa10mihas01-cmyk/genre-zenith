import { BarChart3, CalendarClock, DollarSign, Target, Music } from "lucide-react";

import { formatBRL, formatInt } from "@/lib/campaignEngine";
import type { CampaignSnapshot } from "@/lib/campaignSnapshot";
import type { EcoAllocation } from "./types";
import { KpiBig } from "@/components/KpiBig";

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
  const fmtDelta = (n: number) => `${n > 0 ? "+" : ""}${formatInt(n)} vs snapshot`;
  const fmtDeltaBRL = (n: number) => `${n > 0 ? "+" : ""}${formatBRL(n)} vs snapshot`;

  return (
    <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <KpiBig
        tier="hero"
        icon={BarChart3}
        label="Streams totais"
        value={formatInt(planned)}
        hint={Math.abs(deltaStreams) > 1 ? fmtDelta(deltaStreams) : "alinhado ao snapshot"}
        domain="campaigns"
      />
      <KpiBig
        icon={CalendarClock}
        label="Diário necessário"
        value={formatInt(Math.round(planned / days))}
        hint={`em ${days} dias`}
        domain="deals"
      />
      <KpiBig
        icon={DollarSign}
        label="Custo"
        value={formatBRL(custoPlanejado)}
        hint={Math.abs(deltaCusto) > 0.5 ? fmtDeltaBRL(deltaCusto) : "alinhado ao snapshot"}
        domain="clients"
      />
      <KpiBig
        icon={Target}
        label="Cobertura"
        value={`${cobertura.toFixed(0)}%`}
        hint="do alvo eco"
        domain="curators"
      />
      <KpiBig
        tier="quiet"
        icon={Music}
        label="Playlists"
        value={String(allocations.length)}
        hint="no plano"
        domain="playlists"
      />
    </section>
  );
}


