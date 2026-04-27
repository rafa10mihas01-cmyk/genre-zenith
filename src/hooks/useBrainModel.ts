import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type GenreHealth = "healthy" | "stale" | "dead" | "unknown";
export type Genre = {
  id: string;
  nome: string;
  slug: string;
  total_playlists: number | null;
  total_musicas: number | null;
  total_termos: number | null;
  ultima_coleta: string | null;
  health_status: GenreHealth;
  health_last_seen_at: string | null;
  health_hours_since: number | null;
};
export type GenreModel = {
  id: string;
  genre_id: string | null;
  ultima_analise: string | null;
  updated_at: string | null;
  palavras_chave: { value: string; count: number }[] | null;
  padroes_nome: { value: string; count: number }[] | null;
  playlists_dominantes: any[] | null;
  musicas_recorrentes: any[] | null;
  insights: any | null;
};

export function useBrainModel(slug: string | undefined) {
  const [loading, setLoading] = useState(true);
  const [genre, setGenre] = useState<Genre | null>(null);
  const [model, setModel] = useState<GenreModel | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    try {
      const { data: g, error: ge } = await supabase
        .from("genres_with_health")
        .select("id,nome,slug,total_playlists,total_musicas,total_termos,ultima_coleta,health_status,health_last_seen_at,health_hours_since")
        .eq("slug", slug)
        .maybeSingle();
      if (ge) throw ge;
      if (!g) {
        setGenre(null);
        setModel(null);
        return;
      }
      setGenre({ ...g, health_status: (g.health_status ?? "unknown") as GenreHealth } as Genre);
      const { data: m } = await supabase
        .from("genre_models")
        .select("*")
        .eq("genre_id", g.id)
        .maybeSingle();
      setModel((m as GenreModel) ?? null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { reload(); }, [reload]);

  return { loading, genre, model, error, reload };
}
