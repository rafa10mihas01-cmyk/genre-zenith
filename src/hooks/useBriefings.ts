import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type PlaylistBriefing = {
  nome: string;
  forca_nome: number;
  formato: string;
  formato_id: string;
  keywords_utilizadas: { value: string; peso: number }[];
  base_musical: {
    top_musicas: { nome: string; artista: string }[];
    artistas_principais: string[];
  };
  dna_capa: {
    estilo_dominante: string;
    cores: string[];
    uso_texto: string;
    estrutura_visual: string;
  };
  justificativa: {
    frequencia_padrao_pct: number;
    repeticao_em_playlists: number;
    sinal: string;
  };
};

export type BriefingRow = {
  id: string;
  genre_id: string;
  version: number;
  created_at: string;
  briefings: PlaylistBriefing[];
  metadata: any;
};

export function useBriefings(genreId: string | undefined) {
  const [loading, setLoading] = useState(true);
  const [briefing, setBriefing] = useState<BriefingRow | null>(null);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    if (!genreId) return;
    setLoading(true);
    try {
      const { data } = await supabase
        .from("playlist_briefings")
        .select("*")
        .eq("genre_id", genreId)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      setBriefing(data as BriefingRow | null);
    } finally {
      setLoading(false);
    }
  }, [genreId]);

  useEffect(() => { load(); }, [load]);

  const regenerate = useCallback(async () => {
    if (!genreId || generating) return;
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-playlists-briefing", {
        body: { genre_id: genreId },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Falha ao gerar briefing");
      await load();
      return data;
    } finally {
      setGenerating(false);
    }
  }, [genreId, generating, load]);

  return { loading, briefing, generating, regenerate, reload: load };
}
