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
      autopilot_runs: {
        Row: {
          cache_hits: Json
          covers_generated: number
          current_step: string | null
          duracao_ms: number | null
          error_message: string | null
          finished_at: string | null
          genre_id: string
          id: string
          progress_pct: number
          started_at: string
          status: string
          steps_completed: Json
          summary: string | null
          templates_approved: number
          templates_generated: number
          triggered_by: string
        }
        Insert: {
          cache_hits?: Json
          covers_generated?: number
          current_step?: string | null
          duracao_ms?: number | null
          error_message?: string | null
          finished_at?: string | null
          genre_id: string
          id?: string
          progress_pct?: number
          started_at?: string
          status?: string
          steps_completed?: Json
          summary?: string | null
          templates_approved?: number
          templates_generated?: number
          triggered_by?: string
        }
        Update: {
          cache_hits?: Json
          covers_generated?: number
          current_step?: string | null
          duracao_ms?: number | null
          error_message?: string | null
          finished_at?: string | null
          genre_id?: string
          id?: string
          progress_pct?: number
          started_at?: string
          status?: string
          steps_completed?: Json
          summary?: string | null
          templates_approved?: number
          templates_generated?: number
          triggered_by?: string
        }
        Relationships: []
      }
      bot_events: {
        Row: {
          bot_name: string
          correlation_id: string | null
          created_at: string
          deal_id: string | null
          discard_reason: string | null
          duration_ms: number | null
          hostname: string | null
          id: string
          lifecycle_state: string | null
          message: string | null
          metadata: Json
          process_id: string | null
          screenshot_url: string | null
          session_id: string | null
          song_id: string | null
          status: string
          step: string
          timer_id: string | null
          url: string | null
          worker_id: string | null
        }
        Insert: {
          bot_name?: string
          correlation_id?: string | null
          created_at?: string
          deal_id?: string | null
          discard_reason?: string | null
          duration_ms?: number | null
          hostname?: string | null
          id?: string
          lifecycle_state?: string | null
          message?: string | null
          metadata?: Json
          process_id?: string | null
          screenshot_url?: string | null
          session_id?: string | null
          song_id?: string | null
          status?: string
          step: string
          timer_id?: string | null
          url?: string | null
          worker_id?: string | null
        }
        Update: {
          bot_name?: string
          correlation_id?: string | null
          created_at?: string
          deal_id?: string | null
          discard_reason?: string | null
          duration_ms?: number | null
          hostname?: string | null
          id?: string
          lifecycle_state?: string | null
          message?: string | null
          metadata?: Json
          process_id?: string | null
          screenshot_url?: string | null
          session_id?: string | null
          song_id?: string | null
          status?: string
          step?: string
          timer_id?: string | null
          url?: string | null
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bot_events_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "curator_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_events_song_id_fkey"
            columns: ["song_id"]
            isOneToOne: false
            referencedRelation: "curator_deal_songs"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_heartbeats: {
        Row: {
          bot_name: string
          created_at: string
          hostname: string | null
          id: string
          last_collect_at: string | null
          message: string | null
          metadata: Json
          process_id: string | null
          processing_correlation_ids: string[] | null
          spotify_session_valid: boolean
          status: string
          timer_id: string | null
          worker_id: string | null
        }
        Insert: {
          bot_name?: string
          created_at?: string
          hostname?: string | null
          id?: string
          last_collect_at?: string | null
          message?: string | null
          metadata?: Json
          process_id?: string | null
          processing_correlation_ids?: string[] | null
          spotify_session_valid?: boolean
          status?: string
          timer_id?: string | null
          worker_id?: string | null
        }
        Update: {
          bot_name?: string
          created_at?: string
          hostname?: string | null
          id?: string
          last_collect_at?: string | null
          message?: string | null
          metadata?: Json
          process_id?: string | null
          processing_correlation_ids?: string[] | null
          spotify_session_valid?: boolean
          status?: string
          timer_id?: string | null
          worker_id?: string | null
        }
        Relationships: []
      }
      bot_print_batches: {
        Row: {
          batch_key: string
          completed_at: string | null
          correlation_id: string | null
          created_at: string
          deal_id: string
          dom_payload: Json
          error: string | null
          id: string
          print_paths: Json
          print_urls: Json
          processed_at: string | null
          received_parts: number
          song_id: string | null
          status: string
          total_parts: number
          updated_at: string
        }
        Insert: {
          batch_key: string
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string
          deal_id: string
          dom_payload?: Json
          error?: string | null
          id?: string
          print_paths?: Json
          print_urls?: Json
          processed_at?: string | null
          received_parts?: number
          song_id?: string | null
          status?: string
          total_parts: number
          updated_at?: string
        }
        Update: {
          batch_key?: string
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string
          deal_id?: string
          dom_payload?: Json
          error?: string | null
          id?: string
          print_paths?: Json
          print_urls?: Json
          processed_at?: string | null
          received_parts?: number
          song_id?: string | null
          status?: string
          total_parts?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_print_batches_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "curator_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_print_batches_song_id_fkey"
            columns: ["song_id"]
            isOneToOne: false
            referencedRelation: "curator_deal_songs"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          archived_at: string | null
          contact: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          contact?: string | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          contact?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
            foreignKeyName: "collection_logs_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres_with_health"
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
      curator_deal_logs: {
        Row: {
          created_at: string
          deal_id: string
          id: string
          is_baseline: boolean
          note: string | null
          print_urls: string[]
          song_id: string | null
          total_plays: number
        }
        Insert: {
          created_at?: string
          deal_id: string
          id?: string
          is_baseline?: boolean
          note?: string | null
          print_urls?: string[]
          song_id?: string | null
          total_plays: number
        }
        Update: {
          created_at?: string
          deal_id?: string
          id?: string
          is_baseline?: boolean
          note?: string | null
          print_urls?: string[]
          song_id?: string | null
          total_plays?: number
        }
        Relationships: [
          {
            foreignKeyName: "curator_deal_logs_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "curator_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curator_deal_logs_song_id_fkey"
            columns: ["song_id"]
            isOneToOne: false
            referencedRelation: "curator_deal_songs"
            referencedColumns: ["id"]
          },
        ]
      }
      curator_deal_snapshots: {
        Row: {
          ai_confidence: number | null
          ai_raw: Json
          batch_id: string | null
          captured_at: string
          correlation_id: string | null
          created_at: string
          created_by: string | null
          deal_id: string
          id: string
          is_baseline: boolean
          match_method: string | null
          notes: string | null
          playlist_id: string
          plays: number
          print_url: string | null
          song_id: string | null
          source: string
        }
        Insert: {
          ai_confidence?: number | null
          ai_raw?: Json
          batch_id?: string | null
          captured_at?: string
          correlation_id?: string | null
          created_at?: string
          created_by?: string | null
          deal_id: string
          id?: string
          is_baseline?: boolean
          match_method?: string | null
          notes?: string | null
          playlist_id: string
          plays?: number
          print_url?: string | null
          song_id?: string | null
          source?: string
        }
        Update: {
          ai_confidence?: number | null
          ai_raw?: Json
          batch_id?: string | null
          captured_at?: string
          correlation_id?: string | null
          created_at?: string
          created_by?: string | null
          deal_id?: string
          id?: string
          is_baseline?: boolean
          match_method?: string | null
          notes?: string | null
          playlist_id?: string
          plays?: number
          print_url?: string | null
          song_id?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "curator_deal_snapshots_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "curator_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curator_deal_snapshots_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "curator_playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curator_deal_snapshots_song_id_fkey"
            columns: ["song_id"]
            isOneToOne: false
            referencedRelation: "curator_deal_songs"
            referencedColumns: ["id"]
          },
        ]
      }
      curator_deal_songs: {
        Row: {
          artist_candidates: string[]
          auto_collect: boolean
          auto_collect_error: string | null
          auto_collect_interval_minutes: number
          auto_collect_status: string
          baseline_plays: number
          client_id: string | null
          client_token: string
          created_at: string
          daily_goal: number
          deal_id: string
          duration_days: number
          ends_at: string | null
          id: string
          last_auto_collect_at: string | null
          last_print_at: string | null
          next_auto_collect_at: string | null
          position: number
          ramp_up_days: number
          smartlink_url: string | null
          song_artist: string | null
          song_cover_url: string | null
          song_name: string
          song_spotify_url: string
          spotify_track_id: string | null
          started_at: string | null
          target_plays: number | null
          updated_at: string
        }
        Insert: {
          artist_candidates?: string[]
          auto_collect?: boolean
          auto_collect_error?: string | null
          auto_collect_interval_minutes?: number
          auto_collect_status?: string
          baseline_plays?: number
          client_id?: string | null
          client_token?: string
          created_at?: string
          daily_goal?: number
          deal_id: string
          duration_days?: number
          ends_at?: string | null
          id?: string
          last_auto_collect_at?: string | null
          last_print_at?: string | null
          next_auto_collect_at?: string | null
          position?: number
          ramp_up_days?: number
          smartlink_url?: string | null
          song_artist?: string | null
          song_cover_url?: string | null
          song_name: string
          song_spotify_url: string
          spotify_track_id?: string | null
          started_at?: string | null
          target_plays?: number | null
          updated_at?: string
        }
        Update: {
          artist_candidates?: string[]
          auto_collect?: boolean
          auto_collect_error?: string | null
          auto_collect_interval_minutes?: number
          auto_collect_status?: string
          baseline_plays?: number
          client_id?: string | null
          client_token?: string
          created_at?: string
          daily_goal?: number
          deal_id?: string
          duration_days?: number
          ends_at?: string | null
          id?: string
          last_auto_collect_at?: string | null
          last_print_at?: string | null
          next_auto_collect_at?: string | null
          position?: number
          ramp_up_days?: number
          smartlink_url?: string | null
          song_artist?: string | null
          song_cover_url?: string | null
          song_name?: string
          song_spotify_url?: string
          spotify_track_id?: string | null
          started_at?: string | null
          target_plays?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "curator_deal_songs_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "curator_deals"
            referencedColumns: ["id"]
          },
        ]
      }
      curator_deals: {
        Row: {
          baseline_plays: number
          client_token: string
          closed_at: string | null
          closed_reason: string | null
          closed_status: string | null
          cost: number | null
          created_at: string
          curator_id: string | null
          curator_name: string
          daily_goal: number
          ends_at: string | null
          final_report_url: string | null
          id: string
          last_reconciled_at: string | null
          public_token: string
          ramp_up_days: number
          reconciled_streams_28d: number
          reconciled_streams_7d: number
          reconciled_total_plays: number
          slug: string | null
          song_artist: string | null
          song_cover_url: string | null
          song_name: string
          song_spotify_url: string
          spotify_owner_id: string | null
          spotify_owner_url: string | null
          started_at: string
          state: string
          target_plays: number
          token_expires_at: string | null
          token_revoked_at: string | null
          user_id: string
        }
        Insert: {
          baseline_plays?: number
          client_token?: string
          closed_at?: string | null
          closed_reason?: string | null
          closed_status?: string | null
          cost?: number | null
          created_at?: string
          curator_id?: string | null
          curator_name: string
          daily_goal?: number
          ends_at?: string | null
          final_report_url?: string | null
          id?: string
          last_reconciled_at?: string | null
          public_token?: string
          ramp_up_days?: number
          reconciled_streams_28d?: number
          reconciled_streams_7d?: number
          reconciled_total_plays?: number
          slug?: string | null
          song_artist?: string | null
          song_cover_url?: string | null
          song_name: string
          song_spotify_url: string
          spotify_owner_id?: string | null
          spotify_owner_url?: string | null
          started_at?: string
          state?: string
          target_plays: number
          token_expires_at?: string | null
          token_revoked_at?: string | null
          user_id: string
        }
        Update: {
          baseline_plays?: number
          client_token?: string
          closed_at?: string | null
          closed_reason?: string | null
          closed_status?: string | null
          cost?: number | null
          created_at?: string
          curator_id?: string | null
          curator_name?: string
          daily_goal?: number
          ends_at?: string | null
          final_report_url?: string | null
          id?: string
          last_reconciled_at?: string | null
          public_token?: string
          ramp_up_days?: number
          reconciled_streams_28d?: number
          reconciled_streams_7d?: number
          reconciled_total_plays?: number
          slug?: string | null
          song_artist?: string | null
          song_cover_url?: string | null
          song_name?: string
          song_spotify_url?: string
          spotify_owner_id?: string | null
          spotify_owner_url?: string | null
          started_at?: string
          state?: string
          target_plays?: number
          token_expires_at?: string | null
          token_revoked_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "curator_deals_curator_id_fkey"
            columns: ["curator_id"]
            isOneToOne: false
            referencedRelation: "curators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curator_deals_curator_id_fkey"
            columns: ["curator_id"]
            isOneToOne: false
            referencedRelation: "v_curator_balance"
            referencedColumns: ["curator_id"]
          },
          {
            foreignKeyName: "curator_deals_curator_id_fkey"
            columns: ["curator_id"]
            isOneToOne: false
            referencedRelation: "v_curator_finance"
            referencedColumns: ["curator_id"]
          },
        ]
      }
      curator_fraud_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          alert_type: string
          created_at: string
          deal_id: string
          description: string
          evidence: Json
          id: string
          playlist_id: string | null
          severity: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_type: string
          created_at?: string
          deal_id: string
          description: string
          evidence?: Json
          id?: string
          playlist_id?: string | null
          severity?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_type?: string
          created_at?: string
          deal_id?: string
          description?: string
          evidence?: Json
          id?: string
          playlist_id?: string | null
          severity?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "curator_fraud_alerts_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "curator_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curator_fraud_alerts_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "curator_playlists"
            referencedColumns: ["id"]
          },
        ]
      }
      curator_paste_imports: {
        Row: {
          baseline_count: number
          created_at: string
          curator_count: number
          deal_id: string
          editorial_count: number
          id: string
          imported_by: string | null
          new_count: number
          organic_count: number
          parsed_count: number
          raw_text: string
          song_id: string | null
          suspicious_count: number
          total_streams_7d: number
        }
        Insert: {
          baseline_count?: number
          created_at?: string
          curator_count?: number
          deal_id: string
          editorial_count?: number
          id?: string
          imported_by?: string | null
          new_count?: number
          organic_count?: number
          parsed_count?: number
          raw_text: string
          song_id?: string | null
          suspicious_count?: number
          total_streams_7d?: number
        }
        Update: {
          baseline_count?: number
          created_at?: string
          curator_count?: number
          deal_id?: string
          editorial_count?: number
          id?: string
          imported_by?: string | null
          new_count?: number
          organic_count?: number
          parsed_count?: number
          raw_text?: string
          song_id?: string | null
          suspicious_count?: number
          total_streams_7d?: number
        }
        Relationships: [
          {
            foreignKeyName: "curator_paste_imports_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "curator_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curator_paste_imports_song_id_fkey"
            columns: ["song_id"]
            isOneToOne: false
            referencedRelation: "curator_deal_songs"
            referencedColumns: ["id"]
          },
        ]
      }
      curator_playlist_library: {
        Row: {
          created_at: string
          curator_id: string
          first_seen_at: string
          followers: number | null
          id: string
          image_url: string | null
          last_used_at: string | null
          notes: string | null
          playlist_name: string
          spotify_owner_id: string | null
          spotify_owner_name: string | null
          spotify_playlist_id: string | null
          spotify_url: string
          status: string
          times_used: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          curator_id: string
          first_seen_at?: string
          followers?: number | null
          id?: string
          image_url?: string | null
          last_used_at?: string | null
          notes?: string | null
          playlist_name: string
          spotify_owner_id?: string | null
          spotify_owner_name?: string | null
          spotify_playlist_id?: string | null
          spotify_url: string
          status?: string
          times_used?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          curator_id?: string
          first_seen_at?: string
          followers?: number | null
          id?: string
          image_url?: string | null
          last_used_at?: string | null
          notes?: string | null
          playlist_name?: string
          spotify_owner_id?: string | null
          spotify_owner_name?: string | null
          spotify_playlist_id?: string | null
          spotify_url?: string
          status?: string
          times_used?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      curator_playlists: {
        Row: {
          added_at: string
          added_at_spotify: string | null
          deal_id: string
          followers: number | null
          id: string
          image_url: string | null
          is_baseline: boolean
          last_paste_at: string | null
          match_reason: string | null
          match_status: string
          playlist_name: string
          position_in_paste: number | null
          song_id: string | null
          spotify_owner_id: string | null
          spotify_owner_name: string | null
          spotify_playlist_id: string | null
          spotify_url: string
          streams_28d: number
          streams_7d: number
          streams_total: number
        }
        Insert: {
          added_at?: string
          added_at_spotify?: string | null
          deal_id: string
          followers?: number | null
          id?: string
          image_url?: string | null
          is_baseline?: boolean
          last_paste_at?: string | null
          match_reason?: string | null
          match_status?: string
          playlist_name: string
          position_in_paste?: number | null
          song_id?: string | null
          spotify_owner_id?: string | null
          spotify_owner_name?: string | null
          spotify_playlist_id?: string | null
          spotify_url: string
          streams_28d?: number
          streams_7d?: number
          streams_total?: number
        }
        Update: {
          added_at?: string
          added_at_spotify?: string | null
          deal_id?: string
          followers?: number | null
          id?: string
          image_url?: string | null
          is_baseline?: boolean
          last_paste_at?: string | null
          match_reason?: string | null
          match_status?: string
          playlist_name?: string
          position_in_paste?: number | null
          song_id?: string | null
          spotify_owner_id?: string | null
          spotify_owner_name?: string | null
          spotify_playlist_id?: string | null
          spotify_url?: string
          streams_28d?: number
          streams_7d?: number
          streams_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "curator_playlists_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "curator_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curator_playlists_song_id_fkey"
            columns: ["song_id"]
            isOneToOne: false
            referencedRelation: "curator_deal_songs"
            referencedColumns: ["id"]
          },
        ]
      }
      curator_purchases: {
        Row: {
          amount: number
          cpp: number | null
          created_at: string
          curator_id: string
          deal_id: string | null
          id: string
          note: string | null
          plays_purchased: number
          purchased_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          cpp?: number | null
          created_at?: string
          curator_id: string
          deal_id?: string | null
          id?: string
          note?: string | null
          plays_purchased?: number
          purchased_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          cpp?: number | null
          created_at?: string
          curator_id?: string
          deal_id?: string | null
          id?: string
          note?: string | null
          plays_purchased?: number
          purchased_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "curator_purchases_curator_id_fkey"
            columns: ["curator_id"]
            isOneToOne: false
            referencedRelation: "curators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curator_purchases_curator_id_fkey"
            columns: ["curator_id"]
            isOneToOne: false
            referencedRelation: "v_curator_balance"
            referencedColumns: ["curator_id"]
          },
          {
            foreignKeyName: "curator_purchases_curator_id_fkey"
            columns: ["curator_id"]
            isOneToOne: false
            referencedRelation: "v_curator_finance"
            referencedColumns: ["curator_id"]
          },
        ]
      }
      curators: {
        Row: {
          archived_at: string | null
          contact: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          purchased_plays: number
          spotify_owner_id: string | null
          spotify_owner_url: string | null
          total_cost: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          contact?: string | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          purchased_plays?: number
          spotify_owner_id?: string | null
          spotify_owner_url?: string | null
          total_cost?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          contact?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          purchased_plays?: number
          spotify_owner_id?: string | null
          spotify_owner_url?: string | null
          total_cost?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      genre_backfill_attempts: {
        Row: {
          details: Json
          duracao_ms: number | null
          finished_at: string | null
          genre_id: string
          id: string
          reason: string | null
          started_at: string
          status: string
          triggered_by: string
        }
        Insert: {
          details?: Json
          duracao_ms?: number | null
          finished_at?: string | null
          genre_id: string
          id?: string
          reason?: string | null
          started_at?: string
          status?: string
          triggered_by?: string
        }
        Update: {
          details?: Json
          duracao_ms?: number | null
          finished_at?: string | null
          genre_id?: string
          id?: string
          reason?: string | null
          started_at?: string
          status?: string
          triggered_by?: string
        }
        Relationships: []
      }
      genre_filters: {
        Row: {
          base_daily: number
          blacklist: string[]
          briefing_mode: string
          created_at: string
          genre_id: string
          id: string
          max_daily: number
          max_playlists: number
          max_search_calls: number | null
          min_daily: number
          min_followers: number | null
          updated_at: string
        }
        Insert: {
          base_daily?: number
          blacklist?: string[]
          briefing_mode?: string
          created_at?: string
          genre_id: string
          id?: string
          max_daily?: number
          max_playlists?: number
          max_search_calls?: number | null
          min_daily?: number
          min_followers?: number | null
          updated_at?: string
        }
        Update: {
          base_daily?: number
          blacklist?: string[]
          briefing_mode?: string
          created_at?: string
          genre_id?: string
          id?: string
          max_daily?: number
          max_playlists?: number
          max_search_calls?: number | null
          min_daily?: number
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
          {
            foreignKeyName: "genre_filters_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: true
            referencedRelation: "genres_with_health"
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
          {
            foreignKeyName: "genre_models_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: true
            referencedRelation: "genres_with_health"
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
      learning_loop_runs: {
        Row: {
          duracao_ms: number | null
          finished_at: string | null
          id: string
          started_at: string
          status: string
          steps: Json
          summary: string | null
          triggered_by: string
        }
        Insert: {
          duracao_ms?: number | null
          finished_at?: string | null
          id?: string
          started_at?: string
          status?: string
          steps?: Json
          summary?: string | null
          triggered_by?: string
        }
        Update: {
          duracao_ms?: number | null
          finished_at?: string | null
          id?: string
          started_at?: string
          status?: string
          steps?: Json
          summary?: string | null
          triggered_by?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          action_url: string | null
          created_at: string
          id: string
          message: string
          metadata: Json
          read: boolean
          title: string
          type: Database["public"]["Enums"]["notification_type"]
        }
        Insert: {
          action_url?: string | null
          created_at?: string
          id?: string
          message: string
          metadata?: Json
          read?: boolean
          title: string
          type?: Database["public"]["Enums"]["notification_type"]
        }
        Update: {
          action_url?: string | null
          created_at?: string
          id?: string
          message?: string
          metadata?: Json
          read?: boolean
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
        }
        Relationships: []
      }
      ops_metrics: {
        Row: {
          created_at: string
          deal_id: string | null
          duration_ms: number | null
          id: string
          metadata: Json
          operation: string
          scope: string
          song_id: string | null
          status: string
        }
        Insert: {
          created_at?: string
          deal_id?: string | null
          duration_ms?: number | null
          id?: string
          metadata?: Json
          operation: string
          scope: string
          song_id?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          deal_id?: string | null
          duration_ms?: number | null
          id?: string
          metadata?: Json
          operation?: string
          scope?: string
          song_id?: string | null
          status?: string
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
          archived_at: string | null
          archived_reason: string | null
          auto_cover_requested: boolean
          blueprint_id: string
          cover_brief: string | null
          cover_generated_at: string | null
          cover_image_url: string | null
          cover_selected_index: number | null
          cover_variations: Json | null
          created_at: string
          created_on_spotify_at: string | null
          creation_error: string | null
          description: string | null
          final_score: number
          followers_at_creation: number | null
          generated_by_model: string | null
          genre_id: string
          id: string
          keywords: Json | null
          name: string
          performance_class: string | null
          performance_evaluated_at: string | null
          quality_tier: string
          regras: Json | null
          rejection_reason: string | null
          replication_score: number
          score_breakdown: Json
          scored_at: string | null
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
          archived_at?: string | null
          archived_reason?: string | null
          auto_cover_requested?: boolean
          blueprint_id: string
          cover_brief?: string | null
          cover_generated_at?: string | null
          cover_image_url?: string | null
          cover_selected_index?: number | null
          cover_variations?: Json | null
          created_at?: string
          created_on_spotify_at?: string | null
          creation_error?: string | null
          description?: string | null
          final_score?: number
          followers_at_creation?: number | null
          generated_by_model?: string | null
          genre_id: string
          id?: string
          keywords?: Json | null
          name: string
          performance_class?: string | null
          performance_evaluated_at?: string | null
          quality_tier?: string
          regras?: Json | null
          rejection_reason?: string | null
          replication_score?: number
          score_breakdown?: Json
          scored_at?: string | null
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
          archived_at?: string | null
          archived_reason?: string | null
          auto_cover_requested?: boolean
          blueprint_id?: string
          cover_brief?: string | null
          cover_generated_at?: string | null
          cover_image_url?: string | null
          cover_selected_index?: number | null
          cover_variations?: Json | null
          created_at?: string
          created_on_spotify_at?: string | null
          creation_error?: string | null
          description?: string | null
          final_score?: number
          followers_at_creation?: number | null
          generated_by_model?: string | null
          genre_id?: string
          id?: string
          keywords?: Json | null
          name?: string
          performance_class?: string | null
          performance_evaluated_at?: string | null
          quality_tier?: string
          regras?: Json | null
          rejection_reason?: string | null
          replication_score?: number
          score_breakdown?: Json
          scored_at?: string | null
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
          owner_id: string | null
          owner_type: string | null
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
          owner_id?: string | null
          owner_type?: string | null
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
          owner_id?: string | null
          owner_type?: string | null
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
            foreignKeyName: "search_results_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres_with_health"
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
          {
            foreignKeyName: "search_terms_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres_with_health"
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
            foreignKeyName: "search_tracks_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres_with_health"
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
      spotify_email_allowlist: {
        Row: {
          created_at: string
          created_by: string | null
          email: string
          id: string
          note: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email: string
          id?: string
          note?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string
          id?: string
          note?: string | null
        }
        Relationships: []
      }
      spotify_oauth_states: {
        Row: {
          consumed_at: string | null
          created_at: string
          flow: string
          state: string
          user_id: string | null
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          flow?: string
          state: string
          user_id?: string | null
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          flow?: string
          state?: string
          user_id?: string | null
        }
        Relationships: []
      }
      spotify_tokens: {
        Row: {
          access_token: string
          created_at: string
          expires_at: string
          id: string
          singleton_key: string
        }
        Insert: {
          access_token: string
          created_at?: string
          expires_at: string
          id?: string
          singleton_key?: string
        }
        Update: {
          access_token?: string
          created_at?: string
          expires_at?: string
          id?: string
          singleton_key?: string
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
          singleton_key: string
          updated_at: string
        }
        Insert: {
          apify_blocked?: boolean
          apify_blocked_at?: string | null
          apify_blocked_reason?: string | null
          created_at?: string
          id?: string
          singleton_key?: string
          updated_at?: string
        }
        Update: {
          apify_blocked?: boolean
          apify_blocked_at?: string | null
          apify_blocked_reason?: string | null
          created_at?: string
          id?: string
          singleton_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      curator_playlist_library_stats: {
        Row: {
          avg_streams_per_deal: number | null
          curator_id: string | null
          deals_count: number | null
          followers: number | null
          image_url: string | null
          last_used_at: string | null
          library_id: string | null
          playlist_name: string | null
          spotify_url: string | null
          status: string | null
          total_streams_7d: number | null
          total_streams_lifetime: number | null
          user_id: string | null
        }
        Relationships: []
      }
      curator_playlist_performance: {
        Row: {
          avg_streams_7d: number | null
          best_streams_7d: number | null
          curator_id: string | null
          deals_count: number | null
          drop_ratio: number | null
          library_id: string | null
          performance_class: string | null
          total_streams_7d: number | null
          total_streams_lifetime: number | null
          user_id: string | null
          variation_coef: number | null
          worst_streams_7d: number | null
        }
        Relationships: []
      }
      genres_with_health: {
        Row: {
          ativo: boolean | null
          attention_flagged_at: string | null
          attention_reason: string | null
          created_at: string | null
          health_hours_since: number | null
          health_last_seen_at: string | null
          health_status: string | null
          id: string | null
          last_audit_metrics: Json | null
          needs_attention: boolean | null
          nome: string | null
          slug: string | null
          status: string | null
          total_musicas: number | null
          total_playlists: number | null
          total_termos: number | null
          ultima_coleta: string | null
        }
        Relationships: []
      }
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
      v_curator_balance: {
        Row: {
          archived_at: string | null
          consumed_plays: number | null
          curator_id: string | null
          name: string | null
          overbooked_plays: number | null
          purchased_plays: number | null
          remaining_plays: number | null
          total_cost: number | null
          user_id: string | null
        }
        Relationships: []
      }
      v_curator_finance: {
        Row: {
          cpp: number | null
          curator_id: string | null
          last_purchase_at: string | null
          name: string | null
          plays_purchased: number | null
          purchase_count: number | null
          total_cost: number | null
          user_id: string | null
        }
        Relationships: []
      }
      v_curator_global_finance: {
        Row: {
          global_cpp: number | null
          purchase_count: number | null
          total_plays_purchased: number | null
          total_spent: number | null
          user_id: string | null
        }
        Relationships: []
      }
      v_dispatch_trace: {
        Row: {
          accepted_at: string | null
          batch_id: string | null
          batch_status: string | null
          correlation_id: string | null
          current_state: string | null
          deal_id: string | null
          discard_reason: string | null
          discarded_at: string | null
          dur_fetched_to_accepted_s: number | null
          dur_print_to_snapshot_s: number | null
          dur_queue_to_started_s: number | null
          dur_started_to_print_s: number | null
          dur_total_s: number | null
          failed_at: string | null
          failure_message: string | null
          fetched_at: string | null
          finished_at: string | null
          first_snapshot_at: string | null
          hostname: string | null
          hosts_seen: string[] | null
          last_heartbeat_at: string | null
          last_heartbeat_host: string | null
          last_snapshot_at: string | null
          multi_worker_conflict: boolean | null
          print_uploaded_at: string | null
          process_id: string | null
          queued_local_at: string | null
          received_parts: number | null
          snapshot_count: number | null
          snapshot_sent_at: string | null
          song_id: string | null
          started_at: string | null
          timer_id: string | null
          total_events: number | null
          total_parts: number | null
          total_plays_extracted: number | null
          worker_id: string | null
          worker_processing_now: string[] | null
          workers_seen: string[] | null
        }
        Relationships: []
      }
      v_storage_growth: {
        Row: {
          bot_events_rows: number | null
          bot_print_batches_dom_payload_bytes: number | null
          bot_print_batches_print_paths_bytes: number | null
          bot_print_batches_rows: number | null
          computed_at: string | null
          curator_snapshots_ai_raw_bytes: number | null
          curator_snapshots_rows: number | null
          ops_metrics_rows: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      _normalize_notification_type: {
        Args: { p_type: string }
        Returns: Database["public"]["Enums"]["notification_type"]
      }
      cleanup_old_logs_and_snapshots: {
        Args: never
        Returns: {
          logs_deleted: number
          snapshots_deleted: number
          tracks_deleted: number
        }[]
      }
      cleanup_operational_logs: { Args: never; Returns: Json }
      cleanup_stale_autopilot_runs: {
        Args: { p_minutes?: number }
        Returns: number
      }
      compare_genre_versions: {
        Args: { p_genre_id: string; p_version_a: number; p_version_b: number }
        Returns: Json
      }
      count_recent_backfill_attempts: {
        Args: { p_genre_id: string; p_hours?: number }
        Returns: number
      }
      create_curator_deal_atomic: {
        Args: { p_deal: Json; p_force?: boolean; p_songs: Json }
        Returns: Json
      }
      create_notification:
        | {
            Args: {
              p_action_url?: string
              p_message: string
              p_metadata?: Json
              p_title: string
              p_type: Database["public"]["Enums"]["notification_type"]
            }
            Returns: string
          }
        | {
            Args: {
              p_action_url?: string
              p_cooldown_minutes?: number
              p_dedupe_key?: string
              p_message: string
              p_metadata?: Json
              p_title: string
              p_type: string
            }
            Returns: string
          }
      detect_duplicate_curator_deal: {
        Args: {
          p_curator_id: string
          p_curator_name: string
          p_ends_at: string
          p_song_spotify_url: string
          p_spotify_track_id: string
          p_started_at: string
          p_user_id: string
        }
        Returns: {
          deal_id: string
          ends_at: string
          song_name: string
          started_at: string
          state: string
        }[]
      }
      detect_duplicate_curator_playlists: {
        Args: { p_user_id: string }
        Returns: {
          deal_ids: string[]
          deals_count: number
          song_signature: string
          spotify_playlist_id: string
        }[]
      }
      expire_stale_medium_templates: {
        Args: { p_hours?: number }
        Returns: {
          expired_count: number
          expired_ids: string[]
        }[]
      }
      extract_spotify_playlist_id: { Args: { p_url: string }; Returns: string }
      generate_curator_deal_slug: {
        Args: { p_curator: string; p_id: string; p_song: string }
        Returns: string
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
      get_cron_secret: { Args: never; Returns: string }
      get_curator_deal_breakdown: { Args: { p_deal_id: string }; Returns: Json }
      get_curator_deal_progress: {
        Args: { p_deal_id: string; p_song_id?: string }
        Returns: Json
      }
      get_curator_deal_snapshot_history: {
        Args: { p_deal_id: string }
        Returns: Json
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
      get_genre_daily_target_v2: {
        Args: { p_genre_id: string }
        Returns: {
          base_daily: number
          evaluated_3d: number
          evaluated_7d: number
          final_score: number
          generated_today: number
          max_daily: number
          min_daily: number
          performance_tier: string
          remaining: number
          score_3d: number
          score_7d: number
          target_today: number
        }[]
      }
      get_genre_health: {
        Args: { p_genre_id: string }
        Returns: {
          health_status: string
          hours_since: number
          last_seen_at: string
        }[]
      }
      get_learning_loop_status: { Args: never; Returns: Json }
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_team_access: { Args: never; Returns: boolean }
      increment_account_playlists: {
        Args: { p_spotify_user_id: string }
        Returns: number
      }
      is_admin: { Args: never; Returns: boolean }
      match_curator_playlist:
        | {
            Args: {
              p_deal_id: string
              p_playlist_name: string
              p_spotify_playlist_id: string
            }
            Returns: {
              match_method: string
              playlist_id: string
            }[]
          }
        | {
            Args: {
              p_deal_id: string
              p_playlist_name: string
              p_song_id?: string
              p_spotify_playlist_id: string
            }
            Returns: {
              match_method: string
              playlist_id: string
            }[]
          }
      priority_from_performance: {
        Args: { p_class: string }
        Returns: {
          priority: string
          reason: string
        }[]
      }
      recompute_curator_deal_state: {
        Args: { p_deal_id: string }
        Returns: undefined
      }
      recompute_curator_deal_totals: {
        Args: { p_deal_id: string }
        Returns: undefined
      }
      reconcile_account_playlist_counts: {
        Args: never
        Returns: {
          after_count: number
          before_count: number
          drift: number
          spotify_user_id: string
        }[]
      }
      reconcile_genre_counts: {
        Args: never
        Returns: {
          after_musicas: number
          after_playlists: number
          after_termos: number
          before_musicas: number
          before_playlists: number
          before_termos: number
          genre_id: string
        }[]
      }
      record_curator_deal_capture: {
        Args: {
          p_captured_at?: string
          p_deal_id: string
          p_is_baseline: boolean
          p_new_playlists: Json
          p_note: string
          p_print_urls: string[]
          p_snapshots: Json
          p_song_id: string
          p_total_plays: number
        }
        Returns: Json
      }
      recover_stuck_print_batches: {
        Args: never
        Returns: {
          batch_id: string
          deal_id: string
          print_urls: Json
          song_id: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      slugify: { Args: { p_text: string }; Returns: string }
      unaccent: { Args: { "": string }; Returns: string }
    }
    Enums: {
      app_role: "admin" | "curador"
      followers_source_type: "spotify_api"
      notification_type: "critical" | "warning" | "info"
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
      app_role: ["admin", "curador"],
      followers_source_type: ["spotify_api"],
      notification_type: ["critical", "warning", "info"],
    },
  },
} as const
