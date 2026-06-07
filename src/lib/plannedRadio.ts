// plannedRadio — reuso semântico do bucket Organic como "Rádio Planejada".
// IMPORTANTE: não altera nada do campaignEngine. O bucket continua sendo
// streamsOrganic / custoOrganic / splitOrganicPct no snapshot. Apenas
// re-interpretamos esse valor como alocação operacional da Rádio.
import type { CampaignSnapshot } from "./campaignSnapshot";

/** Streams planejados pra Rádio (alocação operacional, não estimativa). */
export function plannedRadioStreams(snapshot: Pick<CampaignSnapshot, "streamsOrganic">): number {
  return Math.max(0, Math.round(snapshot.streamsOrganic ?? 0));
}

/** Custo planejado da Rádio = streams × CPP do Ecossistema (herdado). */
export function plannedRadioCost(
  snapshot: Pick<CampaignSnapshot, "streamsOrganic" | "custoOrganic" | "streamsEco" | "custoEco">,
): number {
  // Prioriza custoOrganic do snapshot (já calculado pelo engine).
  if (snapshot.custoOrganic != null) return Math.max(0, snapshot.custoOrganic);
  const cppEco = snapshot.streamsEco > 0 ? snapshot.custoEco / snapshot.streamsEco : 0;
  return plannedRadioStreams(snapshot) * cppEco;
}

/** % da meta destinada à Rádio (lido do snapshot, sem recalcular). */
export function plannedRadioPct(snapshot: Pick<CampaignSnapshot, "splitOrganicPct">): number {
  return Math.max(0, Math.round(snapshot.splitOrganicPct ?? 0));
}
