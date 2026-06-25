import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type SnapshotStatus =
  | "pending"
  | "processing"
  | "ready"
  | "failed"
  | "superseded";

export type SnapshotStep =
  | "sync"
  | "dna"
  | "diagnose"
  | "brain"
  | "score";

export interface AnalysisSnapshotRow {
  id: string;
  playlist_id: string;
  status: SnapshotStatus;
  trigger_event: string | null;
  dna_version: string | null;
  genre_brain_version: string | null;
  market_version: string | null;
  strategy_version: string | null;
  tracks_hash: string | null;
  started_at: string | null;
  ready_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
  metrics: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface AnalysisSnapshotResultRow {
  id: string;
  snapshot_id: string;
  step: SnapshotStep;
  status: SnapshotStatus | "skipped";
  retry_count: number;
  duration_ms: number | null;
  result: Record<string, unknown> | null;
  metrics: Record<string, unknown> | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface AnalysisSnapshotData {
  latest: AnalysisSnapshotRow | null;
  ready: AnalysisSnapshotRow | null;
  results: AnalysisSnapshotResultRow[];
}

/**
 * Unified read for the Analysis Snapshot pipeline.
 * - `latest`  = mais recente independente do status (pode estar processing/failed).
 * - `ready`   = último com status='ready' (fonte oficial pra UI).
 * - `results` = etapas do `ready` (ou do `latest` se nenhum ready existir).
 *
 * Phase 4: a UI deve consumir EXCLUSIVAMENTE este hook quando o snapshot estiver disponível
 * e cair para tabelas legadas apenas durante o backfill.
 */
export function useAnalysisSnapshot(playlistId: string | null | undefined) {
  return useQuery<AnalysisSnapshotData>({
    queryKey: ["analysis_snapshot", playlistId],
    enabled: !!playlistId,
    refetchInterval: (q) => {
      const data = q.state.data as AnalysisSnapshotData | undefined;
      const st = data?.latest?.status;
      // Enquanto estiver processando, faz polling rápido.
      return st === "pending" || st === "processing" ? 4000 : false;
    },
    queryFn: async (): Promise<AnalysisSnapshotData> => {
      if (!playlistId) return { latest: null, ready: null, results: [] };

      const { data: snaps, error } = await supabase
        .from("analysis_snapshots")
        .select("*")
        .eq("playlist_id", playlistId)
        .order("created_at", { ascending: false })
        .limit(5);

      if (error) throw error;

      const list = (snaps ?? []) as AnalysisSnapshotRow[];
      const latest = list[0] ?? null;
      const ready = list.find((s) => s.status === "ready") ?? null;

      const target = ready ?? latest;
      let results: AnalysisSnapshotResultRow[] = [];
      if (target) {
        const { data: rs, error: rErr } = await supabase
          .from("analysis_snapshot_results")
          .select("*")
          .eq("snapshot_id", target.id);
        if (rErr) throw rErr;
        results = (rs ?? []) as AnalysisSnapshotResultRow[];
      }

      return { latest, ready, results };
    },
  });
}
