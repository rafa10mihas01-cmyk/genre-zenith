// Fase 14.1 — hooks únicos de consumo do overview consolidado.
// Toda tela (Cliente, Campanha, Financeiro, Cockpit, Home) deve usar EXCLUSIVAMENTE estes hooks.
import { useQuery } from "@tanstack/react-query";
import {
  getCampaignOverview,
  getClientOverview,
  getCockpitOverview,
} from "@/services/campaignOverview";

const STALE = 30_000;

export function useCampaignOverview(campaignId: string | undefined | null) {
  return useQuery({
    queryKey: ["overview", "campaign", campaignId],
    enabled: !!campaignId,
    staleTime: STALE,
    queryFn: () => getCampaignOverview(campaignId!),
  });
}

export function useClientOverview(clientId: string | undefined | null) {
  return useQuery({
    queryKey: ["overview", "client", clientId],
    enabled: !!clientId,
    staleTime: STALE,
    queryFn: () => getClientOverview(clientId!),
  });
}

export function useCockpitOverview() {
  return useQuery({
    queryKey: ["overview", "cockpit"],
    staleTime: STALE,
    queryFn: () => getCockpitOverview(),
  });
}
