import { Activity, Target, Gauge, CalendarDays } from "lucide-react";
import { KpiBig } from "@/components/KpiBig";
import { formatInt } from "@/lib/campaignEngine";
import type { CampaignSnapshot } from "@/lib/campaignSnapshot";
import { deliveryPct } from "@/lib/campaignPct";

type Props = {
  snapshot: CampaignSnapshot;
  delivered: number;
  daysElapsed: number;
};

export function CampaignKpis({ snapshot, delivered, daysElapsed }: Props) {
  const pct = deliveryPct(delivered, snapshot.meta);
  const curva = Array.isArray(snapshot.curva) ? snapshot.curva : [];
  const plannedToDate = curva.slice(0, daysElapsed).reduce((s, p) => s + p.streamsDay, 0);
  const adherence = plannedToDate > 0 ? Math.round((delivered / plannedToDate) * 100) : 0;

  return (
    <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <KpiBig
        tier="hero"
        icon={Activity}
        label="Entregue"
        value={formatInt(delivered)}
        hint={`${pct}% da meta`}
        domain="campaigns"
      />
      <KpiBig
        icon={Target}
        label="Meta"
        value={formatInt(snapshot.meta)}
        hint="streams"
        domain="deals"
      />
      <KpiBig
        icon={Gauge}
        label="Aderência"
        value={`${adherence}%`}
        hint={`vs ${formatInt(plannedToDate)} planejados`}
        domain={adherence >= 85 ? "campaigns" : "system"}
      />
      <KpiBig
        tier="quiet"
        icon={CalendarDays}
        label="Duração"
        value={`${snapshot.days}d`}
        hint={snapshot.modo === "simultaneo" ? "simultâneo" : "sequencial"}
        domain="curators"
      />
    </section>
  );
}
