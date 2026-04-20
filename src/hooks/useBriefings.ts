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

export type Cluster = {
  id: string;
  label: string;
  seed: string;
  size: number;
  playlist_ids: string[];
  media_seguidores: number;
  top_examples: { nome: string; seguidores: number; imagem_url: string | null; spotify_url: string | null }[];
};

export function useBriefings(genreId: string | undefined) {
  const [loading, setLoading] = useState(true);
  const [briefing, setBriefing] = useState<BriefingRow | null>(null);
  const [generating, setGenerating] = useState(false);
  const [analyzingDna, setAnalyzingDna] = useState(false);

  // Clusters
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [loadingClusters, setLoadingClusters] = useState(false);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);

  const load = useCallback(async (clusterId: string | null = null) => {
    if (!genreId) return;
    setLoading(true);
    try {
      // Filtra por cluster_id no metadata (ou null/"todos" pra geral)
      let query = supabase
        .from("playlist_briefings")
        .select("*")
        .eq("genre_id", genreId)
        .order("version", { ascending: false });

      const { data } = await query.limit(50);
      const rows = (data ?? []) as BriefingRow[];
      const match = rows.find(r => {
        const cid = r.metadata?.cluster_id ?? null;
        return clusterId ? cid === clusterId : !cid;
      });
      setBriefing(match ?? null);
    } finally {
      setLoading(false);
    }
  }, [genreId]);

  const loadClusters = useCallback(async () => {
    if (!genreId) return;
    setLoadingClusters(true);
    try {
      const { data, error } = await supabase.functions.invoke("cluster-playlists", {
        body: { genre_id: genreId },
      });
      if (error) throw error;
      setClusters((data?.clusters ?? []) as Cluster[]);
    } catch (e) {
      console.error("loadClusters error", e);
      setClusters([]);
    } finally {
      setLoadingClusters(false);
    }
  }, [genreId]);

  useEffect(() => {
    load(selectedClusterId);
  }, [load, selectedClusterId]);

  useEffect(() => {
    loadClusters();
  }, [loadClusters]);

  const regenerate = useCallback(async () => {
    if (!genreId || generating) return;
    setGenerating(true);
    try {
      const cluster = selectedClusterId ? clusters.find(c => c.id === selectedClusterId) : null;
      const payload: any = { genre_id: genreId };
      if (cluster) {
        payload.cluster_id = cluster.id;
        payload.cluster_label = cluster.label;
        payload.cluster_playlist_ids = cluster.playlist_ids;
      }
      const { data, error } = await supabase.functions.invoke("generate-playlists-briefing", {
        body: payload,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Falha ao gerar briefing");
      await load(selectedClusterId);
      return data;
    } finally {
      setGenerating(false);
    }
  }, [genreId, generating, load, selectedClusterId, clusters]);

  const analyzeVisualDna = useCallback(async () => {
    if (!genreId || analyzingDna) return;
    setAnalyzingDna(true);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-genre-visual-dna", {
        body: { genre_id: genreId },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Falha ao analisar DNA visual");
      await regenerate();
      return data;
    } finally {
      setAnalyzingDna(false);
    }
  }, [genreId, analyzingDna, regenerate]);

  const selectCluster = useCallback((id: string | null) => {
    setSelectedClusterId(id);
  }, []);

  return {
    loading,
    briefing,
    generating,
    regenerate,
    reload: () => load(selectedClusterId),
    analyzeVisualDna,
    analyzingDna,
    clusters,
    loadingClusters,
    selectedClusterId,
    selectCluster,
    reloadClusters: loadClusters,
  };
}
