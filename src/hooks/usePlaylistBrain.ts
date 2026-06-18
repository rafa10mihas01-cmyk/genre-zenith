import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type BrainSignal = {
  code: string;
  severity: "low" | "medium" | "high";
  message: string;
  detected_at: string;
};

export type BrainRecommendation = {
  priority: number;
  action: string;
  reason: string;
};

export type RoadmapStep = {
  cycle: number;
  delta: number;
  total: number;
  action: "build" | "trim";
  phase: string;
};

export type LifecyclePhase = "seed" | "growth" | "mature" | "bloated" | "decline";

export type PlaylistBrain = {
  id: string;
  playlist_id: string;
  identity: {
    nicho?: string | null;
    keywords_matched?: string[];
    keywords_total?: number;
    has_genre?: boolean;
  };
  personality: {
    total_tracks?: number;
    freq_update_dias?: number | null;
    snapshots_count?: number;
  };
  capacity_total: number | null;
  capacity_per_slot: number | null;
  capacity_ceiling: number | null;
  headroom_pct: number | null;
  health_trend: "crescendo" | "estavel" | "encolhendo" | "novo" | "sem_dados";
  signals: BrainSignal[];
  recommendations: BrainRecommendation[];
  confidence_score: number;
  last_calculated_at: string;
  lifecycle_phase: LifecyclePhase | null;
  benchmark_tracks: number | null;
  ratio_to_benchmark: number | null;
  growth_roadmap: RoadmapStep[];
  metadata: Record<string, any>;
};

export type BrainHistoryPoint = {
  capacity_total: number | null;
  capacity_per_slot: number | null;
  health_score: number | null;
  signals_count: number;
  confidence_score: number;
  calculated_at: string;
};

/** Carrega o cérebro vivo da playlist (1 linha por playlist). */
export function usePlaylistBrain(playlistId?: string) {
  return useQuery({
    queryKey: ["playlist_brain", playlistId],
    enabled: !!playlistId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("playlist_brain")
        .select("*")
        .eq("playlist_id", playlistId!)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as PlaylistBrain | null;
    },
  });
}

/** Histórico leve para gráficos de trend. */
export function usePlaylistBrainHistory(playlistId?: string, limit = 30) {
  return useQuery({
    queryKey: ["playlist_brain_history", playlistId, limit],
    enabled: !!playlistId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("playlist_brain_history")
        .select("capacity_total, capacity_per_slot, health_score, signals_count, confidence_score, calculated_at")
        .eq("playlist_id", playlistId!)
        .order("calculated_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as BrainHistoryPoint[];
    },
  });
}

/** Recalcula sob demanda (chama edge function). */
export function useRecalcPlaylistBrain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (playlistId: string) => {
      const { data, error } = await supabase.functions.invoke("playlist-brain-calc", {
        body: { playlist_id: playlistId },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Falha ao recalcular");
      return data;
    },
    onSuccess: (_, playlistId) => {
      qc.invalidateQueries({ queryKey: ["playlist_brain", playlistId] });
      qc.invalidateQueries({ queryKey: ["playlist_brain_history", playlistId] });
      toast.success("Cérebro atualizado");
    },
    onError: (e: Error) => toast.error(e?.message ?? "Erro ao recalcular"),
  });
}

/** Roda o diagnóstico de IA (gaps de nome, sugestões de faixas) e recalcula o cérebro. */
export function useDiagnoseManagedPlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { managedId: string; playlistId: string }) => {
      const { data, error } = await supabase.functions.invoke("diagnose-managed-playlist", {
        body: { playlist_id: args.managedId },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Falha ao diagnosticar");
      // Recalcula o cérebro pra refletir o novo last_diagnosis_at e remover o sinal
      const { error: calcErr } = await supabase.functions.invoke("playlist-brain-calc", {
        body: { playlist_id: args.playlistId },
      });
      if (calcErr) throw calcErr;
      return data;
    },
    onSuccess: (_, args) => {
      qc.invalidateQueries({ queryKey: ["playlist_brain", args.playlistId] });
      qc.invalidateQueries({ queryKey: ["playlist_brain_history", args.playlistId] });
      toast.success("Diagnóstico concluído");
    },
    onError: (e: Error) => toast.error(e?.message ?? "Erro ao diagnosticar"),
  });
}

