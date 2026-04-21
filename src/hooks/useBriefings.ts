import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type DnaVisual = {
  cores_dominantes: string[];
  estilo_dominante: string;
  uso_texto: string;
  presenca_emoji: boolean;
  ano_visivel: boolean;
  estrutura_visual: string;
  atmosfera: string;
  recomendacao_criacao: string;
  capas_analisadas?: { nome: string; url: string }[];
  analyzed_at?: string;
};

export type PlaylistRef = {
  nome: string;
  seguidores: number;
  spotify_url: string | null;
  imagem_url: string | null;
};

export type PlaylistBriefing = {
  nome: string;
  forca_nome: number;
  formato: string;
  formato_id: string;
  confidence: "alta" | "media" | "baixa";
  origem?: "strict" | "expansao";
  subgenero?: { slug: string; nome: string } | null;
  keywords_utilizadas: { value: string; peso: number }[];
  base_musical: {
    top_musicas: { nome: string; artista: string }[];
    artistas_principais: string[];
  };
  playlists_referencia?: PlaylistRef[];
  metricas?: {
    media_seguidores: number;
    total_referencias: number;
  };
  dna_capa: DnaVisual | null;
  justificativa: {
    frequencia_padrao_pct: number;
    repeticao_em_playlists: number;
    score: number;
    sinal: string;
    subgenero_peso_pct?: number | null;
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
  const [analyzingDna, setAnalyzingDna] = useState(false);

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

  const analyzeVisualDna = useCallback(async () => {
    if (!genreId || analyzingDna) return;
    setAnalyzingDna(true);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-genre-visual-dna", {
        body: { genre_id: genreId },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Falha ao analisar DNA visual");
      // Após analisar DNA, regenera briefing pra incluir
      await regenerate();
      return data;
    } finally {
      setAnalyzingDna(false);
    }
  }, [genreId, analyzingDna, regenerate]);

  return { loading, briefing, generating, regenerate, reload: load, analyzeVisualDna, analyzingDna };
}
