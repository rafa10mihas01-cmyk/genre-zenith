// useDiagnosisLoader — carrega o último diagnostico da playlist (extraído sem
// mudar a query nem a forma do retorno). Fase 2 / Commit 3.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Diagnosis } from "../types";

export function useDiagnosisLoader(managedId: string) {
  const [diag, setDiag] = useState<Diagnosis | null>(null);
  const [loading, setLoading] = useState(true);

  const loadLatest = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("playlist_diagnoses")
      .select("id, created_at, name_current, name_suggestion, name_score, tracks_analysis, tracks_suggestions, tracks_summary, raw")
      .eq("playlist_id", managedId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setDiag((data as any) ?? null);
    setLoading(false);
  }, [managedId]);

  useEffect(() => { loadLatest(); }, [loadLatest]);

  return { diag, setDiag, loading, loadLatest } as const;
}
