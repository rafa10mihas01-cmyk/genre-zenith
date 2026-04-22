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
      accounts: {
        Row: {
          created_at: string
          current_playlists: number
          display_name: string | null
          email: string | null
          id: string
          max_playlists: number
          notes: string | null
          spotify_user_id: string
          spotify_user_token_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_playlists?: number
          display_name?: string | null
          email?: string | null
          id?: string
          max_playlists?: number
          notes?: string | null
          spotify_user_id: string
          spotify_user_token_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_playlists?: number
          display_name?: string | null
          email?: string | null
          id?: string
          max_playlists?: number
          notes?: string | null
          spotify_user_id?: string
          spotify_user_token_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_spotify_user_token_id_fkey"
            columns: ["spotify_user_token_id"]
            isOneToOne: false
            referencedRelation: "spotify_user_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
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
          attention_flagged_at: string | null
          attention_reason: string | null
          created_at: string | null
          id: string
          last_audit_metrics: Json | null
          needs_attention: boolean
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
          attention_flagged_at?: string | null
          attention_reason?: string | null
          created_at?: string | null
          id?: string
          last_audit_metrics?: Json | null
          needs_attention?: boolean
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
          attention_flagged_at?: string | null
          attention_reason?: string | null
          created_at?: string | null
          id?: string
          last_audit_metrics?: Json | null
          needs_attention?: boolean
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
      performance_insights: {
        Row: {
          acoes_sugeridas: Json
          classificacao: Json
          created_at: string
          generated_by_model: string | null
          genre_id: string | null
          id: string
          insights: Json
          recomendacoes: Json
          scope: string
          total_playlists_analisadas: number
        }
        Insert: {
          acoes_sugeridas?: Json
          classificacao?: Json
          created_at?: string
          generated_by_model?: string | null
          genre_id?: string | null
          id?: string
          insights?: Json
          recomendacoes?: Json
          scope?: string
          total_playlists_analisadas?: number
        }
        Update: {
          acoes_sugeridas?: Json
          classificacao?: Json
          created_at?: string
          generated_by_model?: string | null
          genre_id?: string | null
          id?: string
          insights?: Json
          recomendacoes?: Json
          scope?: string
          total_playlists_analisadas?: number
        }
        Relationships: []
      }
      playlist_adjustments: {
        Row: {
          action_type: string
          after: Json
          before: Json
          created_at: string
          details: Json
          error_message: string | null
          genre_id: string | null
          id: string
          spotify_playlist_id: string | null
          status: string
          template_id: string
          triggered_by: string
        }
        Insert: {
          action_type: string
          after?: Json
          before?: Json
          created_at?: string
          details?: Json
          error_message?: string | null
          genre_id?: string | null
          id?: string
          spotify_playlist_id?: string | null
          status?: string
          template_id: string
          triggered_by?: string
        }
        Update: {
          action_type?: string
          after?: Json
          before?: Json
          created_at?: string
          details?: Json
          error_message?: string | null
          genre_id?: string | null
          id?: string
          spotify_playlist_id?: string | null
          status?: string
          template_id?: string
          triggered_by?: string
        }
        Relationships: []
      }
      playlist_blueprints: {
        Row: {
          confidence: string
          cover_style: Json | null
          created_at: string
          format: string | null
          generated_by_model: string | null
          genre_id: string
          id: string
          mood: string | null
          name: string
          name_pattern: string | null
          notes: string | null
          performance_source: string | null
          replication_priority: string
          replication_reason: string | null
          replication_score: number
          sample_size: number
          slug: string
          source_playlists: Json | null
          status: string
          tier: string
          track_dna: Json | null
          updated_at: string
        }
        Insert: {
          confidence?: string
          cover_style?: Json | null
          created_at?: string
          format?: string | null
          generated_by_model?: string | null
          genre_id: string
          id?: string
          mood?: string | null
          name: string
          name_pattern?: string | null
          notes?: string | null
          performance_source?: string | null
          replication_priority?: string
          replication_reason?: string | null
          replication_score?: number
          sample_size?: number
          slug: string
          source_playlists?: Json | null
          status?: string
          tier?: string
          track_dna?: Json | null
          updated_at?: string
        }
        Update: {
          confidence?: string
          cover_style?: Json | null
          created_at?: string
          format?: string | null
          generated_by_model?: string | null
          genre_id?: string
          id?: string
          mood?: string | null
          name?: string
          name_pattern?: string | null
          notes?: string | null
          performance_source?: string | null
          replication_priority?: string
          replication_reason?: string | null
          replication_score?: number
          sample_size?: number
          slug?: string
          source_playlists?: Json | null
          status?: string
          tier?: string
          track_dna?: Json | null
          updated_at?: string
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
      playlist_metrics_snapshots: {
        Row: {
          collected_at: string
          followers: number
          id: string
          spotify_playlist_id: string
          template_id: string
          total_tracks: number | null
        }
        Insert: {
          collected_at?: string
          followers?: number
          id?: string
          spotify_playlist_id: string
          template_id: string
          total_tracks?: number | null
        }
        Update: {
          collected_at?: string
          followers?: number
          id?: string
          spotify_playlist_id?: string
          template_id?: string
          total_tracks?: number | null
        }
        Relationships: []
      }
      playlist_templates: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          blueprint_id: string
          cover_brief: string | null
          created_at: string
          created_on_spotify_at: string | null
          creation_error: string | null
          description: string | null
          followers_at_creation: number | null
          generated_by_model: string | null
          genre_id: string
          id: string
          keywords: Json | null
          name: string
          performance_class: string | null
          performance_evaluated_at: string | null
          regras: Json | null
          rejection_reason: string | null
          replication_score: number
          spotify_owner_id: string | null
          spotify_playlist_id: string | null
          spotify_snapshot_id: string | null
          spotify_url: string | null
          status: string
          track_seeds: Json | null
          tracks_added: number
          tracks_failed: number
          updated_at: string
          variation_index: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          blueprint_id: string
          cover_brief?: string | null
          created_at?: string
          created_on_spotify_at?: string | null
          creation_error?: string | null
          description?: string | null
          followers_at_creation?: number | null
          generated_by_model?: string | null
          genre_id: string
          id?: string
          keywords?: Json | null
          name: string
          performance_class?: string | null
          performance_evaluated_at?: string | null
          regras?: Json | null
          rejection_reason?: string | null
          replication_score?: number
          spotify_owner_id?: string | null
          spotify_playlist_id?: string | null
          spotify_snapshot_id?: string | null
          spotify_url?: string | null
          status?: string
          track_seeds?: Json | null
          tracks_added?: number
          tracks_failed?: number
          updated_at?: string
          variation_index?: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          blueprint_id?: string
          cover_brief?: string | null
          created_at?: string
          created_on_spotify_at?: string | null
          creation_error?: string | null
          description?: string | null
          followers_at_creation?: number | null
          generated_by_model?: string | null
          genre_id?: string
          id?: string
          keywords?: Json | null
          name?: string
          performance_class?: string | null
          performance_evaluated_at?: string | null
          regras?: Json | null
          rejection_reason?: string | null
          replication_score?: number
          spotify_owner_id?: string | null
          spotify_playlist_id?: string | null
          spotify_snapshot_id?: string | null
          spotify_url?: string | null
          status?: string
          track_seeds?: Json | null
          tracks_added?: number
          tracks_failed?: number
          updated_at?: string
          variation_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "playlist_templates_blueprint_id_fkey"
            columns: ["blueprint_id"]
            isOneToOne: false
            referencedRelation: "playlist_blueprints"
            referencedColumns: ["id"]
          },
        ]
      }
      replication_rules: {
        Row: {
          active: boolean
          condition: Json
          confidence: string
          created_at: string
          evidence: string | null
          expires_at: string | null
          generated_by_model: string | null
          genre_id: string | null
          id: string
          priority: string
          rule_type: string
          scope: string
          source_insight_id: string | null
          target: string
          updated_at: string
          value: Json
        }
        Insert: {
          active?: boolean
          condition?: Json
          confidence?: string
          created_at?: string
          evidence?: string | null
          expires_at?: string | null
          generated_by_model?: string | null
          genre_id?: string | null
          id?: string
          priority?: string
          rule_type: string
          scope?: string
          source_insight_id?: string | null
          target: string
          updated_at?: string
          value?: Json
        }
        Update: {
          active?: boolean
          condition?: Json
          confidence?: string
          created_at?: string
          evidence?: string | null
          expires_at?: string | null
          generated_by_model?: string | null
          genre_id?: string | null
          id?: string
          priority?: string
          rule_type?: string
          scope?: string
          source_insight_id?: string | null
          target?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      replications: {
        Row: {
          account_id: string | null
          blueprint_id: string | null
          created_at: string
          error_message: string | null
          genre_id: string
          id: string
          selection_score: number
          source_result_id: string | null
          spotify_playlist_id: string | null
          spotify_url: string | null
          status: string
          template_id: string | null
          triggered_by: string
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          blueprint_id?: string | null
          created_at?: string
          error_message?: string | null
          genre_id: string
          id?: string
          selection_score?: number
          source_result_id?: string | null
          spotify_playlist_id?: string | null
          spotify_url?: string | null
          status?: string
          template_id?: string | null
          triggered_by?: string
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          blueprint_id?: string | null
          created_at?: string
          error_message?: string | null
          genre_id?: string
          id?: string
          selection_score?: number
          source_result_id?: string | null
          spotify_playlist_id?: string | null
          spotify_url?: string | null
          status?: string
          template_id?: string | null
          triggered_by?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "replications_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
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
          followers_source:
            | Database["public"]["Enums"]["followers_source_type"]
            | null
          followers_verified_at: string | null
          genre_id: string | null
          id: string
          imagem_url: string | null
          is_valid: boolean
          last_seen_at: string
          needs_enrich: boolean
          nome_playlist: string
          posicao: number
          priority_score: number | null
          quality_flag: string | null
          quality_flagged_at: string | null
          quality_score: number | null
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
          followers_source?:
            | Database["public"]["Enums"]["followers_source_type"]
            | null
          followers_verified_at?: string | null
          genre_id?: string | null
          id?: string
          imagem_url?: string | null
          is_valid?: boolean
          last_seen_at?: string
          needs_enrich?: boolean
          nome_playlist: string
          posicao: number
          priority_score?: number | null
          quality_flag?: string | null
          quality_flagged_at?: string | null
          quality_score?: number | null
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
          followers_source?:
            | Database["public"]["Enums"]["followers_source_type"]
            | null
          followers_verified_at?: string | null
          genre_id?: string | null
          id?: string
          imagem_url?: string | null
          is_valid?: boolean
          last_seen_at?: string
          needs_enrich?: boolean
          nome_playlist?: string
          posicao?: number
          priority_score?: number | null
          quality_flag?: string | null
          quality_flagged_at?: string | null
          quality_score?: number | null
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
      spotify_user_tokens: {
        Row: {
          access_token: string
          created_at: string
          display_name: string | null
          email: string | null
          expires_at: string
          id: string
          is_default: boolean
          refresh_token: string
          scope: string | null
          spotify_user_id: string
          updated_at: string
        }
        Insert: {
          access_token: string
          created_at?: string
          display_name?: string | null
          email?: string | null
          expires_at: string
          id?: string
          is_default?: boolean
          refresh_token: string
          scope?: string | null
          spotify_user_id: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          created_at?: string
          display_name?: string | null
          email?: string | null
          expires_at?: string
          id?: string
          is_default?: boolean
          refresh_token?: string
          scope?: string | null
          spotify_user_id?: string
          updated_at?: string
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
      v_brain_health: {
        Row: {
          analyzed_genres: number | null
          apify_blocked: boolean | null
          apify_blocked_at: string | null
          apify_blocked_reason: string | null
          avg_quality_score: number | null
          brain_status: string | null
          checks: Json | null
          duplicate_count: number | null
          enrich_failed_count: number | null
          followers_coverage_pct: number | null
          invalid_records: number | null
          last_collection_at: string | null
          needs_enrich_pct: number | null
          pending_enrich: number | null
          stuck_enrich_loop: number | null
          total_genres: number | null
          total_playlists: number | null
          with_followers: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      compare_genre_versions: {
        Args: { p_genre_id: string; p_version_a: number; p_version_b: number }
        Returns: Json
      }
      get_active_replication_rules: {
        Args: { p_genre_id: string }
        Returns: {
          condition: Json
          confidence: string
          evidence: string
          id: string
          priority: string
          rule_type: string
          scope: string
          target: string
          value: Json
        }[]
      }
      get_followers_revalidation_candidates: {
        Args: {
          p_limit?: number
          p_min_followers?: number
          p_stale_before?: string
        }
        Returns: {
          followers_verified_at: string
          genre_id: string
          id: string
          seguidores: number
          spotify_playlist_id: string
          spotify_url: string
        }[]
      }
      get_low_performance_candidates: {
        Args: {
          p_cooldown_hours?: number
          p_limit?: number
          p_min_age_hours?: number
        }
        Returns: {
          created_on_spotify_at: string
          genre_id: string
          name: string
          performance_class: string
          spotify_playlist_id: string
          spotify_url: string
          template_id: string
          tempo_horas: number
        }[]
      }
      get_performance_class_for_source: {
        Args: { p_source_result_id: string }
        Returns: string
      }
      get_performance_dataset: {
        Args: { p_min_age_hours?: number }
        Returns: {
          created_on_spotify_at: string
          crescimento_absoluto: number
          crescimento_percentual: number
          followers_now: number
          followers_start: number
          genre_id: string
          last_snapshot_at: string
          nome: string
          spotify_playlist_id: string
          spotify_url: string
          template_id: string
          tempo_horas: number
          total_tracks: number
        }[]
      }
      has_team_access: { Args: never; Returns: boolean }
      priority_from_performance: {
        Args: { p_class: string }
        Returns: {
          priority: string
          reason: string
        }[]
      }
    }
    Enums: {
      followers_source_type: "spotify_api"
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
    Enums: {
      followers_source_type: ["spotify_api"],
    },
  },
} as const
