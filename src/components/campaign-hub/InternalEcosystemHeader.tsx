import { BarChart3, CalendarClock, DollarSign, Target, Music } from "lucide-react";

import { formatBRL, formatInt } from "@/lib/campaignEngine";
import type { CampaignSnapshot } from "@/lib/campaignSnapshot";
import type { EcoAllocation } from "./types";
import { KpiBig } from "@/components/KpiBig";

/**
 * Header do Ecossistema (planejamento). Mostra apenas valores de PLANO
 * (allocations + snapshot). A entrega REAL é responsabilidade dos
 * componentes de execução que consomem vw_campaign_playlist_growth —
 * este header não deve mais somar campaign_eco_snapshots.plays_28d.
 */
export function InternalEcosystemHeader({
  snapshot,
  allocations,
}: {
  snapshot: CampaignSnapshot;
  allocations: EcoAllocation[];
}) {
  const planned = allocations.reduce((s, a) => s + Number(a.planned_streams || 0), 0);

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
