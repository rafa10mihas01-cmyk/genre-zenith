import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useSnapshotGate, type SnapshotGate } from "./useSnapshotGate";

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

/**
 * Phase 4.2 — leitura do Brain gateada por Analysis Snapshot.
 *
 * Garante o contrato "nunca misturar estados":
 *  - Enquanto o snapshot estiver `processing`, retorna `brain=null` + `gate.isProcessing=true`.
 *  - Quando `ready`, libera a leitura de `playlist_brain` (consistente com o pipeline).
 *  - Quando `failed`, retorna `brain=null` e expõe `gate.failureReason` para a UI decidir o fallback.
 *  - Quando `no_snapshot` (legado pré-pipeline), mantém a leitura legada como compat.
 */
export function usePlaylistBrainGated(playlistId?: string): {
  brain: PlaylistBrain | null;
  isLoading: boolean;
  gate: SnapshotGate;
} {
  const { loading: gateLoading, gate } = useSnapshotGate(playlistId);

  const canRead = gate.kind === "ready" || gate.kind === "no_snapshot";
  const q = useQuery({
    queryKey: ["playlist_brain_gated", playlistId, gate.kind],
    enabled: !!playlistId && canRead,
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

  return {
    brain: canRead ? (q.data ?? null) : null,
    isLoading: gateLoading || (canRead && q.isLoading),
    gate,
  };
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

/** Recalcula sob demanda via Snapshot Único (analysis-orchestrator, trigger=manual_reanalyze). */
export function useRecalcPlaylistBrain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (playlistId: string) => {
      const { data, error } = await supabase.functions.invoke("analysis-orchestrator", {
        body: { playlist_id: playlistId, trigger_event: "manual_reanalyze" },
      });
      if (error) throw error;
      if (!data?.ok && data?.status === "rejected") {
        throw new Error(data?.reason ?? "Falha ao recalcular");
      }
      return data;
    },
    onSuccess: (_, playlistId) => {
      qc.invalidateQueries({ queryKey: ["playlist_brain", playlistId] });
      qc.invalidateQueries({ queryKey: ["playlist_brain_history", playlistId] });
      qc.invalidateQueries({ queryKey: ["analysis_snapshot", playlistId] });
      toast.success("Reanálise iniciada");
    },
    onError: (e: Error) => toast.error(e?.message ?? "Erro ao recalcular"),
  });
}

/** Dispara reanálise completa (sync→dna→diagnose→brain→score) via Snapshot Único. */
export function useDiagnoseManagedPlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { managedId: string; playlistId: string }) => {
      const { data, error } = await supabase.functions.invoke("analysis-orchestrator", {
        body: { playlist_id: args.playlistId, trigger_event: "manual_reanalyze" },
      });
      if (error) throw error;
      if (!data?.ok && data?.status === "rejected") {
        throw new Error(data?.reason ?? "Falha ao diagnosticar");
      }
      return data;
    },
    onSuccess: (_, args) => {
      qc.invalidateQueries({ queryKey: ["playlist_brain", args.playlistId] });
      qc.invalidateQueries({ queryKey: ["playlist_brain_history", args.playlistId] });
      qc.invalidateQueries({ queryKey: ["analysis_snapshot", args.playlistId] });
      toast.success("Diagnóstico iniciado");
    },
    onError: (e: Error) => toast.error(e?.message ?? "Erro ao diagnosticar"),
  });
}


