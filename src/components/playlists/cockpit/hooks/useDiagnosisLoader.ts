// useDiagnosisLoader — Fase 4.5: agora consome a variante GATEADA pelo Analysis Snapshot.
// Durante `processing`/`failed`, `diag` vem null e `loading` reflete o gate.
// API pública preservada: { diag, setDiag, loading, loadLatest } + novo opcional `gate`.
import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePlaylistDiagnosisGated } from "@/hooks/useCockpitQueries";
import type { Diagnosis } from "../types";

type DiagSetter = React.Dispatch<React.SetStateAction<Diagnosis | null>>;

export function useDiagnosisLoader(managedId: string) {
  const qc = useQueryClient();
  const { diag, isLoading, gate } = usePlaylistDiagnosisGated(managedId);
  const key = useMemo(
    () => ["playlist-diagnosis-gated", managedId, gate.kind] as const,
    [managedId, gate.kind],
  );

  const setDiag: DiagSetter = useCallback(
    (updater) => {
      qc.setQueryData<Diagnosis | null>(key as any, (prev) => {
        const current = (prev ?? null) as Diagnosis | null;
        return typeof updater === "function"
          ? (updater as (p: Diagnosis | null) => Diagnosis | null)(current)
          : (updater as Diagnosis | null);
      });
    },
    [qc, key],
  );

  const loadLatest = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ["playlist-diagnosis-gated", managedId] as any });
  }, [qc, managedId]);

  return {
    diag: (diag ?? null) as Diagnosis | null,
    setDiag,
    loading: isLoading,
    loadLatest,
    gate,
  } as const;
}
