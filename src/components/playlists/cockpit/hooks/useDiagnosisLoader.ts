// useDiagnosisLoader — Fase 4B.3A: agora usa React Query (dedup + cache).
// API pública preservada: { diag, setDiag, loading, loadLatest }.
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePlaylistDiagnosis } from "@/hooks/useCockpitQueries";
import type { Diagnosis } from "../types";

type DiagSetter = React.Dispatch<React.SetStateAction<Diagnosis | null>>;

export function useDiagnosisLoader(managedId: string) {
  const qc = useQueryClient();
  const q = usePlaylistDiagnosis(managedId);
  const key = ["playlist-diagnosis", managedId] as const;

  const setDiag: DiagSetter = useCallback(
    (updater) => {
      qc.setQueryData<Diagnosis | null>(key as any, (prev) => {
        const current = (prev ?? null) as Diagnosis | null;
        return typeof updater === "function"
          ? (updater as (p: Diagnosis | null) => Diagnosis | null)(current)
          : (updater as Diagnosis | null);
      });
    },
    [qc, managedId],
  );

  const loadLatest = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: key as any });
  }, [qc, managedId]);

  return {
    diag: (q.data ?? null) as Diagnosis | null,
    setDiag,
    loading: q.isLoading,
    loadLatest,
  } as const;
}
