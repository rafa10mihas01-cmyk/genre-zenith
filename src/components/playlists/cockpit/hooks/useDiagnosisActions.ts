// useDiagnosisActions — encapsula as mutações do diagnostico/plano + arquivamento.
// Toda a lógica foi movida 1:1 do PlaylistCockpit.tsx (Fase 2 / Commit 3).
// Nenhuma query, fetch, toast ou efeito foi alterado.
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { Diagnosis } from "../types";

type ApplyAction = "remove" | "demote" | "promote" | "add" | "all";
type ApplyProgress = {
  index: number;
  total: number;
  description: string;
  status: "running" | "done" | "skipped" | "failed";
  error?: string;
} | null;

export function useDiagnosisActions(args: {
  managedId: string;
  playlistName: string;
  tracksCount: number;
  setDiag: React.Dispatch<React.SetStateAction<Diagnosis | null>>;
  onBack?: () => void;
}) {
  const { managedId, playlistName, tracksCount, setDiag, onBack } = args;
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState<ApplyAction | null>(null);
  const [applyProgress, setApplyProgress] = useState<ApplyProgress>(null);
  const [liveTracksCount, setLiveTracksCount] = useState(tracksCount);
  const [archiving, setArchiving] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => { setLiveTracksCount(tracksCount); }, [tracksCount]);

  const runDiagnose = useCallback(async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("diagnose-managed-playlist", {
        body: { playlist_id: managedId },
      });
      if (error || !data?.ok) throw new Error(error?.message ?? data?.error ?? "Falha");
      setDiag(data.diagnosis);
      toast({ title: "Diagnóstico pronto" });
    } catch (e: any) {
      toast({ title: "Erro no diagnóstico", description: e.message, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  }, [managedId, setDiag]);

  const applyPlan = useCallback(async (action: ApplyAction) => {
    setApplying(action);
    setApplyProgress(null);
    let completed: any = null;
    let lastError: string | null = null;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/apply-playlist-plan`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ playlist_id: managedId, action, stream: true }),
      });

      if (!resp.ok || !resp.body) {
        const txt = await resp.text().catch(() => "");
        let parsed: any = null;
        try { parsed = JSON.parse(txt); } catch { /* */ }
        toast({
          title: `Erro ${resp.status}`,
          description: parsed?.error ?? txt ?? "falha ao iniciar execução",
          variant: "destructive",
        });
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";
        for (const block of lines) {
          const line = block.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          let evt: any;
          try { evt = JSON.parse(line.slice(6)); } catch { continue; }
          if (evt.type === "start") {
            setApplyProgress({
              index: 0,
              total: evt.total ?? 0,
              description: evt.total ? `Iniciando ${evt.total} ações…` : "Sem ações a executar",
              status: "running",
            });
          } else if (evt.type === "step") {
            setApplyProgress({
              index: evt.index,
              total: evt.total,
              description: evt.description ?? `Executando ${evt.index} de ${evt.total}`,
              status: evt.status,
              error: evt.error,
            });
            if (evt.status === "failed") {
              lastError = `Falhou em ${evt.index}/${evt.total}: ${evt.description ?? evt.kind} — ${evt.error ?? "erro"}`;
            }
          } else if (evt.type === "complete") {
            completed = evt;
          }
        }
      }

      if (typeof completed?.current_tracks_count === "number") {
        setLiveTracksCount(completed.current_tracks_count);
      }

      if (completed?.ok === false || lastError) {
        toast({
          title: "Plano interrompido",
          description: lastError ?? completed?.error ?? "erro durante execução",
          variant: "destructive",
        });
      } else {
        const executed = completed?.executed ?? 0;
        const total = completed?.total ?? 0;
        toast({
          title: action === "all" ? "Plano executado" : "Bucket aplicado",
          description: total === 0 ? "sem alterações necessárias" : `${executed}/${total} ações concluídas`,
        });
      }

      if (action === "all") {
        runDiagnose();
      } else {
        setDiag((prev) => {
          if (!prev) return prev;
          const next: any = { ...prev };
          if (action === "remove" || action === "demote" || action === "promote") {
            next.tracks_analysis = (prev.tracks_analysis ?? []).filter(
              (t: any) => t.status !== action,
            );
          }
          if (action === "add") {
            next.tracks_suggestions = [];
          }
          return next;
        });
      }
    } catch (e: any) {
      toast({
        title: "Falha ao aplicar",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
    } finally {
      setApplying(null);
      // mantém o progresso visível por 2.5s pra usuário ver o estado final
      setTimeout(() => setApplyProgress(null), 2500);
    }
  }, [managedId, runDiagnose, setDiag]);

  const handleArchive = useCallback(async () => {
    if (!confirm(`Mover "${playlistName}" para a lixeira?`)) return;
    setArchiving(true);
    const { error } = await supabase.functions.invoke("archive-managed-playlist", {
      body: { playlist_id: managedId, restore: false },
    });
    setArchiving(false);
    if (error) {
      toast({ title: "Erro ao arquivar", description: error.message, variant: "destructive" });
      return;
    }
    // Atualiza cache local imediatamente (otimista) + invalida pra refetch ao chegar em /catalogo.
    queryClient.setQueryData<any[]>(["managed-playlists"], (prev) =>
      (prev ?? []).map((p) => (p.id === managedId ? { ...p, archived_at: new Date().toISOString() } : p)),
    );
    queryClient.invalidateQueries({ queryKey: ["managed-playlists"] });
    toast({ title: "Movida para lixeira", description: "Você pode restaurar em Catálogo › Lixeira." });
    if (onBack) onBack(); else navigate("/catalogo");
  }, [managedId, playlistName, onBack, navigate, queryClient]);

  return {
    running,
    applying,
    applyProgress,
    liveTracksCount,
    setLiveTracksCount,
    archiving,
    runDiagnose,
    applyPlan,
    handleArchive,
  } as const;
}
