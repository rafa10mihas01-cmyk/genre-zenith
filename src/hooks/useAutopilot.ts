// useAutopilot — hook que assina autopilot_runs por gênero e devolve status em tempo real.
//
// Uso:
//   const { run, isRunning, start, error } = useAutopilot(genreId);
//   <Button onClick={start} disabled={isRunning}>...</Button>
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type AutopilotStep =
  | "analyze"
  | "briefing"
  | "blueprints"
  | "templates"
  | "covers"
  | "approve"
  | "replicate"
  | "done";

export type AutopilotRun = {
  id: string;
  genre_id: string;
  status: "running" | "success" | "error" | "partial";
  current_step: AutopilotStep | null;
  progress_pct: number;
  steps_completed: Array<{ step: AutopilotStep; at: string; [k: string]: unknown }>;
  templates_generated: number;
  templates_approved: number;
  covers_generated: number;
  cache_hits: Record<string, boolean>;
  summary: string | null;
  error_message: string | null;
  triggered_by: string;
  started_at: string;
  finished_at: string | null;
  duracao_ms: number | null;
};

export const STEP_LABELS: Record<AutopilotStep, string> = {
  analyze: "Analisando gênero",
  briefing: "Gerando briefing",
  blueprints: "Extraindo blueprints",
  templates: "Criando templates",
  covers: "Gerando capas",
  approve: "Aprovando vencedores",
  replicate: "Preparando replicação",
  done: "Concluído",
};

export function useAutopilot(genreId: string | null | undefined) {
  const [run, setRun] = useState<AutopilotRun | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Carrega a run mais recente do gênero (running ou recente)
  useEffect(() => {
    if (!genreId) { setRun(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("autopilot_runs")
        .select("*")
        .eq("genre_id", genreId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) setRun((data as AutopilotRun | null) ?? null);
    })();
    return () => { cancelled = true; };
  }, [genreId]);

  // Realtime: escuta INSERT/UPDATE da tabela filtrado por gênero
  useEffect(() => {
    if (!genreId) return;
    const channel = supabase
      .channel(`autopilot:${genreId}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "autopilot_runs",
          filter: `genre_id=eq.${genreId}`,
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as AutopilotRun;
          if (!row) return;
          setRun((prev) => {
            // Se chegou uma run mais recente, troca; se é update da current, atualiza
            if (!prev || prev.id === row.id || new Date(row.started_at) >= new Date(prev.started_at)) {
              return row;
            }
            return prev;
          });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [genreId]);

  const start = useCallback(async (maxTemplates = 5, opts?: { force?: boolean }) => {
    if (!genreId) return;
    setStarting(true);
    setError(null);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke("genre-autopilot", {
        body: { genre_id: genreId, max_templates: maxTemplates, force: opts?.force === true },
      });
      if (invokeErr) throw new Error(invokeErr.message);
      if (data?.ok === false) {
        setError(data.error ?? "Erro desconhecido");
        if (data?.cooldown) {
          toast.error(data.error ?? "Cooldown ativo", {
            description: "Use 'Forçar execução' para ignorar o cooldown.",
          });
        } else {
          toast.error(data.error ?? "Não foi possível iniciar a inteligência");
        }
        return null;
      }
      toast.success("Inteligência iniciada", { description: "Acompanhe o progresso em tempo real" });
      return data?.run_id as string;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error("Falha ao iniciar inteligência", { description: msg });
      return null;
    } finally {
      setStarting(false);
    }
  }, [genreId]);

  const isRunning = run?.status === "running" || starting;

  return { run, isRunning, starting, start, error };
}
