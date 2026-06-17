// Hook compartilhado para o último heartbeat do bot.
// Consolidação Fase 4.A.1 — substitui pollings duplicados em vários componentes,
// usando React Query como cache único (staleTime 30s, refetch 60s).
// Não altera comportamento: leitura única da última linha de bot_heartbeats.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type LatestBotHeartbeat = {
  created_at: string | null;
  status: string | null;
  spotify_session_valid: boolean | null;
  message: string | null;
};

const QUERY_KEY = ["bot-heartbeats", "latest"] as const;

export function useLatestBotHeartbeat() {
  return useQuery<LatestBotHeartbeat | null>({
    queryKey: QUERY_KEY,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data } = await supabase
        .from("bot_heartbeats")
        .select("created_at, status, spotify_session_valid, message")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data ?? null) as LatestBotHeartbeat | null;
    },
  });
}
