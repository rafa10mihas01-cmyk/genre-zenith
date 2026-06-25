import { useAnalysisSnapshot } from "./useAnalysisSnapshot";

export type SnapshotGate =
  | { kind: "no_snapshot"; isProcessing: false; isReady: false; isFailed: false; readyAt: null; failureReason: null; snapshot: null }
  | { kind: "processing";  isProcessing: true;  isReady: false; isFailed: false; readyAt: null; failureReason: null; snapshot: any }
  | { kind: "ready";       isProcessing: false; isReady: true;  isFailed: false; readyAt: string; failureReason: null; snapshot: any }
  | { kind: "failed";      isProcessing: false; isReady: false; isFailed: true;  readyAt: string | null; failureReason: string | null; snapshot: any };

/**
 * Phase 4.2 — Snapshot Gate.
 *
 * Único ponto que decide se a UI pode consumir as tabelas canônicas
 * (playlist_brain, playlist_diagnoses, playlist_ecosystem_score) ou se
 * deve aguardar/exibir estado intermediário.
 *
 * Contrato: UI NUNCA renderiza dados parciais. Sempre olha esse gate primeiro.
 *
 * - `no_snapshot`  → pré-existente (legado), pode renderizar legado como fallback.
 * - `processing`   → bloqueia render e exibe banner.
 * - `ready`        → libera leitura das tabelas canônicas (consistentes).
 * - `failed`       → exibe motivo e oferece fallback ao último `ready` anterior.
 */
export function useSnapshotGate(playlistId: string | null | undefined): {
  loading: boolean;
  gate: SnapshotGate;
} {
  const q = useAnalysisSnapshot(playlistId ?? null);
  const data = q.data;

  if (q.isLoading || !data) {
    return {
      loading: true,
      gate: { kind: "no_snapshot", isProcessing: false, isReady: false, isFailed: false, readyAt: null, failureReason: null, snapshot: null },
    };
  }

  const latest = data.latest;

  // Nunca houve snapshot — UI pode renderizar legado (compat).
  if (!latest) {
    return {
      loading: false,
      gate: { kind: "no_snapshot", isProcessing: false, isReady: false, isFailed: false, readyAt: null, failureReason: null, snapshot: null },
    };
  }

  if (latest.status === "pending" || latest.status === "processing") {
    return {
      loading: false,
      gate: { kind: "processing", isProcessing: true, isReady: false, isFailed: false, readyAt: null, failureReason: null, snapshot: latest },
    };
  }

  if (latest.status === "ready") {
    return {
      loading: false,
      gate: { kind: "ready", isProcessing: false, isReady: true, isFailed: false, readyAt: latest.ready_at ?? latest.updated_at, failureReason: null, snapshot: latest },
    };
  }

  // failed / superseded — usa `ready` anterior como fallback explícito.
  return {
    loading: false,
    gate: {
      kind: "failed",
      isProcessing: false,
      isReady: false,
      isFailed: true,
      readyAt: data.ready?.ready_at ?? null,
      failureReason: latest.failure_reason ?? null,
      snapshot: latest,
    },
  };
}
