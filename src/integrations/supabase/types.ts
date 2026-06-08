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
      _io_stats_snapshots: {
        Row: {
          id: number
          idx_scan: number | null
          idx_tup_fetch: number | null
          label: string
          n_live_tup: number | null
          n_tup_del: number | null
          n_tup_ins: number | null
          n_tup_upd: number | null
          relname: string
          seq_scan: number | null
          seq_tup_read: number | null
          taken_at: string
        }
        Insert: {
          id?: number
          idx_scan?: number | null
          idx_tup_fetch?: number | null
          label: string
          n_live_tup?: number | null
          n_tup_del?: number | null
          n_tup_ins?: number | null
          n_tup_upd?: number | null
          relname: string
          seq_scan?: number | null
          seq_tup_read?: number | null
          taken_at?: string
        }
        Update: {
          id?: number
          idx_scan?: number | null
          idx_tup_fetch?: number | null
          label?: string
          n_live_tup?: number | null
          n_tup_del?: number | null
          n_tup_ins?: number | null
          n_tup_upd?: number | null
          relname?: string
          seq_scan?: number | null
          seq_tup_read?: number | null
          taken_at?: string
        }
        Relationships: []
      }
      _rls_optimization_audit: {
        Row: {
          after_check: string | null
          after_qual: string | null
          before_check: string | null
          before_qual: string | null
          changed: boolean
          cmd: string
          created_at: string
          id: number
          policyname: string
          tablename: string
        }
        Insert: {
          after_check?: string | null
          after_qual?: string | null
          before_check?: string | null
          before_qual?: string | null
          changed: boolean
          cmd: string
          created_at?: string
          id?: number
          policyname: string
          tablename: string
        }
        Update: {
          after_check?: string | null
          after_qual?: string | null
          before_check?: string | null
          before_qual?: string | null
          changed?: boolean
          cmd?: string
          created_at?: string
          id?: number
          policyname?: string
          tablename?: string
        }
        Relationships: []
      }
      accounts: {
        Row: {
          created_at: string
          current_playlists: number
          display_name: string | null
          email: string | null
          id: string
          last_sync_already_existed: number | null
          last_sync_at: string | null
          last_sync_auto_archived: number | null
          last_sync_found: number | null
          last_sync_imported: number | null
          last_sync_pending: number | null
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
          last_sync_already_existed?: number | null
          last_sync_at?: string | null
          last_sync_auto_archived?: number | null
          last_sync_found?: number | null
          last_sync_imported?: number | null
          last_sync_pending?: number | null
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
          last_sync_already_existed?: number | null
          last_sync_at?: string | null
          last_sync_auto_archived?: number | null
          last_sync_found?: number | null
          last_sync_imported?: number | null
          last_sync_pending?: number | null
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
          {
            foreignKeyName: "accounts_spotify_user_token_id_fkey"
            columns: ["spotify_user_token_id"]
            isOneToOne: false
            referencedRelation: "spotify_user_tokens_public"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_print_cache: {
        Row: {
          created_at: string
          hits: number
          last_hit_at: string
          model: string
          print_hash: string
          result: Json
          tokens_used: number | null
        }
        Insert: {
          created_at?: string
          hits?: number
          last_hit_at?: string
          model: string
          print_hash: string
          result: Json
          tokens_used?: number | null
        }
        Update: {
          created_at?: string
          hits?: number
          last_hit_at?: string
          model?: string
          print_hash?: string
          result?: Json
          tokens_used?: number | null
        }
        Relationships: []
      }
      ai_quota_user: {
        Row: {
          blocked: boolean
          cap_tokens: number
          month_start: string
          tokens_used: number
          updated_at: string
          user_id: string
        }
        Insert: {
          blocked?: boolean
          cap_tokens?: number
          month_start: string
          tokens_used?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          blocked?: boolean
          cap_tokens?: number
          month_start?: string
          tokens_used?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      anchor_playlists_audit: {
        Row: {
          anchor_genre: string
          authority_score: number | null
          classification: string
          computed_at: string
          foreign_breakdown: Json | null
          foreign_pct: number | null
          id: string
          own_pct: number | null
          phase22_purity_pct: number | null
          playlist_id: string
          reference_run_id: string
          top_contaminant: string | null
          top_contaminant_pct: number | null
          tracks_foreign: number
          tracks_own: number
          tracks_total: number
          tracks_unknown: number
          unknown_pct: number | null
        }
        Insert: {
          anchor_genre: string
          authority_score?: number | null
          classification: string
          computed_at?: string
          foreign_breakdown?: Json | null
          foreign_pct?: number | null
          id?: string
          own_pct?: number | null
          phase22_purity_pct?: number | null
          playlist_id: string
          reference_run_id: string
          top_contaminant?: string | null
          top_contaminant_pct?: number | null
          tracks_foreign: number
          tracks_own: number
          tracks_total: number
          tracks_unknown: number
          unknown_pct?: number | null
        }
        Update: {
          anchor_genre?: string
          authority_score?: number | null
          classification?: string
          computed_at?: string
          foreign_breakdown?: Json | null
          foreign_pct?: number | null
          id?: string
          own_pct?: number | null
          phase22_purity_pct?: number | null
          playlist_id?: string
          reference_run_id?: string
          top_contaminant?: string | null
          top_contaminant_pct?: number | null
          tracks_foreign?: number
          tracks_own?: number
          tracks_total?: number
          tracks_unknown?: number
          unknown_pct?: number | null
        }
        Relationships: []
      }
      artist_normalization_runs: {
        Row: {
          blind_genres_new: number | null
          blind_genres_old: number | null
          combos_detected: number | null
          coverage_gain_pp: number | null
          coverage_new_pct: number | null
          coverage_old_pct: number | null
          finished_at: string | null
          id: string
          notes: Json | null
          started_at: string
          total_track_lines: number | null
          unique_combos: number | null
          unique_individuals: number | null
        }
        Insert: {
          blind_genres_new?: number | null
          blind_genres_old?: number | null
          combos_detected?: number | null
          coverage_gain_pp?: number | null
          coverage_new_pct?: number | null
          coverage_old_pct?: number | null
          finished_at?: string | null
          id?: string
          notes?: Json | null
          started_at?: string
          total_track_lines?: number | null
          unique_combos?: number | null
          unique_individuals?: number | null
        }
        Update: {
          blind_genres_new?: number | null
          blind_genres_old?: number | null
          combos_detected?: number | null
          coverage_gain_pp?: number | null
          coverage_new_pct?: number | null
          coverage_old_pct?: number | null
          finished_at?: string | null
          id?: string
          notes?: Json | null
          started_at?: string
          total_track_lines?: number | null
          unique_combos?: number | null
          unique_individuals?: number | null
        }
        Relationships: []
      }
      artist_split_shadow: {
        Row: {
          artist_individual: string
          artist_norm: string
          created_at: string
          id: number
          original_combo: string
          source_id: string
          source_table: string
          split_position: number
          split_separator: string | null
        }
        Insert: {
          artist_individual: string
          artist_norm: string
          created_at?: string
          id?: number
          original_combo: string
          source_id: string
          source_table: string
          split_position: number
          split_separator?: string | null
        }
        Update: {
          artist_individual?: string
          artist_norm?: string
          created_at?: string
          id?: number
          original_combo?: string
          source_id?: string
          source_table?: string
          split_position?: number
          split_separator?: string | null
        }
        Relationships: []
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
          agent_version: string | null
          bot_name: string
          chrome_instances: number | null
          cpu_percent: number | null
          created_at: string
          disk_percent: number | null
          disk_total_gb: number | null
          disk_used_gb: number | null
          hostname: string | null
          id: string
          last_collect_at: string | null
          load_avg: Json | null
          mem_percent: number | null
          mem_total_mb: number | null
          mem_used_mb: number | null
          message: string | null
          metadata: Json
          pm2_processes: Json | null
          process_id: string | null
          processing_correlation_ids: string[] | null
          spotify_session_valid: boolean
          status: string
          swap_percent: number | null
          timer_id: string | null
          uptime_seconds: number | null
          worker_id: string | null
        }
        Insert: {
          agent_version?: string | null
          bot_name?: string
          chrome_instances?: number | null
          cpu_percent?: number | null
          created_at?: string
          disk_percent?: number | null
          disk_total_gb?: number | null
          disk_used_gb?: number | null
          hostname?: string | null
          id?: string
          last_collect_at?: string | null
          load_avg?: Json | null
          mem_percent?: number | null
          mem_total_mb?: number | null
          mem_used_mb?: number | null
          message?: string | null
          metadata?: Json
          pm2_processes?: Json | null
          process_id?: string | null
          processing_correlation_ids?: string[] | null
          spotify_session_valid?: boolean
          status?: string
          swap_percent?: number | null
          timer_id?: string | null
          uptime_seconds?: number | null
          worker_id?: string | null
        }
        Update: {
          agent_version?: string | null
          bot_name?: string
          chrome_instances?: number | null
          cpu_percent?: number | null
          created_at?: string
          disk_percent?: number | null
          disk_total_gb?: number | null
          disk_used_gb?: number | null
          hostname?: string | null
          id?: string
          last_collect_at?: string | null
          load_avg?: Json | null
          mem_percent?: number | null
          mem_total_mb?: number | null
          mem_used_mb?: number | null
          message?: string | null
          metadata?: Json
          pm2_processes?: Json | null
          process_id?: string | null
          processing_correlation_ids?: string[] | null
          spotify_session_valid?: boolean
          status?: string
          swap_percent?: number | null
          timer_id?: string | null
          uptime_seconds?: number | null
          worker_id?: string | null
        }
        Relationships: []
      }
      bot_ingest_raw: {
        Row: {
          campaign_id: string | null
          correlation_id: string | null
          created_at: string
          deal_id: string | null
          endpoint: string
          expires_at: string
          headers_json: Json | null
          http_method: string | null
          id: string
          ip: string | null
          payload_hash: string | null
          payload_json: Json
          payload_size_bytes: number | null
          processed: boolean
          processed_at: string | null
          processing_result: Json | null
          snapshot_id: string | null
          song_id: string | null
          source: string
          worker_id: string | null
        }
        Insert: {
          campaign_id?: string | null
          correlation_id?: string | null
          created_at?: string
          deal_id?: string | null
          endpoint: string
          expires_at?: string
          headers_json?: Json | null
          http_method?: string | null
          id?: string
          ip?: string | null
          payload_hash?: string | null
          payload_json: Json
          payload_size_bytes?: number | null
          processed?: boolean
          processed_at?: string | null
          processing_result?: Json | null
          snapshot_id?: string | null
          song_id?: string | null
          source: string
          worker_id?: string | null
        }
        Update: {
          campaign_id?: string | null
          correlation_id?: string | null
          created_at?: string
          deal_id?: string | null
          endpoint?: string
          expires_at?: string
          headers_json?: Json | null
          http_method?: string | null
          id?: string
          ip?: string | null
          payload_hash?: string | null
          payload_json?: Json
          payload_size_bytes?: number | null
          processed?: boolean
          processed_at?: string | null
          processing_result?: Json | null
          snapshot_id?: string | null
          song_id?: string | null
          source?: string
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
          superseded_by: string | null
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
          superseded_by?: string | null
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
          superseded_by?: string | null
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
          {
            foreignKeyName: "bot_print_batches_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "bot_print_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bot_print_batches_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "v_snapshot_prints"
            referencedColumns: ["run_id"]
          },
        ]
      }
      brain_drift_events: {
        Row: {
          brain_calculated_at: string | null
          brain_confidence: number | null
          brain_value: Json | null
          canonical_playlist_id: string | null
          detected_at: string
          diagnosis_id: string | null
          diff_pct: number | null
          field: string
          id: string
          local_value: Json | null
          playlist_id: string
        }
        Insert: {
          brain_calculated_at?: string | null
          brain_confidence?: number | null
          brain_value?: Json | null
          canonical_playlist_id?: string | null
          detected_at?: string
          diagnosis_id?: string | null
          diff_pct?: number | null
          field: string
          id?: string
          local_value?: Json | null
          playlist_id: string
        }
        Update: {
          brain_calculated_at?: string | null
          brain_confidence?: number | null
          brain_value?: Json | null
          canonical_playlist_id?: string | null
          detected_at?: string
          diagnosis_id?: string | null
          diff_pct?: number | null
          field?: string
          id?: string
          local_value?: Json | null
          playlist_id?: string
        }
        Relationships: []
      }
      campaign_access_emails: {
        Row: {
          added_at: string
          added_by: string | null
          campaign_id: string
          email: string
          id: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          campaign_id: string
          email: string
          id?: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          campaign_id?: string
          email?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_access_emails_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_radio_collected"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaign_access_emails_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_access_emails_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_velocity"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaign_access_emails_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_financial_summary"
            referencedColumns: ["campaign_id"]
          },
        ]
      }
      campaign_access_logs: {
        Row: {
          accessed_at: string
          campaign_id: string
          email: string | null
          id: string
          ip: string | null
          user_agent: string | null
        }
        Insert: {
          accessed_at?: string
          campaign_id: string
          email?: string | null
          id?: string
          ip?: string | null
          user_agent?: string | null
        }
        Update: {
          accessed_at?: string
          campaign_id?: string
          email?: string | null
          id?: string
          ip?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_access_logs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_radio_collected"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaign_access_logs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_access_logs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_velocity"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaign_access_logs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_financial_summary"
            referencedColumns: ["campaign_id"]
          },
        ]
      }
      campaign_access_otps: {
        Row: {
          campaign_id: string
          code: string
          created_at: string
          email: string
          expires_at: string
          id: string
          used_at: string | null
        }
        Insert: {
          campaign_id: string
          code: string
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          used_at?: string | null
        }
        Update: {
          campaign_id?: string
          code?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_access_otps_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_radio_collected"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaign_access_otps_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_access_otps_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_velocity"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaign_access_otps_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_financial_summary"
            referencedColumns: ["campaign_id"]
          },
        ]
      }
      campaign_allocations: {
        Row: {
          campaign_id: string
          created_at: string
          delivered_plays: number
          id: string
          notes: string | null
          playlist_id: string
          position: number
          status: string
          target_plays: number
          updated_at: string
          weight: number
        }
        Insert: {
          campaign_id: string
          created_at?: string
          delivered_plays?: number
          id?: string
          notes?: string | null
          playlist_id: string
          position?: number
          status?: string
          target_plays?: number
          updated_at?: string
          weight?: number
        }
        Update: {
          campaign_id?: string
          created_at?: string
          delivered_plays?: number
          id?: string
          notes?: string | null
          playlist_id?: string
          position?: number
          status?: string
          target_plays?: number
          updated_at?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "campaign_allocations_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_radio_collected"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaign_allocations_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_allocations_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_velocity"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaign_allocations_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_financial_summary"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaign_allocations_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_eco_allocations: {
        Row: {
          campaign_id: string
          cost_per_stream_op: number | null
          created_at: string
          dispatched_at: string | null
          genre_affinity_score: number | null
          genre_source: string
          id: string
          job_id: string | null
          managed_playlist_id: string
          market_per_stream: number | null
          planned_streams: number
          position: number | null
          price_per_stream_sell: number | null
          start_day: number
          status: string
          updated_at: string
        }
        Insert: {
          campaign_id: string
          cost_per_stream_op?: number | null
          created_at?: string
          dispatched_at?: string | null
          genre_affinity_score?: number | null
          genre_source?: string
          id?: string
          job_id?: string | null
          managed_playlist_id: string
          market_per_stream?: number | null
          planned_streams?: number
          position?: number | null
          price_per_stream_sell?: number | null
          start_day?: number
          status?: string
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          cost_per_stream_op?: number | null
          created_at?: string
          dispatched_at?: string | null
          genre_affinity_score?: number | null
          genre_source?: string
          id?: string
          job_id?: string | null
          managed_playlist_id?: string
          market_per_stream?: number | null
          planned_streams?: number
          position?: number | null
          price_per_stream_sell?: number | null
          start_day?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_eco_allocations_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_radio_collected"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaign_eco_allocations_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_eco_allocations_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_velocity"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaign_eco_allocations_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_financial_summary"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaign_eco_allocations_managed_playlist_id_fkey"
            columns: ["managed_playlist_id"]
            isOneToOne: false
            referencedRelation: "managed_playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_eco_allocations_managed_playlist_id_fkey"
            columns: ["managed_playlist_id"]
            isOneToOne: false
            referencedRelation: "v_playlist_vps_assignment"
            referencedColumns: ["managed_playlist_id"]
          },
        ]
      }
      campaign_eco_snapshots: {
        Row: {
          campaign_id: string
          captured_at: string
          correlation_id: string | null
          created_at: string
          id: string
          managed_playlist_id: string
          plays_24h: number | null
          plays_28d: number | null
          plays_7d: number | null
          source: string
          spotify_playlist_id: string
        }
        Insert: {
          campaign_id: string
          captured_at?: string
          correlation_id?: string | null
          created_at?: string
          id?: string
          managed_playlist_id: string
          plays_24h?: number | null
          plays_28d?: number | null
          plays_7d?: number | null
          source?: string
          spotify_playlist_id: string
        }
        Update: {
          campaign_id?: string
          captured_at?: string
          correlation_id?: string | null
          created_at?: string
          id?: string
          managed_playlist_id?: string
          plays_24h?: number | null
          plays_28d?: number | null
          plays_7d?: number | null
          source?: string
          spotify_playlist_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_eco_snapshots_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_radio_collected"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaign_eco_snapshots_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_eco_snapshots_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_velocity"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaign_eco_snapshots_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_financial_summary"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaign_eco_snapshots_managed_playlist_id_fkey"
            columns: ["managed_playlist_id"]
            isOneToOne: false
            referencedRelation: "managed_playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_eco_snapshots_managed_playlist_id_fkey"
            columns: ["managed_playlist_id"]
            isOneToOne: false
            referencedRelation: "v_playlist_vps_assignment"
            referencedColumns: ["managed_playlist_id"]
          },
        ]
      }
      campaign_external_package_items: {
        Row: {
          assigned_cost: number
          assigned_streams: number
          cost_per_stream: number
          created_at: string
          curator_deal_id: string | null
          curator_id: string
          id: string
          package_id: string
          source_purchase_id: string | null
          updated_at: string
        }
        Insert: {
          assigned_cost?: number
          assigned_streams?: number
          cost_per_stream?: number
          created_at?: string
          curator_deal_id?: string | null
          curator_id: string
          id?: string
          package_id: string
          source_purchase_id?: string | null
          updated_at?: string
        }
        Update: {
          assigned_cost?: number
          assigned_streams?: number
          cost_per_stream?: number
          created_at?: string
          curator_deal_id?: string | null
          curator_id?: string
          id?: string
          package_id?: string
          source_purchase_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_external_package_items_curator_deal_id_fkey"
            columns: ["curator_deal_id"]
            isOneToOne: false
            referencedRelation: "curator_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_external_package_items_curator_id_fkey"
            columns: ["curator_id"]
            isOneToOne: false
            referencedRelation: "curators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_external_package_items_curator_id_fkey"
            columns: ["curator_id"]
            isOneToOne: false
            referencedRelation: "v_curator_balance"
            referencedColumns: ["curator_id"]
          },
          {
            foreignKeyName: "campaign_external_package_items_curator_id_fkey"
            columns: ["curator_id"]
            isOneToOne: false
            referencedRelation: "v_curator_finance"
            referencedColumns: ["curator_id"]
          },
          {
            foreignKeyName: "campaign_external_package_items_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "campaign_external_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_external_package_items_source_purchase_id_fkey"
            columns: ["source_purchase_id"]
            isOneToOne: false
            referencedRelation: "curator_purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_external_packages: {
        Row: {
          campaign_id: string
          confirmed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          status: string
          target_cost: number
          target_streams: number
          updated_at: string
        }
        Insert: {
          campaign_id: string
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          status?: string
          target_cost?: number
          target_streams?: number
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          status?: string
          target_cost?: number
          target_streams?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_external_packages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_radio_collected"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaign_external_packages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_external_packages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_velocity"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaign_external_packages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_financial_summary"
            referencedColumns: ["campaign_id"]
          },
        ]
      }
      campaign_plan_history: {
        Row: {
          acted_by: string | null
          action: string
          campaign_id: string
          created_at: string
          id: string
          meta: Json | null
          new_playlist_ids: string[] | null
          old_playlist_id: string | null
          reason: string | null
        }
        Insert: {
          acted_by?: string | null
          action: string
          campaign_id: string
          created_at?: string
          id?: string
          meta?: Json | null
          new_playlist_ids?: string[] | null
          old_playlist_id?: string | null
          reason?: string | null
        }
        Update: {
          acted_by?: string | null
          action?: string
          campaign_id?: string
          created_at?: string
          id?: string
          meta?: Json | null
          new_playlist_ids?: string[] | null
          old_playlist_id?: string | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_plan_history_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_radio_collected"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaign_plan_history_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_plan_history_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_velocity"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaign_plan_history_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_financial_summary"
            referencedColumns: ["campaign_id"]
          },
        ]
      }
      campaign_plan_versions: {
        Row: {
          campaign_id: string
          created_at: string
          goal_plays: number | null
          id: string
          requested_by: string | null
          requested_message: string | null
          snapshot: Json
          total_allocated: number | null
          valor_cobrado: number | null
          version: number
        }
        Insert: {
          campaign_id: string
          created_at?: string
          goal_plays?: number | null
          id?: string
          requested_by?: string | null
          requested_message?: string | null
          snapshot?: Json
          total_allocated?: number | null
          valor_cobrado?: number | null
          version: number
        }
        Update: {
          campaign_id?: string
          created_at?: string
          goal_plays?: number | null
          id?: string
          requested_by?: string | null
          requested_message?: string | null
          snapshot?: Json
          total_allocated?: number | null
          valor_cobrado?: number | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "campaign_plan_versions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_radio_collected"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaign_plan_versions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_plan_versions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_velocity"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaign_plan_versions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_financial_summary"
            referencedColumns: ["campaign_id"]
          },
        ]
      }
      campaign_playlist_collections: {
        Row: {
          campaign_id: string
          captured_at: string
          collection_run_id: string | null
          created_at: string
          first_seen_at: string | null
          id: string
          is_baseline: boolean
          playlist_id: string
          playlist_name_at_capture: string | null
          playlist_url: string | null
          plays_7d: number
          proof_screenshot_url: string | null
          proof_screenshot_urls: string[]
          snapshot_run_id: string | null
          source: string
        }
        Insert: {
          campaign_id: string
          captured_at?: string
          collection_run_id?: string | null
          created_at?: string
          first_seen_at?: string | null
          id?: string
          is_baseline?: boolean
          playlist_id: string
          playlist_name_at_capture?: string | null
          playlist_url?: string | null
          plays_7d?: number
          proof_screenshot_url?: string | null
          proof_screenshot_urls?: string[]
          snapshot_run_id?: string | null
          source?: string
        }
        Update: {
          campaign_id?: string
          captured_at?: string
          collection_run_id?: string | null
          created_at?: string
          first_seen_at?: string | null
          id?: string
          is_baseline?: boolean
          playlist_id?: string
          playlist_name_at_capture?: string | null
          playlist_url?: string | null
          plays_7d?: number
          proof_screenshot_url?: string | null
          proof_screenshot_urls?: string[]
          snapshot_run_id?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_playlist_collections_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_radio_collected"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaign_playlist_collections_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_playlist_collections_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_velocity"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaign_playlist_collections_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_financial_summary"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaign_playlist_collections_snapshot_run_id_fkey"
            columns: ["snapshot_run_id"]
            isOneToOne: false
            referencedRelation: "bot_print_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_playlist_collections_snapshot_run_id_fkey"
            columns: ["snapshot_run_id"]
            isOneToOne: false
            referencedRelation: "v_snapshot_prints"
            referencedColumns: ["run_id"]
          },
        ]
      }
      campaigns: {
        Row: {
          artist: string | null
          auto_deal_created: boolean
          baseline_captured_at: string | null
          baseline_status: string
          campaign_type: string
          client_adjustment_request: string | null
          client_approved_at: string | null
          client_approved_by: string | null
          client_approved_ip: string | null
          client_decision_round: number
          client_id: string | null
          client_rejected_at: string | null
          closed_at: string | null
          collection_mode: string
          cover_url: string | null
          created_at: string
          created_by: string | null
          curator_id: string | null
          deadline: string | null
          deal_id: string | null
          eco_dispatched_at: string | null
          eco_max_pct: number
          engagement_multiplier: number
          expires_at: string | null
          final_report_requested_at: string | null
          final_report_url: string | null
          forma_recebimento: string | null
          goal_plays: number
          id: string
          locked_eco_streams: number | null
          notes: string | null
          plan_approved_at: string | null
          plan_approved_by: string | null
          public_plan_token: string
          radio_plays_start: number | null
          radio_plays_start_at: string | null
          recebido_em: string | null
          roadmap_token: string
          simulation_snapshot: Json | null
          snapshot_locked_at: string | null
          split_locked_at: string | null
          spotify_track_id: string | null
          spotify_track_url: string | null
          started_at: string
          status: string
          token_expires_at: string | null
          token_revoked_at: string | null
          total_allocated: number
          total_delivered: number
          track_name: string
          updated_at: string
          valor_cobrado: number | null
          valor_recebido: number | null
        }
        Insert: {
          artist?: string | null
          auto_deal_created?: boolean
          baseline_captured_at?: string | null
          baseline_status?: string
          campaign_type?: string
          client_adjustment_request?: string | null
          client_approved_at?: string | null
          client_approved_by?: string | null
          client_approved_ip?: string | null
          client_decision_round?: number
          client_id?: string | null
          client_rejected_at?: string | null
          closed_at?: string | null
          collection_mode?: string
          cover_url?: string | null
          created_at?: string
          created_by?: string | null
          curator_id?: string | null
          deadline?: string | null
          deal_id?: string | null
          eco_dispatched_at?: string | null
          eco_max_pct?: number
          engagement_multiplier?: number
          expires_at?: string | null
          final_report_requested_at?: string | null
          final_report_url?: string | null
          forma_recebimento?: string | null
          goal_plays: number
          id?: string
          locked_eco_streams?: number | null
          notes?: string | null
          plan_approved_at?: string | null
          plan_approved_by?: string | null
          public_plan_token?: string
          radio_plays_start?: number | null
          radio_plays_start_at?: string | null
          recebido_em?: string | null
          roadmap_token?: string
          simulation_snapshot?: Json | null
          snapshot_locked_at?: string | null
          split_locked_at?: string | null
          spotify_track_id?: string | null
          spotify_track_url?: string | null
          started_at?: string
          status?: string
          token_expires_at?: string | null
          token_revoked_at?: string | null
          total_allocated?: number
          total_delivered?: number
          track_name: string
          updated_at?: string
          valor_cobrado?: number | null
          valor_recebido?: number | null
        }
        Update: {
          artist?: string | null
          auto_deal_created?: boolean
          baseline_captured_at?: string | null
          baseline_status?: string
          campaign_type?: string
          client_adjustment_request?: string | null
          client_approved_at?: string | null
          client_approved_by?: string | null
          client_approved_ip?: string | null
          client_decision_round?: number
          client_id?: string | null
          client_rejected_at?: string | null
          closed_at?: string | null
          collection_mode?: string
          cover_url?: string | null
          created_at?: string
          created_by?: string | null
          curator_id?: string | null
          deadline?: string | null
          deal_id?: string | null
          eco_dispatched_at?: string | null
          eco_max_pct?: number
          engagement_multiplier?: number
          expires_at?: string | null
          final_report_requested_at?: string | null
          final_report_url?: string | null
          forma_recebimento?: string | null
          goal_plays?: number
          id?: string
          locked_eco_streams?: number | null
          notes?: string | null
          plan_approved_at?: string | null
          plan_approved_by?: string | null
          public_plan_token?: string
          radio_plays_start?: number | null
          radio_plays_start_at?: string | null
          recebido_em?: string | null
          roadmap_token?: string
          simulation_snapshot?: Json | null
          snapshot_locked_at?: string | null
          split_locked_at?: string | null
          spotify_track_id?: string | null
          spotify_track_url?: string | null
          started_at?: string
          status?: string
          token_expires_at?: string | null
          token_revoked_at?: string | null
          total_allocated?: number
          total_delivered?: number
          track_name?: string
          updated_at?: string
          valor_cobrado?: number | null
          valor_recebido?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_curator_id_fkey"
            columns: ["curator_id"]
            isOneToOne: false
            referencedRelation: "curators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_curator_id_fkey"
            columns: ["curator_id"]
            isOneToOne: false
            referencedRelation: "v_curator_balance"
            referencedColumns: ["curator_id"]
          },
          {
            foreignKeyName: "campaigns_curator_id_fkey"
            columns: ["curator_id"]
            isOneToOne: false
            referencedRelation: "v_curator_finance"
            referencedColumns: ["curator_id"]
          },
          {
            foreignKeyName: "campaigns_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "curator_deals"
            referencedColumns: ["id"]
          },
        ]
      }
      chart_position_benchmarks: {
        Row: {
          captured_at: string
          created_at: string
          database: string
          id: string
          position: number
          streams_day: number
          updated_at: string
        }
        Insert: {
          captured_at?: string
          created_at?: string
          database?: string
          id?: string
          position: number
          streams_day: number
          updated_at?: string
        }
        Update: {
          captured_at?: string
          created_at?: string
          database?: string
          id?: string
          position?: number
          streams_day?: number
          updated_at?: string
        }
        Relationships: []
      }
      clients: {
        Row: {
          archived_at: string | null
          brand_color: string | null
          city: string | null
          client_type: string
          company: string | null
          contact: string | null
          country: string | null
          created_at: string
          document: string | null
          email: string | null
          id: string
          image_url: string | null
          instagram: string | null
          logo_url: string | null
          monthly_listeners: number | null
          name: string
          notes: string | null
          payment_terms: string | null
          phone: string | null
          primary_genre: string | null
          spotify_artist_id: string | null
          spotify_artist_url: string | null
          tags: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          brand_color?: string | null
          city?: string | null
          client_type?: string
          company?: string | null
          contact?: string | null
          country?: string | null
          created_at?: string
          document?: string | null
          email?: string | null
          id?: string
          image_url?: string | null
          instagram?: string | null
          logo_url?: string | null
          monthly_listeners?: number | null
          name: string
          notes?: string | null
          payment_terms?: string | null
          phone?: string | null
          primary_genre?: string | null
          spotify_artist_id?: string | null
          spotify_artist_url?: string | null
          tags?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          brand_color?: string | null
          city?: string | null
          client_type?: string
          company?: string | null
          contact?: string | null
          country?: string | null
          created_at?: string
          document?: string | null
          email?: string | null
          id?: string
          image_url?: string | null
          instagram?: string | null
          logo_url?: string | null
          monthly_listeners?: number | null
          name?: string
          notes?: string | null
          payment_terms?: string | null
          phone?: string | null
          primary_genre?: string | null
          spotify_artist_id?: string | null
          spotify_artist_url?: string | null
          tags?: string[]
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
      community_campaigns: {
        Row: {
          brief: string | null
          closed_at: string | null
          created_at: string
          created_by: string
          deal_id: string
          id: string
          max_slots: number
          opened_at: string | null
          points_per_member: number
          proof_window_hours: number
          status: string
          title: string
          updated_at: string
          used_slots: number
        }
        Insert: {
          brief?: string | null
          closed_at?: string | null
          created_at?: string
          created_by: string
          deal_id: string
          id?: string
          max_slots?: number
          opened_at?: string | null
          points_per_member?: number
          proof_window_hours?: number
          status?: string
          title: string
          updated_at?: string
          used_slots?: number
        }
        Update: {
          brief?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string
          deal_id?: string
          id?: string
          max_slots?: number
          opened_at?: string | null
          points_per_member?: number
          proof_window_hours?: number
          status?: string
          title?: string
          updated_at?: string
          used_slots?: number
        }
        Relationships: []
      }
      community_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          code: string
          created_at: string
          email: string | null
          expires_at: string
          id: string
          invited_by: string
          note: string | null
          slug: string | null
          status: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          code?: string
          created_at?: string
          email?: string | null
          expires_at?: string
          id?: string
          invited_by: string
          note?: string | null
          slug?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          code?: string
          created_at?: string
          email?: string | null
          expires_at?: string
          id?: string
          invited_by?: string
          note?: string | null
          slug?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      community_members: {
        Row: {
          created_at: string
          display_name: string
          id: string
          instagram_handle: string | null
          invite_id: string | null
          invited_by: string | null
          joined_at: string
          playlist_followers: number | null
          playlist_name: string | null
          playlist_url: string | null
          points: number
          spotify_playlist_id: string | null
          status: string
          suspended_at: string | null
          suspended_reason: string | null
          tier: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          instagram_handle?: string | null
          invite_id?: string | null
          invited_by?: string | null
          joined_at?: string
          playlist_followers?: number | null
          playlist_name?: string | null
          playlist_url?: string | null
          points?: number
          spotify_playlist_id?: string | null
          status?: string
          suspended_at?: string | null
          suspended_reason?: string | null
          tier?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          instagram_handle?: string | null
          invite_id?: string | null
          invited_by?: string | null
          joined_at?: string
          playlist_followers?: number | null
          playlist_name?: string | null
          playlist_url?: string | null
          points?: number
          spotify_playlist_id?: string | null
          status?: string
          suspended_at?: string | null
          suspended_reason?: string | null
          tier?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_members_invite_id_fkey"
            columns: ["invite_id"]
            isOneToOne: false
            referencedRelation: "community_invites"
            referencedColumns: ["id"]
          },
        ]
      }
      community_participations: {
        Row: {
          campaign_id: string | null
          created_at: string
          deal_id: string
          expires_at: string | null
          id: string
          member_id: string
          points_awarded: number
          points_offered: number
          proof_submitted_at: string | null
          proof_url: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          song_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          campaign_id?: string | null
          created_at?: string
          deal_id: string
          expires_at?: string | null
          id?: string
          member_id: string
          points_awarded?: number
          points_offered?: number
          proof_submitted_at?: string | null
          proof_url?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          song_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          campaign_id?: string | null
          created_at?: string
          deal_id?: string
          expires_at?: string | null
          id?: string
          member_id?: string
          points_awarded?: number
          points_offered?: number
          proof_submitted_at?: string | null
          proof_url?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          song_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_participations_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "community_members"
            referencedColumns: ["id"]
          },
        ]
      }
      community_points_ledger: {
        Row: {
          campaign_id: string | null
          created_at: string
          created_by: string | null
          id: string
          member_id: string
          participation_id: string | null
          points: number
          reason: string
        }
        Insert: {
          campaign_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          member_id: string
          participation_id?: string | null
          points: number
          reason: string
        }
        Update: {
          campaign_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          member_id?: string
          participation_id?: string | null
          points?: number
          reason?: string
        }
        Relationships: []
      }
      cron_health: {
        Row: {
          duration_ms: number | null
          id: string
          job_name: string
          message: string | null
          metrics: Json
          ran_at: string
          status: string
        }
        Insert: {
          duration_ms?: number | null
          id?: string
          job_name: string
          message?: string | null
          metrics?: Json
          ran_at?: string
          status?: string
        }
        Update: {
          duration_ms?: number | null
          id?: string
          job_name?: string
          message?: string | null
          metrics?: Json
          ran_at?: string
          status?: string
        }
        Relationships: []
      }
      curator_access_logs: {
        Row: {
          created_at: string
          deal_id: string
          email: string
          id: string
          ip: string | null
        }
        Insert: {
          created_at?: string
          deal_id: string
          email: string
          id?: string
          ip?: string | null
        }
        Update: {
          created_at?: string
          deal_id?: string
          email?: string
          id?: string
          ip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "curator_access_logs_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "curator_deals"
            referencedColumns: ["id"]
          },
        ]
      }
      curator_access_otps: {
        Row: {
          code: string
          created_at: string
          deal_id: string
          email: string
          expires_at: string
          id: string
          used_at: string | null
        }
        Insert: {
          code: string
          created_at?: string
          deal_id: string
          email: string
          expires_at?: string
          id?: string
          used_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          deal_id?: string
          email?: string
          expires_at?: string
          id?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "curator_access_otps_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "curator_deals"
            referencedColumns: ["id"]
          },
        ]
      }
      curator_brain: {
        Row: {
          avg_cpp: number | null
          calculation_version: number
          capacity_avg_per_deal: number | null
          capacity_p90: number | null
          confidence_score: number
          created_at: string
          curator_id: string
          delivery_rate_pct: number | null
          economics: Json
          id: string
          identity: Json
          last_calculated_at: string
          metadata: Json
          on_time_rate_pct: number | null
          recommendations: Json
          reliability: Json
          risk: Json
          roi_score: number | null
          signals: Json
          trust_score: number
          updated_at: string
        }
        Insert: {
          avg_cpp?: number | null
          calculation_version?: number
          capacity_avg_per_deal?: number | null
          capacity_p90?: number | null
          confidence_score?: number
          created_at?: string
          curator_id: string
          delivery_rate_pct?: number | null
          economics?: Json
          id?: string
          identity?: Json
          last_calculated_at?: string
          metadata?: Json
          on_time_rate_pct?: number | null
          recommendations?: Json
          reliability?: Json
          risk?: Json
          roi_score?: number | null
          signals?: Json
          trust_score?: number
          updated_at?: string
        }
        Update: {
          avg_cpp?: number | null
          calculation_version?: number
          capacity_avg_per_deal?: number | null
          capacity_p90?: number | null
          confidence_score?: number
          created_at?: string
          curator_id?: string
          delivery_rate_pct?: number | null
          economics?: Json
          id?: string
          identity?: Json
          last_calculated_at?: string
          metadata?: Json
          on_time_rate_pct?: number | null
          recommendations?: Json
          reliability?: Json
          risk?: Json
          roi_score?: number | null
          signals?: Json
          trust_score?: number
          updated_at?: string
        }
        Relationships: []
      }
      curator_brain_history: {
        Row: {
          avg_cpp: number | null
          calculated_at: string
          capacity_avg_per_deal: number | null
          confidence_score: number
          curator_id: string
          delivery_rate_pct: number | null
          id: string
          on_time_rate_pct: number | null
          signals_count: number
          trust_score: number | null
        }
        Insert: {
          avg_cpp?: number | null
          calculated_at?: string
          capacity_avg_per_deal?: number | null
          confidence_score?: number
          curator_id: string
          delivery_rate_pct?: number | null
          id?: string
          on_time_rate_pct?: number | null
          signals_count?: number
          trust_score?: number | null
        }
        Update: {
          avg_cpp?: number | null
          calculated_at?: string
          capacity_avg_per_deal?: number | null
          confidence_score?: number
          curator_id?: string
          delivery_rate_pct?: number | null
          id?: string
          on_time_rate_pct?: number | null
          signals_count?: number
          trust_score?: number | null
        }
        Relationships: []
      }
      curator_campaign_playlists: {
        Row: {
          baseline_conflict_at: string | null
          baseline_conflict_source: string | null
          campaign_id: string
          created_at: string
          curator_id: string
          deal_id: string | null
          excluded_from_kpis: boolean
          first_seen_collection_run_id: string | null
          id: string
          matched_at: string | null
          playlist_id: string
          playlist_url: string
          registered_at: string
          status: string
          updated_at: string
        }
        Insert: {
          baseline_conflict_at?: string | null
          baseline_conflict_source?: string | null
          campaign_id: string
          created_at?: string
          curator_id: string
          deal_id?: string | null
          excluded_from_kpis?: boolean
          first_seen_collection_run_id?: string | null
          id?: string
          matched_at?: string | null
          playlist_id: string
          playlist_url: string
          registered_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          baseline_conflict_at?: string | null
          baseline_conflict_source?: string | null
          campaign_id?: string
          created_at?: string
          curator_id?: string
          deal_id?: string | null
          excluded_from_kpis?: boolean
          first_seen_collection_run_id?: string | null
          id?: string
          matched_at?: string | null
          playlist_id?: string
          playlist_url?: string
          registered_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "curator_campaign_playlists_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_radio_collected"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "curator_campaign_playlists_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curator_campaign_playlists_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_velocity"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "curator_campaign_playlists_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_financial_summary"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "curator_campaign_playlists_curator_id_fkey"
            columns: ["curator_id"]
            isOneToOne: false
            referencedRelation: "curators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curator_campaign_playlists_curator_id_fkey"
            columns: ["curator_id"]
            isOneToOne: false
            referencedRelation: "v_curator_balance"
            referencedColumns: ["curator_id"]
          },
          {
            foreignKeyName: "curator_campaign_playlists_curator_id_fkey"
            columns: ["curator_id"]
            isOneToOne: false
            referencedRelation: "v_curator_finance"
            referencedColumns: ["curator_id"]
          },
          {
            foreignKeyName: "curator_campaign_playlists_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "curator_deals"
            referencedColumns: ["id"]
          },
        ]
      }
      curator_deal_access_emails: {
        Row: {
          added_at: string
          added_by: string | null
          deal_id: string
          email: string
          id: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          deal_id: string
          email: string
          id?: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          deal_id?: string
          email?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "curator_deal_access_emails_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "curator_deals"
            referencedColumns: ["id"]
          },
        ]
      }
      curator_deal_baseline_playlists: {
        Row: {
          captured_at: string
          created_at: string
          deal_id: string
          id: string
          playlist_name: string | null
          snapshot_id: string | null
          song_id: string | null
          spotify_playlist_id: string
        }
        Insert: {
          captured_at?: string
          created_at?: string
          deal_id: string
          id?: string
          playlist_name?: string | null
          snapshot_id?: string | null
          song_id?: string | null
          spotify_playlist_id: string
        }
        Update: {
          captured_at?: string
          created_at?: string
          deal_id?: string
          id?: string
          playlist_name?: string | null
          snapshot_id?: string | null
          song_id?: string | null
          spotify_playlist_id?: string
        }
        Relationships: []
      }
      curator_deal_delivery_status: {
        Row: {
          actual_to_date: number
          deal_id: string
          delta_pct: number
          expected_to_date: number
          last_checked_at: string
          reason: string | null
          spike_playlist_ids: Json
          status: string
          updated_at: string
        }
        Insert: {
          actual_to_date?: number
          deal_id: string
          delta_pct?: number
          expected_to_date?: number
          last_checked_at?: string
          reason?: string | null
          spike_playlist_ids?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          actual_to_date?: number
          deal_id?: string
          delta_pct?: number
          expected_to_date?: number
          last_checked_at?: string
          reason?: string | null
          spike_playlist_ids?: Json
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "curator_deal_delivery_status_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: true
            referencedRelation: "curator_deals"
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
      curator_deal_payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          deal_id: string
          id: string
          method: string | null
          notes: string | null
          payment_date: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          deal_id: string
          id?: string
          method?: string | null
          notes?: string | null
          payment_date?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          deal_id?: string
          id?: string
          method?: string | null
          notes?: string | null
          payment_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "curator_deal_payments_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "curator_deals"
            referencedColumns: ["id"]
          },
        ]
      }
      curator_deal_plan: {
        Row: {
          cap_dia: number
          curator_playlist_id: string
          daily: Json
          deal_id: string
          engagement_mult: number
          followers: number
          generated_at: string
          id: string
          playlist_name: string
          position: number
          start_day: number
          total_streams: number
        }
        Insert: {
          cap_dia?: number
          curator_playlist_id: string
          daily?: Json
          deal_id: string
          engagement_mult?: number
          followers?: number
          generated_at?: string
          id?: string
          playlist_name: string
          position?: number
          start_day?: number
          total_streams?: number
        }
        Update: {
          cap_dia?: number
          curator_playlist_id?: string
          daily?: Json
          deal_id?: string
          engagement_mult?: number
          followers?: number
          generated_at?: string
          id?: string
          playlist_name?: string
          position?: number
          start_day?: number
          total_streams?: number
        }
        Relationships: [
          {
            foreignKeyName: "curator_deal_plan_curator_playlist_id_fkey"
            columns: ["curator_playlist_id"]
            isOneToOne: false
            referencedRelation: "curator_playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curator_deal_plan_curator_playlist_id_fkey"
            columns: ["curator_playlist_id"]
            isOneToOne: false
            referencedRelation: "v_curator_playlists_observational"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curator_deal_plan_curator_playlist_id_fkey"
            columns: ["curator_playlist_id"]
            isOneToOne: false
            referencedRelation: "v_curator_playlists_operational"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curator_deal_plan_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "curator_deals"
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
          flag_reason: string | null
          flagged: boolean
          id: string
          is_baseline: boolean
          match_method: string | null
          notes: string | null
          playlist_id: string
          plays: number
          plays_24h: number | null
          plays_28d: number | null
          plays_7d: number | null
          print_url: string | null
          snapshot_run_id: string | null
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
          flag_reason?: string | null
          flagged?: boolean
          id?: string
          is_baseline?: boolean
          match_method?: string | null
          notes?: string | null
          playlist_id: string
          plays?: number
          plays_24h?: number | null
          plays_28d?: number | null
          plays_7d?: number | null
          print_url?: string | null
          snapshot_run_id?: string | null
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
          flag_reason?: string | null
          flagged?: boolean
          id?: string
          is_baseline?: boolean
          match_method?: string | null
          notes?: string | null
          playlist_id?: string
          plays?: number
          plays_24h?: number | null
          plays_28d?: number | null
          plays_7d?: number | null
          print_url?: string | null
          snapshot_run_id?: string | null
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
            foreignKeyName: "curator_deal_snapshots_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "v_curator_playlists_observational"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curator_deal_snapshots_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "v_curator_playlists_operational"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curator_deal_snapshots_snapshot_run_id_fkey"
            columns: ["snapshot_run_id"]
            isOneToOne: false
            referencedRelation: "bot_print_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curator_deal_snapshots_snapshot_run_id_fkey"
            columns: ["snapshot_run_id"]
            isOneToOne: false
            referencedRelation: "v_snapshot_prints"
            referencedColumns: ["run_id"]
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
      curator_deal_snapshots_repoint_backup: {
        Row: {
          ai_confidence: number | null
          ai_raw: Json | null
          backed_up_at: string | null
          batch_id: string | null
          captured_at: string | null
          correlation_id: string | null
          created_at: string | null
          created_by: string | null
          deal_id: string | null
          flag_reason: string | null
          flagged: boolean | null
          id: string | null
          is_baseline: boolean | null
          match_method: string | null
          notes: string | null
          original_playlist_id_backup: string | null
          playlist_id: string | null
          plays: number | null
          plays_24h: number | null
          plays_28d: number | null
          plays_7d: number | null
          print_url: string | null
          snapshot_run_id: string | null
          song_id: string | null
          source: string | null
        }
        Insert: {
          ai_confidence?: number | null
          ai_raw?: Json | null
          backed_up_at?: string | null
          batch_id?: string | null
          captured_at?: string | null
          correlation_id?: string | null
          created_at?: string | null
          created_by?: string | null
          deal_id?: string | null
          flag_reason?: string | null
          flagged?: boolean | null
          id?: string | null
          is_baseline?: boolean | null
          match_method?: string | null
          notes?: string | null
          original_playlist_id_backup?: string | null
          playlist_id?: string | null
          plays?: number | null
          plays_24h?: number | null
          plays_28d?: number | null
          plays_7d?: number | null
          print_url?: string | null
          snapshot_run_id?: string | null
          song_id?: string | null
          source?: string | null
        }
        Update: {
          ai_confidence?: number | null
          ai_raw?: Json | null
          backed_up_at?: string | null
          batch_id?: string | null
          captured_at?: string | null
          correlation_id?: string | null
          created_at?: string | null
          created_by?: string | null
          deal_id?: string | null
          flag_reason?: string | null
          flagged?: boolean | null
          id?: string | null
          is_baseline?: boolean | null
          match_method?: string | null
          notes?: string | null
          original_playlist_id_backup?: string | null
          playlist_id?: string | null
          plays?: number | null
          plays_24h?: number | null
          plays_28d?: number | null
          plays_7d?: number | null
          print_url?: string | null
          snapshot_run_id?: string | null
          song_id?: string | null
          source?: string | null
        }
        Relationships: []
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
          queued_at: string | null
          ramp_up_days: number
          slug: string | null
          smartlink_url: string | null
          song_artist: string | null
          song_cover_url: string | null
          song_name: string
          song_spotify_url: string
          spotify_artist_id: string | null
          spotify_artist_url: string | null
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
          queued_at?: string | null
          ramp_up_days?: number
          slug?: string | null
          smartlink_url?: string | null
          song_artist?: string | null
          song_cover_url?: string | null
          song_name: string
          song_spotify_url: string
          spotify_artist_id?: string | null
          spotify_artist_url?: string | null
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
          queued_at?: string | null
          ramp_up_days?: number
          slug?: string | null
          smartlink_url?: string | null
          song_artist?: string | null
          song_cover_url?: string | null
          song_name?: string
          song_spotify_url?: string
          spotify_artist_id?: string | null
          spotify_artist_url?: string | null
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
          baseline_captured_at: string | null
          baseline_plays: number | null
          billing_model: string
          campaign_id: string | null
          client_token: string
          closed_at: string | null
          closed_reason: string | null
          closed_status: string | null
          collection_mode: string
          cost: number | null
          created_at: string
          curator_id: string | null
          curator_name: string
          cycle_months: number | null
          daily_goal: number
          ends_at: string | null
          final_report_url: string | null
          id: string
          last_reconciled_at: string | null
          monthly_amount: number | null
          next_invoice_at: string | null
          origin: string
          payout_window: string
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
          source: string | null
          source_fit_id: string | null
          spotify_owner_id: string | null
          spotify_owner_url: string | null
          started_at: string
          state: string
          target_days: number | null
          target_plays: number
          token_expires_at: string | null
          token_revoked_at: string | null
          user_id: string
        }
        Insert: {
          baseline_captured_at?: string | null
          baseline_plays?: number | null
          billing_model?: string
          campaign_id?: string | null
          client_token?: string
          closed_at?: string | null
          closed_reason?: string | null
          closed_status?: string | null
          collection_mode?: string
          cost?: number | null
          created_at?: string
          curator_id?: string | null
          curator_name: string
          cycle_months?: number | null
          daily_goal?: number
          ends_at?: string | null
          final_report_url?: string | null
          id?: string
          last_reconciled_at?: string | null
          monthly_amount?: number | null
          next_invoice_at?: string | null
          origin?: string
          payout_window?: string
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
          source?: string | null
          source_fit_id?: string | null
          spotify_owner_id?: string | null
          spotify_owner_url?: string | null
          started_at?: string
          state?: string
          target_days?: number | null
          target_plays: number
          token_expires_at?: string | null
          token_revoked_at?: string | null
          user_id: string
        }
        Update: {
          baseline_captured_at?: string | null
          baseline_plays?: number | null
          billing_model?: string
          campaign_id?: string | null
          client_token?: string
          closed_at?: string | null
          closed_reason?: string | null
          closed_status?: string | null
          collection_mode?: string
          cost?: number | null
          created_at?: string
          curator_id?: string | null
          curator_name?: string
          cycle_months?: number | null
          daily_goal?: number
          ends_at?: string | null
          final_report_url?: string | null
          id?: string
          last_reconciled_at?: string | null
          monthly_amount?: number | null
          next_invoice_at?: string | null
          origin?: string
          payout_window?: string
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
          source?: string | null
          source_fit_id?: string | null
          spotify_owner_id?: string | null
          spotify_owner_url?: string | null
          started_at?: string
          state?: string
          target_days?: number | null
          target_plays?: number
          token_expires_at?: string | null
          token_revoked_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "curator_deals_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_radio_collected"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "curator_deals_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curator_deals_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_velocity"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "curator_deals_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_financial_summary"
            referencedColumns: ["campaign_id"]
          },
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
          {
            foreignKeyName: "curator_fraud_alerts_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "v_curator_playlists_observational"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curator_fraud_alerts_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "v_curator_playlists_operational"
            referencedColumns: ["id"]
          },
        ]
      }
      curator_outreach_log: {
        Row: {
          body_snippet: string | null
          channel: string
          created_at: string
          error_message: string | null
          event_type: string
          external_curator_id: string | null
          id: string
          note: string | null
          recipient_email: string | null
          recipient_handle: string | null
          sent_at: string
          status: string
          subject: string | null
          template_name: string | null
          user_id: string
        }
        Insert: {
          body_snippet?: string | null
          channel: string
          created_at?: string
          error_message?: string | null
          event_type?: string
          external_curator_id?: string | null
          id?: string
          note?: string | null
          recipient_email?: string | null
          recipient_handle?: string | null
          sent_at?: string
          status?: string
          subject?: string | null
          template_name?: string | null
          user_id: string
        }
        Update: {
          body_snippet?: string | null
          channel?: string
          created_at?: string
          error_message?: string | null
          event_type?: string
          external_curator_id?: string | null
          id?: string
          note?: string | null
          recipient_email?: string | null
          recipient_handle?: string | null
          sent_at?: string
          status?: string
          subject?: string | null
          template_name?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "curator_outreach_log_external_curator_id_fkey"
            columns: ["external_curator_id"]
            isOneToOne: false
            referencedRelation: "external_curators"
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
          canonical_playlist_id: string | null
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
          canonical_playlist_id?: string | null
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
          canonical_playlist_id?: string | null
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
        Relationships: [
          {
            foreignKeyName: "curator_playlist_library_canonical_playlist_id_fkey"
            columns: ["canonical_playlist_id"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["id"]
          },
        ]
      }
      curator_playlists: {
        Row: {
          added_at: string
          added_at_spotify: string | null
          attribution_method: string
          attribution_reason: string | null
          canonical_playlist_id: string | null
          deal_id: string
          followers: number | null
          id: string
          image_url: string | null
          is_baseline: boolean
          is_observational: boolean | null
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
          attribution_method?: string
          attribution_reason?: string | null
          canonical_playlist_id?: string | null
          deal_id: string
          followers?: number | null
          id?: string
          image_url?: string | null
          is_baseline?: boolean
          is_observational?: boolean | null
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
          attribution_method?: string
          attribution_reason?: string | null
          canonical_playlist_id?: string | null
          deal_id?: string
          followers?: number | null
          id?: string
          image_url?: string | null
          is_baseline?: boolean
          is_observational?: boolean | null
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
            foreignKeyName: "curator_playlists_canonical_playlist_id_fkey"
            columns: ["canonical_playlist_id"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["id"]
          },
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
      curator_playlists_ghost_repoint_map: {
        Row: {
          created_at: string
          deal_id: string
          ghost_id: string
          ghost_name: string | null
          id: string
          norm_key: string | null
          twin_id: string
          twin_name: string | null
          twin_spotify_id: string | null
        }
        Insert: {
          created_at?: string
          deal_id: string
          ghost_id: string
          ghost_name?: string | null
          id?: string
          norm_key?: string | null
          twin_id: string
          twin_name?: string | null
          twin_spotify_id?: string | null
        }
        Update: {
          created_at?: string
          deal_id?: string
          ghost_id?: string
          ghost_name?: string | null
          id?: string
          norm_key?: string | null
          twin_id?: string
          twin_name?: string | null
          twin_spotify_id?: string | null
        }
        Relationships: []
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
          billing_day: number | null
          contact: string | null
          created_at: string
          deal_type: string
          default_amount: number | null
          default_plays: number | null
          document: string | null
          email: string | null
          full_name: string | null
          id: string
          monthly_amount: number | null
          name: string
          notes: string | null
          paused_at: string | null
          performance_score: number | null
          performance_score_updated_at: string | null
          phone: string | null
          pix_key: string | null
          pix_type: string | null
          purchased_plays: number
          spotify_owner_id: string | null
          spotify_owner_url: string | null
          total_cost: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          billing_day?: number | null
          contact?: string | null
          created_at?: string
          deal_type?: string
          default_amount?: number | null
          default_plays?: number | null
          document?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          monthly_amount?: number | null
          name: string
          notes?: string | null
          paused_at?: string | null
          performance_score?: number | null
          performance_score_updated_at?: string | null
          phone?: string | null
          pix_key?: string | null
          pix_type?: string | null
          purchased_plays?: number
          spotify_owner_id?: string | null
          spotify_owner_url?: string | null
          total_cost?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          billing_day?: number | null
          contact?: string | null
          created_at?: string
          deal_type?: string
          default_amount?: number | null
          default_plays?: number | null
          document?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          monthly_amount?: number | null
          name?: string
          notes?: string | null
          paused_at?: string | null
          performance_score?: number | null
          performance_score_updated_at?: string | null
          phone?: string | null
          pix_key?: string | null
          pix_type?: string | null
          purchased_plays?: number
          spotify_owner_id?: string | null
          spotify_owner_url?: string | null
          total_cost?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      delivery_proofs: {
        Row: {
          bot_correlation_id: string | null
          captured_at: string
          created_at: string
          deal_id: string
          id: string
          playlist_id: string
          playlist_name: string
          plays_24h: number | null
          plays_7d: number | null
          plays_total: number
          position_in_playlist: number | null
          screenshot_url: string | null
          song_id: string
          source: string
          spotify_playlist_id: string
          spotify_track_id: string | null
          track_name: string
        }
        Insert: {
          bot_correlation_id?: string | null
          captured_at?: string
          created_at?: string
          deal_id: string
          id?: string
          playlist_id: string
          playlist_name: string
          plays_24h?: number | null
          plays_7d?: number | null
          plays_total: number
          position_in_playlist?: number | null
          screenshot_url?: string | null
          song_id: string
          source?: string
          spotify_playlist_id: string
          spotify_track_id?: string | null
          track_name: string
        }
        Update: {
          bot_correlation_id?: string | null
          captured_at?: string
          created_at?: string
          deal_id?: string
          id?: string
          playlist_id?: string
          playlist_name?: string
          plays_24h?: number | null
          plays_7d?: number | null
          plays_total?: number
          position_in_playlist?: number | null
          screenshot_url?: string | null
          song_id?: string
          source?: string
          spotify_playlist_id?: string
          spotify_track_id?: string | null
          track_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_proofs_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "curator_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_proofs_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "curator_playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_proofs_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "v_curator_playlists_observational"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_proofs_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "v_curator_playlists_operational"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_proofs_song_id_fkey"
            columns: ["song_id"]
            isOneToOne: false
            referencedRelation: "curator_deal_songs"
            referencedColumns: ["id"]
          },
        ]
      }
      deprecation_blocked_jobs: {
        Row: {
          blocked_at: string
          id: number
          job_type: string
          payload: Json | null
        }
        Insert: {
          blocked_at?: string
          id?: number
          job_type: string
          payload?: Json | null
        }
        Update: {
          blocked_at?: string
          id?: number
          job_type?: string
          payload?: Json | null
        }
        Relationships: []
      }
      deprecation_hits: {
        Row: {
          called_at: string
          caller_user_id: string | null
          function_name: string
          id: number
          request_meta: Json | null
          source: string
        }
        Insert: {
          called_at?: string
          caller_user_id?: string | null
          function_name: string
          id?: number
          request_meta?: Json | null
          source?: string
        }
        Update: {
          called_at?: string
          caller_user_id?: string | null
          function_name?: string
          id?: number
          request_meta?: Json | null
          source?: string
        }
        Relationships: []
      }
      discovery_wave1_reports: {
        Row: {
          approved: number
          benchmark_size: number
          created_at: string
          discovered: number
          duplicates: number
          genre_id: string | null
          id: string
          invalid: number
          removed: number
          run_id: string
          top_problems: Json
        }
        Insert: {
          approved?: number
          benchmark_size?: number
          created_at?: string
          discovered?: number
          duplicates?: number
          genre_id?: string | null
          id?: string
          invalid?: number
          removed?: number
          run_id: string
          top_problems?: Json
        }
        Update: {
          approved?: number
          benchmark_size?: number
          created_at?: string
          discovered?: number
          duplicates?: number
          genre_id?: string | null
          id?: string
          invalid?: number
          removed?: number
          run_id?: string
          top_problems?: Json
        }
        Relationships: [
          {
            foreignKeyName: "discovery_wave1_reports_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discovery_wave1_reports_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres_with_health"
            referencedColumns: ["id"]
          },
        ]
      }
      dna_blind_test_playlists: {
        Row: {
          ambiguous_hits: number | null
          artist_signals: number | null
          cadastrado_genre_name: string | null
          confidence_pct: number | null
          created_at: string
          error_reasons: string[] | null
          id: string
          is_correct: boolean | null
          margin_pct: number | null
          playlist_id: string
          predicted_genre_id: string | null
          predicted_genre_name: string | null
          run_id: string
          runner_up_genre_name: string | null
          supporting_artists: Json | null
          supporting_tracks: Json | null
          track_signals: number | null
          tracks_total: number | null
          unclassifiable: boolean | null
          unclassifiable_reason: string | null
          votes: Json | null
        }
        Insert: {
          ambiguous_hits?: number | null
          artist_signals?: number | null
          cadastrado_genre_name?: string | null
          confidence_pct?: number | null
          created_at?: string
          error_reasons?: string[] | null
          id?: string
          is_correct?: boolean | null
          margin_pct?: number | null
          playlist_id: string
          predicted_genre_id?: string | null
          predicted_genre_name?: string | null
          run_id: string
          runner_up_genre_name?: string | null
          supporting_artists?: Json | null
          supporting_tracks?: Json | null
          track_signals?: number | null
          tracks_total?: number | null
          unclassifiable?: boolean | null
          unclassifiable_reason?: string | null
          votes?: Json | null
        }
        Update: {
          ambiguous_hits?: number | null
          artist_signals?: number | null
          cadastrado_genre_name?: string | null
          confidence_pct?: number | null
          created_at?: string
          error_reasons?: string[] | null
          id?: string
          is_correct?: boolean | null
          margin_pct?: number | null
          playlist_id?: string
          predicted_genre_id?: string | null
          predicted_genre_name?: string | null
          run_id?: string
          runner_up_genre_name?: string | null
          supporting_artists?: Json | null
          supporting_tracks?: Json | null
          track_signals?: number | null
          tracks_total?: number | null
          unclassifiable?: boolean | null
          unclassifiable_reason?: string | null
          votes?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "dna_blind_test_playlists_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "dna_blind_test_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      dna_blind_test_runs: {
        Row: {
          accuracy_pct: number | null
          finished_at: string | null
          id: string
          reference_run_id: string | null
          sample_per_genre: number
          started_at: string
          target_genres: string[]
          totals: Json | null
        }
        Insert: {
          accuracy_pct?: number | null
          finished_at?: string | null
          id?: string
          reference_run_id?: string | null
          sample_per_genre?: number
          started_at?: string
          target_genres?: string[]
          totals?: Json | null
        }
        Update: {
          accuracy_pct?: number | null
          finished_at?: string | null
          id?: string
          reference_run_id?: string | null
          sample_per_genre?: number
          started_at?: string
          target_genres?: string[]
          totals?: Json | null
        }
        Relationships: []
      }
      editorial_history: {
        Row: {
          artist_name: string | null
          cover_url: string | null
          created_at: string
          genre_id: string
          id: number
          position: number | null
          release_date: string | null
          run_date: string
          score_final: number | null
          track_id: string
          track_name: string | null
        }
        Insert: {
          artist_name?: string | null
          cover_url?: string | null
          created_at?: string
          genre_id: string
          id?: number
          position?: number | null
          release_date?: string | null
          run_date?: string
          score_final?: number | null
          track_id: string
          track_name?: string | null
        }
        Update: {
          artist_name?: string | null
          cover_url?: string | null
          created_at?: string
          genre_id?: string
          id?: number
          position?: number | null
          release_date?: string | null
          run_date?: string
          score_final?: number | null
          track_id?: string
          track_name?: string | null
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      external_curators: {
        Row: {
          activity: string | null
          commercial_score: Json
          created_at: string
          description: string | null
          email: string | null
          favorite: boolean
          followers: number | null
          followup_count: number
          id: string
          instagram: string | null
          last_modified: string | null
          last_outreach_at: string | null
          last_outreach_channel: string | null
          last_response_at: string | null
          links: string | null
          name: string
          notes: string | null
          operational_tags: string[]
          owner_name: string | null
          pipeline_status: string
          score: string | null
          score_raw: number | null
          social: string | null
          spotify_playlist_id: string | null
          spotify_url: string | null
          status: string
          track_popularity: number | null
          tracks: number | null
          updated_at: string
          user_id: string
          whatsapp: string | null
        }
        Insert: {
          activity?: string | null
          commercial_score?: Json
          created_at?: string
          description?: string | null
          email?: string | null
          favorite?: boolean
          followers?: number | null
          followup_count?: number
          id?: string
          instagram?: string | null
          last_modified?: string | null
          last_outreach_at?: string | null
          last_outreach_channel?: string | null
          last_response_at?: string | null
          links?: string | null
          name: string
          notes?: string | null
          operational_tags?: string[]
          owner_name?: string | null
          pipeline_status?: string
          score?: string | null
          score_raw?: number | null
          social?: string | null
          spotify_playlist_id?: string | null
          spotify_url?: string | null
          status?: string
          track_popularity?: number | null
          tracks?: number | null
          updated_at?: string
          user_id: string
          whatsapp?: string | null
        }
        Update: {
          activity?: string | null
          commercial_score?: Json
          created_at?: string
          description?: string | null
          email?: string | null
          favorite?: boolean
          followers?: number | null
          followup_count?: number
          id?: string
          instagram?: string | null
          last_modified?: string | null
          last_outreach_at?: string | null
          last_outreach_channel?: string | null
          last_response_at?: string | null
          links?: string | null
          name?: string
          notes?: string | null
          operational_tags?: string[]
          owner_name?: string | null
          pipeline_status?: string
          score?: string | null
          score_raw?: number | null
          social?: string | null
          spotify_playlist_id?: string | null
          spotify_url?: string | null
          status?: string
          track_popularity?: number | null
          tracks?: number | null
          updated_at?: string
          user_id?: string
          whatsapp?: string | null
        }
        Relationships: []
      }
      genre_affinities: {
        Row: {
          computed_at: string
          created_at: string
          genre_a_id: string
          genre_b_id: string
          id: string
          lexicon_score: number | null
          manual_score: number | null
          method: string
          notes: string | null
          score: number
          shared_tokens: Json | null
          updated_at: string
        }
        Insert: {
          computed_at?: string
          created_at?: string
          genre_a_id: string
          genre_b_id: string
          id?: string
          lexicon_score?: number | null
          manual_score?: number | null
          method: string
          notes?: string | null
          score: number
          shared_tokens?: Json | null
          updated_at?: string
        }
        Update: {
          computed_at?: string
          created_at?: string
          genre_a_id?: string
          genre_b_id?: string
          id?: string
          lexicon_score?: number | null
          manual_score?: number | null
          method?: string
          notes?: string | null
          score?: number
          shared_tokens?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "genre_affinities_genre_a_id_fkey"
            columns: ["genre_a_id"]
            isOneToOne: false
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "genre_affinities_genre_a_id_fkey"
            columns: ["genre_a_id"]
            isOneToOne: false
            referencedRelation: "genres_with_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "genre_affinities_genre_b_id_fkey"
            columns: ["genre_b_id"]
            isOneToOne: false
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "genre_affinities_genre_b_id_fkey"
            columns: ["genre_b_id"]
            isOneToOne: false
            referencedRelation: "genres_with_health"
            referencedColumns: ["id"]
          },
        ]
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
      genre_benchmarks: {
        Row: {
          avg_growth_pct_30d: number | null
          calculated_at: string
          followers_p50: number | null
          followers_p75: number | null
          followers_p90: number | null
          genre_id: string
          metadata: Json
          plays_per_follower_estimate: number
          sample_size: number
          tracks_p50: number | null
          tracks_p75: number | null
          tracks_p90: number | null
        }
        Insert: {
          avg_growth_pct_30d?: number | null
          calculated_at?: string
          followers_p50?: number | null
          followers_p75?: number | null
          followers_p90?: number | null
          genre_id: string
          metadata?: Json
          plays_per_follower_estimate?: number
          sample_size?: number
          tracks_p50?: number | null
          tracks_p75?: number | null
          tracks_p90?: number | null
        }
        Update: {
          avg_growth_pct_30d?: number | null
          calculated_at?: string
          followers_p50?: number | null
          followers_p75?: number | null
          followers_p90?: number | null
          genre_id?: string
          metadata?: Json
          plays_per_follower_estimate?: number
          sample_size?: number
          tracks_p50?: number | null
          tracks_p75?: number | null
          tracks_p90?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "genre_benchmarks_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: true
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "genre_benchmarks_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: true
            referencedRelation: "genres_with_health"
            referencedColumns: ["id"]
          },
        ]
      }
      genre_brain: {
        Row: {
          active_leaders: number
          aesthetics_updated_at: string | null
          aggressiveness_score: number | null
          avg_confidence: number | null
          avg_leadership_score: number | null
          contrast_avg: number | null
          created_at: string
          display_name: string
          dominant_colors: Json
          genre_id: string
          has_face_pct: number | null
          id: string
          knowledge_score: number | null
          last_recomputed_at: string
          leadership_updated_at: string | null
          lexicon_updated_at: string | null
          metadata: Json
          parent_genre_id: string | null
          playlists_total: number
          playlists_with_genre: number
          recent_drifts_7d: number
          recent_reclassifications_7d: number
          slug: string
          style_tags: Json
          tokens_strong: number
          tokens_total: number
          top_tokens: Json
          updated_at: string
        }
        Insert: {
          active_leaders?: number
          aesthetics_updated_at?: string | null
          aggressiveness_score?: number | null
          avg_confidence?: number | null
          avg_leadership_score?: number | null
          contrast_avg?: number | null
          created_at?: string
          display_name: string
          dominant_colors?: Json
          genre_id: string
          has_face_pct?: number | null
          id?: string
          knowledge_score?: number | null
          last_recomputed_at?: string
          leadership_updated_at?: string | null
          lexicon_updated_at?: string | null
          metadata?: Json
          parent_genre_id?: string | null
          playlists_total?: number
          playlists_with_genre?: number
          recent_drifts_7d?: number
          recent_reclassifications_7d?: number
          slug: string
          style_tags?: Json
          tokens_strong?: number
          tokens_total?: number
          top_tokens?: Json
          updated_at?: string
        }
        Update: {
          active_leaders?: number
          aesthetics_updated_at?: string | null
          aggressiveness_score?: number | null
          avg_confidence?: number | null
          avg_leadership_score?: number | null
          contrast_avg?: number | null
          created_at?: string
          display_name?: string
          dominant_colors?: Json
          genre_id?: string
          has_face_pct?: number | null
          id?: string
          knowledge_score?: number | null
          last_recomputed_at?: string
          leadership_updated_at?: string | null
          lexicon_updated_at?: string | null
          metadata?: Json
          parent_genre_id?: string | null
          playlists_total?: number
          playlists_with_genre?: number
          recent_drifts_7d?: number
          recent_reclassifications_7d?: number
          slug?: string
          style_tags?: Json
          tokens_strong?: number
          tokens_total?: number
          top_tokens?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "genre_brain_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: true
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "genre_brain_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: true
            referencedRelation: "genres_with_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "genre_brain_parent_genre_id_fkey"
            columns: ["parent_genre_id"]
            isOneToOne: false
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "genre_brain_parent_genre_id_fkey"
            columns: ["parent_genre_id"]
            isOneToOne: false
            referencedRelation: "genres_with_health"
            referencedColumns: ["id"]
          },
        ]
      }
      genre_brain_history: {
        Row: {
          active_leaders: number | null
          avg_confidence: number | null
          avg_leadership_score: number | null
          captured_at: string
          cluster_strength_avg: number | null
          freshness_avg: number | null
          genre_id: string
          id: string
          knowledge_score: number | null
          metadata: Json | null
          playlists_with_genre: number | null
          recent_drifts_7d: number | null
          slug: string | null
          tokens_strong: number | null
          tokens_total: number | null
        }
        Insert: {
          active_leaders?: number | null
          avg_confidence?: number | null
          avg_leadership_score?: number | null
          captured_at?: string
          cluster_strength_avg?: number | null
          freshness_avg?: number | null
          genre_id: string
          id?: string
          knowledge_score?: number | null
          metadata?: Json | null
          playlists_with_genre?: number | null
          recent_drifts_7d?: number | null
          slug?: string | null
          tokens_strong?: number | null
          tokens_total?: number | null
        }
        Update: {
          active_leaders?: number | null
          avg_confidence?: number | null
          avg_leadership_score?: number | null
          captured_at?: string
          cluster_strength_avg?: number | null
          freshness_avg?: number | null
          genre_id?: string
          id?: string
          knowledge_score?: number | null
          metadata?: Json | null
          playlists_with_genre?: number | null
          recent_drifts_7d?: number | null
          slug?: string | null
          tokens_strong?: number | null
          tokens_total?: number | null
        }
        Relationships: []
      }
      genre_capacity_matrix: {
        Row: {
          genre_id: string
          genre_name: string
          id: string
          playlist_count: number
          plays_per_day_x18: number
          plays_per_day_x30: number
          plays_per_day_x50: number
          position: number
          total_followers: number
          updated_at: string
        }
        Insert: {
          genre_id: string
          genre_name: string
          id?: string
          playlist_count?: number
          plays_per_day_x18?: number
          plays_per_day_x30?: number
          plays_per_day_x50?: number
          position: number
          total_followers?: number
          updated_at?: string
        }
        Update: {
          genre_id?: string
          genre_name?: string
          id?: string
          playlist_count?: number
          plays_per_day_x18?: number
          plays_per_day_x30?: number
          plays_per_day_x50?: number
          position?: number
          total_followers?: number
          updated_at?: string
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
      genre_lexicon_history: {
        Row: {
          captured_at: string
          genre_id: string
          id: string
          rank: number | null
          slug: string | null
          status: string | null
          term: string
          weight: number | null
        }
        Insert: {
          captured_at?: string
          genre_id: string
          id?: string
          rank?: number | null
          slug?: string | null
          status?: string | null
          term: string
          weight?: number | null
        }
        Update: {
          captured_at?: string
          genre_id?: string
          id?: string
          rank?: number | null
          slug?: string | null
          status?: string | null
          term?: string
          weight?: number | null
        }
        Relationships: []
      }
      genre_models: {
        Row: {
          genre_id: string | null
          id: string
          insights: Json | null
          min_health_score: number
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
          min_health_score?: number
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
          min_health_score?: number
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
      genre_reference_artists: {
        Row: {
          artist_name: string
          artist_norm: string
          authority_score: number
          genre_id: string
          genre_name: string
          genres_present: number
          id: string
          playlists_in_genre: number
          purity_pct: number
          rank_in_genre: number | null
          run_id: string
          total_instances_all_genres: number
          track_instances_in_genre: number
        }
        Insert: {
          artist_name: string
          artist_norm: string
          authority_score?: number
          genre_id: string
          genre_name: string
          genres_present?: number
          id?: string
          playlists_in_genre?: number
          purity_pct?: number
          rank_in_genre?: number | null
          run_id: string
          total_instances_all_genres?: number
          track_instances_in_genre?: number
        }
        Update: {
          artist_name?: string
          artist_norm?: string
          authority_score?: number
          genre_id?: string
          genre_name?: string
          genres_present?: number
          id?: string
          playlists_in_genre?: number
          purity_pct?: number
          rank_in_genre?: number | null
          run_id?: string
          total_instances_all_genres?: number
          track_instances_in_genre?: number
        }
        Relationships: [
          {
            foreignKeyName: "genre_reference_artists_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "genre_reference_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      genre_reference_artists_shadow: {
        Row: {
          artist_display: string
          artist_norm: string
          created_at: string
          genre_id: string | null
          genre_nome: string | null
          id: number
          is_anchor: boolean
          occurrences: number
          playlists_count: number
          purity_pct: number | null
          total_genre_appearances: number
        }
        Insert: {
          artist_display: string
          artist_norm: string
          created_at?: string
          genre_id?: string | null
          genre_nome?: string | null
          id?: number
          is_anchor?: boolean
          occurrences?: number
          playlists_count?: number
          purity_pct?: number | null
          total_genre_appearances?: number
        }
        Update: {
          artist_display?: string
          artist_norm?: string
          created_at?: string
          genre_id?: string | null
          genre_nome?: string | null
          id?: number
          is_anchor?: boolean
          occurrences?: number
          playlists_count?: number
          purity_pct?: number | null
          total_genre_appearances?: number
        }
        Relationships: []
      }
      genre_reference_playlists: {
        Row: {
          authority_score: number
          followers: number | null
          genre_id: string
          genre_name: string
          id: string
          internal_purity_pct: number
          playlist_id: string
          playlist_name: string | null
          rank_in_genre: number | null
          run_id: string
          tracks_authority_in_genre: number
          tracks_total: number
        }
        Insert: {
          authority_score?: number
          followers?: number | null
          genre_id: string
          genre_name: string
          id?: string
          internal_purity_pct?: number
          playlist_id: string
          playlist_name?: string | null
          rank_in_genre?: number | null
          run_id: string
          tracks_authority_in_genre?: number
          tracks_total?: number
        }
        Update: {
          authority_score?: number
          followers?: number | null
          genre_id?: string
          genre_name?: string
          id?: string
          internal_purity_pct?: number
          playlist_id?: string
          playlist_name?: string | null
          rank_in_genre?: number | null
          run_id?: string
          tracks_authority_in_genre?: number
          tracks_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "genre_reference_playlists_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "genre_reference_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      genre_reference_runs: {
        Row: {
          finished_at: string | null
          id: string
          notes: Json | null
          started_at: string
        }
        Insert: {
          finished_at?: string | null
          id?: string
          notes?: Json | null
          started_at?: string
        }
        Update: {
          finished_at?: string | null
          id?: string
          notes?: Json | null
          started_at?: string
        }
        Relationships: []
      }
      genre_reference_tracks: {
        Row: {
          artist_name: string
          authority_score: number
          genre_id: string
          genre_name: string
          genres_present: number
          id: string
          instances_in_genre: number
          playlists_in_genre: number
          purity_pct: number
          rank_in_genre: number | null
          run_id: string
          spotify_track_id: string | null
          total_instances_all_genres: number
          track_key: string
          track_name: string
        }
        Insert: {
          artist_name: string
          authority_score?: number
          genre_id: string
          genre_name: string
          genres_present?: number
          id?: string
          instances_in_genre?: number
          playlists_in_genre?: number
          purity_pct?: number
          rank_in_genre?: number | null
          run_id: string
          spotify_track_id?: string | null
          total_instances_all_genres?: number
          track_key: string
          track_name: string
        }
        Update: {
          artist_name?: string
          authority_score?: number
          genre_id?: string
          genre_name?: string
          genres_present?: number
          id?: string
          instances_in_genre?: number
          playlists_in_genre?: number
          purity_pct?: number
          rank_in_genre?: number | null
          run_id?: string
          spotify_track_id?: string | null
          total_instances_all_genres?: number
          track_key?: string
          track_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "genre_reference_tracks_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "genre_reference_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      genre_seo_lexicon: {
        Row: {
          first_seen: string
          genre_id: string | null
          id: string
          last_seen: string
          occurrences: number
          status: string
          strength: number
          subgenre_id: string | null
          token: string
          token_type: string
          updated_at: string
        }
        Insert: {
          first_seen?: string
          genre_id?: string | null
          id?: string
          last_seen?: string
          occurrences?: number
          status?: string
          strength?: number
          subgenre_id?: string | null
          token: string
          token_type?: string
          updated_at?: string
        }
        Update: {
          first_seen?: string
          genre_id?: string | null
          id?: string
          last_seen?: string
          occurrences?: number
          status?: string
          strength?: number
          subgenre_id?: string | null
          token?: string
          token_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "genre_seo_lexicon_subgenre_id_fkey"
            columns: ["subgenre_id"]
            isOneToOne: false
            referencedRelation: "subgenres"
            referencedColumns: ["id"]
          },
        ]
      }
      genre_trend_events: {
        Row: {
          created_at: string
          description: string | null
          event_type: string
          genre_id: string | null
          id: string
          occurred_at: string
          payload: Json | null
          severity: string | null
          subgenre_slug: string | null
          title: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          event_type: string
          genre_id?: string | null
          id?: string
          occurred_at?: string
          payload?: Json | null
          severity?: string | null
          subgenre_slug?: string | null
          title: string
        }
        Update: {
          created_at?: string
          description?: string | null
          event_type?: string
          genre_id?: string | null
          id?: string
          occurred_at?: string
          payload?: Json | null
          severity?: string | null
          subgenre_slug?: string | null
          title?: string
        }
        Relationships: []
      }
      genre_trends: {
        Row: {
          artist: string | null
          bucket: string
          evidence: Json
          genre_id: string
          id: string
          last_seen_at: string | null
          score: number
          track_id: string
          track_name: string | null
          updated_at: string
          velocity: number | null
        }
        Insert: {
          artist?: string | null
          bucket: string
          evidence?: Json
          genre_id: string
          id?: string
          last_seen_at?: string | null
          score?: number
          track_id: string
          track_name?: string | null
          updated_at?: string
          velocity?: number | null
        }
        Update: {
          artist?: string | null
          bucket?: string
          evidence?: Json
          genre_id?: string
          id?: string
          last_seen_at?: string | null
          score?: number
          track_id?: string
          track_name?: string | null
          updated_at?: string
          velocity?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "genre_trends_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "genre_trends_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres_with_health"
            referencedColumns: ["id"]
          },
        ]
      }
      genre_visual_signature: {
        Row: {
          aggressiveness_score: number | null
          calculated_at: string
          contrast_avg: number | null
          dominant_colors: Json
          genre_id: string | null
          has_face_pct: number | null
          id: string
          sample_size: number
          style_tags: Json
          subgenre_id: string
        }
        Insert: {
          aggressiveness_score?: number | null
          calculated_at?: string
          contrast_avg?: number | null
          dominant_colors?: Json
          genre_id?: string | null
          has_face_pct?: number | null
          id?: string
          sample_size?: number
          style_tags?: Json
          subgenre_id: string
        }
        Update: {
          aggressiveness_score?: number | null
          calculated_at?: string
          contrast_avg?: number | null
          dominant_colors?: Json
          genre_id?: string | null
          has_face_pct?: number | null
          id?: string
          sample_size?: number
          style_tags?: Json
          subgenre_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "genre_visual_signature_subgenre_id_fkey"
            columns: ["subgenre_id"]
            isOneToOne: true
            referencedRelation: "subgenres"
            referencedColumns: ["id"]
          },
        ]
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
      label_spreadsheet_reminders: {
        Row: {
          created_at: string
          deal_id: string
          id: string
          recipient_email: string | null
          sent_for_date: string
        }
        Insert: {
          created_at?: string
          deal_id: string
          id?: string
          recipient_email?: string | null
          sent_for_date?: string
        }
        Update: {
          created_at?: string
          deal_id?: string
          id?: string
          recipient_email?: string | null
          sent_for_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "label_spreadsheet_reminders_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "curator_deals"
            referencedColumns: ["id"]
          },
        ]
      }
      label_spreadsheet_rows: {
        Row: {
          country: string | null
          created_at: string
          deal_id: string
          id: string
          is_internal: boolean
          isrc: string | null
          matched_curator_id: string | null
          matched_playlist_id: string | null
          owner_name: string | null
          playlist_name: string
          playlist_spotify_id: string | null
          playlist_uri: string | null
          playlist_url: string | null
          position: number | null
          raw_payload: Json | null
          song_id: string | null
          streams: number
          upload_id: string
          version_name: string | null
        }
        Insert: {
          country?: string | null
          created_at?: string
          deal_id: string
          id?: string
          is_internal?: boolean
          isrc?: string | null
          matched_curator_id?: string | null
          matched_playlist_id?: string | null
          owner_name?: string | null
          playlist_name: string
          playlist_spotify_id?: string | null
          playlist_uri?: string | null
          playlist_url?: string | null
          position?: number | null
          raw_payload?: Json | null
          song_id?: string | null
          streams?: number
          upload_id: string
          version_name?: string | null
        }
        Update: {
          country?: string | null
          created_at?: string
          deal_id?: string
          id?: string
          is_internal?: boolean
          isrc?: string | null
          matched_curator_id?: string | null
          matched_playlist_id?: string | null
          owner_name?: string | null
          playlist_name?: string
          playlist_spotify_id?: string | null
          playlist_uri?: string | null
          playlist_url?: string | null
          position?: number | null
          raw_payload?: Json | null
          song_id?: string | null
          streams?: number
          upload_id?: string
          version_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "label_spreadsheet_rows_matched_curator_id_fkey"
            columns: ["matched_curator_id"]
            isOneToOne: false
            referencedRelation: "curators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "label_spreadsheet_rows_matched_curator_id_fkey"
            columns: ["matched_curator_id"]
            isOneToOne: false
            referencedRelation: "v_curator_balance"
            referencedColumns: ["curator_id"]
          },
          {
            foreignKeyName: "label_spreadsheet_rows_matched_curator_id_fkey"
            columns: ["matched_curator_id"]
            isOneToOne: false
            referencedRelation: "v_curator_finance"
            referencedColumns: ["curator_id"]
          },
          {
            foreignKeyName: "label_spreadsheet_rows_matched_playlist_id_fkey"
            columns: ["matched_playlist_id"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "label_spreadsheet_rows_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "label_spreadsheet_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      label_spreadsheet_uploads: {
        Row: {
          content_hash: string
          created_at: string
          deal_id: string
          error_message: string | null
          file_name: string | null
          file_path: string
          id: string
          is_baseline: boolean
          reference_date: string
          rows_imported: number
          song_id: string | null
          status: string
          total_streams: number
          uploaded_by: string | null
          uploaded_via: string
        }
        Insert: {
          content_hash: string
          created_at?: string
          deal_id: string
          error_message?: string | null
          file_name?: string | null
          file_path: string
          id?: string
          is_baseline?: boolean
          reference_date?: string
          rows_imported?: number
          song_id?: string | null
          status?: string
          total_streams?: number
          uploaded_by?: string | null
          uploaded_via?: string
        }
        Update: {
          content_hash?: string
          created_at?: string
          deal_id?: string
          error_message?: string | null
          file_name?: string | null
          file_path?: string
          id?: string
          is_baseline?: boolean
          reference_date?: string
          rows_imported?: number
          song_id?: string | null
          status?: string
          total_streams?: number
          uploaded_by?: string | null
          uploaded_via?: string
        }
        Relationships: [
          {
            foreignKeyName: "label_spreadsheet_uploads_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "curator_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "label_spreadsheet_uploads_song_id_fkey"
            columns: ["song_id"]
            isOneToOne: false
            referencedRelation: "curator_deal_songs"
            referencedColumns: ["id"]
          },
        ]
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
      learning_snapshots: {
        Row: {
          artists: Json
          genre_id: string | null
          id: string
          insights: Json
          keywords: Json
          min_winner_score: number | null
          snapshot_at: string
          source: string
          tracks: Json
          winners_count: number
        }
        Insert: {
          artists?: Json
          genre_id?: string | null
          id?: string
          insights?: Json
          keywords?: Json
          min_winner_score?: number | null
          snapshot_at?: string
          source?: string
          tracks?: Json
          winners_count?: number
        }
        Update: {
          artists?: Json
          genre_id?: string | null
          id?: string
          insights?: Json
          keywords?: Json
          min_winner_score?: number | null
          snapshot_at?: string
          source?: string
          tracks?: Json
          winners_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "learning_snapshots_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_snapshots_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres_with_health"
            referencedColumns: ["id"]
          },
        ]
      }
      managed_playlist_tracks: {
        Row: {
          added_at: string | null
          album_cover: string | null
          artist_name: string | null
          created_at: string
          duration_ms: number | null
          id: string
          isrc: string | null
          playlist_id: string
          position: number
          snapshot_at: string
          spotify_track_id: string
          track_name: string | null
        }
        Insert: {
          added_at?: string | null
          album_cover?: string | null
          artist_name?: string | null
          created_at?: string
          duration_ms?: number | null
          id?: string
          isrc?: string | null
          playlist_id: string
          position: number
          snapshot_at?: string
          spotify_track_id: string
          track_name?: string | null
        }
        Update: {
          added_at?: string | null
          album_cover?: string | null
          artist_name?: string | null
          created_at?: string
          duration_ms?: number | null
          id?: string
          isrc?: string | null
          playlist_id?: string
          position?: number
          snapshot_at?: string
          spotify_track_id?: string
          track_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "managed_playlist_tracks_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "managed_playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "managed_playlist_tracks_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "v_playlist_vps_assignment"
            referencedColumns: ["managed_playlist_id"]
          },
        ]
      }
      managed_playlists: {
        Row: {
          account_id: string | null
          archived_at: string | null
          archived_followers: number | null
          archived_reason: string | null
          canonical_playlist_id: string | null
          cover_url: string | null
          created_at: string
          curator_id: string | null
          curatorial_state: Database["public"]["Enums"]["curatorial_state"]
          description: string | null
          diagnose_403_streak: number
          diagnose_blocked: boolean
          diagnose_blocked_at: string | null
          diagnose_blocked_reason: string | null
          engagement_multiplier_override: number | null
          execution_mode: Database["public"]["Enums"]["playlist_execution_mode"]
          followers: number
          genre_id: string | null
          id: string
          imported_at: string
          imported_by: string | null
          last_diagnosis_at: string | null
          last_maintenance_at: string | null
          last_maintenance_intensity:
            | Database["public"]["Enums"]["curatorial_action_type"]
            | null
          last_metrics_at: string | null
          last_onboarding_check_at: string | null
          lifecycle_phase: string
          lifecycle_phase_updated_at: string | null
          lifecycle_stage: string
          locked_at: string | null
          locked_by: string | null
          max_change_pct: number
          metadata: Json
          name: string
          onboarding_checklist: Json
          onboarding_completed_at: string | null
          onboarding_ready_streak: number
          operational_status: string | null
          owner_spotify_user_id: string | null
          reactivation_eligible_at: string | null
          recommended_change_count: number | null
          spotify_playlist_id: string
          spotify_url: string
          suggested_at: string | null
          suggested_genre_id: string | null
          suggestion_confidence: number | null
          suggestion_reason: string | null
          tracks_count: number
          tracks_hash: string | null
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          archived_at?: string | null
          archived_followers?: number | null
          archived_reason?: string | null
          canonical_playlist_id?: string | null
          cover_url?: string | null
          created_at?: string
          curator_id?: string | null
          curatorial_state?: Database["public"]["Enums"]["curatorial_state"]
          description?: string | null
          diagnose_403_streak?: number
          diagnose_blocked?: boolean
          diagnose_blocked_at?: string | null
          diagnose_blocked_reason?: string | null
          engagement_multiplier_override?: number | null
          execution_mode?: Database["public"]["Enums"]["playlist_execution_mode"]
          followers?: number
          genre_id?: string | null
          id?: string
          imported_at?: string
          imported_by?: string | null
          last_diagnosis_at?: string | null
          last_maintenance_at?: string | null
          last_maintenance_intensity?:
            | Database["public"]["Enums"]["curatorial_action_type"]
            | null
          last_metrics_at?: string | null
          last_onboarding_check_at?: string | null
          lifecycle_phase?: string
          lifecycle_phase_updated_at?: string | null
          lifecycle_stage?: string
          locked_at?: string | null
          locked_by?: string | null
          max_change_pct?: number
          metadata?: Json
          name: string
          onboarding_checklist?: Json
          onboarding_completed_at?: string | null
          onboarding_ready_streak?: number
          operational_status?: string | null
          owner_spotify_user_id?: string | null
          reactivation_eligible_at?: string | null
          recommended_change_count?: number | null
          spotify_playlist_id: string
          spotify_url: string
          suggested_at?: string | null
          suggested_genre_id?: string | null
          suggestion_confidence?: number | null
          suggestion_reason?: string | null
          tracks_count?: number
          tracks_hash?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          archived_at?: string | null
          archived_followers?: number | null
          archived_reason?: string | null
          canonical_playlist_id?: string | null
          cover_url?: string | null
          created_at?: string
          curator_id?: string | null
          curatorial_state?: Database["public"]["Enums"]["curatorial_state"]
          description?: string | null
          diagnose_403_streak?: number
          diagnose_blocked?: boolean
          diagnose_blocked_at?: string | null
          diagnose_blocked_reason?: string | null
          engagement_multiplier_override?: number | null
          execution_mode?: Database["public"]["Enums"]["playlist_execution_mode"]
          followers?: number
          genre_id?: string | null
          id?: string
          imported_at?: string
          imported_by?: string | null
          last_diagnosis_at?: string | null
          last_maintenance_at?: string | null
          last_maintenance_intensity?:
            | Database["public"]["Enums"]["curatorial_action_type"]
            | null
          last_metrics_at?: string | null
          last_onboarding_check_at?: string | null
          lifecycle_phase?: string
          lifecycle_phase_updated_at?: string | null
          lifecycle_stage?: string
          locked_at?: string | null
          locked_by?: string | null
          max_change_pct?: number
          metadata?: Json
          name?: string
          onboarding_checklist?: Json
          onboarding_completed_at?: string | null
          onboarding_ready_streak?: number
          operational_status?: string | null
          owner_spotify_user_id?: string | null
          reactivation_eligible_at?: string | null
          recommended_change_count?: number | null
          spotify_playlist_id?: string
          spotify_url?: string
          suggested_at?: string | null
          suggested_genre_id?: string | null
          suggestion_confidence?: number | null
          suggestion_reason?: string | null
          tracks_count?: number
          tracks_hash?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "managed_playlists_canonical_playlist_id_fkey"
            columns: ["canonical_playlist_id"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "managed_playlists_curator_id_fkey"
            columns: ["curator_id"]
            isOneToOne: false
            referencedRelation: "curators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "managed_playlists_curator_id_fkey"
            columns: ["curator_id"]
            isOneToOne: false
            referencedRelation: "v_curator_balance"
            referencedColumns: ["curator_id"]
          },
          {
            foreignKeyName: "managed_playlists_curator_id_fkey"
            columns: ["curator_id"]
            isOneToOne: false
            referencedRelation: "v_curator_finance"
            referencedColumns: ["curator_id"]
          },
          {
            foreignKeyName: "managed_playlists_suggested_genre_id_fkey"
            columns: ["suggested_genre_id"]
            isOneToOne: false
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "managed_playlists_suggested_genre_id_fkey"
            columns: ["suggested_genre_id"]
            isOneToOne: false
            referencedRelation: "genres_with_health"
            referencedColumns: ["id"]
          },
        ]
      }
      manual_distribution_queue: {
        Row: {
          campaign_id: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          executed_position: number | null
          id: string
          job_id: string | null
          job_type: string | null
          motivo: string
          observacao: string | null
          planned_position: number | null
          playlist_id: string | null
          playlist_name: string | null
          position: number | null
          spotify_playlist_id: string | null
          spotify_track_id: string | null
          status: string
          track_id: string | null
        }
        Insert: {
          campaign_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          executed_position?: number | null
          id?: string
          job_id?: string | null
          job_type?: string | null
          motivo: string
          observacao?: string | null
          planned_position?: number | null
          playlist_id?: string | null
          playlist_name?: string | null
          position?: number | null
          spotify_playlist_id?: string | null
          spotify_track_id?: string | null
          status?: string
          track_id?: string | null
        }
        Update: {
          campaign_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          executed_position?: number | null
          id?: string
          job_id?: string | null
          job_type?: string | null
          motivo?: string
          observacao?: string | null
          planned_position?: number | null
          playlist_id?: string | null
          playlist_name?: string | null
          position?: number | null
          spotify_playlist_id?: string | null
          spotify_track_id?: string | null
          status?: string
          track_id?: string | null
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
          user_id: string | null
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
          user_id?: string | null
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
          user_id?: string | null
        }
        Relationships: []
      }
      organic_plays_snapshots: {
        Row: {
          captured_at: string
          correlation_id: string | null
          created_at: string
          deal_id: string
          id: string
          kind: Database["public"]["Enums"]["organic_play_kind"]
          playlist_name: string | null
          plays_24h: number | null
          plays_28d: number | null
          plays_7d: number | null
          song_id: string | null
          source: string | null
          spotify_playlist_id: string | null
          spotify_track_id: string | null
        }
        Insert: {
          captured_at?: string
          correlation_id?: string | null
          created_at?: string
          deal_id: string
          id?: string
          kind?: Database["public"]["Enums"]["organic_play_kind"]
          playlist_name?: string | null
          plays_24h?: number | null
          plays_28d?: number | null
          plays_7d?: number | null
          song_id?: string | null
          source?: string | null
          spotify_playlist_id?: string | null
          spotify_track_id?: string | null
        }
        Update: {
          captured_at?: string
          correlation_id?: string | null
          created_at?: string
          deal_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["organic_play_kind"]
          playlist_name?: string | null
          plays_24h?: number | null
          plays_28d?: number | null
          plays_7d?: number | null
          song_id?: string | null
          source?: string | null
          spotify_playlist_id?: string | null
          spotify_track_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organic_plays_snapshots_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "curator_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organic_plays_snapshots_song_id_fkey"
            columns: ["song_id"]
            isOneToOne: false
            referencedRelation: "curator_deal_songs"
            referencedColumns: ["id"]
          },
        ]
      }
      patch_b_v2_backup_curator_playlists: {
        Row: {
          attribution_method: string | null
          attribution_reason: string | null
          backed_up_at: string
          deal_id: string | null
          id: string
          image_url: string | null
          playlist_name: string | null
          spotify_owner_id: string | null
          spotify_owner_name: string | null
          spotify_playlist_id: string | null
          spotify_url: string | null
          streams_28d: number | null
          streams_7d: number | null
          streams_total: number | null
          twin_pid_applied: string | null
        }
        Insert: {
          attribution_method?: string | null
          attribution_reason?: string | null
          backed_up_at?: string
          deal_id?: string | null
          id: string
          image_url?: string | null
          playlist_name?: string | null
          spotify_owner_id?: string | null
          spotify_owner_name?: string | null
          spotify_playlist_id?: string | null
          spotify_url?: string | null
          streams_28d?: number | null
          streams_7d?: number | null
          streams_total?: number | null
          twin_pid_applied?: string | null
        }
        Update: {
          attribution_method?: string | null
          attribution_reason?: string | null
          backed_up_at?: string
          deal_id?: string | null
          id?: string
          image_url?: string | null
          playlist_name?: string | null
          spotify_owner_id?: string | null
          spotify_owner_name?: string | null
          spotify_playlist_id?: string | null
          spotify_url?: string | null
          streams_28d?: number | null
          streams_7d?: number | null
          streams_total?: number | null
          twin_pid_applied?: string | null
        }
        Relationships: []
      }
      patch_b_v2_green_cohort: {
        Row: {
          ghost_id: string
          twin_pid: string
        }
        Insert: {
          ghost_id: string
          twin_pid: string
        }
        Update: {
          ghost_id?: string
          twin_pid?: string
        }
        Relationships: []
      }
      patch_b_v2_promoted_backup: {
        Row: {
          attribution_method: string | null
          attribution_reason: string | null
          backed_up_at: string
          deal_id: string | null
          id: string
          image_url: string | null
          match_status: string | null
          playlist_name: string | null
          song_id: string | null
          spotify_owner_id: string | null
          spotify_owner_name: string | null
          spotify_playlist_id: string | null
          spotify_url: string | null
          streams_total: number | null
        }
        Insert: {
          attribution_method?: string | null
          attribution_reason?: string | null
          backed_up_at?: string
          deal_id?: string | null
          id: string
          image_url?: string | null
          match_status?: string | null
          playlist_name?: string | null
          song_id?: string | null
          spotify_owner_id?: string | null
          spotify_owner_name?: string | null
          spotify_playlist_id?: string | null
          spotify_url?: string | null
          streams_total?: number | null
        }
        Update: {
          attribution_method?: string | null
          attribution_reason?: string | null
          backed_up_at?: string
          deal_id?: string | null
          id?: string
          image_url?: string | null
          match_status?: string | null
          playlist_name?: string | null
          song_id?: string | null
          spotify_owner_id?: string | null
          spotify_owner_name?: string | null
          spotify_playlist_id?: string | null
          spotify_url?: string | null
          streams_total?: number | null
        }
        Relationships: []
      }
      patch_b_v2_promoted_cohort: {
        Row: {
          ghost_id: string
          twin_pid: string
        }
        Insert: {
          ghost_id: string
          twin_pid: string
        }
        Update: {
          ghost_id?: string
          twin_pid?: string
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
      plan_execution_snapshots: {
        Row: {
          accuracy_by_metric: Json | null
          accuracy_grade: string | null
          accuracy_overall: number | null
          baseline_benchmark_tracks: number | null
          baseline_dominant_artists: number | null
          baseline_headroom_pct: number | null
          baseline_ratio_to_benchmark: number | null
          baseline_saturation_avg: number | null
          baseline_size: number | null
          created_at: string
          diagnosis_id: string | null
          evaluated_at: string | null
          evaluation_notes: string | null
          executed_at: string
          executed_by: string | null
          id: string
          measured_artist_delta: number | null
          measured_benchmark_delta: number | null
          measured_concentration_delta_pp: number | null
          measured_coverage_delta_pp: number | null
          measured_headroom_delta_pp: number | null
          measured_saturation_delta_pp: number | null
          measured_size_delta: number | null
          ops_add: number
          ops_demote: number
          ops_promote: number
          ops_remove: number
          playlist_id: string
          projected_artist_delta: number | null
          projected_benchmark_delta: number | null
          projected_concentration_delta_pp: number | null
          projected_confidence: string | null
          projected_coverage_delta_pp: number | null
          projected_headroom_delta_pp: number | null
          projected_saturation_delta_pp: number | null
          projected_size_delta: number | null
          status: string
          updated_at: string
        }
        Insert: {
          accuracy_by_metric?: Json | null
          accuracy_grade?: string | null
          accuracy_overall?: number | null
          baseline_benchmark_tracks?: number | null
          baseline_dominant_artists?: number | null
          baseline_headroom_pct?: number | null
          baseline_ratio_to_benchmark?: number | null
          baseline_saturation_avg?: number | null
          baseline_size?: number | null
          created_at?: string
          diagnosis_id?: string | null
          evaluated_at?: string | null
          evaluation_notes?: string | null
          executed_at?: string
          executed_by?: string | null
          id?: string
          measured_artist_delta?: number | null
          measured_benchmark_delta?: number | null
          measured_concentration_delta_pp?: number | null
          measured_coverage_delta_pp?: number | null
          measured_headroom_delta_pp?: number | null
          measured_saturation_delta_pp?: number | null
          measured_size_delta?: number | null
          ops_add?: number
          ops_demote?: number
          ops_promote?: number
          ops_remove?: number
          playlist_id: string
          projected_artist_delta?: number | null
          projected_benchmark_delta?: number | null
          projected_concentration_delta_pp?: number | null
          projected_confidence?: string | null
          projected_coverage_delta_pp?: number | null
          projected_headroom_delta_pp?: number | null
          projected_saturation_delta_pp?: number | null
          projected_size_delta?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          accuracy_by_metric?: Json | null
          accuracy_grade?: string | null
          accuracy_overall?: number | null
          baseline_benchmark_tracks?: number | null
          baseline_dominant_artists?: number | null
          baseline_headroom_pct?: number | null
          baseline_ratio_to_benchmark?: number | null
          baseline_saturation_avg?: number | null
          baseline_size?: number | null
          created_at?: string
          diagnosis_id?: string | null
          evaluated_at?: string | null
          evaluation_notes?: string | null
          executed_at?: string
          executed_by?: string | null
          id?: string
          measured_artist_delta?: number | null
          measured_benchmark_delta?: number | null
          measured_concentration_delta_pp?: number | null
          measured_coverage_delta_pp?: number | null
          measured_headroom_delta_pp?: number | null
          measured_saturation_delta_pp?: number | null
          measured_size_delta?: number | null
          ops_add?: number
          ops_demote?: number
          ops_promote?: number
          ops_remove?: number
          playlist_id?: string
          projected_artist_delta?: number | null
          projected_benchmark_delta?: number | null
          projected_concentration_delta_pp?: number | null
          projected_confidence?: string | null
          projected_coverage_delta_pp?: number | null
          projected_headroom_delta_pp?: number | null
          projected_saturation_delta_pp?: number | null
          projected_size_delta?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_execution_snapshots_diagnosis_id_fkey"
            columns: ["diagnosis_id"]
            isOneToOne: false
            referencedRelation: "playlist_diagnoses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_execution_snapshots_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "managed_playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_execution_snapshots_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "v_playlist_vps_assignment"
            referencedColumns: ["managed_playlist_id"]
          },
        ]
      }
      playlist_adjustment_impacts: {
        Row: {
          action_type: string
          adjustment_id: string
          created_at: string
          delta: Json | null
          editorial_note: string | null
          evaluated_at: string | null
          id: string
          observation_ends_at: string
          observation_window_days: number
          playlist_id: string | null
          snapshot_after: Json | null
          snapshot_before: Json
          spotify_playlist_id: string
          updated_at: string
          verdict: Database["public"]["Enums"]["impact_verdict"]
        }
        Insert: {
          action_type: string
          adjustment_id: string
          created_at?: string
          delta?: Json | null
          editorial_note?: string | null
          evaluated_at?: string | null
          id?: string
          observation_ends_at: string
          observation_window_days?: number
          playlist_id?: string | null
          snapshot_after?: Json | null
          snapshot_before?: Json
          spotify_playlist_id: string
          updated_at?: string
          verdict?: Database["public"]["Enums"]["impact_verdict"]
        }
        Update: {
          action_type?: string
          adjustment_id?: string
          created_at?: string
          delta?: Json | null
          editorial_note?: string | null
          evaluated_at?: string | null
          id?: string
          observation_ends_at?: string
          observation_window_days?: number
          playlist_id?: string | null
          snapshot_after?: Json | null
          snapshot_before?: Json
          spotify_playlist_id?: string
          updated_at?: string
          verdict?: Database["public"]["Enums"]["impact_verdict"]
        }
        Relationships: [
          {
            foreignKeyName: "playlist_adjustment_impacts_adjustment_id_fkey"
            columns: ["adjustment_id"]
            isOneToOne: false
            referencedRelation: "playlist_adjustments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playlist_adjustment_impacts_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "managed_playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playlist_adjustment_impacts_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "v_playlist_vps_assignment"
            referencedColumns: ["managed_playlist_id"]
          },
        ]
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
      playlist_brain: {
        Row: {
          benchmark_tracks: number | null
          calculation_version: number
          capacity_ceiling: number | null
          capacity_per_slot: number | null
          capacity_total: number | null
          confidence_score: number
          created_at: string
          growth_roadmap: Json
          headroom_pct: number | null
          health_trend: string
          id: string
          identity: Json
          last_calculated_at: string
          lifecycle_phase: string | null
          metadata: Json
          personality: Json
          playlist_id: string
          ratio_to_benchmark: number | null
          recommendations: Json
          signals: Json
          updated_at: string
        }
        Insert: {
          benchmark_tracks?: number | null
          calculation_version?: number
          capacity_ceiling?: number | null
          capacity_per_slot?: number | null
          capacity_total?: number | null
          confidence_score?: number
          created_at?: string
          growth_roadmap?: Json
          headroom_pct?: number | null
          health_trend?: string
          id?: string
          identity?: Json
          last_calculated_at?: string
          lifecycle_phase?: string | null
          metadata?: Json
          personality?: Json
          playlist_id: string
          ratio_to_benchmark?: number | null
          recommendations?: Json
          signals?: Json
          updated_at?: string
        }
        Update: {
          benchmark_tracks?: number | null
          calculation_version?: number
          capacity_ceiling?: number | null
          capacity_per_slot?: number | null
          capacity_total?: number | null
          confidence_score?: number
          created_at?: string
          growth_roadmap?: Json
          headroom_pct?: number | null
          health_trend?: string
          id?: string
          identity?: Json
          last_calculated_at?: string
          lifecycle_phase?: string | null
          metadata?: Json
          personality?: Json
          playlist_id?: string
          ratio_to_benchmark?: number | null
          recommendations?: Json
          signals?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "playlist_brain_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: true
            referencedRelation: "playlists"
            referencedColumns: ["id"]
          },
        ]
      }
      playlist_brain_history: {
        Row: {
          calculated_at: string
          capacity_per_slot: number | null
          capacity_total: number | null
          confidence_score: number
          health_score: number | null
          id: string
          playlist_id: string
          signals_count: number
        }
        Insert: {
          calculated_at?: string
          capacity_per_slot?: number | null
          capacity_total?: number | null
          confidence_score?: number
          health_score?: number | null
          id?: string
          playlist_id: string
          signals_count?: number
        }
        Update: {
          calculated_at?: string
          capacity_per_slot?: number | null
          capacity_total?: number | null
          confidence_score?: number
          health_score?: number | null
          id?: string
          playlist_id?: string
          signals_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "playlist_brain_history_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["id"]
          },
        ]
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
      playlist_cluster_members: {
        Row: {
          cluster_id: string
          id: string
          joined_at: string
          playlist_id: string
          similarity: number
        }
        Insert: {
          cluster_id: string
          id?: string
          joined_at?: string
          playlist_id: string
          similarity?: number
        }
        Update: {
          cluster_id?: string
          id?: string
          joined_at?: string
          playlist_id?: string
          similarity?: number
        }
        Relationships: [
          {
            foreignKeyName: "playlist_cluster_members_cluster_id_fkey"
            columns: ["cluster_id"]
            isOneToOne: false
            referencedRelation: "playlist_clusters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playlist_cluster_members_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["id"]
          },
        ]
      }
      playlist_clusters: {
        Row: {
          centroid: Json
          created_at: string
          genre_id: string | null
          id: string
          label: string | null
          sample_size: number
          strength: number
          subgenre_id: string | null
          updated_at: string
        }
        Insert: {
          centroid?: Json
          created_at?: string
          genre_id?: string | null
          id?: string
          label?: string | null
          sample_size?: number
          strength?: number
          subgenre_id?: string | null
          updated_at?: string
        }
        Update: {
          centroid?: Json
          created_at?: string
          genre_id?: string | null
          id?: string
          label?: string | null
          sample_size?: number
          strength?: number
          subgenre_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "playlist_clusters_subgenre_id_fkey"
            columns: ["subgenre_id"]
            isOneToOne: false
            referencedRelation: "subgenres"
            referencedColumns: ["id"]
          },
        ]
      }
      playlist_cooldowns: {
        Row: {
          action_type: Database["public"]["Enums"]["curatorial_action_type"]
          cooldown_until: string
          created_at: string
          id: string
          playlist_id: string
          reason: string | null
          started_at: string
          triggered_by: string | null
        }
        Insert: {
          action_type: Database["public"]["Enums"]["curatorial_action_type"]
          cooldown_until: string
          created_at?: string
          id?: string
          playlist_id: string
          reason?: string | null
          started_at?: string
          triggered_by?: string | null
        }
        Update: {
          action_type?: Database["public"]["Enums"]["curatorial_action_type"]
          cooldown_until?: string
          created_at?: string
          id?: string
          playlist_id?: string
          reason?: string | null
          started_at?: string
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "playlist_cooldowns_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "managed_playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playlist_cooldowns_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "v_playlist_vps_assignment"
            referencedColumns: ["managed_playlist_id"]
          },
        ]
      }
      playlist_delivery_validations: {
        Row: {
          actual_position: number | null
          campaign_id: string | null
          checked_at: string
          error: string | null
          expected_position: number | null
          id: string
          job_id: string | null
          occurrences: number
          spotify_playlist_id: string
          spotify_track_id: string
          status: string
        }
        Insert: {
          actual_position?: number | null
          campaign_id?: string | null
          checked_at?: string
          error?: string | null
          expected_position?: number | null
          id?: string
          job_id?: string | null
          occurrences?: number
          spotify_playlist_id: string
          spotify_track_id: string
          status: string
        }
        Update: {
          actual_position?: number | null
          campaign_id?: string | null
          checked_at?: string
          error?: string | null
          expected_position?: number | null
          id?: string
          job_id?: string | null
          occurrences?: number
          spotify_playlist_id?: string
          spotify_track_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "playlist_delivery_validations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "playlist_execution_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      playlist_diagnoses: {
        Row: {
          applied_at: string | null
          applied_by: string | null
          applied_changes: Json
          competitors: Json
          cover_suggestion: Json
          created_at: string
          created_by: string | null
          id: string
          name_current: string | null
          name_reasons: Json
          name_score: number | null
          name_suggestion: string | null
          playlist_id: string
          raw: Json
          tracks_analysis: Json
          tracks_suggestions: Json
          tracks_summary: Json
        }
        Insert: {
          applied_at?: string | null
          applied_by?: string | null
          applied_changes?: Json
          competitors?: Json
          cover_suggestion?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          name_current?: string | null
          name_reasons?: Json
          name_score?: number | null
          name_suggestion?: string | null
          playlist_id: string
          raw?: Json
          tracks_analysis?: Json
          tracks_suggestions?: Json
          tracks_summary?: Json
        }
        Update: {
          applied_at?: string | null
          applied_by?: string | null
          applied_changes?: Json
          competitors?: Json
          cover_suggestion?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          name_current?: string | null
          name_reasons?: Json
          name_score?: number | null
          name_suggestion?: string | null
          playlist_id?: string
          raw?: Json
          tracks_analysis?: Json
          tracks_suggestions?: Json
          tracks_summary?: Json
        }
        Relationships: [
          {
            foreignKeyName: "playlist_diagnoses_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "managed_playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playlist_diagnoses_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "v_playlist_vps_assignment"
            referencedColumns: ["managed_playlist_id"]
          },
        ]
      }
      playlist_dna: {
        Row: {
          avg_track_age_days: number | null
          classification: string | null
          classification_confidence: number | null
          classification_reasons: Json
          computed_at: string
          confidence_bucket: string | null
          created_at: string
          dominant_genre_id: string | null
          dominant_genre_name: string | null
          dominant_genre_pct: number | null
          dominant_subgenre_id: string | null
          dominant_subgenre_name: string | null
          dominant_subgenre_pct: number | null
          enriched_at: string | null
          genre_distribution: Json
          id: string
          internal_concentration_score: number | null
          median_track_age_days: number | null
          name_conflict: Json | null
          niche_adherence_score: number | null
          niche_top_artists: Json
          niche_top_subgenres: Json
          niche_top_tracks: Json
          playlist_id: string
          purity_score: number | null
          subgenre_distribution: Json
          top_artists: Json
          tracks_analyzed: number
          tracks_matched: number
          unique_artists_count: number
          updated_at: string
        }
        Insert: {
          avg_track_age_days?: number | null
          classification?: string | null
          classification_confidence?: number | null
          classification_reasons?: Json
          computed_at?: string
          confidence_bucket?: string | null
          created_at?: string
          dominant_genre_id?: string | null
          dominant_genre_name?: string | null
          dominant_genre_pct?: number | null
          dominant_subgenre_id?: string | null
          dominant_subgenre_name?: string | null
          dominant_subgenre_pct?: number | null
          enriched_at?: string | null
          genre_distribution?: Json
          id?: string
          internal_concentration_score?: number | null
          median_track_age_days?: number | null
          name_conflict?: Json | null
          niche_adherence_score?: number | null
          niche_top_artists?: Json
          niche_top_subgenres?: Json
          niche_top_tracks?: Json
          playlist_id: string
          purity_score?: number | null
          subgenre_distribution?: Json
          top_artists?: Json
          tracks_analyzed?: number
          tracks_matched?: number
          unique_artists_count?: number
          updated_at?: string
        }
        Update: {
          avg_track_age_days?: number | null
          classification?: string | null
          classification_confidence?: number | null
          classification_reasons?: Json
          computed_at?: string
          confidence_bucket?: string | null
          created_at?: string
          dominant_genre_id?: string | null
          dominant_genre_name?: string | null
          dominant_genre_pct?: number | null
          dominant_subgenre_id?: string | null
          dominant_subgenre_name?: string | null
          dominant_subgenre_pct?: number | null
          enriched_at?: string | null
          genre_distribution?: Json
          id?: string
          internal_concentration_score?: number | null
          median_track_age_days?: number | null
          name_conflict?: Json | null
          niche_adherence_score?: number | null
          niche_top_artists?: Json
          niche_top_subgenres?: Json
          niche_top_tracks?: Json
          playlist_id?: string
          purity_score?: number | null
          subgenre_distribution?: Json
          top_artists?: Json
          tracks_analyzed?: number
          tracks_matched?: number
          unique_artists_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "playlist_dna_dominant_genre_id_fkey"
            columns: ["dominant_genre_id"]
            isOneToOne: false
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playlist_dna_dominant_genre_id_fkey"
            columns: ["dominant_genre_id"]
            isOneToOne: false
            referencedRelation: "genres_with_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playlist_dna_dominant_subgenre_id_fkey"
            columns: ["dominant_subgenre_id"]
            isOneToOne: false
            referencedRelation: "subgenres"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playlist_dna_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: true
            referencedRelation: "managed_playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playlist_dna_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: true
            referencedRelation: "v_playlist_vps_assignment"
            referencedColumns: ["managed_playlist_id"]
          },
        ]
      }
      playlist_dna_lexicon_proposals: {
        Row: {
          already_existing: boolean
          created_at: string
          distinct_playlists: number
          frequency: number
          id: string
          parent_genre_id: string | null
          parent_genre_name: string | null
          proposed_keyword: string
          run_id: string | null
          subgenre_id: string | null
          subgenre_name: string | null
        }
        Insert: {
          already_existing?: boolean
          created_at?: string
          distinct_playlists?: number
          frequency?: number
          id?: string
          parent_genre_id?: string | null
          parent_genre_name?: string | null
          proposed_keyword: string
          run_id?: string | null
          subgenre_id?: string | null
          subgenre_name?: string | null
        }
        Update: {
          already_existing?: boolean
          created_at?: string
          distinct_playlists?: number
          frequency?: number
          id?: string
          parent_genre_id?: string | null
          parent_genre_name?: string | null
          proposed_keyword?: string
          run_id?: string | null
          subgenre_id?: string | null
          subgenre_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "playlist_dna_lexicon_proposals_parent_genre_id_fkey"
            columns: ["parent_genre_id"]
            isOneToOne: false
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playlist_dna_lexicon_proposals_parent_genre_id_fkey"
            columns: ["parent_genre_id"]
            isOneToOne: false
            referencedRelation: "genres_with_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playlist_dna_lexicon_proposals_subgenre_id_fkey"
            columns: ["subgenre_id"]
            isOneToOne: false
            referencedRelation: "subgenres"
            referencedColumns: ["id"]
          },
        ]
      }
      playlist_dna_quality_runs: {
        Row: {
          bucket_high: number
          bucket_low: number
          bucket_mid: number
          confiavel: number
          conflitos: number
          coverage_by_genre: Json
          created_at: string
          finished_at: string | null
          fraco: number
          id: string
          insufficient_no_tracks: number
          lexicon_keywords_current: number
          lexicon_keywords_proposed: number
          notes: Json
          started_at: string
          top_confused: Json
          top_hybrid: Json
          top_pure: Json
          total_classified: number
          total_playlists: number
        }
        Insert: {
          bucket_high?: number
          bucket_low?: number
          bucket_mid?: number
          confiavel?: number
          conflitos?: number
          coverage_by_genre?: Json
          created_at?: string
          finished_at?: string | null
          fraco?: number
          id?: string
          insufficient_no_tracks?: number
          lexicon_keywords_current?: number
          lexicon_keywords_proposed?: number
          notes?: Json
          started_at?: string
          top_confused?: Json
          top_hybrid?: Json
          top_pure?: Json
          total_classified?: number
          total_playlists?: number
        }
        Update: {
          bucket_high?: number
          bucket_low?: number
          bucket_mid?: number
          confiavel?: number
          conflitos?: number
          coverage_by_genre?: Json
          created_at?: string
          finished_at?: string | null
          fraco?: number
          id?: string
          insufficient_no_tracks?: number
          lexicon_keywords_current?: number
          lexicon_keywords_proposed?: number
          notes?: Json
          started_at?: string
          top_confused?: Json
          top_hybrid?: Json
          top_pure?: Json
          total_classified?: number
          total_playlists?: number
        }
        Relationships: []
      }
      playlist_dna_runs: {
        Row: {
          created_at: string
          failed: number
          finished_at: string | null
          hibrida: number
          id: string
          insufficient: number
          nicho: number
          notes: Json
          processed: number
          scope: string
          started_at: string
          tematica: number
          tendencia: number
          total_candidates: number
        }
        Insert: {
          created_at?: string
          failed?: number
          finished_at?: string | null
          hibrida?: number
          id?: string
          insufficient?: number
          nicho?: number
          notes?: Json
          processed?: number
          scope?: string
          started_at?: string
          tematica?: number
          tendencia?: number
          total_candidates?: number
        }
        Update: {
          created_at?: string
          failed?: number
          finished_at?: string | null
          hibrida?: number
          id?: string
          insufficient?: number
          nicho?: number
          notes?: Json
          processed?: number
          scope?: string
          started_at?: string
          tematica?: number
          tendencia?: number
          total_candidates?: number
        }
        Relationships: []
      }
      playlist_dna_shadow: {
        Row: {
          avg_track_age_days: number | null
          classification: string | null
          classification_confidence: number | null
          classification_reasons: Json | null
          computed_at: string
          confidence_bucket: string | null
          dominant_genre_id: string | null
          dominant_genre_name: string | null
          dominant_genre_pct: number | null
          dominant_subgenre_id: string | null
          dominant_subgenre_name: string | null
          dominant_subgenre_pct: number | null
          genre_distribution: Json | null
          id: string
          median_track_age_days: number | null
          playlist_id: string
          purity_score: number | null
          run_id: string
          subgenre_distribution: Json | null
          top_artists: Json | null
          tracks_analyzed: number | null
          tracks_matched: number | null
          unique_artists_count: number | null
        }
        Insert: {
          avg_track_age_days?: number | null
          classification?: string | null
          classification_confidence?: number | null
          classification_reasons?: Json | null
          computed_at?: string
          confidence_bucket?: string | null
          dominant_genre_id?: string | null
          dominant_genre_name?: string | null
          dominant_genre_pct?: number | null
          dominant_subgenre_id?: string | null
          dominant_subgenre_name?: string | null
          dominant_subgenre_pct?: number | null
          genre_distribution?: Json | null
          id?: string
          median_track_age_days?: number | null
          playlist_id: string
          purity_score?: number | null
          run_id: string
          subgenre_distribution?: Json | null
          top_artists?: Json | null
          tracks_analyzed?: number | null
          tracks_matched?: number | null
          unique_artists_count?: number | null
        }
        Update: {
          avg_track_age_days?: number | null
          classification?: string | null
          classification_confidence?: number | null
          classification_reasons?: Json | null
          computed_at?: string
          confidence_bucket?: string | null
          dominant_genre_id?: string | null
          dominant_genre_name?: string | null
          dominant_genre_pct?: number | null
          dominant_subgenre_id?: string | null
          dominant_subgenre_name?: string | null
          dominant_subgenre_pct?: number | null
          genre_distribution?: Json | null
          id?: string
          median_track_age_days?: number | null
          playlist_id?: string
          purity_score?: number | null
          run_id?: string
          subgenre_distribution?: Json | null
          top_artists?: Json | null
          tracks_analyzed?: number | null
          tracks_matched?: number | null
          unique_artists_count?: number | null
        }
        Relationships: []
      }
      playlist_dna_shadow_runs: {
        Row: {
          failed: number | null
          finished_at: string | null
          hibrida: number | null
          id: string
          insufficient: number | null
          lexicon_source: string | null
          nicho: number | null
          notes: Json | null
          processed: number | null
          proposals_applied: number | null
          scope: string | null
          started_at: string
          tematica: number | null
          tendencia: number | null
          total_candidates: number | null
        }
        Insert: {
          failed?: number | null
          finished_at?: string | null
          hibrida?: number | null
          id?: string
          insufficient?: number | null
          lexicon_source?: string | null
          nicho?: number | null
          notes?: Json | null
          processed?: number | null
          proposals_applied?: number | null
          scope?: string | null
          started_at?: string
          tematica?: number | null
          tendencia?: number | null
          total_candidates?: number | null
        }
        Update: {
          failed?: number | null
          finished_at?: string | null
          hibrida?: number | null
          id?: string
          insufficient?: number | null
          lexicon_source?: string | null
          nicho?: number | null
          notes?: Json | null
          processed?: number | null
          proposals_applied?: number | null
          scope?: string | null
          started_at?: string
          tematica?: number | null
          tendencia?: number | null
          total_candidates?: number | null
        }
        Relationships: []
      }
      playlist_drift_snapshots: {
        Row: {
          captured_at: string
          dominant_genre: string | null
          genre_mix: Json
          id: string
          playlist_id: string
          playlist_spotify_id: string | null
          track_sample_size: number | null
        }
        Insert: {
          captured_at?: string
          dominant_genre?: string | null
          genre_mix?: Json
          id?: string
          playlist_id: string
          playlist_spotify_id?: string | null
          track_sample_size?: number | null
        }
        Update: {
          captured_at?: string
          dominant_genre?: string | null
          genre_mix?: Json
          id?: string
          playlist_id?: string
          playlist_spotify_id?: string | null
          track_sample_size?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_pds_playlist"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "managed_playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_pds_playlist"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "v_playlist_vps_assignment"
            referencedColumns: ["managed_playlist_id"]
          },
        ]
      }
      playlist_ecosystem_score: {
        Row: {
          avg_track_momentum: number | null
          calculated_at: string
          confidence: number
          created_at: string
          curator_name: string | null
          efficiency_score: number
          followers: number
          growth_28d_pct: number | null
          health_class: string
          id: string
          image_url: string | null
          last_snapshot_at: string | null
          pct_caindo: number
          pct_estavel: number
          pct_saturada: number
          pct_subindo: number
          playlist_kind: string
          playlist_name: string | null
          snapshots_used: number
          spotify_playlist_id: string
          streams_28d: number
          streams_7d: number
          total_streams: number
          track_count: number
          updated_at: string
        }
        Insert: {
          avg_track_momentum?: number | null
          calculated_at?: string
          confidence?: number
          created_at?: string
          curator_name?: string | null
          efficiency_score?: number
          followers?: number
          growth_28d_pct?: number | null
          health_class?: string
          id?: string
          image_url?: string | null
          last_snapshot_at?: string | null
          pct_caindo?: number
          pct_estavel?: number
          pct_saturada?: number
          pct_subindo?: number
          playlist_kind: string
          playlist_name?: string | null
          snapshots_used?: number
          spotify_playlist_id: string
          streams_28d?: number
          streams_7d?: number
          total_streams?: number
          track_count?: number
          updated_at?: string
        }
        Update: {
          avg_track_momentum?: number | null
          calculated_at?: string
          confidence?: number
          created_at?: string
          curator_name?: string | null
          efficiency_score?: number
          followers?: number
          growth_28d_pct?: number | null
          health_class?: string
          id?: string
          image_url?: string | null
          last_snapshot_at?: string | null
          pct_caindo?: number
          pct_estavel?: number
          pct_saturada?: number
          pct_subindo?: number
          playlist_kind?: string
          playlist_name?: string | null
          snapshots_used?: number
          spotify_playlist_id?: string
          streams_28d?: number
          streams_7d?: number
          total_streams?: number
          track_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      playlist_execution_jobs: {
        Row: {
          allocation_id: string | null
          attempts: number
          campaign_id: string | null
          claimed_at: string | null
          claimed_by: string | null
          completed_at: string | null
          correlation_id: string | null
          created_at: string
          dedupe_key: string
          from_position: number | null
          id: string
          job_type: string
          last_error: string | null
          last_validated_at: string | null
          last_validation_position: number | null
          last_validation_status: string | null
          lease_expires_at: string | null
          max_attempts: number
          metadata: Json
          playlist_id: string | null
          scheduled_for: string
          spotify_playlist_id: string
          spotify_track_id: string
          status: string
          to_position: number | null
          updated_at: string
        }
        Insert: {
          allocation_id?: string | null
          attempts?: number
          campaign_id?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string
          dedupe_key: string
          from_position?: number | null
          id?: string
          job_type?: string
          last_error?: string | null
          last_validated_at?: string | null
          last_validation_position?: number | null
          last_validation_status?: string | null
          lease_expires_at?: string | null
          max_attempts?: number
          metadata?: Json
          playlist_id?: string | null
          scheduled_for?: string
          spotify_playlist_id: string
          spotify_track_id: string
          status?: string
          to_position?: number | null
          updated_at?: string
        }
        Update: {
          allocation_id?: string | null
          attempts?: number
          campaign_id?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string
          dedupe_key?: string
          from_position?: number | null
          id?: string
          job_type?: string
          last_error?: string | null
          last_validated_at?: string | null
          last_validation_position?: number | null
          last_validation_status?: string | null
          lease_expires_at?: string | null
          max_attempts?: number
          metadata?: Json
          playlist_id?: string | null
          scheduled_for?: string
          spotify_playlist_id?: string
          spotify_track_id?: string
          status?: string
          to_position?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "playlist_execution_jobs_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["id"]
          },
        ]
      }
      playlist_followers_snapshots: {
        Row: {
          captured_at: string
          followers: number | null
          id: string
          playlist_spotify_id: string
          total_tracks: number | null
        }
        Insert: {
          captured_at?: string
          followers?: number | null
          id?: string
          playlist_spotify_id: string
          total_tracks?: number | null
        }
        Update: {
          captured_at?: string
          followers?: number | null
          id?: string
          playlist_spotify_id?: string
          total_tracks?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_pfs_playlist"
            columns: ["playlist_spotify_id"]
            isOneToOne: false
            referencedRelation: "managed_playlists"
            referencedColumns: ["spotify_playlist_id"]
          },
          {
            foreignKeyName: "fk_pfs_playlist"
            columns: ["playlist_spotify_id"]
            isOneToOne: false
            referencedRelation: "v_playlist_vps_assignment"
            referencedColumns: ["spotify_playlist_id"]
          },
        ]
      }
      playlist_genre_history: {
        Row: {
          created_at: string
          detected_by: string
          drift_score: number | null
          evidence: Json
          id: string
          new_confidence: number | null
          new_genre_id: string | null
          playlist_id: string
          previous_confidence: number | null
          previous_genre_id: string | null
          reason: string | null
        }
        Insert: {
          created_at?: string
          detected_by?: string
          drift_score?: number | null
          evidence?: Json
          id?: string
          new_confidence?: number | null
          new_genre_id?: string | null
          playlist_id: string
          previous_confidence?: number | null
          previous_genre_id?: string | null
          reason?: string | null
        }
        Update: {
          created_at?: string
          detected_by?: string
          drift_score?: number | null
          evidence?: Json
          id?: string
          new_confidence?: number | null
          new_genre_id?: string | null
          playlist_id?: string
          previous_confidence?: number | null
          previous_genre_id?: string | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "playlist_genre_history_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["id"]
          },
        ]
      }
      playlist_genres: {
        Row: {
          calculated_at: string
          confidence: number
          created_at: string
          drift_score: number | null
          evidence: Json
          genre_id: string
          id: string
          is_primary: boolean
          migration_score: number
          playlist_id: string
          previous_confidence: number | null
          source: string
          trend_shift: string | null
          updated_at: string
        }
        Insert: {
          calculated_at?: string
          confidence?: number
          created_at?: string
          drift_score?: number | null
          evidence?: Json
          genre_id: string
          id?: string
          is_primary?: boolean
          migration_score?: number
          playlist_id: string
          previous_confidence?: number | null
          source?: string
          trend_shift?: string | null
          updated_at?: string
        }
        Update: {
          calculated_at?: string
          confidence?: number
          created_at?: string
          drift_score?: number | null
          evidence?: Json
          genre_id?: string
          id?: string
          is_primary?: boolean
          migration_score?: number
          playlist_id?: string
          previous_confidence?: number | null
          source?: string
          trend_shift?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "playlist_genres_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playlist_genres_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres_with_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playlist_genres_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["id"]
          },
        ]
      }
      playlist_leadership: {
        Row: {
          activity_rank: number
          benchmark_rank: number
          calculated_at: string
          evidence: Json
          follower_rank: number
          freshness_rank: number | null
          growth_rank: number
          id: string
          leadership_score: number
          playlist_id: string
        }
        Insert: {
          activity_rank?: number
          benchmark_rank?: number
          calculated_at?: string
          evidence?: Json
          follower_rank?: number
          freshness_rank?: number | null
          growth_rank?: number
          id?: string
          leadership_score?: number
          playlist_id: string
        }
        Update: {
          activity_rank?: number
          benchmark_rank?: number
          calculated_at?: string
          evidence?: Json
          follower_rank?: number
          freshness_rank?: number | null
          growth_rank?: number
          id?: string
          leadership_score?: number
          playlist_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "playlist_leadership_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: true
            referencedRelation: "playlists"
            referencedColumns: ["id"]
          },
        ]
      }
      playlist_leadership_history: {
        Row: {
          activity_rank: number | null
          captured_at: string
          evidence: Json | null
          follower_rank: number | null
          followers: number | null
          freshness_rank: number | null
          growth_rank: number | null
          id: string
          leadership_score: number | null
          playlist_id: string
          rank_position: number | null
        }
        Insert: {
          activity_rank?: number | null
          captured_at?: string
          evidence?: Json | null
          follower_rank?: number | null
          followers?: number | null
          freshness_rank?: number | null
          growth_rank?: number | null
          id?: string
          leadership_score?: number | null
          playlist_id: string
          rank_position?: number | null
        }
        Update: {
          activity_rank?: number | null
          captured_at?: string
          evidence?: Json | null
          follower_rank?: number | null
          followers?: number | null
          freshness_rank?: number | null
          growth_rank?: number | null
          id?: string
          leadership_score?: number | null
          playlist_id?: string
          rank_position?: number | null
        }
        Relationships: []
      }
      playlist_metrics_snapshots: {
        Row: {
          collected_at: string
          followers: number
          id: string
          spotify_playlist_id: string
          template_id: string | null
          total_tracks: number | null
        }
        Insert: {
          collected_at?: string
          followers?: number
          id?: string
          spotify_playlist_id: string
          template_id?: string | null
          total_tracks?: number | null
        }
        Update: {
          collected_at?: string
          followers?: number
          id?: string
          spotify_playlist_id?: string
          template_id?: string | null
          total_tracks?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_pms_template"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "playlist_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      playlist_operation_log: {
        Row: {
          conflict_detected: boolean
          created_at: string
          divergence_count: number
          error: string | null
          finished_at: string | null
          id: string
          lock_timeout: boolean
          operation: string
          playlist_id: string
          retries: number
          started_at: string
          status: string
          tracks_after: number | null
          tracks_before: number | null
          tracks_changed: number | null
        }
        Insert: {
          conflict_detected?: boolean
          created_at?: string
          divergence_count?: number
          error?: string | null
          finished_at?: string | null
          id?: string
          lock_timeout?: boolean
          operation: string
          playlist_id: string
          retries?: number
          started_at?: string
          status?: string
          tracks_after?: number | null
          tracks_before?: number | null
          tracks_changed?: number | null
        }
        Update: {
          conflict_detected?: boolean
          created_at?: string
          divergence_count?: number
          error?: string | null
          finished_at?: string | null
          id?: string
          lock_timeout?: boolean
          operation?: string
          playlist_id?: string
          retries?: number
          started_at?: string
          status?: string
          tracks_after?: number | null
          tracks_before?: number | null
          tracks_changed?: number | null
        }
        Relationships: []
      }
      playlist_operation_queue: {
        Row: {
          attempts: number
          claimed_at: string | null
          claimed_by: string | null
          completed_at: string | null
          created_at: string
          error: string | null
          id: string
          max_attempts: number
          operation_type: string
          payload: Json
          playlist_id: string
          priority: number
          scheduled_for: string
          status: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          max_attempts?: number
          operation_type: string
          payload?: Json
          playlist_id: string
          priority?: number
          scheduled_for?: string
          status?: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          max_attempts?: number
          operation_type?: string
          payload?: Json
          playlist_id?: string
          priority?: number
          scheduled_for?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "playlist_operation_queue_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "managed_playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playlist_operation_queue_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "v_playlist_vps_assignment"
            referencedColumns: ["managed_playlist_id"]
          },
        ]
      }
      playlist_scores: {
        Row: {
          activity_score: number
          calculated_at: string
          capacity_score: number
          created_at: string
          delivery_score: number
          health_score: number
          id: string
          metadata: Json
          playlist_id: string
          risk_score: number
        }
        Insert: {
          activity_score?: number
          calculated_at?: string
          capacity_score?: number
          created_at?: string
          delivery_score?: number
          health_score?: number
          id?: string
          metadata?: Json
          playlist_id: string
          risk_score?: number
        }
        Update: {
          activity_score?: number
          calculated_at?: string
          capacity_score?: number
          created_at?: string
          delivery_score?: number
          health_score?: number
          id?: string
          metadata?: Json
          playlist_id?: string
          risk_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "playlist_scores_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: true
            referencedRelation: "playlists"
            referencedColumns: ["id"]
          },
        ]
      }
      playlist_seo_experiments: {
        Row: {
          applied_at: string | null
          baseline_at: string | null
          baseline_followers: number | null
          created_at: string
          delta_followers: number | null
          delta_pct: number | null
          field: string
          genre_id: string | null
          id: string
          measure_due_at: string | null
          measured_at: string | null
          measured_followers: number | null
          outcome: string | null
          pattern_key: string | null
          pattern_label: string | null
          playlist_id: string
          reasoning: string | null
          status: string
          suggestion_source: string
          updated_at: string
          version_after: string
          version_before: string
        }
        Insert: {
          applied_at?: string | null
          baseline_at?: string | null
          baseline_followers?: number | null
          created_at?: string
          delta_followers?: number | null
          delta_pct?: number | null
          field: string
          genre_id?: string | null
          id?: string
          measure_due_at?: string | null
          measured_at?: string | null
          measured_followers?: number | null
          outcome?: string | null
          pattern_key?: string | null
          pattern_label?: string | null
          playlist_id: string
          reasoning?: string | null
          status?: string
          suggestion_source?: string
          updated_at?: string
          version_after: string
          version_before: string
        }
        Update: {
          applied_at?: string | null
          baseline_at?: string | null
          baseline_followers?: number | null
          created_at?: string
          delta_followers?: number | null
          delta_pct?: number | null
          field?: string
          genre_id?: string | null
          id?: string
          measure_due_at?: string | null
          measured_at?: string | null
          measured_followers?: number | null
          outcome?: string | null
          pattern_key?: string | null
          pattern_label?: string | null
          playlist_id?: string
          reasoning?: string | null
          status?: string
          suggestion_source?: string
          updated_at?: string
          version_after?: string
          version_before?: string
        }
        Relationships: [
          {
            foreignKeyName: "playlist_seo_experiments_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playlist_seo_experiments_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres_with_health"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playlist_seo_experiments_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "managed_playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playlist_seo_experiments_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "v_playlist_vps_assignment"
            referencedColumns: ["managed_playlist_id"]
          },
        ]
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
      playlist_track_snapshots: {
        Row: {
          captured_at: string
          id: string
          playlist_spotify_id: string
          track_ids: string[]
          tracks_hash: string
        }
        Insert: {
          captured_at?: string
          id?: string
          playlist_spotify_id: string
          track_ids?: string[]
          tracks_hash: string
        }
        Update: {
          captured_at?: string
          id?: string
          playlist_spotify_id?: string
          track_ids?: string[]
          tracks_hash?: string
        }
        Relationships: []
      }
      playlists: {
        Row: {
          account_id: string | null
          cover_url: string | null
          created_at: string
          first_seen_at: string
          followers: number | null
          genre_id: string | null
          id: string
          last_seen_at: string
          monitored: boolean
          name: string | null
          ownership: string
          source: string
          spotify_playlist_id: string
        }
        Insert: {
          account_id?: string | null
          cover_url?: string | null
          created_at?: string
          first_seen_at?: string
          followers?: number | null
          genre_id?: string | null
          id?: string
          last_seen_at?: string
          monitored?: boolean
          name?: string | null
          ownership?: string
          source?: string
          spotify_playlist_id: string
        }
        Update: {
          account_id?: string | null
          cover_url?: string | null
          created_at?: string
          first_seen_at?: string
          followers?: number | null
          genre_id?: string | null
          id?: string
          last_seen_at?: string
          monitored?: boolean
          name?: string | null
          ownership?: string
          source?: string
          spotify_playlist_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "playlists_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playlists_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres_with_health"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_settings: {
        Row: {
          cost_per_stream_eco: number
          cost_per_stream_ext: number
          created_at: string
          id: string
          market_per_stream_eco: number
          market_per_stream_ext: number
          price_per_stream_sell: number
          target_margin_pct: number
          updated_at: string
          user_id: string
        }
        Insert: {
          cost_per_stream_eco?: number
          cost_per_stream_ext?: number
          created_at?: string
          id?: string
          market_per_stream_eco?: number
          market_per_stream_ext?: number
          price_per_stream_sell?: number
          target_margin_pct?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          cost_per_stream_eco?: number
          cost_per_stream_ext?: number
          created_at?: string
          id?: string
          market_per_stream_eco?: number
          market_per_stream_ext?: number
          price_per_stream_sell?: number
          target_margin_pct?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          count: number
          key: string
          window_start: string
        }
        Insert: {
          count?: number
          key: string
          window_start: string
        }
        Update: {
          count?: number
          key?: string
          window_start?: string
        }
        Relationships: []
      }
      raw_chart_daily: {
        Row: {
          album_name: string | null
          artist: string | null
          captured_at: string
          chart_date: string
          chart_name: string
          cover_url: string | null
          id: string
          popularity: number | null
          position: number
          source: string
          spotify_artist_id: string | null
          spotify_track_id: string | null
          streams_day: number
          streams_total: number | null
          track: string | null
        }
        Insert: {
          album_name?: string | null
          artist?: string | null
          captured_at?: string
          chart_date: string
          chart_name?: string
          cover_url?: string | null
          id?: string
          popularity?: number | null
          position: number
          source?: string
          spotify_artist_id?: string | null
          spotify_track_id?: string | null
          streams_day?: number
          streams_total?: number | null
          track?: string | null
        }
        Update: {
          album_name?: string | null
          artist?: string | null
          captured_at?: string
          chart_date?: string
          chart_name?: string
          cover_url?: string | null
          id?: string
          popularity?: number | null
          position?: number
          source?: string
          spotify_artist_id?: string | null
          spotify_track_id?: string | null
          streams_day?: number
          streams_total?: number | null
          track?: string | null
        }
        Relationships: []
      }
      realtime_audit_markers: {
        Row: {
          created_at: string
          id: string
          marker: string
        }
        Insert: {
          created_at?: string
          id?: string
          marker: string
        }
        Update: {
          created_at?: string
          id?: string
          marker?: string
        }
        Relationships: []
      }
      recommendation_feedback: {
        Row: {
          action: string
          created_at: string
          deal_id: string | null
          fit_id: string
          id: string
          note: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          deal_id?: string | null
          fit_id: string
          id?: string
          note?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          deal_id?: string | null
          fit_id?: string
          id?: string
          note?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recommendation_feedback_fit_id_fkey"
            columns: ["fit_id"]
            isOneToOne: false
            referencedRelation: "track_playlist_fit"
            referencedColumns: ["id"]
          },
        ]
      }
      recommendation_outcome: {
        Row: {
          created_at: string
          detected_at: string | null
          fit_id: string
          id: string
          impact_delta_pct: number | null
          notes: string | null
          outcome_kind: string
          streams_after_28d: number | null
          streams_before_28d: number | null
          updated_at: string
          verdict: string | null
        }
        Insert: {
          created_at?: string
          detected_at?: string | null
          fit_id: string
          id?: string
          impact_delta_pct?: number | null
          notes?: string | null
          outcome_kind?: string
          streams_after_28d?: number | null
          streams_before_28d?: number | null
          updated_at?: string
          verdict?: string | null
        }
        Update: {
          created_at?: string
          detected_at?: string | null
          fit_id?: string
          id?: string
          impact_delta_pct?: number | null
          notes?: string | null
          outcome_kind?: string
          streams_after_28d?: number | null
          streams_before_28d?: number | null
          updated_at?: string
          verdict?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recommendation_outcome_fit_id_fkey"
            columns: ["fit_id"]
            isOneToOne: false
            referencedRelation: "track_playlist_fit"
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
          {
            foreignKeyName: "replications_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "v_playlist_vps_assignment"
            referencedColumns: ["account_id"]
          },
        ]
      }
      search_results: {
        Row: {
          apify_run_id: string | null
          canonical_playlist_id: string | null
          coletado_em: string | null
          descricao: string | null
          duplicate_of: string | null
          enrich_attempted_at: string | null
          enrich_attempts: number
          enrich_failed: boolean
          enriched_at: string | null
          first_seen_at: string
          followers_growth: number | null
          followers_growth_rate: number | null
          followers_source:
            | Database["public"]["Enums"]["followers_source_type"]
            | null
          followers_verified_at: string | null
          freshness_score: number | null
          genre_id: string | null
          id: string
          imagem_url: string | null
          is_valid: boolean
          last_refreshed_at: string | null
          last_seen_at: string
          needs_enrich: boolean
          next_refresh_due: string | null
          nome_normalizado: string | null
          nome_playlist: string
          owner_id: string | null
          owner_type: string | null
          posicao: number
          previous_followers: number | null
          priority_score: number | null
          quality_flag: string | null
          quality_flagged_at: string | null
          quality_score: number | null
          quality_score_version: number | null
          refresh_tier: string | null
          score: number | null
          seguidores: number | null
          spotify_playlist_id: string | null
          spotify_url: string | null
          term_id: string | null
          times_seen: number
          total_musicas: number | null
          validation_reason: string | null
          winner_breakdown: Json | null
          winner_score: number | null
          winner_score_at: string | null
          winner_score_version: number | null
        }
        Insert: {
          apify_run_id?: string | null
          canonical_playlist_id?: string | null
          coletado_em?: string | null
          descricao?: string | null
          duplicate_of?: string | null
          enrich_attempted_at?: string | null
          enrich_attempts?: number
          enrich_failed?: boolean
          enriched_at?: string | null
          first_seen_at?: string
          followers_growth?: number | null
          followers_growth_rate?: number | null
          followers_source?:
            | Database["public"]["Enums"]["followers_source_type"]
            | null
          followers_verified_at?: string | null
          freshness_score?: number | null
          genre_id?: string | null
          id?: string
          imagem_url?: string | null
          is_valid?: boolean
          last_refreshed_at?: string | null
          last_seen_at?: string
          needs_enrich?: boolean
          next_refresh_due?: string | null
          nome_normalizado?: string | null
          nome_playlist: string
          owner_id?: string | null
          owner_type?: string | null
          posicao: number
          previous_followers?: number | null
          priority_score?: number | null
          quality_flag?: string | null
          quality_flagged_at?: string | null
          quality_score?: number | null
          quality_score_version?: number | null
          refresh_tier?: string | null
          score?: number | null
          seguidores?: number | null
          spotify_playlist_id?: string | null
          spotify_url?: string | null
          term_id?: string | null
          times_seen?: number
          total_musicas?: number | null
          validation_reason?: string | null
          winner_breakdown?: Json | null
          winner_score?: number | null
          winner_score_at?: string | null
          winner_score_version?: number | null
        }
        Update: {
          apify_run_id?: string | null
          canonical_playlist_id?: string | null
          coletado_em?: string | null
          descricao?: string | null
          duplicate_of?: string | null
          enrich_attempted_at?: string | null
          enrich_attempts?: number
          enrich_failed?: boolean
          enriched_at?: string | null
          first_seen_at?: string
          followers_growth?: number | null
          followers_growth_rate?: number | null
          followers_source?:
            | Database["public"]["Enums"]["followers_source_type"]
            | null
          followers_verified_at?: string | null
          freshness_score?: number | null
          genre_id?: string | null
          id?: string
          imagem_url?: string | null
          is_valid?: boolean
          last_refreshed_at?: string | null
          last_seen_at?: string
          needs_enrich?: boolean
          next_refresh_due?: string | null
          nome_normalizado?: string | null
          nome_playlist?: string
          owner_id?: string | null
          owner_type?: string | null
          posicao?: number
          previous_followers?: number | null
          priority_score?: number | null
          quality_flag?: string | null
          quality_flagged_at?: string | null
          quality_score?: number | null
          quality_score_version?: number | null
          refresh_tier?: string | null
          score?: number | null
          seguidores?: number | null
          spotify_playlist_id?: string | null
          spotify_url?: string | null
          term_id?: string | null
          times_seen?: number
          total_musicas?: number | null
          validation_reason?: string | null
          winner_breakdown?: Json | null
          winner_score?: number | null
          winner_score_at?: string | null
          winner_score_version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "search_results_canonical_playlist_id_fkey"
            columns: ["canonical_playlist_id"]
            isOneToOne: false
            referencedRelation: "search_results"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_results_duplicate_of_fkey"
            columns: ["duplicate_of"]
            isOneToOne: false
            referencedRelation: "search_results"
            referencedColumns: ["id"]
          },
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
          growth_rate: number
          id: string
          last_evaluated_at: string | null
          quality_score: number
          search_velocity: number
          status: string
          subgenre_id: string | null
          termo: string
          tipo: string
          total_resultados: number | null
          trend_score: number
          ultima_execucao: string | null
        }
        Insert: {
          created_at?: string | null
          executado?: boolean | null
          genre_id?: string | null
          growth_rate?: number
          id?: string
          last_evaluated_at?: string | null
          quality_score?: number
          search_velocity?: number
          status?: string
          subgenre_id?: string | null
          termo: string
          tipo: string
          total_resultados?: number | null
          trend_score?: number
          ultima_execucao?: string | null
        }
        Update: {
          created_at?: string | null
          executado?: boolean | null
          genre_id?: string | null
          growth_rate?: number
          id?: string
          last_evaluated_at?: string | null
          quality_score?: number
          search_velocity?: number
          status?: string
          subgenre_id?: string | null
          termo?: string
          tipo?: string
          total_resultados?: number | null
          trend_score?: number
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
          {
            foreignKeyName: "search_terms_subgenre_id_fkey"
            columns: ["subgenre_id"]
            isOneToOne: false
            referencedRelation: "subgenres"
            referencedColumns: ["id"]
          },
        ]
      }
      search_tracks: {
        Row: {
          album: string | null
          artista: string
          coletado_em: string | null
          cover_url: string | null
          duration_ms: number | null
          genre_id: string | null
          id: string
          nome_musica: string
          popularity: number | null
          posicao_na_playlist: number | null
          release_date: string | null
          result_id: string | null
          spotify_track_id: string | null
        }
        Insert: {
          album?: string | null
          artista: string
          coletado_em?: string | null
          cover_url?: string | null
          duration_ms?: number | null
          genre_id?: string | null
          id?: string
          nome_musica: string
          popularity?: number | null
          posicao_na_playlist?: number | null
          release_date?: string | null
          result_id?: string | null
          spotify_track_id?: string | null
        }
        Update: {
          album?: string | null
          artista?: string
          coletado_em?: string | null
          cover_url?: string | null
          duration_ms?: number | null
          genre_id?: string | null
          id?: string
          nome_musica?: string
          popularity?: number | null
          posicao_na_playlist?: number | null
          release_date?: string | null
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
      seo_genre_lessons: {
        Row: {
          avg_delta_pct: number | null
          confidence: number | null
          field: string
          genre_id: string
          id: string
          last_updated_at: string
          negative_count: number
          neutral_count: number
          pattern_key: string
          pattern_label: string
          positive_count: number
          samples_count: number
        }
        Insert: {
          avg_delta_pct?: number | null
          confidence?: number | null
          field: string
          genre_id: string
          id?: string
          last_updated_at?: string
          negative_count?: number
          neutral_count?: number
          pattern_key: string
          pattern_label: string
          positive_count?: number
          samples_count?: number
        }
        Update: {
          avg_delta_pct?: number | null
          confidence?: number | null
          field?: string
          genre_id?: string
          id?: string
          last_updated_at?: string
          negative_count?: number
          neutral_count?: number
          pattern_key?: string
          pattern_label?: string
          positive_count?: number
          samples_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "seo_genre_lessons_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seo_genre_lessons_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres_with_health"
            referencedColumns: ["id"]
          },
        ]
      }
      song_snapshot_playlists: {
        Row: {
          created_at: string
          id: string
          name: string
          owner: string | null
          plays_7d: number | null
          position: number | null
          snapshot_id: string
          spotify_playlist_id: string | null
          spotify_url: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner?: string | null
          plays_7d?: number | null
          position?: number | null
          snapshot_id: string
          spotify_playlist_id?: string | null
          spotify_url?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner?: string | null
          plays_7d?: number | null
          position?: number | null
          snapshot_id?: string
          spotify_playlist_id?: string | null
          spotify_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "song_snapshot_playlists_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "song_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      song_snapshots: {
        Row: {
          bot_metadata: Json | null
          captured_at: string
          correlation_id: string | null
          created_at: string
          id: string
          processed_at: string | null
          processing_error: string | null
          screenshot_url: string | null
          snapshot_run_id: string | null
          song_id: string
          spotify_song_id: string | null
          time_window: string
          total_plays_28d: number | null
        }
        Insert: {
          bot_metadata?: Json | null
          captured_at?: string
          correlation_id?: string | null
          created_at?: string
          id?: string
          processed_at?: string | null
          processing_error?: string | null
          screenshot_url?: string | null
          snapshot_run_id?: string | null
          song_id: string
          spotify_song_id?: string | null
          time_window?: string
          total_plays_28d?: number | null
        }
        Update: {
          bot_metadata?: Json | null
          captured_at?: string
          correlation_id?: string | null
          created_at?: string
          id?: string
          processed_at?: string | null
          processing_error?: string | null
          screenshot_url?: string | null
          snapshot_run_id?: string | null
          song_id?: string
          spotify_song_id?: string | null
          time_window?: string
          total_plays_28d?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "song_snapshots_snapshot_run_id_fkey"
            columns: ["snapshot_run_id"]
            isOneToOne: false
            referencedRelation: "bot_print_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "song_snapshots_snapshot_run_id_fkey"
            columns: ["snapshot_run_id"]
            isOneToOne: false
            referencedRelation: "v_snapshot_prints"
            referencedColumns: ["run_id"]
          },
        ]
      }
      spotify_accounts: {
        Row: {
          account_id: string
          created_at: string
          default_curator_id: string | null
          display_name: string | null
          email: string | null
          id: string
          last_login_at: string | null
          notes: string | null
          session_file_path: string | null
          status: string
          updated_at: string
          vps_node_id: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          default_curator_id?: string | null
          display_name?: string | null
          email?: string | null
          id?: string
          last_login_at?: string | null
          notes?: string | null
          session_file_path?: string | null
          status?: string
          updated_at?: string
          vps_node_id?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          default_curator_id?: string | null
          display_name?: string | null
          email?: string | null
          id?: string
          last_login_at?: string | null
          notes?: string | null
          session_file_path?: string | null
          status?: string
          updated_at?: string
          vps_node_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "spotify_accounts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spotify_accounts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "v_playlist_vps_assignment"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "spotify_accounts_default_curator_id_fkey"
            columns: ["default_curator_id"]
            isOneToOne: false
            referencedRelation: "curators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spotify_accounts_default_curator_id_fkey"
            columns: ["default_curator_id"]
            isOneToOne: false
            referencedRelation: "v_curator_balance"
            referencedColumns: ["curator_id"]
          },
          {
            foreignKeyName: "spotify_accounts_default_curator_id_fkey"
            columns: ["default_curator_id"]
            isOneToOne: false
            referencedRelation: "v_curator_finance"
            referencedColumns: ["curator_id"]
          },
          {
            foreignKeyName: "spotify_accounts_vps_node_id_fkey"
            columns: ["vps_node_id"]
            isOneToOne: false
            referencedRelation: "v_playlist_vps_assignment"
            referencedColumns: ["vps_node_id"]
          },
          {
            foreignKeyName: "spotify_accounts_vps_node_id_fkey"
            columns: ["vps_node_id"]
            isOneToOne: false
            referencedRelation: "vps_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      spotify_apps: {
        Row: {
          auth_failure_count: number
          client_id: string
          client_secret: string
          created_at: string
          id: string
          is_default: boolean
          last_auth_failure_at: string | null
          max_accounts: number
          name: string
          notes: string | null
          owner_email: string | null
          quarantine_reason: string | null
          quarantined_until: string | null
          ready_for_deletion: boolean
          retired_from_production: boolean
          retirement_audit: Json | null
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          auth_failure_count?: number
          client_id: string
          client_secret: string
          created_at?: string
          id?: string
          is_default?: boolean
          last_auth_failure_at?: string | null
          max_accounts?: number
          name: string
          notes?: string | null
          owner_email?: string | null
          quarantine_reason?: string | null
          quarantined_until?: string | null
          ready_for_deletion?: boolean
          retired_from_production?: boolean
          retirement_audit?: Json | null
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          auth_failure_count?: number
          client_id?: string
          client_secret?: string
          created_at?: string
          id?: string
          is_default?: boolean
          last_auth_failure_at?: string | null
          max_accounts?: number
          name?: string
          notes?: string | null
          owner_email?: string | null
          quarantine_reason?: string | null
          quarantined_until?: string | null
          ready_for_deletion?: boolean
          retired_from_production?: boolean
          retirement_audit?: Json | null
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      spotify_call_log: {
        Row: {
          app_id: string | null
          app_name: string | null
          attempts: number
          breaker_open: boolean
          created_at: string
          duration_ms: number | null
          endpoint: string
          error: string | null
          error_body: string | null
          function_name: string | null
          http_status: number | null
          id: number
          meta: Json | null
          method: string
          owner_id: string | null
          playlist_id: string | null
          retry_after_sec: number | null
          spotify_user_id: string | null
          status: string
        }
        Insert: {
          app_id?: string | null
          app_name?: string | null
          attempts?: number
          breaker_open?: boolean
          created_at?: string
          duration_ms?: number | null
          endpoint: string
          error?: string | null
          error_body?: string | null
          function_name?: string | null
          http_status?: number | null
          id?: number
          meta?: Json | null
          method?: string
          owner_id?: string | null
          playlist_id?: string | null
          retry_after_sec?: number | null
          spotify_user_id?: string | null
          status: string
        }
        Update: {
          app_id?: string | null
          app_name?: string | null
          attempts?: number
          breaker_open?: boolean
          created_at?: string
          duration_ms?: number | null
          endpoint?: string
          error?: string | null
          error_body?: string | null
          function_name?: string | null
          http_status?: number | null
          id?: number
          meta?: Json | null
          method?: string
          owner_id?: string | null
          playlist_id?: string | null
          retry_after_sec?: number | null
          spotify_user_id?: string | null
          status?: string
        }
        Relationships: []
      }
      spotify_circuit_breaker: {
        Row: {
          app_id: string
          blocked_until: string | null
          created_at: string
          last_429_at: string | null
          retry_after_sec: number
          status: string
          updated_at: string
        }
        Insert: {
          app_id?: string
          blocked_until?: string | null
          created_at?: string
          last_429_at?: string | null
          retry_after_sec?: number
          status?: string
          updated_at?: string
        }
        Update: {
          app_id?: string
          blocked_until?: string | null
          created_at?: string
          last_429_at?: string | null
          retry_after_sec?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      spotify_circuit_breaker_log: {
        Row: {
          app_id: string
          blocked_until: string
          caused_by: string | null
          created_at: string
          id: string
          opened_at: string
          retry_after_sec: number
          source_function: string | null
        }
        Insert: {
          app_id?: string
          blocked_until: string
          caused_by?: string | null
          created_at?: string
          id?: string
          opened_at?: string
          retry_after_sec?: number
          source_function?: string | null
        }
        Update: {
          app_id?: string
          blocked_until?: string
          caused_by?: string | null
          created_at?: string
          id?: string
          opened_at?: string
          retry_after_sec?: number
          source_function?: string | null
        }
        Relationships: []
      }
      spotify_editorial_blocklist: {
        Row: {
          created_at: string
          display_name: string | null
          reason: string
          spotify_user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          reason?: string
          spotify_user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          reason?: string
          spotify_user_id?: string
        }
        Relationships: []
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
      spotify_invite_tokens: {
        Row: {
          app_id: string
          consumed_at: string | null
          consumed_email: string | null
          consumed_spotify_user_id: string | null
          created_at: string
          created_by: string | null
          expires_at: string
          label: string | null
          token: string
        }
        Insert: {
          app_id: string
          consumed_at?: string | null
          consumed_email?: string | null
          consumed_spotify_user_id?: string | null
          created_at?: string
          created_by?: string | null
          expires_at: string
          label?: string | null
          token: string
        }
        Update: {
          app_id?: string
          consumed_at?: string | null
          consumed_email?: string | null
          consumed_spotify_user_id?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string
          label?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "spotify_invite_tokens_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "spotify_apps"
            referencedColumns: ["id"]
          },
        ]
      }
      spotify_oauth_audit: {
        Row: {
          actor_user_id: string | null
          app_id: string | null
          created_at: string
          display_name: string | null
          email: string | null
          error_code: string | null
          error_message: string | null
          event: string
          flow: string | null
          id: string
          invite_token: string | null
          ip: string | null
          meta: Json
          spotify_user_id: string | null
          state: string | null
          status: string
          user_agent: string | null
        }
        Insert: {
          actor_user_id?: string | null
          app_id?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          error_code?: string | null
          error_message?: string | null
          event: string
          flow?: string | null
          id?: string
          invite_token?: string | null
          ip?: string | null
          meta?: Json
          spotify_user_id?: string | null
          state?: string | null
          status?: string
          user_agent?: string | null
        }
        Update: {
          actor_user_id?: string | null
          app_id?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          error_code?: string | null
          error_message?: string | null
          event?: string
          flow?: string | null
          id?: string
          invite_token?: string | null
          ip?: string | null
          meta?: Json
          spotify_user_id?: string | null
          state?: string | null
          status?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "spotify_oauth_audit_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "spotify_apps"
            referencedColumns: ["id"]
          },
        ]
      }
      spotify_oauth_states: {
        Row: {
          app_id: string | null
          consumed_at: string | null
          created_at: string
          flow: string
          state: string
          user_id: string | null
        }
        Insert: {
          app_id?: string | null
          consumed_at?: string | null
          created_at?: string
          flow?: string
          state: string
          user_id?: string | null
        }
        Update: {
          app_id?: string | null
          consumed_at?: string | null
          created_at?: string
          flow?: string
          state?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "spotify_oauth_states_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "spotify_apps"
            referencedColumns: ["id"]
          },
        ]
      }
      spotify_playlist_cache: {
        Row: {
          cached_at: string
          created_at: string
          followers: number | null
          id: string
          image_url: string | null
          owner_name: string | null
          spotify_playlist_id: string
        }
        Insert: {
          cached_at?: string
          created_at?: string
          followers?: number | null
          id?: string
          image_url?: string | null
          owner_name?: string | null
          spotify_playlist_id: string
        }
        Update: {
          cached_at?: string
          created_at?: string
          followers?: number | null
          id?: string
          image_url?: string | null
          owner_name?: string | null
          spotify_playlist_id?: string
        }
        Relationships: []
      }
      spotify_tokens: {
        Row: {
          access_token: string
          app_id: string | null
          created_at: string
          expires_at: string
          id: string
          singleton_key: string
        }
        Insert: {
          access_token: string
          app_id?: string | null
          created_at?: string
          expires_at: string
          id?: string
          singleton_key?: string
        }
        Update: {
          access_token?: string
          app_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          singleton_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "spotify_tokens_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "spotify_apps"
            referencedColumns: ["id"]
          },
        ]
      }
      spotify_user_tokens: {
        Row: {
          access_token: string
          app_id: string | null
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
          app_id?: string | null
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
          app_id?: string | null
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
        Relationships: [
          {
            foreignKeyName: "spotify_user_tokens_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "spotify_apps"
            referencedColumns: ["id"]
          },
        ]
      }
      subgenres: {
        Row: {
          ativo: boolean
          created_at: string
          descricao: string | null
          id: string
          nome: string
          palavras_chave: Json
          parent_genre_id: string
          slug: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          id?: string
          nome: string
          palavras_chave?: Json
          parent_genre_id: string
          slug: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          id?: string
          nome?: string
          palavras_chave?: Json
          parent_genre_id?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subgenres_parent_genre_id_fkey"
            columns: ["parent_genre_id"]
            isOneToOne: false
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subgenres_parent_genre_id_fkey"
            columns: ["parent_genre_id"]
            isOneToOne: false
            referencedRelation: "genres_with_health"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      sync_log: {
        Row: {
          created_at: string
          duration_ms: number | null
          errors: Json | null
          failed: number
          id: string
          recalculated: number
          source: string
          synced: number
          tier: string | null
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          errors?: Json | null
          failed?: number
          id?: string
          recalculated?: number
          source?: string
          synced?: number
          tier?: string | null
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          errors?: Json | null
          failed?: number
          id?: string
          recalculated?: number
          source?: string
          synced?: number
          tier?: string | null
        }
        Relationships: []
      }
      system_flags: {
        Row: {
          ai_editorial_tier: string
          apify_blocked: boolean
          apify_blocked_at: string | null
          apify_blocked_reason: string | null
          auto_deal_from_campaign: boolean
          created_at: string
          execution_frozen: boolean
          execution_frozen_at: string | null
          execution_frozen_by: string | null
          execution_frozen_reason: string | null
          execution_queue_internal_enabled: boolean
          id: string
          singleton_key: string
          updated_at: string
        }
        Insert: {
          ai_editorial_tier?: string
          apify_blocked?: boolean
          apify_blocked_at?: string | null
          apify_blocked_reason?: string | null
          auto_deal_from_campaign?: boolean
          created_at?: string
          execution_frozen?: boolean
          execution_frozen_at?: string | null
          execution_frozen_by?: string | null
          execution_frozen_reason?: string | null
          execution_queue_internal_enabled?: boolean
          id?: string
          singleton_key?: string
          updated_at?: string
        }
        Update: {
          ai_editorial_tier?: string
          apify_blocked?: boolean
          apify_blocked_at?: string | null
          apify_blocked_reason?: string | null
          auto_deal_from_campaign?: boolean
          created_at?: string
          execution_frozen?: boolean
          execution_frozen_at?: string | null
          execution_frozen_by?: string | null
          execution_frozen_reason?: string | null
          execution_queue_internal_enabled?: boolean
          id?: string
          singleton_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      track_ecosystem_score: {
        Row: {
          acceleration: number | null
          artist_name: string | null
          calculated_at: string
          confidence: number | null
          created_at: string
          curator_playlist_count: number | null
          deal_active_count: number | null
          frequency_score: number | null
          growth_28d_pct: number | null
          growth_7d_pct: number | null
          id: string
          last_snapshot_at: string | null
          managed_playlist_count: number | null
          momentum_class: string
          saturation_index: number | null
          snapshots_used: number | null
          spotify_track_id: string
          streams_28d: number | null
          streams_7d: number | null
          streams_total: number | null
          total_playlist_count: number | null
          track_name: string | null
          updated_at: string
        }
        Insert: {
          acceleration?: number | null
          artist_name?: string | null
          calculated_at?: string
          confidence?: number | null
          created_at?: string
          curator_playlist_count?: number | null
          deal_active_count?: number | null
          frequency_score?: number | null
          growth_28d_pct?: number | null
          growth_7d_pct?: number | null
          id?: string
          last_snapshot_at?: string | null
          managed_playlist_count?: number | null
          momentum_class?: string
          saturation_index?: number | null
          snapshots_used?: number | null
          spotify_track_id: string
          streams_28d?: number | null
          streams_7d?: number | null
          streams_total?: number | null
          total_playlist_count?: number | null
          track_name?: string | null
          updated_at?: string
        }
        Update: {
          acceleration?: number | null
          artist_name?: string | null
          calculated_at?: string
          confidence?: number | null
          created_at?: string
          curator_playlist_count?: number | null
          deal_active_count?: number | null
          frequency_score?: number | null
          growth_28d_pct?: number | null
          growth_7d_pct?: number | null
          id?: string
          last_snapshot_at?: string | null
          managed_playlist_count?: number | null
          momentum_class?: string
          saturation_index?: number | null
          snapshots_used?: number | null
          spotify_track_id?: string
          streams_28d?: number | null
          streams_7d?: number | null
          streams_total?: number | null
          total_playlist_count?: number | null
          track_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      track_playlist_fit: {
        Row: {
          already_present: boolean
          calculated_at: string
          confidence: number
          created_at: string
          evidence: Json
          fit_reason: string[]
          fit_score: number
          id: string
          playlist_kind: string
          recommendation_kind: string
          spotify_playlist_id: string
          spotify_track_id: string
          updated_at: string
        }
        Insert: {
          already_present?: boolean
          calculated_at?: string
          confidence?: number
          created_at?: string
          evidence?: Json
          fit_reason?: string[]
          fit_score?: number
          id?: string
          playlist_kind: string
          recommendation_kind: string
          spotify_playlist_id: string
          spotify_track_id: string
          updated_at?: string
        }
        Update: {
          already_present?: boolean
          calculated_at?: string
          confidence?: number
          created_at?: string
          evidence?: Json
          fit_reason?: string[]
          fit_score?: number
          id?: string
          playlist_kind?: string
          recommendation_kind?: string
          spotify_playlist_id?: string
          spotify_track_id?: string
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
      vps_nodes: {
        Row: {
          created_at: string
          hostname: string
          id: string
          ip: unknown
          last_heartbeat_at: string | null
          max_concurrent_sessions: number
          notes: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          hostname: string
          id?: string
          ip: unknown
          last_heartbeat_at?: string | null
          max_concurrent_sessions?: number
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          hostname?: string
          id?: string
          ip?: unknown
          last_heartbeat_at?: string | null
          max_concurrent_sessions?: number
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      campaign_playlist_inventory_v1: {
        Row: {
          campaign_id: string | null
          curator_id: string | null
          first_seen_at: string | null
          has_collection: boolean | null
          last_collected_at: string | null
          managed_playlist_id: string | null
          missing_spotify_id: boolean | null
          planned_at: string | null
          playlist_id: string | null
          playlist_name: string | null
          raw_status: string | null
          source: string | null
          source_ref: string | null
          state: string | null
        }
        Relationships: []
      }
      campaign_radio_collected: {
        Row: {
          campaign_id: string | null
          current_plays_7d: number | null
          last_captured_at: string | null
          radio_delta: number | null
          spotify_track_id: string | null
          start_captured_at: string | null
          start_plays_7d: number | null
        }
        Relationships: []
      }
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
      spotify_user_tokens_public: {
        Row: {
          app_id: string | null
          display_name: string | null
          email: string | null
          id: string | null
          is_default: boolean | null
          spotify_user_id: string | null
        }
        Insert: {
          app_id?: string | null
          display_name?: string | null
          email?: string | null
          id?: string | null
          is_default?: boolean | null
          spotify_user_id?: string | null
        }
        Update: {
          app_id?: string | null
          display_name?: string | null
          email?: string | null
          id?: string | null
          is_default?: boolean | null
          spotify_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "spotify_user_tokens_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "spotify_apps"
            referencedColumns: ["id"]
          },
        ]
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
      v_campaign_velocity: {
        Row: {
          campaign_id: string | null
          days_elapsed: number | null
          days_total: number | null
          deadline: string | null
          delivered_per_day: number | null
          goal_plays: number | null
          pace_ratio: number | null
          started_at: string | null
          status: string | null
          total_delivered: number | null
          track_name: string | null
        }
        Insert: {
          campaign_id?: string | null
          days_elapsed?: never
          days_total?: never
          deadline?: string | null
          delivered_per_day?: never
          goal_plays?: number | null
          pace_ratio?: never
          started_at?: string | null
          status?: string | null
          total_delivered?: number | null
          track_name?: string | null
        }
        Update: {
          campaign_id?: string | null
          days_elapsed?: never
          days_total?: never
          deadline?: string | null
          delivered_per_day?: never
          goal_plays?: number | null
          pace_ratio?: never
          started_at?: string | null
          status?: string | null
          total_delivered?: number | null
          track_name?: string | null
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
      v_curator_playlists_observational: {
        Row: {
          added_at: string | null
          added_at_spotify: string | null
          attribution_method: string | null
          attribution_reason: string | null
          canonical_playlist_id: string | null
          deal_id: string | null
          followers: number | null
          id: string | null
          image_url: string | null
          is_baseline: boolean | null
          is_observational: boolean | null
          last_paste_at: string | null
          match_reason: string | null
          match_status: string | null
          playlist_name: string | null
          position_in_paste: number | null
          song_id: string | null
          spotify_owner_id: string | null
          spotify_owner_name: string | null
          spotify_playlist_id: string | null
          spotify_url: string | null
          streams_28d: number | null
          streams_7d: number | null
          streams_total: number | null
        }
        Insert: {
          added_at?: string | null
          added_at_spotify?: string | null
          attribution_method?: string | null
          attribution_reason?: string | null
          canonical_playlist_id?: string | null
          deal_id?: string | null
          followers?: number | null
          id?: string | null
          image_url?: string | null
          is_baseline?: boolean | null
          is_observational?: boolean | null
          last_paste_at?: string | null
          match_reason?: string | null
          match_status?: string | null
          playlist_name?: string | null
          position_in_paste?: number | null
          song_id?: string | null
          spotify_owner_id?: string | null
          spotify_owner_name?: string | null
          spotify_playlist_id?: string | null
          spotify_url?: string | null
          streams_28d?: number | null
          streams_7d?: number | null
          streams_total?: number | null
        }
        Update: {
          added_at?: string | null
          added_at_spotify?: string | null
          attribution_method?: string | null
          attribution_reason?: string | null
          canonical_playlist_id?: string | null
          deal_id?: string | null
          followers?: number | null
          id?: string | null
          image_url?: string | null
          is_baseline?: boolean | null
          is_observational?: boolean | null
          last_paste_at?: string | null
          match_reason?: string | null
          match_status?: string | null
          playlist_name?: string | null
          position_in_paste?: number | null
          song_id?: string | null
          spotify_owner_id?: string | null
          spotify_owner_name?: string | null
          spotify_playlist_id?: string | null
          spotify_url?: string | null
          streams_28d?: number | null
          streams_7d?: number | null
          streams_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "curator_playlists_canonical_playlist_id_fkey"
            columns: ["canonical_playlist_id"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["id"]
          },
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
      v_curator_playlists_operational: {
        Row: {
          added_at: string | null
          added_at_spotify: string | null
          attribution_method: string | null
          attribution_reason: string | null
          canonical_playlist_id: string | null
          deal_id: string | null
          followers: number | null
          id: string | null
          image_url: string | null
          is_baseline: boolean | null
          is_observational: boolean | null
          last_paste_at: string | null
          match_reason: string | null
          match_status: string | null
          playlist_name: string | null
          position_in_paste: number | null
          song_id: string | null
          spotify_owner_id: string | null
          spotify_owner_name: string | null
          spotify_playlist_id: string | null
          spotify_url: string | null
          streams_28d: number | null
          streams_7d: number | null
          streams_total: number | null
        }
        Insert: {
          added_at?: string | null
          added_at_spotify?: string | null
          attribution_method?: string | null
          attribution_reason?: string | null
          canonical_playlist_id?: string | null
          deal_id?: string | null
          followers?: number | null
          id?: string | null
          image_url?: string | null
          is_baseline?: boolean | null
          is_observational?: boolean | null
          last_paste_at?: string | null
          match_reason?: string | null
          match_status?: string | null
          playlist_name?: string | null
          position_in_paste?: number | null
          song_id?: string | null
          spotify_owner_id?: string | null
          spotify_owner_name?: string | null
          spotify_playlist_id?: string | null
          spotify_url?: string | null
          streams_28d?: number | null
          streams_7d?: number | null
          streams_total?: number | null
        }
        Update: {
          added_at?: string | null
          added_at_spotify?: string | null
          attribution_method?: string | null
          attribution_reason?: string | null
          canonical_playlist_id?: string | null
          deal_id?: string | null
          followers?: number | null
          id?: string | null
          image_url?: string | null
          is_baseline?: boolean | null
          is_observational?: boolean | null
          last_paste_at?: string | null
          match_reason?: string | null
          match_status?: string | null
          playlist_name?: string | null
          position_in_paste?: number | null
          song_id?: string | null
          spotify_owner_id?: string | null
          spotify_owner_name?: string | null
          spotify_playlist_id?: string | null
          spotify_url?: string | null
          streams_28d?: number | null
          streams_7d?: number | null
          streams_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "curator_playlists_canonical_playlist_id_fkey"
            columns: ["canonical_playlist_id"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["id"]
          },
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
      v_financial_summary: {
        Row: {
          artist: string | null
          campaign_id: string | null
          campaign_status: string | null
          created_at: string | null
          margem_bruta: number | null
          margem_pct: number | null
          num_deals: number | null
          receita_pendente: number | null
          total_pago_curadores: number | null
          track_name: string | null
          valor_cobrado: number | null
          valor_recebido: number | null
        }
        Relationships: []
      }
      v_financial_unallocated_cost: {
        Row: {
          num_compras: number | null
          total_nao_alocado: number | null
        }
        Relationships: []
      }
      v_playlist_delivery_history: {
        Row: {
          avg_daily_delivery: number | null
          campaigns_count: number | null
          fulfillment_rate: number | null
          last_campaign_at: string | null
          playlist_id: string | null
          total_delivered: number | null
          total_promised: number | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_allocations_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["id"]
          },
        ]
      }
      v_playlist_vps_assignment: {
        Row: {
          account_id: string | null
          account_name: string | null
          account_status: string | null
          canonical_playlist_id: string | null
          hostname: string | null
          ip: unknown
          managed_playlist_id: string | null
          session_file_path: string | null
          spotify_account_id: string | null
          spotify_playlist_id: string | null
          vps_node_id: string | null
          vps_status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "managed_playlists_canonical_playlist_id_fkey"
            columns: ["canonical_playlist_id"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["id"]
          },
        ]
      }
      v_snapshot_prints: {
        Row: {
          campaign_id: string | null
          completed_at: string | null
          created_at: string | null
          deal_id: string | null
          print_count: number | null
          print_urls: string[] | null
          run_id: string | null
          song_id: string | null
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
          {
            foreignKeyName: "curator_deals_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_radio_collected"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "curator_deals_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curator_deals_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_velocity"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "curator_deals_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_financial_summary"
            referencedColumns: ["campaign_id"]
          },
        ]
      }
      vw_403_audit_report: {
        Row: {
          errors_7d: number | null
          group_key: string | null
          group_kind: string | null
          last_seen: string | null
        }
        Relationships: []
      }
      vw_campaign_playlist_growth: {
        Row: {
          attributed_curator_id: string | null
          attributed_to: string | null
          baseline_at: string | null
          baseline_name: string | null
          baseline_plays: number | null
          campaign_id: string | null
          current_name: string | null
          current_plays: number | null
          delta: number | null
          first_seen_at: string | null
          is_baseline_conflict: boolean | null
          last_captured_at: string | null
          playlist_id: string | null
          playlist_url: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_playlist_collections_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_radio_collected"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaign_playlist_collections_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_playlist_collections_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_campaign_velocity"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "campaign_playlist_collections_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "v_financial_summary"
            referencedColumns: ["campaign_id"]
          },
          {
            foreignKeyName: "curator_campaign_playlists_curator_id_fkey"
            columns: ["attributed_curator_id"]
            isOneToOne: false
            referencedRelation: "curators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curator_campaign_playlists_curator_id_fkey"
            columns: ["attributed_curator_id"]
            isOneToOne: false
            referencedRelation: "v_curator_balance"
            referencedColumns: ["curator_id"]
          },
          {
            foreignKeyName: "curator_campaign_playlists_curator_id_fkey"
            columns: ["attributed_curator_id"]
            isOneToOne: false
            referencedRelation: "v_curator_finance"
            referencedColumns: ["curator_id"]
          },
        ]
      }
      vw_inventory_vs_monitor_diff: {
        Row: {
          campaign_id: string | null
          curator_id: string | null
          divergence: string | null
          last_collected_at: string | null
          managed_playlist_id: string | null
          planned_at: string | null
          playlist_id: string | null
          playlist_name: string | null
          source: string | null
          state: string | null
          visible_in_monitor: boolean | null
        }
        Relationships: []
      }
    }
    Functions: {
      _normalize_notification_type: {
        Args: { p_type: string }
        Returns: Database["public"]["Enums"]["notification_type"]
      }
      accept_community_invite: { Args: { p_code: string }; Returns: Json }
      admin_get_client_pii: {
        Args: { _client_id: string }
        Returns: {
          document: string
          phone: string
        }[]
      }
      admin_get_curator_pii: {
        Args: { _curator_id: string }
        Returns: {
          document: string
          phone: string
          pix_key: string
          pix_type: string
        }[]
      }
      apply_playlist_cooldown: {
        Args: {
          _action: Database["public"]["Enums"]["curatorial_action_type"]
          _days?: number
          _playlist_id: string
          _reason?: string
          _triggered_by?: string
        }
        Returns: string
      }
      approve_campaign: { Args: { p_campaign_id: string }; Returns: Json }
      approve_campaign_plan_atomic: {
        Args: {
          p_campaign_id: string
          p_new_allocs?: Json
          p_position_updates?: Json
          p_user_id: string
          p_valor_cobrado?: number
        }
        Returns: Json
      }
      backfill_curator_deal_songs: {
        Args: { p_deal_ids?: string[] }
        Returns: {
          action: string
          deal_id: string
          song_id: string
        }[]
      }
      bump_ai_quota: {
        Args: { p_month_start: string; p_tokens: number; p_user_id: string }
        Returns: Json
      }
      bump_rate_limit: {
        Args: { p_key: string; p_limit?: number; p_window_seconds?: number }
        Returns: Json
      }
      claim_next_playlist_job: {
        Args: { _claimed_by: string }
        Returns: {
          attempts: number
          claimed_at: string | null
          claimed_by: string | null
          completed_at: string | null
          created_at: string
          error: string | null
          id: string
          max_attempts: number
          operation_type: string
          payload: Json
          playlist_id: string
          priority: number
          scheduled_for: string
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "playlist_operation_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      cleanup_bot_ingest_raw: { Args: never; Returns: number }
      cleanup_old_bot_prints: { Args: never; Returns: Json }
      cleanup_old_logs: { Args: never; Returns: Json }
      cleanup_old_logs_and_snapshots: { Args: never; Returns: Json }
      cleanup_operational_logs: { Args: never; Returns: Json }
      cleanup_rate_limits_and_ai_cache: { Args: never; Returns: Json }
      cleanup_spotify_call_log: { Args: never; Returns: undefined }
      cleanup_stale_autopilot_runs: {
        Args: { p_minutes?: number }
        Returns: number
      }
      client_approve_campaign: {
        Args: {
          p_approver_ip?: string
          p_approver_name: string
          p_token: string
        }
        Returns: string
      }
      client_request_adjustment: {
        Args: { p_message: string; p_requester_name?: string; p_token: string }
        Returns: string
      }
      close_expired_spotify_circuit_breakers: { Args: never; Returns: number }
      community_accept_campaign: {
        Args: { p_campaign_id: string }
        Returns: Json
      }
      community_audit_report: { Args: never; Returns: Json }
      community_expire_stale: { Args: never; Returns: number }
      community_list_open_campaigns: {
        Args: never
        Returns: {
          already_accepted: boolean
          brief: string
          id: string
          points_per_member: number
          proof_window_hours: number
          remaining_slots: number
          song_artist: string
          song_cover_url: string
          song_name: string
          song_spotify_url: string
          title: string
        }[]
      }
      community_member_points: { Args: { p_member: string }; Returns: number }
      community_my_participations: {
        Args: never
        Returns: {
          created_at: string
          expires_at: string
          id: string
          points_awarded: number
          points_offered: number
          proof_submitted_at: string
          review_note: string
          reviewed_at: string
          song_artist: string
          song_cover_url: string
          song_name: string
          status: string
          title: string
        }[]
      }
      community_recompute_member: {
        Args: { p_member: string }
        Returns: undefined
      }
      community_revert_participation: {
        Args: { p_participation_id: string; p_reason?: string }
        Returns: Json
      }
      community_review_participation: {
        Args: { p_action: string; p_note?: string; p_participation_id: string }
        Returns: Json
      }
      community_submit_proof: {
        Args: { p_participation_id: string; p_proof_url: string }
        Returns: Json
      }
      community_tier_for: { Args: { p_points: number }; Returns: string }
      compare_genre_versions: {
        Args: { p_genre_id: string; p_version_a: number; p_version_b: number }
        Returns: Json
      }
      compute_playlist_execution_mode: {
        Args: { p_archived_at: string; p_owner: string }
        Returns: Database["public"]["Enums"]["playlist_execution_mode"]
      }
      count_recent_backfill_attempts: {
        Args: { p_genre_id: string; p_hours?: number }
        Returns: number
      }
      create_curator_deal_atomic:
        | {
            Args: { p_deal: Json; p_force?: boolean; p_songs: Json }
            Returns: Json
          }
        | {
            Args: {
              p_deal: Json
              p_force?: boolean
              p_new_curator?: Json
              p_songs: Json
            }
            Returns: Json
          }
        | {
            Args: {
              p_deal: Json
              p_external_curator_id?: string
              p_force?: boolean
              p_new_curator?: Json
              p_songs: Json
            }
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
      default_cooldown_days: {
        Args: { _action: Database["public"]["Enums"]["curatorial_action_type"] }
        Returns: number
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
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
      enqueue_baseline_collection: {
        Args: { p_campaign_id: string }
        Returns: undefined
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      evaluate_pending_impacts: { Args: never; Returns: number }
      evaluate_playlist: { Args: { p_spotify_id: string }; Returns: Json }
      evaluate_playlist_by_url: { Args: { p_url: string }; Returns: Json }
      evaluate_playlists_batch: {
        Args: { p_spotify_ids: string[] }
        Returns: {
          estimated_monthly_plays: number
          recommendation: string
          risk_level: string
          spotify_playlist_id: string
          valuation_score: number
        }[]
      }
      expire_spotify_app_quarantines: { Args: never; Returns: number }
      expire_stale_medium_templates: {
        Args: { p_hours?: number }
        Returns: {
          expired_count: number
          expired_ids: string[]
        }[]
      }
      extract_spotify_playlist_id: { Args: { p_url: string }; Returns: string }
      generate_community_invite_slug: {
        Args: { p_email: string; p_id: string; p_note: string }
        Returns: string
      }
      generate_curator_deal_slug: {
        Args: { p_curator: string; p_id: string; p_song: string }
        Returns: string
      }
      generate_curator_deal_song_slug: {
        Args: { p_artist: string; p_id: string; p_song: string }
        Returns: string
      }
      get_active_cooldowns: {
        Args: { _playlist_id: string }
        Returns: {
          action_type: Database["public"]["Enums"]["curatorial_action_type"]
          cooldown_until: string
          days_remaining: number
          reason: string
        }[]
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
      get_blocked_playlist_ids: {
        Args: never
        Returns: {
          app_id: string
          app_name: string
          blocked_until: string
          playlist_id: string
        }[]
      }
      get_campaign_analytics_overview: { Args: never; Returns: Json }
      get_campaign_radio_collected: {
        Args: { _campaign_id: string }
        Returns: {
          campaign_id: string
          current_plays_7d: number
          last_captured_at: string
          radio_delta: number
          spotify_track_id: string
          start_captured_at: string
          start_plays_7d: number
        }[]
      }
      get_community_invite_by_code: {
        Args: { p_code: string }
        Returns: {
          email: string
          expires_at: string
          id: string
          invited_by_name: string
          status: string
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
      get_spotify_app_for_playlist: {
        Args: { p_playlist_id: string }
        Returns: {
          app_id: string
          app_name: string
          app_status: string
          auth_failure_count: number
          blocked_until: string
          circuit_status: string
          level: string
          playlists_count: number
          retry_after_sec: number
        }[]
      }
      get_spotify_apps_status: {
        Args: never
        Returns: {
          app_id: string
          app_name: string
          app_status: string
          auth_failure_count: number
          blocked_until: string
          circuit_status: string
          last_429_at: string
          level: string
          playlists_count: number
          quarantined_until: string
          retry_after_sec: number
        }[]
      }
      get_spotify_token_status: {
        Args: never
        Returns: {
          expired: boolean
          expires_at: string
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
      infer_collection_mode: { Args: { p_deal_id: string }; Returns: string }
      ingest_campaign_collection_batch: {
        Args: {
          p_campaign_id: string
          p_intent: string
          p_rows: Json
          p_snapshot_run_id?: string
        }
        Returns: Json
      }
      is_admin: { Args: never; Returns: boolean }
      is_current_user_admin: { Args: never; Returns: boolean }
      is_internal_operator: { Args: never; Returns: boolean }
      is_operador_or_above: { Args: never; Returns: boolean }
      is_playlist_action_blocked: {
        Args: {
          _action: Database["public"]["Enums"]["curatorial_action_type"]
          _playlist_id: string
        }
        Returns: boolean
      }
      is_playlist_in_deal_baseline:
        | {
            Args: { p_deal_id: string; p_spotify_playlist_id: string }
            Returns: boolean
          }
        | {
            Args: {
              p_deal_id: string
              p_song_id?: string
              p_spotify_playlist_id: string
            }
            Returns: boolean
          }
      list_campaign_plan_versions_by_token: {
        Args: { p_token: string }
        Returns: {
          created_at: string
          goal_plays: number
          id: string
          requested_by: string
          requested_message: string
          snapshot: Json
          total_allocated: number
          valor_cobrado: number
          version: number
        }[]
      }
      log_ai_usage: {
        Args: {
          p_duration_ms?: number
          p_error?: string
          p_function_name: string
          p_metadata?: Json
          p_model?: string
          p_provider?: string
          p_status?: string
          p_tokens_in?: number
          p_tokens_out?: number
          p_tokens_total?: number
          p_user_id: string
        }
        Returns: string
      }
      map_adjustment_to_curatorial: {
        Args: { _action_type: string }
        Returns: Database["public"]["Enums"]["curatorial_action_type"]
      }
      mark_spotify_app_auth_failure: {
        Args: { p_app_id: string; p_reason: string; p_retry_after_sec?: number }
        Returns: Json
      }
      match_curator_campaign_playlists: {
        Args: { p_campaign_id: string }
        Returns: Json
      }
      match_curator_playlist: {
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
      monitor_cron_http_failures: { Args: never; Returns: number }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      normalize_playlist_name: { Args: { p_name: string }; Returns: string }
      notify_baseline_missing: {
        Args: { p_deal_id: string }
        Returns: undefined
      }
      notify_member: {
        Args: {
          p_action_url?: string
          p_dedupe?: string
          p_message: string
          p_meta?: Json
          p_title: string
          p_type: string
          p_user: string
        }
        Returns: string
      }
      pick_next_account: {
        Args: { p_app_id?: string; p_purpose?: string }
        Returns: {
          account_id: string
          app_id: string
          slots_remaining: number
          spotify_user_id: string
        }[]
      }
      priority_from_performance: {
        Args: { p_class: string }
        Returns: {
          priority: string
          reason: string
        }[]
      }
      purge_bot_heartbeats: { Args: never; Returns: number }
      purge_cron_job_run_details: { Args: never; Returns: undefined }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      reap_zombie_playlist_jobs: { Args: never; Returns: number }
      recalc_campaign_progress: {
        Args: { p_campaign_id?: string }
        Returns: number
      }
      recalc_curator_deal_baseline_from_spreadsheet: {
        Args: { p_deal_id: string }
        Returns: Json
      }
      recalc_curator_performance_scores: {
        Args: never
        Returns: {
          curator_id: string
          deals_count: number
          score: number
        }[]
      }
      recalc_playlist_scores: { Args: never; Returns: number }
      recompute_campaign_total_delivered: {
        Args: { p_campaign_id: string }
        Returns: undefined
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
      recover_stuck_auto_collect: { Args: never; Returns: number }
      recover_stuck_print_batches: {
        Args: never
        Returns: {
          batch_id: string
          deal_id: string
          print_urls: Json
          song_id: string
        }[]
      }
      refresh_genre_capacity_matrix: { Args: never; Returns: Json }
      reset_spotify_app_auth_failures: {
        Args: { p_app_id: string }
        Returns: undefined
      }
      resolve_client_token: {
        Args: { _token: string }
        Returns: {
          deal_id: string
          has_spotify: boolean
          song_id: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      slugify: { Args: { p_text: string }; Returns: string }
      spotify_app_slugify: { Args: { input: string }; Returns: string }
      suggest_campaign_playlists: {
        Args: { p_deadline: string; p_exclude_active?: boolean; p_goal: number }
        Returns: {
          campaigns_count: number
          capacity_score: number
          composite_score: number
          cover_url: string
          delivery_score: number
          expected_delivery: number
          followers: number
          fulfillment_rate: number
          health_score: number
          playlist_id: string
          playlist_name: string
          risk_score: number
          suggested_target: number
          suggested_weight: number
        }[]
      }
      sync_campaign_curator_playlist_attribution: {
        Args: { p_campaign_id: string; p_playlist_id?: string }
        Returns: number
      }
      sync_tier_cold_ids: {
        Args: {
          p_cutoff_alloc: string
          p_cutoff_imported: string
          p_cutoff_metrics: string
          p_limit: number
        }
        Returns: {
          id: string
        }[]
      }
      sync_tier_hot_ids: {
        Args: { p_cutoff: string; p_limit: number }
        Returns: {
          id: string
        }[]
      }
      sync_tier_warm_ids: {
        Args: {
          p_cutoff_alloc: string
          p_cutoff_imported: string
          p_cutoff_metrics: string
          p_limit: number
        }
        Returns: {
          id: string
        }[]
      }
      trigger_recalc_playlist_scores: { Args: never; Returns: number }
      unaccent: { Args: { "": string }; Returns: string }
    }
    Enums: {
      app_role: "admin" | "curador" | "operador"
      curatorial_action_type:
        | "cover"
        | "description"
        | "tracks_light"
        | "tracks_recycle"
        | "structural"
      curatorial_state:
        | "saudavel"
        | "observacao"
        | "leve"
        | "moderada"
        | "estrutural"
        | "cooldown"
      followers_source_type: "spotify_api"
      impact_verdict:
        | "pending"
        | "positive"
        | "neutral"
        | "negative"
        | "inconclusive"
      notification_type: "critical" | "warning" | "info"
      organic_play_kind: "algorithmic" | "organic" | "editorial"
      playlist_execution_mode: "API_READY" | "MANUAL_ONLY" | "DISABLED"
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
      app_role: ["admin", "curador", "operador"],
      curatorial_action_type: [
        "cover",
        "description",
        "tracks_light",
        "tracks_recycle",
        "structural",
      ],
      curatorial_state: [
        "saudavel",
        "observacao",
        "leve",
        "moderada",
        "estrutural",
        "cooldown",
      ],
      followers_source_type: ["spotify_api"],
      impact_verdict: [
        "pending",
        "positive",
        "neutral",
        "negative",
        "inconclusive",
      ],
      notification_type: ["critical", "warning", "info"],
      organic_play_kind: ["algorithmic", "organic", "editorial"],
      playlist_execution_mode: ["API_READY", "MANUAL_ONLY", "DISABLED"],
    },
  },
} as const
