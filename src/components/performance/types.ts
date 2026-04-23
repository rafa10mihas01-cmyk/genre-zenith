export type DatasetRow = {
  template_id: string;
  genre_id: string | null;
  nome: string;
  spotify_playlist_id: string;
  spotify_url: string | null;
  followers_start: number;
  followers_now: number;
  crescimento_absoluto: number;
  crescimento_percentual: number | null;
  tempo_horas: number | null;
  total_tracks: number | null;
  created_on_spotify_at: string;
  last_snapshot_at: string | null;
};

export type Insight = {
  id: string;
  scope: string;
  total_playlists_analisadas: number;
  insights: { padroes_vencedores?: string[]; padroes_fracos?: string[] };
  recomendacoes: string[];
  acoes_sugeridas: Array<{
    tipo: string;
    playlist?: string;
    motivo: string;
    acao?: string;
    prioridade: string;
  }>;
  classificacao: { alta?: string[]; media?: string[]; baixa?: string[] };
  generated_by_model: string | null;
  created_at: string;
};

export type GenreRow = { id: string; nome: string };
