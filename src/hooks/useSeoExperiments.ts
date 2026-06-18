import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type SeoExperiment = {
  id: string;
  playlist_id: string;
  genre_id: string | null;
  field: "name" | "description";
  pattern_key: string | null;
  pattern_label: string | null;
  version_before: string;
  version_after: string;
  reasoning: string | null;
  status: "proposed" | "active" | "completed" | "rolled_back" | "rejected";
  baseline_followers: number | null;
  baseline_at: string | null;
  applied_at: string | null;
  measure_due_at: string | null;
  measured_followers: number | null;
  measured_at: string | null;
  delta_followers: number | null;
  delta_pct: number | null;
  outcome: "positive" | "neutral" | "negative" | null;
  created_at: string;
};

export type SeoLesson = {
  id: string;
  genre_id: string;
  pattern_key: string;
  pattern_label: string;
  field: "name" | "description";
  samples_count: number;
  positive_count: number;
  neutral_count: number;
  negative_count: number;
  avg_delta_pct: number | null;
  confidence: number | null;
  last_updated_at: string;
};

export function useSeoExperiments(playlistId?: string) {
  return useQuery({
    queryKey: ["seo_experiments", playlistId],
    enabled: !!playlistId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("playlist_seo_experiments")
        .select("*")
        .eq("playlist_id", playlistId!)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as unknown as SeoExperiment[];
    },
  });
}

export function useSuggestSeoExperiment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { playlistId: string; field?: "name" | "description" }) => {
      const { data, error } = await supabase.functions.invoke("seo-experiment-suggest", {
        body: { playlist_id: args.playlistId, field: args.field },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Falha ao gerar sugestão");
      return data.experiment as SeoExperiment;
    },
    onSuccess: (_, args) => {
      qc.invalidateQueries({ queryKey: ["seo_experiments", args.playlistId] });
      toast.success("Sugestão gerada");
    },
    onError: (e: Error) => toast.error(e?.message ?? "Erro ao gerar sugestão"),
  });
}

export function useApplySeoExperiment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { experimentId: string; playlistId: string }) => {
      const { data, error } = await supabase.functions.invoke("seo-experiment-apply", {
        body: { experiment_id: args.experimentId },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Falha ao aplicar");
      return data;
    },
    onSuccess: (_, args) => {
      qc.invalidateQueries({ queryKey: ["seo_experiments", args.playlistId] });
      toast.success("Experimento aplicado no Spotify");
    },
    onError: (e: Error) => toast.error(e?.message ?? "Erro ao aplicar"),
  });
}

export function useRejectSeoExperiment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { experimentId: string; playlistId: string }) => {
      const { error } = await supabase
        .from("playlist_seo_experiments")
        .update({ status: "rejected", updated_at: new Date().toISOString() })
        .eq("id", args.experimentId);
      if (error) throw error;
    },
    onSuccess: (_, args) => {
      qc.invalidateQueries({ queryKey: ["seo_experiments", args.playlistId] });
      toast.success("Sugestão descartada");
    },
    onError: (e: Error) => toast.error(e?.message ?? "Erro ao descartar"),
  });
}

export function useSeoLessons(genreId?: string | null) {
  return useQuery({
    queryKey: ["seo_lessons", genreId ?? "all"],
    queryFn: async () => {
      let q = supabase.from("seo_genre_lessons").select("*").order("avg_delta_pct", { ascending: false });
      if (genreId) q = q.eq("genre_id", genreId);
      const { data, error } = await q.limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as SeoLesson[];
    },
  });
}
