import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type OnboardingChecklist = {
  name_ok: boolean;
  description_ok: boolean;
  min_tracks_ok: boolean;
  cover_ok: boolean;
  niche_alignment_ok: boolean;
  niche_alignment_score: number;
  blocking_issues: string[];
  hints: string[];
  ready_for_deals: boolean;
  checked_at: string;
};

export type PlaylistLifecycle = {
  id: string;
  lifecycle_stage: "onboarding" | "testing" | "mature";
  onboarding_checklist: OnboardingChecklist | null;
  onboarding_completed_at: string | null;
  onboarding_ready_streak: number;
  last_onboarding_check_at: string | null;
};

/** Carrega o estágio de ciclo de vida da managed_playlist. */
export function usePlaylistOnboarding(managedId?: string) {
  return useQuery({
    queryKey: ["playlist_onboarding", managedId],
    enabled: !!managedId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("managed_playlists")
        .select(
          "id, lifecycle_stage, onboarding_checklist, onboarding_completed_at, onboarding_ready_streak, last_onboarding_check_at",
        )
        .eq("id", managedId!)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as PlaylistLifecycle | null;
    },
  });
}

/** Reavalia o checklist sob demanda. */
export function useRecheckOnboarding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (managedId: string) => {
      const { data, error } = await supabase.functions.invoke("playlist-onboarding-check", {
        body: { playlist_id: managedId },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Falha ao reavaliar");
      return data;
    },
    onSuccess: (_, managedId) => {
      qc.invalidateQueries({ queryKey: ["playlist_onboarding", managedId] });
      toast.success("Checklist atualizado");
    },
    onError: (e: Error) => toast.error(e?.message ?? "Erro ao reavaliar"),
  });
}
