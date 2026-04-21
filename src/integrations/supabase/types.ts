export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      collection_logs: {
        Row: {
          acao: string
          created_at: string | null
          duracao_ms: number | null
          genre_id: string | null
          id: string
          mensagem: string | null
          status: string
          term_id: string | null
        }
        Insert: {
          acao: string
          created_at?: string | null
          duracao_ms?: number | null
          genre_id?: string | null
          id?: string
          mensagem?: string | null
          status: string
          term_id?: string | null
        }
        Update: {
          acao?: string
          created_at?: string | null
          duracao_ms?: number | null
          genre_id?: string | null
          id?: string
          mensagem?: string | null
          status?: string
          term_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collection_logs_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_logs_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "search_terms"
            referencedColumns: ["id"]
          },
        ]
      }
      genre_filters: {
        Row: {
          blacklist: string[]
          briefing_mode: string
          created_at: string
          genre_id: string
          id: string
          max_playlists: number
          max_search_calls: number | null
          min_followers: number | null
          updated_at: string
        }
        Insert: {
          blacklist?: string[]
          briefing_mode?: string
          created_at?: string
          genre_id: string
          id?: string
          max_playlists?: number
          max_search_calls?: number | null
          min_followers?: number | null
          updated_at?: string
        }
        Update: {
          blacklist?: string[]
          briefing_mode?: string
          created_at?: string
          genre_id?: string
          id?: string
          max_playlists?: number
          max_search_calls?: number | null
          min_followers?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "genre_filters_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: true
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
        ]
      }
      genre_models: {
        Row: {
          genre_id: string | null
          id: string
          insights: Json | null
          musicas_recorrentes: Json | null
          padroes_nome: Json | null
          palavras_chave: Json | null
          playlists_dominantes: Json | null
          ultima_analise: string | null
          updated_at: string | null
        }
        Insert: {
          genre_id?: string | null
          id?: string
          insights?: Json | null
          musicas_recorrentes?: Json | null
          padroes_nome?: Json | null
          palavras_chave?: Json | null
          playlists_dominantes?: Json | null
          ultima_analise?: string | null
          updated_at?: string | null
        }
        Update: {
          genre_id?: string | null
          id?: string
          insights?: Json | null
          musicas_recorrentes?: Json | null
          padroes_nome?: Json | null
          palavras_chave?: Json | null
          playlists_dominantes?: Json | null
          ultima_analise?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "genre_models_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: true
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
        ]
      }
      genre_models_history: {
        Row: {
          ai_insights: string | null
          ai_suggestions: Json | null
          ai_summary: string | null
          coverage_percent: number | null
          created_at: string
          diff_keywords: Json | null
          diff_playlists: Json | null
          diff_tracks: Json | null
          genre_id: string
          id: string
          insights: Json | null
          musicas_recorrentes: Json | null
          padroes_nome: Json | null
          palavras_chave: Json | null
          playlists_dominantes: Json | null
          run_id: string | null
          total_enriched: number | null
          total_playlists: number | null
          version: number
        }
        Insert: {
          ai_insights?: string | null
          ai_suggestions?: Json | null
          ai_summary?: string | null
          coverage_percent?: number | null
          created_at?: string
          diff_keywords?: Json | null
          diff_playlists?: Json | null
          diff_tracks?: Json | null
          genre_id: string
          id?: string
          insights?: Json | null
          musicas_recorrentes?: Json | null
          padroes_nome?: Json | null
          palavras_chave?: Json | null
          playlists_dominantes?: Json | null
          run_id?: string | null
          total_enriched?: number | null
          total_playlists?: number | null
          version: number
        }
        Update: {
          ai_insights?: string | null
          ai_suggestions?: Json | null
          ai_summary?: string | null
          coverage_percent?: number | null
          created_at?: string
          diff_keywords?: Json | null
          diff_playlists?: Json | null
          diff_tracks?: Json | null
          genre_id?: string
          id?: string
          insights?: Json | null
          musicas_recorrentes?: Json | null
          padroes_nome?: Json | null
          palavras_chave?: Json | null
          playlists_dominantes?: Json | null
          run_id?: string | null
          total_enriched?: number | null
          total_playlists?: number | null
          version?: number
        }
        Relationships: []
      }
      genres: {
        Row: {
          ativo: boolean | null
          created_at: string | null
          id: string
          nome: string
          slug: string
          status: string | null
          total_musicas: number | null
          total_playlists: number | null
          total_termos: number | null
          ultima_coleta: string | null
        }
        Insert: {
          ativo?: boolean | null
          created_at?: string | null
          id?: string
          nome: string
          slug: string
          status?: string | null
          total_musicas?: number | null
          total_playlists?: number | null
          total_termos?: number | null
          ultima_coleta?: string | null
        }
        Update: {
          ativo?: boolean | null
          created_at?: string | null
          id?: string
          nome?: string
          slug?: string
          status?: string | null
          total_musicas?: number | null
          total_playlists?: number | null
          total_termos?: number | null
          ultima_coleta?: string | null
        }
        Relationships: []
      }
      playlist_briefings: {
        Row: {
          briefings: Json
          created_at: string
          genre_id: string
          id: string
          metadata: Json | null
          version: number
        }
        Insert: {
          briefings?: Json
          created_at?: string
          genre_id: string
          id?: string
          metadata?: Json | null
          version?: number
        }
        Update: {
          briefings?: Json
          created_at?: string
          genre_id?: string
          id?: string
          metadata?: Json | null
          version?: number
        }
        Relationships: []
      }
      search_results: {
        Row: {
          apify_run_id: string | null
          coletado_em: string | null
          descricao: string | null
          enrich_attempted_at: string | null
          enrich_attempts: number
          enrich_failed: boolean
          first_seen_at: string
          genre_id: string | null
          id: string
          imagem_url: string | null
          is_valid: boolean
          last_seen_at: string
          nome_playlist: string
          posicao: number
          priority_score: number | null
          score: number | null
          seguidores: number | null
          spotify_playlist_id: string | null
          spotify_url: string | null
          term_id: string | null
          times_seen: number
          total_musicas: number | null
          validation_reason: string | null
        }
        Insert: {
          apify_run_id?: string | null
          coletado_em?: string | null
          descricao?: string | null
          enrich_attempted_at?: string | null
          enrich_attempts?: number
          enrich_failed?: boolean
          first_seen_at?: string
          genre_id?: string | null
          id?: string
          imagem_url?: string | null
          is_valid?: boolean
          last_seen_at?: string
          nome_playlist: string
          posicao: number
          priority_score?: number | null
          score?: number | null
          seguidores?: number | null
          spotify_playlist_id?: string | null
          spotify_url?: string | null
          term_id?: string | null
          times_seen?: number
          total_musicas?: number | null
          validation_reason?: string | null
        }
        Update: {
          apify_run_id?: string | null
          coletado_em?: string | null
          descricao?: string | null
          enrich_attempted_at?: string | null
          enrich_attempts?: number
          enrich_failed?: boolean
          first_seen_at?: string
          genre_id?: string | null
          id?: string
          imagem_url?: string | null
          is_valid?: boolean
          last_seen_at?: string
          nome_playlist?: string
          posicao?: number
          priority_score?: number | null
          score?: number | null
          seguidores?: number | null
          spotify_playlist_id?: string | null
          spotify_url?: string | null
          term_id?: string | null
          times_seen?: number
          total_musicas?: number | null
          validation_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "search_results_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_results_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "search_terms"
            referencedColumns: ["id"]
          },
        ]
      }
      search_terms: {
        Row: {
          created_at: string | null
          executado: boolean | null
          genre_id: string | null
          id: string
          termo: string
          tipo: string
          total_resultados: number | null
          ultima_execucao: string | null
        }
        Insert: {
          created_at?: string | null
          executado?: boolean | null
          genre_id?: string | null
          id?: string
          termo: string
          tipo: string
          total_resultados?: number | null
          ultima_execucao?: string | null
        }
        Update: {
          created_at?: string | null
          executado?: boolean | null
          genre_id?: string | null
          id?: string
          termo?: string
          tipo?: string
          total_resultados?: number | null
          ultima_execucao?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "search_terms_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
        ]
      }
      search_tracks: {
        Row: {
          artista: string
          coletado_em: string | null
          genre_id: string | null
          id: string
          nome_musica: string
          posicao_na_playlist: number | null
          result_id: string | null
          spotify_track_id: string | null
        }
        Insert: {
          artista: string
          coletado_em?: string | null
          genre_id?: string | null
          id?: string
          nome_musica: string
          posicao_na_playlist?: number | null
          result_id?: string | null
          spotify_track_id?: string | null
        }
        Update: {
          artista?: string
          coletado_em?: string | null
          genre_id?: string | null
          id?: string
          nome_musica?: string
          posicao_na_playlist?: number | null
          result_id?: string | null
          spotify_track_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "search_tracks_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_tracks_result_id_fkey"
            columns: ["result_id"]
            isOneToOne: false
            referencedRelation: "search_results"
            referencedColumns: ["id"]
          },
        ]
      }
      spotify_tokens: {
        Row: {
          access_token: string
          created_at: string
          expires_at: string
          id: string
        }
        Insert: {
          access_token: string
          created_at?: string
          expires_at: string
          id?: string
        }
        Update: {
          access_token?: string
          created_at?: string
          expires_at?: string
          id?: string
        }
        Relationships: []
      }
      system_flags: {
        Row: {
          apify_blocked: boolean
          apify_blocked_at: string | null
          apify_blocked_reason: string | null
          created_at: string
          id: string
          updated_at: string
        }
        Insert: {
          apify_blocked?: boolean
          apify_blocked_at?: string | null
          apify_blocked_reason?: string | null
          created_at?: string
          id?: string
          updated_at?: string
        }
        Update: {
          apify_blocked?: boolean
          apify_blocked_at?: string | null
          apify_blocked_reason?: string | null
          created_at?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      compare_genre_versions: {
        Args: { p_genre_id: string; p_version_a: number; p_version_b: number }
        Returns: Json
      }
      has_team_access: { Args: never; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
