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
      _audit_pre_window_migration: {
        Row: {
          campaign_id: string
          captured_at: string
          curador_eco_pre: number | null
          observed_pre: number | null
          track_name: string | null
        }
        Insert: {
          campaign_id: string
          captured_at?: string
          curador_eco_pre?: number | null
          observed_pre?: number | null
          track_name?: string | null
        }
        Update: {
          campaign_id?: string
          captured_at?: string
          curador_eco_pre?: number | null
          observed_pre?: number | null
          track_name?: string | null
        }
        Relationships: []
      }
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
      _spotify_apps_caps_snapshots: {
        Row: {
          app_id: string
          app_name: string
          id: string
          lifecycle_state: string | null
          max_accounts: number | null
          max_playlists: number | null
          reason: string | null
          soft_capacity_cap: number | null
          taken_at: string
        }
        Insert: {
          app_id: string
          app_name: string
          id?: string
          lifecycle_state?: string | null
          max_accounts?: number | null
          max_playlists?: number | null
          reason?: string | null
          soft_capacity_cap?: number | null
          taken_at?: string
        }
        Update: {
          app_id?: string
          app_name?: string
          id?: string
          lifecycle_state?: string | null
          max_accounts?: number | null
          max_playlists?: number | null
          reason?: string | null
          soft_capacity_cap?: number | null
          taken_at?: string
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
      analysis_snapshot_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          payload: Json
          playlist_id: string
          snapshot_id: string
          step: Database["public"]["Enums"]["analysis_snapshot_step"] | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          payload?: Json
          playlist_id: string
          snapshot_id: string
          step?: Database["public"]["Enums"]["analysis_snapshot_step"] | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          playlist_id?: string
          snapshot_id?: string
          step?: Database["public"]["Enums"]["analysis_snapshot_step"] | null
        }
        Relationships: [
          {
            foreignKeyName: "analysis_snapshot_events_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "analysis_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      analysis_snapshot_results: {
        Row: {
          created_at: string
          duration_ms: number | null
          error: string | null
          finished_at: string | null
          id: string
          last_retry_at: string | null
          max_retry: number
          metrics: Json
          result: Json
          retry_count: number
          snapshot_id: string
          started_at: string | null
          status: Database["public"]["Enums"]["analysis_step_status"]
          step: Database["public"]["Enums"]["analysis_snapshot_step"]
          timeout_seconds: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          id?: string
          last_retry_at?: string | null
          max_retry?: number
          metrics?: Json
          result?: Json
          retry_count?: number
          snapshot_id: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["analysis_step_status"]
          step: Database["public"]["Enums"]["analysis_snapshot_step"]
          timeout_seconds?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          id?: string
          last_retry_at?: string | null
          max_retry?: number
          metrics?: Json
          result?: Json
          retry_count?: number
          snapshot_id?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["analysis_step_status"]
          step?: Database["public"]["Enums"]["analysis_snapshot_step"]
          timeout_seconds?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "analysis_snapshot_results_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "analysis_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      analysis_snapshots: {
        Row: {
          created_at: string
          dna_version: string | null
          event_hash: string | null
          failed_at: string | null
          failure_reason: string | null
          genre_brain_version: string | null
          id: string
          idempotency_key: string | null
          market_version: string | null
          metrics: Json
          pending_event_id: string | null
          playlist_id: string
          ready_at: string | null
          request_hash: string | null
          started_at: string
          status: Database["public"]["Enums"]["analysis_snapshot_status"]
          strategy_version: string | null
          superseded_by: string | null
          tracks_hash: string | null
          trigger_event: Database["public"]["Enums"]["analysis_snapshot_trigger"]
          trigger_payload: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          dna_version?: string | null
          event_hash?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          genre_brain_version?: string | null
          id?: string
          idempotency_key?: string | null
          market_version?: string | null
          metrics?: Json
          pending_event_id?: string | null
          playlist_id: string
          ready_at?: string | null
          request_hash?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["analysis_snapshot_status"]
          strategy_version?: string | null
          superseded_by?: string | null
          tracks_hash?: string | null
          trigger_event: Database["public"]["Enums"]["analysis_snapshot_trigger"]
          trigger_payload?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          dna_version?: string | null
          event_hash?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          genre_brain_version?: string | null
          id?: string
          idempotency_key?: string | null
          market_version?: string | null
          metrics?: Json
          pending_event_id?: string | null
          playlist_id?: string
          ready_at?: string | null
          request_hash?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["analysis_snapshot_status"]
          strategy_version?: string | null
          superseded_by?: string | null
          tracks_hash?: string | null
          trigger_event?: Database["public"]["Enums"]["analysis_snapshot_trigger"]
          trigger_payload?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "analysis_snapshots_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "managed_playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analysis_snapshots_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_playlist_occupancy"
            referencedColumns: ["managed_playlist_id"]
          },
          {
            foreignKeyName: "analysis_snapshots_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "v_playlist_vps_assignment"
            referencedColumns: ["managed_playlist_id"]
          },
          {
            foreignKeyName: "analysis_snapshots_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "analysis_snapshots"
            referencedColumns: ["id"]
          },
        ]
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
      audit_log: {
        Row: {
          actor_id: string | null
          actor_role: string | null
          after_data: Json | null
          before_data: Json | null
          correlation_id: string | null
          created_at: string
          diff_keys: string[] | null
          id: string
          occurred_at: string
          operation: string
          row_pk: string | null
          source: string | null
          table_name: string
        }
        Insert: {
          actor_id?: string | null
          actor_role?: string | null
          after_data?: Json | null
          before_data?: Json | null
          correlation_id?: string | null
          created_at?: string
          diff_keys?: string[] | null
          id?: string
          occurred_at?: string
          operation: string
          row_pk?: string | null
          source?: string | null
          table_name: string
        }
        Update: {
          actor_id?: string | null
          actor_role?: string | null
          after_data?: Json | null
          before_data?: Json | null
          correlation_id?: string | null
          created_at?: string
          diff_keys?: string[] | null
          id?: string
          occurred_at?: string
          operation?: string
          row_pk?: string | null
          source?: string | null
          table_name?: string
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
            referencedRelation: "v_campaign_overview"
            referencedColumns: ["campaign_id"]
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
            referencedRelation: "v_campaign_overview"
            referencedColumns: ["campaign_id"]
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
          blocked_at: string | null
          campaign_id: string
          code: string
          created_at: string
          email: string
          expires_at: string
          failed_attempts: number
          id: string
          used_at: string | null
        }
        Insert: {
          blocked_at?: string | null
          campaign_id: string
          code: string
          created_at?: string
          email: string
          expires_at?: string
          failed_attempts?: number
          id?: string
          used_at?: string | null
        }
        Update: {
          blocked_at?: string | null
          campaign_id?: string
          code?: string
          created_at?: string
          email?: string
          expires_at?: string
          failed_attempts?: number
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
            referencedRelation: "v_campaign_overview"
            referencedColumns: ["campaign_id"]
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
            referencedRelation: "v_campaign_overview"
            referencedColumns: ["campaign_id"]
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
            referencedRelation: "v_catalog_playlist_occupancy"
            referencedColumns: ["managed_playlist_id"]
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
            referencedRelation: "v_campaign_overview"
            referencedColumns: ["campaign_id"]
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
            referencedRelation: "v_catalog_playlist_occupancy"
            referencedColumns: ["managed_playlist_id"]
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
            referencedRelation: "v_campaign_overview"
            referencedColumns: ["campaign_id"]
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
            referencedRelation: "v_campaign_overview"
            referencedColumns: ["campaign_id"]
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
            referencedRelation: "v_campaign_overview"
            referencedColumns: ["campaign_id"]
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
          correlation_id: string | null
          created_at: string
          excluded: boolean
          exclusion_reason: string | null
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
          upload_id: string | null
          window_days: number
        }
        Insert: {
          campaign_id: string
          captured_at?: string
          collection_run_id?: string | null
          correlation_id?: string | null
          created_at?: string
          excluded?: boolean
          exclusion_reason?: string | null
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
          upload_id?: string | null
          window_days?: number
        }
        Update: {
          campaign_id?: string
          captured_at?: string
          collection_run_id?: string | null
          correlation_id?: string | null
          created_at?: string
          excluded?: boolean
          exclusion_reason?: string | null
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
          upload_id?: string | null
          window_days?: number
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
            referencedRelation: "v_campaign_overview"
            referencedColumns: ["campaign_id"]
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
          {
            foreignKeyName: "campaign_playlist_collections_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "label_spreadsheet_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          artist: string | null
          auto_deal_created: boolean
          baseline_captured_at: string | null
          baseline_reference_date: string | null
          baseline_status: string
          campaign_type: string
          canonical_window_days: number
          catalog_track_id: string | null
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
          baseline_reference_date?: string | null
          baseline_status?: string
          campaign_type?: string
          canonical_window_days?: number
          catalog_track_id?: string | null
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
          baseline_reference_date?: string | null
          baseline_status?: string
          campaign_type?: string
          canonical_window_days?: number
          catalog_track_id?: string | null
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
            foreignKeyName: "campaigns_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "catalog_tracks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_distribution_stats"
            referencedColumns: ["catalog_track_id"]
          },
          {
            foreignKeyName: "campaigns_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_performance"
            referencedColumns: ["catalog_track_id"]
          },
          {
            foreignKeyName: "campaigns_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_telemetry"
            referencedColumns: ["catalog_track_id"]
          },
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
      catalog_distribution_batches: {
        Row: {
          catalog_track_id: string
          created_at: string
          id: string
          placements_created: number
          skipped_already_present: number
          skipped_no_capacity: number
          total_eligible_playlists: number
          triggered_by: string | null
        }
        Insert: {
          catalog_track_id: string
          created_at?: string
          id?: string
          placements_created?: number
          skipped_already_present?: number
          skipped_no_capacity?: number
          total_eligible_playlists?: number
          triggered_by?: string | null
        }
        Update: {
          catalog_track_id?: string
          created_at?: string
          id?: string
          placements_created?: number
          skipped_already_present?: number
          skipped_no_capacity?: number
          total_eligible_playlists?: number
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_distribution_batches_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "catalog_tracks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_distribution_batches_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_distribution_stats"
            referencedColumns: ["catalog_track_id"]
          },
          {
            foreignKeyName: "catalog_distribution_batches_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_performance"
            referencedColumns: ["catalog_track_id"]
          },
          {
            foreignKeyName: "catalog_distribution_batches_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_telemetry"
            referencedColumns: ["catalog_track_id"]
          },
        ]
      }
      catalog_distribution_plan_targets: {
        Row: {
          catalog_track_id: string
          created_at: string
          distributed_at: string | null
          id: string
          managed_playlist_id: string
          placement_id: string | null
          plan_id: string
          scheduled_for: string
          skip_reason: string | null
          status: string
          updated_at: string
        }
        Insert: {
          catalog_track_id: string
          created_at?: string
          distributed_at?: string | null
          id?: string
          managed_playlist_id: string
          placement_id?: string | null
          plan_id: string
          scheduled_for: string
          skip_reason?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          catalog_track_id?: string
          created_at?: string
          distributed_at?: string | null
          id?: string
          managed_playlist_id?: string
          placement_id?: string | null
          plan_id?: string
          scheduled_for?: string
          skip_reason?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_distribution_plan_targets_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "catalog_tracks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_distribution_plan_targets_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_distribution_stats"
            referencedColumns: ["catalog_track_id"]
          },
          {
            foreignKeyName: "catalog_distribution_plan_targets_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_performance"
            referencedColumns: ["catalog_track_id"]
          },
          {
            foreignKeyName: "catalog_distribution_plan_targets_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_telemetry"
            referencedColumns: ["catalog_track_id"]
          },
          {
            foreignKeyName: "catalog_distribution_plan_targets_managed_playlist_id_fkey"
            columns: ["managed_playlist_id"]
            isOneToOne: false
            referencedRelation: "managed_playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_distribution_plan_targets_managed_playlist_id_fkey"
            columns: ["managed_playlist_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_playlist_occupancy"
            referencedColumns: ["managed_playlist_id"]
          },
          {
            foreignKeyName: "catalog_distribution_plan_targets_managed_playlist_id_fkey"
            columns: ["managed_playlist_id"]
            isOneToOne: false
            referencedRelation: "v_playlist_vps_assignment"
            referencedColumns: ["managed_playlist_id"]
          },
          {
            foreignKeyName: "catalog_distribution_plan_targets_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "catalog_distribution_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_distribution_plan_targets_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_distribution_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_distribution_plans: {
        Row: {
          catalog_track_id: string
          completed_at: string | null
          created_at: string
          daily_quota: number
          expected_end_at: string | null
          id: string
          next_wave_at: string | null
          notes: string | null
          priority: number
          started_at: string
          status: string
          total_distributed: number
          total_eligible: number
          total_skipped: number
          updated_at: string
          window_days: number
        }
        Insert: {
          catalog_track_id: string
          completed_at?: string | null
          created_at?: string
          daily_quota?: number
          expected_end_at?: string | null
          id?: string
          next_wave_at?: string | null
          notes?: string | null
          priority?: number
          started_at?: string
          status?: string
          total_distributed?: number
          total_eligible?: number
          total_skipped?: number
          updated_at?: string
          window_days?: number
        }
        Update: {
          catalog_track_id?: string
          completed_at?: string | null
          created_at?: string
          daily_quota?: number
          expected_end_at?: string | null
          id?: string
          next_wave_at?: string | null
          notes?: string | null
          priority?: number
          started_at?: string
          status?: string
          total_distributed?: number
          total_eligible?: number
          total_skipped?: number
          updated_at?: string
          window_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "catalog_distribution_plans_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "catalog_tracks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_distribution_plans_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_distribution_stats"
            referencedColumns: ["catalog_track_id"]
          },
          {
            foreignKeyName: "catalog_distribution_plans_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_performance"
            referencedColumns: ["catalog_track_id"]
          },
          {
            foreignKeyName: "catalog_distribution_plans_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_telemetry"
            referencedColumns: ["catalog_track_id"]
          },
        ]
      }
      catalog_inflight: {
        Row: {
          caller: string | null
          endpoint: string
          expires_at: string
          id: string
          resource_id: string
          resource_key: string
          started_at: string
          status: string
        }
        Insert: {
          caller?: string | null
          endpoint: string
          expires_at?: string
          id?: string
          resource_id: string
          resource_key: string
          started_at?: string
          status?: string
        }
        Update: {
          caller?: string | null
          endpoint?: string
          expires_at?: string
          id?: string
          resource_id?: string
          resource_key?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      catalog_placement_execution_log: {
        Row: {
          catalog_track_id: string
          error_code: string | null
          error_message: string | null
          executed_at: string
          id: string
          managed_playlist_id: string
          outcome: string
          placement_id: string
          position: number | null
          snapshot_id: string | null
          spotify_playlist_id: string | null
          spotify_track_id: string | null
        }
        Insert: {
          catalog_track_id: string
          error_code?: string | null
          error_message?: string | null
          executed_at?: string
          id?: string
          managed_playlist_id: string
          outcome: string
          placement_id: string
          position?: number | null
          snapshot_id?: string | null
          spotify_playlist_id?: string | null
          spotify_track_id?: string | null
        }
        Update: {
          catalog_track_id?: string
          error_code?: string | null
          error_message?: string | null
          executed_at?: string
          id?: string
          managed_playlist_id?: string
          outcome?: string
          placement_id?: string
          position?: number | null
          snapshot_id?: string | null
          spotify_playlist_id?: string | null
          spotify_track_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_placement_execution_log_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "catalog_tracks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_placement_execution_log_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_distribution_stats"
            referencedColumns: ["catalog_track_id"]
          },
          {
            foreignKeyName: "catalog_placement_execution_log_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_performance"
            referencedColumns: ["catalog_track_id"]
          },
          {
            foreignKeyName: "catalog_placement_execution_log_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_telemetry"
            referencedColumns: ["catalog_track_id"]
          },
          {
            foreignKeyName: "catalog_placement_execution_log_managed_playlist_id_fkey"
            columns: ["managed_playlist_id"]
            isOneToOne: false
            referencedRelation: "managed_playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_placement_execution_log_managed_playlist_id_fkey"
            columns: ["managed_playlist_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_playlist_occupancy"
            referencedColumns: ["managed_playlist_id"]
          },
          {
            foreignKeyName: "catalog_placement_execution_log_managed_playlist_id_fkey"
            columns: ["managed_playlist_id"]
            isOneToOne: false
            referencedRelation: "v_playlist_vps_assignment"
            referencedColumns: ["managed_playlist_id"]
          },
          {
            foreignKeyName: "catalog_placement_execution_log_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "catalog_placements"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_placements: {
        Row: {
          added_at: string | null
          attempts: number
          catalog_track_id: string
          created_at: string
          distribution_batch_id: string | null
          id: string
          last_error_code: string | null
          lease_expires_at: string | null
          locked_at: string | null
          locked_by: string | null
          managed_playlist_id: string
          max_attempts: number
          origin: string
          position: number | null
          priority: number
          removed_at: string | null
          removed_reason: string | null
          scheduled_for: string
          skip_reason: string | null
          skipped_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          added_at?: string | null
          attempts?: number
          catalog_track_id: string
          created_at?: string
          distribution_batch_id?: string | null
          id?: string
          last_error_code?: string | null
          lease_expires_at?: string | null
          locked_at?: string | null
          locked_by?: string | null
          managed_playlist_id: string
          max_attempts?: number
          origin?: string
          position?: number | null
          priority?: number
          removed_at?: string | null
          removed_reason?: string | null
          scheduled_for?: string
          skip_reason?: string | null
          skipped_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          added_at?: string | null
          attempts?: number
          catalog_track_id?: string
          created_at?: string
          distribution_batch_id?: string | null
          id?: string
          last_error_code?: string | null
          lease_expires_at?: string | null
          locked_at?: string | null
          locked_by?: string | null
          managed_playlist_id?: string
          max_attempts?: number
          origin?: string
          position?: number | null
          priority?: number
          removed_at?: string | null
          removed_reason?: string | null
          scheduled_for?: string
          skip_reason?: string | null
          skipped_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_placements_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "catalog_tracks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_placements_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_distribution_stats"
            referencedColumns: ["catalog_track_id"]
          },
          {
            foreignKeyName: "catalog_placements_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_performance"
            referencedColumns: ["catalog_track_id"]
          },
          {
            foreignKeyName: "catalog_placements_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_telemetry"
            referencedColumns: ["catalog_track_id"]
          },
          {
            foreignKeyName: "catalog_placements_distribution_batch_id_fkey"
            columns: ["distribution_batch_id"]
            isOneToOne: false
            referencedRelation: "catalog_distribution_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_placements_managed_playlist_id_fkey"
            columns: ["managed_playlist_id"]
            isOneToOne: false
            referencedRelation: "managed_playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_placements_managed_playlist_id_fkey"
            columns: ["managed_playlist_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_playlist_occupancy"
            referencedColumns: ["managed_playlist_id"]
          },
          {
            foreignKeyName: "catalog_placements_managed_playlist_id_fkey"
            columns: ["managed_playlist_id"]
            isOneToOne: false
            referencedRelation: "v_playlist_vps_assignment"
            referencedColumns: ["managed_playlist_id"]
          },
        ]
      }
      catalog_snapshot_queue: {
        Row: {
          attempts: number
          catalog_track_id: string
          completed_snapshot_id: string | null
          created_at: string
          id: string
          last_error: string | null
          last_error_at: string | null
          lease_expires_at: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          priority: number
          reason: string
          scheduled_for: string
          spotify_track_id: string
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          catalog_track_id: string
          completed_snapshot_id?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          last_error_at?: string | null
          lease_expires_at?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          priority?: number
          reason?: string
          scheduled_for?: string
          spotify_track_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          catalog_track_id?: string
          completed_snapshot_id?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          last_error_at?: string | null
          lease_expires_at?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          priority?: number
          reason?: string
          scheduled_for?: string
          spotify_track_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_snapshot_queue_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "catalog_tracks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_snapshot_queue_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_distribution_stats"
            referencedColumns: ["catalog_track_id"]
          },
          {
            foreignKeyName: "catalog_snapshot_queue_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_performance"
            referencedColumns: ["catalog_track_id"]
          },
          {
            foreignKeyName: "catalog_snapshot_queue_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_telemetry"
            referencedColumns: ["catalog_track_id"]
          },
          {
            foreignKeyName: "catalog_snapshot_queue_completed_snapshot_id_fkey"
            columns: ["completed_snapshot_id"]
            isOneToOne: false
            referencedRelation: "song_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_track_baselines: {
        Row: {
          captured_at: string
          catalog_track_id: string
          created_at: string
          id: string
          monthly_listeners: number | null
          popularity: number | null
          raw_payload: Json | null
          streams: number | null
        }
        Insert: {
          captured_at?: string
          catalog_track_id: string
          created_at?: string
          id?: string
          monthly_listeners?: number | null
          popularity?: number | null
          raw_payload?: Json | null
          streams?: number | null
        }
        Update: {
          captured_at?: string
          catalog_track_id?: string
          created_at?: string
          id?: string
          monthly_listeners?: number | null
          popularity?: number | null
          raw_payload?: Json | null
          streams?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_track_baselines_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: true
            referencedRelation: "catalog_tracks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_track_baselines_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: true
            referencedRelation: "v_catalog_track_distribution_stats"
            referencedColumns: ["catalog_track_id"]
          },
          {
            foreignKeyName: "catalog_track_baselines_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: true
            referencedRelation: "v_catalog_track_performance"
            referencedColumns: ["catalog_track_id"]
          },
          {
            foreignKeyName: "catalog_track_baselines_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: true
            referencedRelation: "v_catalog_track_telemetry"
            referencedColumns: ["catalog_track_id"]
          },
        ]
      }
      catalog_track_snapshots: {
        Row: {
          artist_followers: number | null
          catalog_track_id: string
          created_at: string
          id: string
          monthly_listeners: number | null
          snapshot_date: string
          spotify_followers: number | null
          spotify_popularity: number | null
        }
        Insert: {
          artist_followers?: number | null
          catalog_track_id: string
          created_at?: string
          id?: string
          monthly_listeners?: number | null
          snapshot_date?: string
          spotify_followers?: number | null
          spotify_popularity?: number | null
        }
        Update: {
          artist_followers?: number | null
          catalog_track_id?: string
          created_at?: string
          id?: string
          monthly_listeners?: number | null
          snapshot_date?: string
          spotify_followers?: number | null
          spotify_popularity?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_track_snapshots_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "catalog_tracks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_track_snapshots_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_distribution_stats"
            referencedColumns: ["catalog_track_id"]
          },
          {
            foreignKeyName: "catalog_track_snapshots_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_performance"
            referencedColumns: ["catalog_track_id"]
          },
          {
            foreignKeyName: "catalog_track_snapshots_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_telemetry"
            referencedColumns: ["catalog_track_id"]
          },
        ]
      }
      catalog_tracks: {
        Row: {
          added_at: string
          added_by: string | null
          artist_name: string
          auto_collect_interval_minutes: number
          cover_url: string | null
          created_at: string
          genre_id: string | null
          id: string
          isrc: string | null
          last_auto_collect_at: string | null
          next_auto_collect_at: string | null
          notes: string | null
          spotify_artist_id: string | null
          spotify_track_id: string
          spotify_uri: string | null
          status: string
          track_name: string
          updated_at: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          artist_name: string
          auto_collect_interval_minutes?: number
          cover_url?: string | null
          created_at?: string
          genre_id?: string | null
          id?: string
          isrc?: string | null
          last_auto_collect_at?: string | null
          next_auto_collect_at?: string | null
          notes?: string | null
          spotify_artist_id?: string | null
          spotify_track_id: string
          spotify_uri?: string | null
          status?: string
          track_name: string
          updated_at?: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          artist_name?: string
          auto_collect_interval_minutes?: number
          cover_url?: string | null
          created_at?: string
          genre_id?: string | null
          id?: string
          isrc?: string | null
          last_auto_collect_at?: string | null
          next_auto_collect_at?: string | null
          notes?: string | null
          spotify_artist_id?: string | null
          spotify_track_id?: string
          spotify_uri?: string | null
          status?: string
          track_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_tracks_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_tracks_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres_with_health"
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
      client_error_log: {
        Row: {
          breadcrumbs: Json
          browser: string | null
          colno: number | null
          commit_sha: string | null
          component: string | null
          correlation_id: string | null
          created_at: string
          id: string
          lineno: number | null
          message: string
          metadata: Json
          release: string | null
          route_from: string | null
          route_to: string | null
          session_ms: number | null
          source: string | null
          stack: string | null
          url: string | null
          user_action: string | null
          user_agent: string | null
          user_id: string | null
          viewport: string | null
        }
        Insert: {
          breadcrumbs?: Json
          browser?: string | null
          colno?: number | null
          commit_sha?: string | null
          component?: string | null
          correlation_id?: string | null
          created_at?: string
          id?: string
          lineno?: number | null
          message: string
          metadata?: Json
          release?: string | null
          route_from?: string | null
          route_to?: string | null
          session_ms?: number | null
          source?: string | null
          stack?: string | null
          url?: string | null
          user_action?: string | null
          user_agent?: string | null
          user_id?: string | null
          viewport?: string | null
        }
        Update: {
          breadcrumbs?: Json
          browser?: string | null
          colno?: number | null
          commit_sha?: string | null
          component?: string | null
          correlation_id?: string | null
          created_at?: string
          id?: string
          lineno?: number | null
          message?: string
          metadata?: Json
          release?: string | null
          route_from?: string | null
          route_to?: string | null
          session_ms?: number | null
          source?: string | null
          stack?: string | null
          url?: string | null
          user_action?: string | null
          user_agent?: string | null
          user_id?: string | null
          viewport?: string | null
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
          correlation_id: string | null
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
          correlation_id?: string | null
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
          correlation_id?: string | null
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
      cron_run_log: {
        Row: {
          correlation_id: string | null
          created_at: string
          cron_name: string
          duration_ms: number | null
          error_message: string | null
          finished_at: string | null
          id: string
          next_run_at: string | null
          payload: Json | null
          retries: number
          started_at: string
          success: boolean | null
        }
        Insert: {
          correlation_id?: string | null
          created_at?: string
          cron_name: string
          duration_ms?: number | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          next_run_at?: string | null
          payload?: Json | null
          retries?: number
          started_at?: string
          success?: boolean | null
        }
        Update: {
          correlation_id?: string | null
          created_at?: string
          cron_name?: string
          duration_ms?: number | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          next_run_at?: string | null
          payload?: Json | null
          retries?: number
          started_at?: string
          success?: boolean | null
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
          blocked_at: string | null
          code: string
          created_at: string
          deal_id: string
          email: string
          expires_at: string
          failed_attempts: number
          id: string
          used_at: string | null
        }
        Insert: {
          blocked_at?: string | null
          code: string
          created_at?: string
          deal_id: string
          email: string
          expires_at?: string
          failed_attempts?: number
          id?: string
          used_at?: string | null
        }
        Update: {
          blocked_at?: string | null
          code?: string
          created_at?: string
          deal_id?: string
          email?: string
          expires_at?: string
          failed_attempts?: number
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
            referencedRelation: "v_campaign_overview"
            referencedColumns: ["campaign_id"]
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
          correlation_id: string | null
          created_at: string
          deal_id: string
          id: string
          is_initial_capture_event: boolean
          note: string | null
          print_urls: string[]
          song_id: string | null
          total_plays: number
        }
        Insert: {
          correlation_id?: string | null
          created_at?: string
          deal_id: string
          id?: string
          is_initial_capture_event?: boolean
          note?: string | null
          print_urls?: string[]
          song_id?: string | null
          total_plays: number
        }
        Update: {
          correlation_id?: string | null
          created_at?: string
          deal_id?: string
          id?: string
          is_initial_capture_event?: boolean
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
      curator_deal_plan_archive: {
        Row: {
          archive_id: string
          archive_reason: string
          archived_at: string
          original_id: string
          original_row: Json
        }
        Insert: {
          archive_id?: string
          archive_reason: string
          archived_at?: string
          original_id: string
          original_row: Json
        }
        Update: {
          archive_id?: string
          archive_reason?: string
          archived_at?: string
          original_id?: string
          original_row?: Json
        }
        Relationships: []
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
          is_initial_capture: boolean
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
          is_initial_capture?: boolean
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
          is_initial_capture?: boolean
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
          collect_attempt_count: number
          collect_error_code: string | null
          collect_paused_until: string | null
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
          collect_attempt_count?: number
          collect_error_code?: string | null
          collect_paused_until?: string | null
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
          collect_attempt_count?: number
          collect_error_code?: string | null
          collect_paused_until?: string | null
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
          baseline_reference_date: string | null
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
          external_package_item_id: string | null
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
          baseline_reference_date?: string | null
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
          external_package_item_id?: string | null
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
          baseline_reference_date?: string | null
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
          external_package_item_id?: string | null
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
            referencedRelation: "v_campaign_overview"
            referencedColumns: ["campaign_id"]
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
          {
            foreignKeyName: "curator_deals_external_package_item_id_fkey"
            columns: ["external_package_item_id"]
            isOneToOne: false
            referencedRelation: "campaign_external_package_items"
            referencedColumns: ["id"]
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
          frozen_at: string | null
          frozen_reason: string | null
          id: string
          image_url: string | null
          is_initial_roster: boolean
          is_observational: boolean
          last_paste_at: string | null
          match_reason: string | null
          match_status: string
          playlist_name: string
          position_in_paste: number | null
          promoted_to_ecosystem_at: string | null
          song_id: string | null
          spotify_dead: boolean
          spotify_dead_at: string | null
          spotify_dead_reason: string | null
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
          frozen_at?: string | null
          frozen_reason?: string | null
          id?: string
          image_url?: string | null
          is_initial_roster?: boolean
          is_observational?: boolean
          last_paste_at?: string | null
          match_reason?: string | null
          match_status?: string
          playlist_name: string
          position_in_paste?: number | null
          promoted_to_ecosystem_at?: string | null
          song_id?: string | null
          spotify_dead?: boolean
          spotify_dead_at?: string | null
          spotify_dead_reason?: string | null
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
          frozen_at?: string | null
          frozen_reason?: string | null
          id?: string
          image_url?: string | null
          is_initial_roster?: boolean
          is_observational?: boolean
          last_paste_at?: string | null
          match_reason?: string | null
          match_status?: string
          playlist_name?: string
          position_in_paste?: number | null
          promoted_to_ecosystem_at?: string | null
          song_id?: string | null
          spotify_dead?: boolean
          spotify_dead_at?: string | null
          spotify_dead_reason?: string | null
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
      curator_playlists_archive: {
        Row: {
          archive_id: string
          archive_reason: string
          archived_at: string
          original_id: string
          original_row: Json
        }
        Insert: {
          archive_id?: string
          archive_reason: string
          archived_at?: string
          original_id: string
          original_row: Json
        }
        Update: {
          archive_id?: string
          archive_reason?: string
          archived_at?: string
          original_id?: string
          original_row?: Json
        }
        Relationships: []
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
          {
            foreignKeyName: "curator_purchases_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "curator_deals"
            referencedColumns: ["id"]
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
          correlation_id: string | null
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
          correlation_id?: string | null
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
          correlation_id?: string | null
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
      engine_occupancy_proposals: {
        Row: {
          available_slots_at_run: number | null
          catalog_track_id: string
          created_at: string
          id: string
          managed_playlist_id: string
          match_components: Json | null
          reason: string
          run_id: string
          slot_index: number | null
          status: string
        }
        Insert: {
          available_slots_at_run?: number | null
          catalog_track_id: string
          created_at?: string
          id?: string
          managed_playlist_id: string
          match_components?: Json | null
          reason?: string
          run_id: string
          slot_index?: number | null
          status?: string
        }
        Update: {
          available_slots_at_run?: number | null
          catalog_track_id?: string
          created_at?: string
          id?: string
          managed_playlist_id?: string
          match_components?: Json | null
          reason?: string
          run_id?: string
          slot_index?: number | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "engine_occupancy_proposals_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "catalog_tracks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engine_occupancy_proposals_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_distribution_stats"
            referencedColumns: ["catalog_track_id"]
          },
          {
            foreignKeyName: "engine_occupancy_proposals_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_performance"
            referencedColumns: ["catalog_track_id"]
          },
          {
            foreignKeyName: "engine_occupancy_proposals_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_telemetry"
            referencedColumns: ["catalog_track_id"]
          },
          {
            foreignKeyName: "engine_occupancy_proposals_managed_playlist_id_fkey"
            columns: ["managed_playlist_id"]
            isOneToOne: false
            referencedRelation: "managed_playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engine_occupancy_proposals_managed_playlist_id_fkey"
            columns: ["managed_playlist_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_playlist_occupancy"
            referencedColumns: ["managed_playlist_id"]
          },
          {
            foreignKeyName: "engine_occupancy_proposals_managed_playlist_id_fkey"
            columns: ["managed_playlist_id"]
            isOneToOne: false
            referencedRelation: "v_playlist_vps_assignment"
            referencedColumns: ["managed_playlist_id"]
          },
          {
            foreignKeyName: "engine_occupancy_proposals_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "engine_occupancy_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      engine_occupancy_runs: {
        Row: {
          candidates_considered: number
          error: string | null
          finished_at: string | null
          id: string
          mode: string
          notes: Json | null
          playlists_scanned: number
          playlists_with_gap: number
          proposals_generated: number
          scope_playlist_id: string | null
          started_at: string
        }
        Insert: {
          candidates_considered?: number
          error?: string | null
          finished_at?: string | null
          id?: string
          mode?: string
          notes?: Json | null
          playlists_scanned?: number
          playlists_with_gap?: number
          proposals_generated?: number
          scope_playlist_id?: string | null
          started_at?: string
        }
        Update: {
          candidates_considered?: number
          error?: string | null
          finished_at?: string | null
          id?: string
          mode?: string
          notes?: Json | null
          playlists_scanned?: number
          playlists_with_gap?: number
          proposals_generated?: number
          scope_playlist_id?: string | null
          started_at?: string
        }
        Relationships: []
      }
      engine_priority_runs: {
        Row: {
          components_used: Json
          created_at: string
          duration_ms: number | null
          errors: number
          finished_at: string | null
          id: string
          notes: string | null
          placements_evaluated: number
          score_avg: number | null
          score_max: number | null
          score_min: number | null
          score_p50: number | null
          score_p90: number | null
          started_at: string
          triggered_by: string
        }
        Insert: {
          components_used?: Json
          created_at?: string
          duration_ms?: number | null
          errors?: number
          finished_at?: string | null
          id?: string
          notes?: string | null
          placements_evaluated?: number
          score_avg?: number | null
          score_max?: number | null
          score_min?: number | null
          score_p50?: number | null
          score_p90?: number | null
          started_at?: string
          triggered_by?: string
        }
        Update: {
          components_used?: Json
          created_at?: string
          duration_ms?: number | null
          errors?: number
          finished_at?: string | null
          id?: string
          notes?: string | null
          placements_evaluated?: number
          score_avg?: number | null
          score_max?: number | null
          score_min?: number | null
          score_p50?: number | null
          score_p90?: number | null
          started_at?: string
          triggered_by?: string
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
      genre_aliases: {
        Row: {
          alias: string
          created_at: string
          genre_id: string
        }
        Insert: {
          alias: string
          created_at?: string
          genre_id: string
        }
        Update: {
          alias?: string
          created_at?: string
          genre_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "genre_aliases_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "genre_aliases_genre_id_fkey"
            columns: ["genre_id"]
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
      genre_editorial_policy_defaults: {
        Row: {
          campaign_reserved_slots: number
          catalog_capacity: number
          created_at: string
          genre_id: string
          id: string
          intercalation_ratio: number
          notes: string | null
          operational_ceiling: number
          protect_top_n: number
          third_party_max_pct: number
          updated_at: string
        }
        Insert: {
          campaign_reserved_slots?: number
          catalog_capacity?: number
          created_at?: string
          genre_id: string
          id?: string
          intercalation_ratio?: number
          notes?: string | null
          operational_ceiling?: number
          protect_top_n?: number
          third_party_max_pct?: number
          updated_at?: string
        }
        Update: {
          campaign_reserved_slots?: number
          catalog_capacity?: number
          created_at?: string
          genre_id?: string
          id?: string
          intercalation_ratio?: number
          notes?: string | null
          operational_ceiling?: number
          protect_top_n?: number
          third_party_max_pct?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "genre_editorial_policy_defaults_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: true
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "genre_editorial_policy_defaults_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: true
            referencedRelation: "genres_with_health"
            referencedColumns: ["id"]
          },
        ]
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
      health_probes: {
        Row: {
          correlation_id: string | null
          created_at: string
          id: string
          last_error_at: string | null
          last_error_msg: string | null
          last_success_at: string | null
          latency_ms: number | null
          metadata: Json
          probe_name: string
          status: string
          subsystem: string
        }
        Insert: {
          correlation_id?: string | null
          created_at?: string
          id?: string
          last_error_at?: string | null
          last_error_msg?: string | null
          last_success_at?: string | null
          latency_ms?: number | null
          metadata?: Json
          probe_name: string
          status: string
          subsystem: string
        }
        Update: {
          correlation_id?: string | null
          created_at?: string
          id?: string
          last_error_at?: string | null
          last_error_msg?: string | null
          last_success_at?: string | null
          latency_ms?: number | null
          metadata?: Json
          probe_name?: string
          status?: string
          subsystem?: string
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
          quarantine_reason: string | null
          quarantine_signals: Json | null
          quarantined_at: string | null
          reference_date: string
          rows_imported: number
          song_id: string | null
          status: string
          superseded_at: string | null
          superseded_by: string | null
          total_streams: number
          upload_mode: string
          uploaded_by: string | null
          uploaded_via: string
          window_days: number
          window_kind: string | null
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
          quarantine_reason?: string | null
          quarantine_signals?: Json | null
          quarantined_at?: string | null
          reference_date?: string
          rows_imported?: number
          song_id?: string | null
          status?: string
          superseded_at?: string | null
          superseded_by?: string | null
          total_streams?: number
          upload_mode?: string
          uploaded_by?: string | null
          uploaded_via?: string
          window_days?: number
          window_kind?: string | null
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
          quarantine_reason?: string | null
          quarantine_signals?: Json | null
          quarantined_at?: string | null
          reference_date?: string
          rows_imported?: number
          song_id?: string | null
          status?: string
          superseded_at?: string | null
          superseded_by?: string | null
          total_streams?: number
          upload_mode?: string
          uploaded_by?: string | null
          uploaded_via?: string
          window_days?: number
          window_kind?: string | null
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
          {
            foreignKeyName: "label_spreadsheet_uploads_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "label_spreadsheet_uploads"
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
            referencedRelation: "v_catalog_playlist_occupancy"
            referencedColumns: ["managed_playlist_id"]
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
          campaign_reserved_slots: number
          canonical_playlist_id: string | null
          catalog_capacity: number
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
          is_catalog: boolean
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
          campaign_reserved_slots?: number
          canonical_playlist_id?: string | null
          catalog_capacity?: number
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
          is_catalog?: boolean
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
          campaign_reserved_slots?: number
          canonical_playlist_id?: string | null
          catalog_capacity?: number
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
          is_catalog?: boolean
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
          resolved_at: string | null
          resolved_by: string | null
          status: string
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
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
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
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string | null
        }
        Relationships: []
      }
      notifications_archive_phase1: {
        Row: {
          action_url: string | null
          archived_at: string | null
          created_at: string | null
          id: string | null
          message: string | null
          metadata: Json | null
          read: boolean | null
          resolved_at: string | null
          resolved_by: string | null
          status: string | null
          title: string | null
          type: Database["public"]["Enums"]["notification_type"] | null
          user_id: string | null
        }
        Insert: {
          action_url?: string | null
          archived_at?: string | null
          created_at?: string | null
          id?: string | null
          message?: string | null
          metadata?: Json | null
          read?: boolean | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string | null
          title?: string | null
          type?: Database["public"]["Enums"]["notification_type"] | null
          user_id?: string | null
        }
        Update: {
          action_url?: string | null
          archived_at?: string | null
          created_at?: string | null
          id?: string | null
          message?: string | null
          metadata?: Json | null
          read?: boolean | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string | null
          title?: string | null
          type?: Database["public"]["Enums"]["notification_type"] | null
          user_id?: string | null
        }
        Relationships: []
      }
      oauth_migration_plan: {
        Row: {
          assigned_at: string
          completed_at: string | null
          current_app_id: string
          id: string
          notes: string | null
          playlists_count: number
          spotify_user_id: string
          status: string
          target_app_id: string
          token_id: string
        }
        Insert: {
          assigned_at?: string
          completed_at?: string | null
          current_app_id: string
          id?: string
          notes?: string | null
          playlists_count?: number
          spotify_user_id: string
          status?: string
          target_app_id: string
          token_id: string
        }
        Update: {
          assigned_at?: string
          completed_at?: string | null
          current_app_id?: string
          id?: string
          notes?: string | null
          playlists_count?: number
          spotify_user_id?: string
          status?: string
          target_app_id?: string
          token_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_migration_plan_current_app_id_fkey"
            columns: ["current_app_id"]
            isOneToOne: false
            referencedRelation: "spotify_app_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauth_migration_plan_current_app_id_fkey"
            columns: ["current_app_id"]
            isOneToOne: false
            referencedRelation: "spotify_apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauth_migration_plan_target_app_id_fkey"
            columns: ["target_app_id"]
            isOneToOne: false
            referencedRelation: "spotify_app_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauth_migration_plan_target_app_id_fkey"
            columns: ["target_app_id"]
            isOneToOne: false
            referencedRelation: "spotify_apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauth_migration_plan_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: true
            referencedRelation: "spotify_user_tokens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauth_migration_plan_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: true
            referencedRelation: "spotify_user_tokens_public"
            referencedColumns: ["id"]
          },
        ]
      }
      observed_playlist_snapshots: {
        Row: {
          captured_at: string
          correlation_id: string | null
          created_at: string
          deal_id: string | null
          id: string
          observed_playlist_id: string
          plays_24h: number | null
          plays_28d: number | null
          plays_7d: number | null
          song_id: string | null
          source: string | null
          spotify_track_id: string | null
        }
        Insert: {
          captured_at?: string
          correlation_id?: string | null
          created_at?: string
          deal_id?: string | null
          id?: string
          observed_playlist_id: string
          plays_24h?: number | null
          plays_28d?: number | null
          plays_7d?: number | null
          song_id?: string | null
          source?: string | null
          spotify_track_id?: string | null
        }
        Update: {
          captured_at?: string
          correlation_id?: string | null
          created_at?: string
          deal_id?: string | null
          id?: string
          observed_playlist_id?: string
          plays_24h?: number | null
          plays_28d?: number | null
          plays_7d?: number | null
          song_id?: string | null
          source?: string | null
          spotify_track_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "observed_playlist_snapshots_observed_playlist_id_fkey"
            columns: ["observed_playlist_id"]
            isOneToOne: false
            referencedRelation: "observed_playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "observed_playlist_snapshots_song_id_fkey"
            columns: ["song_id"]
            isOneToOne: false
            referencedRelation: "curator_deal_songs"
            referencedColumns: ["id"]
          },
        ]
      }
      observed_playlists: {
        Row: {
          created_at: string
          enriched_at: string | null
          enrichment_status: string
          first_observed_at: string
          followers: number | null
          id: string
          image_url: string | null
          last_observed_at: string
          notes: string | null
          observation_count: number
          owner_type: string | null
          playlist_name: string | null
          promoted_at: string | null
          promoted_to_curator_playlist_id: string | null
          spotify_owner_id: string | null
          spotify_owner_name: string | null
          spotify_playlist_id: string
          total_plays_observed: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          enriched_at?: string | null
          enrichment_status?: string
          first_observed_at?: string
          followers?: number | null
          id?: string
          image_url?: string | null
          last_observed_at?: string
          notes?: string | null
          observation_count?: number
          owner_type?: string | null
          playlist_name?: string | null
          promoted_at?: string | null
          promoted_to_curator_playlist_id?: string | null
          spotify_owner_id?: string | null
          spotify_owner_name?: string | null
          spotify_playlist_id: string
          total_plays_observed?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          enriched_at?: string | null
          enrichment_status?: string
          first_observed_at?: string
          followers?: number | null
          id?: string
          image_url?: string | null
          last_observed_at?: string
          notes?: string | null
          observation_count?: number
          owner_type?: string | null
          playlist_name?: string | null
          promoted_at?: string | null
          promoted_to_curator_playlist_id?: string | null
          spotify_owner_id?: string | null
          spotify_owner_name?: string | null
          spotify_playlist_id?: string
          total_plays_observed?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "observed_playlists_promoted_to_curator_playlist_id_fkey"
            columns: ["promoted_to_curator_playlist_id"]
            isOneToOne: false
            referencedRelation: "curator_playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "observed_playlists_promoted_to_curator_playlist_id_fkey"
            columns: ["promoted_to_curator_playlist_id"]
            isOneToOne: false
            referencedRelation: "v_curator_playlists_observational"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "observed_playlists_promoted_to_curator_playlist_id_fkey"
            columns: ["promoted_to_curator_playlist_id"]
            isOneToOne: false
            referencedRelation: "v_curator_playlists_operational"
            referencedColumns: ["id"]
          },
        ]
      }
      observed_playlists_blocklist: {
        Row: {
          created_at: string
          id: string
          reason: string
        }
        Insert: {
          created_at?: string
          id: string
          reason: string
        }
        Update: {
          created_at?: string
          id?: string
          reason?: string
        }
        Relationships: []
      }
      observer_playlist_tracks: {
        Row: {
          album_cover_url: string | null
          album_name: string | null
          artist: string | null
          captured_at: string
          captured_date: string
          correlation_id: string | null
          duration_ms: number | null
          id: string
          name: string | null
          position: number
          raw: Json | null
          spotify_playlist_id: string
          spotify_track_id: string
        }
        Insert: {
          album_cover_url?: string | null
          album_name?: string | null
          artist?: string | null
          captured_at?: string
          captured_date?: string
          correlation_id?: string | null
          duration_ms?: number | null
          id?: string
          name?: string | null
          position: number
          raw?: Json | null
          spotify_playlist_id: string
          spotify_track_id: string
        }
        Update: {
          album_cover_url?: string | null
          album_name?: string | null
          artist?: string | null
          captured_at?: string
          captured_date?: string
          correlation_id?: string | null
          duration_ms?: number | null
          id?: string
          name?: string | null
          position?: number
          raw?: Json | null
          spotify_playlist_id?: string
          spotify_track_id?: string
        }
        Relationships: []
      }
      occupancy_plan_ops: {
        Row: {
          attempts: number
          classification: string | null
          created_at: string
          error: string | null
          executed_at: string | null
          from_position: number | null
          id: string
          op_status: string
          op_type: string
          payload: Json
          plan_id: string
          reason: string
          spotify_track_id: string | null
          to_position: number | null
        }
        Insert: {
          attempts?: number
          classification?: string | null
          created_at?: string
          error?: string | null
          executed_at?: string | null
          from_position?: number | null
          id?: string
          op_status?: string
          op_type: string
          payload?: Json
          plan_id: string
          reason: string
          spotify_track_id?: string | null
          to_position?: number | null
        }
        Update: {
          attempts?: number
          classification?: string | null
          created_at?: string
          error?: string | null
          executed_at?: string | null
          from_position?: number | null
          id?: string
          op_status?: string
          op_type?: string
          payload?: Json
          plan_id?: string
          reason?: string
          spotify_track_id?: string | null
          to_position?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "occupancy_plan_ops_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "occupancy_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      occupancy_plans: {
        Row: {
          block_reason: string | null
          created_at: string
          duration_ms: number | null
          executed_at: string | null
          executor_attempts: number
          executor_error: string | null
          executor_stats: Json | null
          executor_status: string
          finalized_at: string | null
          id: string
          managed_playlist_id: string
          mode: string
          ops_count: number
          policy_snapshot: Json
          spotify_snapshot_id: string | null
          started_at: string | null
          stats: Json
          status: string
          trigger_source: string | null
        }
        Insert: {
          block_reason?: string | null
          created_at?: string
          duration_ms?: number | null
          executed_at?: string | null
          executor_attempts?: number
          executor_error?: string | null
          executor_stats?: Json | null
          executor_status?: string
          finalized_at?: string | null
          id?: string
          managed_playlist_id: string
          mode?: string
          ops_count?: number
          policy_snapshot?: Json
          spotify_snapshot_id?: string | null
          started_at?: string | null
          stats?: Json
          status?: string
          trigger_source?: string | null
        }
        Update: {
          block_reason?: string | null
          created_at?: string
          duration_ms?: number | null
          executed_at?: string | null
          executor_attempts?: number
          executor_error?: string | null
          executor_stats?: Json | null
          executor_status?: string
          finalized_at?: string | null
          id?: string
          managed_playlist_id?: string
          mode?: string
          ops_count?: number
          policy_snapshot?: Json
          spotify_snapshot_id?: string | null
          started_at?: string | null
          stats?: Json
          status?: string
          trigger_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "occupancy_plans_managed_playlist_id_fkey"
            columns: ["managed_playlist_id"]
            isOneToOne: false
            referencedRelation: "managed_playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occupancy_plans_managed_playlist_id_fkey"
            columns: ["managed_playlist_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_playlist_occupancy"
            referencedColumns: ["managed_playlist_id"]
          },
          {
            foreignKeyName: "occupancy_plans_managed_playlist_id_fkey"
            columns: ["managed_playlist_id"]
            isOneToOne: false
            referencedRelation: "v_playlist_vps_assignment"
            referencedColumns: ["managed_playlist_id"]
          },
        ]
      }
      occupancy_rebuild_queue: {
        Row: {
          attempts: number
          enqueued_at: string
          finished_at: string | null
          id: string
          last_error: string | null
          managed_playlist_id: string
          payload: Json
          plan_id: string | null
          started_at: string | null
          status: string
          trigger_source: string
        }
        Insert: {
          attempts?: number
          enqueued_at?: string
          finished_at?: string | null
          id?: string
          last_error?: string | null
          managed_playlist_id: string
          payload?: Json
          plan_id?: string | null
          started_at?: string | null
          status?: string
          trigger_source: string
        }
        Update: {
          attempts?: number
          enqueued_at?: string
          finished_at?: string | null
          id?: string
          last_error?: string | null
          managed_playlist_id?: string
          payload?: Json
          plan_id?: string | null
          started_at?: string | null
          status?: string
          trigger_source?: string
        }
        Relationships: [
          {
            foreignKeyName: "occupancy_rebuild_queue_managed_playlist_id_fkey"
            columns: ["managed_playlist_id"]
            isOneToOne: false
            referencedRelation: "managed_playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occupancy_rebuild_queue_managed_playlist_id_fkey"
            columns: ["managed_playlist_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_playlist_occupancy"
            referencedColumns: ["managed_playlist_id"]
          },
          {
            foreignKeyName: "occupancy_rebuild_queue_managed_playlist_id_fkey"
            columns: ["managed_playlist_id"]
            isOneToOne: false
            referencedRelation: "v_playlist_vps_assignment"
            referencedColumns: ["managed_playlist_id"]
          },
          {
            foreignKeyName: "occupancy_rebuild_queue_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "occupancy_plans"
            referencedColumns: ["id"]
          },
        ]
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
      placement_origin_log: {
        Row: {
          actor: string | null
          catalog_track_id: string | null
          created_at: string
          distribution_batch_id: string | null
          id: string
          managed_playlist_id: string | null
          origin: string
          payload: Json | null
          placement_id: string
          priority_at_insert: number | null
          request_id: string | null
          status_at_insert: string | null
        }
        Insert: {
          actor?: string | null
          catalog_track_id?: string | null
          created_at?: string
          distribution_batch_id?: string | null
          id?: string
          managed_playlist_id?: string | null
          origin: string
          payload?: Json | null
          placement_id: string
          priority_at_insert?: number | null
          request_id?: string | null
          status_at_insert?: string | null
        }
        Update: {
          actor?: string | null
          catalog_track_id?: string | null
          created_at?: string
          distribution_batch_id?: string | null
          id?: string
          managed_playlist_id?: string | null
          origin?: string
          payload?: Json | null
          placement_id?: string
          priority_at_insert?: number | null
          request_id?: string | null
          status_at_insert?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "placement_origin_log_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "catalog_placements"
            referencedColumns: ["id"]
          },
        ]
      }
      placement_priority_scores: {
        Row: {
          calculated_at: string
          components: Json
          created_at: string
          id: string
          placement_id: string
          run_id: string | null
          score: number
        }
        Insert: {
          calculated_at?: string
          components?: Json
          created_at?: string
          id?: string
          placement_id: string
          run_id?: string | null
          score?: number
        }
        Update: {
          calculated_at?: string
          components?: Json
          created_at?: string
          id?: string
          placement_id?: string
          run_id?: string | null
          score?: number
        }
        Relationships: [
          {
            foreignKeyName: "placement_priority_scores_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "catalog_placements"
            referencedColumns: ["id"]
          },
        ]
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
            referencedRelation: "v_catalog_playlist_occupancy"
            referencedColumns: ["managed_playlist_id"]
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
            referencedRelation: "v_catalog_playlist_occupancy"
            referencedColumns: ["managed_playlist_id"]
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
            referencedRelation: "v_catalog_playlist_occupancy"
            referencedColumns: ["managed_playlist_id"]
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
            referencedRelation: "v_catalog_playlist_occupancy"
            referencedColumns: ["managed_playlist_id"]
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
            referencedRelation: "v_catalog_playlist_occupancy"
            referencedColumns: ["managed_playlist_id"]
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
            referencedRelation: "v_catalog_playlist_occupancy"
            referencedColumns: ["managed_playlist_id"]
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
      playlist_editorial_policies: {
        Row: {
          campaign_reserved_slots: number
          catalog_capacity: number
          created_at: string
          id: string
          intercalation_ratio: number
          is_active: boolean
          managed_playlist_id: string
          notes: string | null
          operational_ceiling: number | null
          policy_type: string
          protect_top_n: number
          source: string
          third_party_max_pct: number
          updated_at: string
        }
        Insert: {
          campaign_reserved_slots?: number
          catalog_capacity?: number
          created_at?: string
          id?: string
          intercalation_ratio?: number
          is_active?: boolean
          managed_playlist_id: string
          notes?: string | null
          operational_ceiling?: number | null
          policy_type?: string
          protect_top_n?: number
          source?: string
          third_party_max_pct?: number
          updated_at?: string
        }
        Update: {
          campaign_reserved_slots?: number
          catalog_capacity?: number
          created_at?: string
          id?: string
          intercalation_ratio?: number
          is_active?: boolean
          managed_playlist_id?: string
          notes?: string | null
          operational_ceiling?: number | null
          policy_type?: string
          protect_top_n?: number
          source?: string
          third_party_max_pct?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "playlist_editorial_policies_managed_playlist_id_fkey"
            columns: ["managed_playlist_id"]
            isOneToOne: true
            referencedRelation: "managed_playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playlist_editorial_policies_managed_playlist_id_fkey"
            columns: ["managed_playlist_id"]
            isOneToOne: true
            referencedRelation: "v_catalog_playlist_occupancy"
            referencedColumns: ["managed_playlist_id"]
          },
          {
            foreignKeyName: "playlist_editorial_policies_managed_playlist_id_fkey"
            columns: ["managed_playlist_id"]
            isOneToOne: true
            referencedRelation: "v_playlist_vps_assignment"
            referencedColumns: ["managed_playlist_id"]
          },
        ]
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
          correlation_id: string | null
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
          correlation_id?: string | null
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
          correlation_id?: string | null
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
            referencedRelation: "v_catalog_playlist_occupancy"
            referencedColumns: ["managed_playlist_id"]
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
      playlist_policy_alerts: {
        Row: {
          alert_type: string
          created_at: string
          details: Json
          id: string
          managed_playlist_id: string
          message: string
          resolved_at: string | null
          severity: string
        }
        Insert: {
          alert_type: string
          created_at?: string
          details?: Json
          id?: string
          managed_playlist_id: string
          message: string
          resolved_at?: string | null
          severity?: string
        }
        Update: {
          alert_type?: string
          created_at?: string
          details?: Json
          id?: string
          managed_playlist_id?: string
          message?: string
          resolved_at?: string | null
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "playlist_policy_alerts_managed_playlist_id_fkey"
            columns: ["managed_playlist_id"]
            isOneToOne: false
            referencedRelation: "managed_playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playlist_policy_alerts_managed_playlist_id_fkey"
            columns: ["managed_playlist_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_playlist_occupancy"
            referencedColumns: ["managed_playlist_id"]
          },
          {
            foreignKeyName: "playlist_policy_alerts_managed_playlist_id_fkey"
            columns: ["managed_playlist_id"]
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
            referencedRelation: "v_catalog_playlist_occupancy"
            referencedColumns: ["managed_playlist_id"]
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
      playlists_to_observe: {
        Row: {
          created_at: string | null
          curator_id: string | null
          curator_name: string | null
          id: string
          is_active: boolean | null
          name: string | null
          priority: number | null
          spotify_id: string
          updated_at: string | null
          url: string
        }
        Insert: {
          created_at?: string | null
          curator_id?: string | null
          curator_name?: string | null
          id?: string
          is_active?: boolean | null
          name?: string | null
          priority?: number | null
          spotify_id: string
          updated_at?: string | null
          url: string
        }
        Update: {
          created_at?: string | null
          curator_id?: string | null
          curator_name?: string | null
          id?: string
          is_active?: boolean | null
          name?: string | null
          priority?: number | null
          spotify_id?: string
          updated_at?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "playlists_to_observe_curator_id_fkey"
            columns: ["curator_id"]
            isOneToOne: false
            referencedRelation: "curators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playlists_to_observe_curator_id_fkey"
            columns: ["curator_id"]
            isOneToOne: false
            referencedRelation: "v_curator_balance"
            referencedColumns: ["curator_id"]
          },
          {
            foreignKeyName: "playlists_to_observe_curator_id_fkey"
            columns: ["curator_id"]
            isOneToOne: false
            referencedRelation: "v_curator_finance"
            referencedColumns: ["curator_id"]
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
      public_token_audit: {
        Row: {
          action: string
          actor_user_id: string | null
          correlation_id: string | null
          created_at: string
          entity_id: string
          expires_at: string | null
          id: string
          ip: unknown
          kind: string
          new_token_hash: string | null
          old_token_hash: string | null
          reason: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          correlation_id?: string | null
          created_at?: string
          entity_id: string
          expires_at?: string | null
          id?: string
          ip?: unknown
          kind: string
          new_token_hash?: string | null
          old_token_hash?: string | null
          reason?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          correlation_id?: string | null
          created_at?: string
          entity_id?: string
          expires_at?: string | null
          id?: string
          ip?: unknown
          kind?: string
          new_token_hash?: string | null
          old_token_hash?: string | null
          reason?: string | null
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
          catalog_track_id: string | null
          correlation_id: string | null
          created_at: string
          id: string
          processed_at: string | null
          processing_error: string | null
          screenshot_url: string | null
          snapshot_run_id: string | null
          song_id: string | null
          spotify_song_id: string | null
          time_window: string
          total_plays_28d: number | null
        }
        Insert: {
          bot_metadata?: Json | null
          captured_at?: string
          catalog_track_id?: string | null
          correlation_id?: string | null
          created_at?: string
          id?: string
          processed_at?: string | null
          processing_error?: string | null
          screenshot_url?: string | null
          snapshot_run_id?: string | null
          song_id?: string | null
          spotify_song_id?: string | null
          time_window?: string
          total_plays_28d?: number | null
        }
        Update: {
          bot_metadata?: Json | null
          captured_at?: string
          catalog_track_id?: string | null
          correlation_id?: string | null
          created_at?: string
          id?: string
          processed_at?: string | null
          processing_error?: string | null
          screenshot_url?: string | null
          snapshot_run_id?: string | null
          song_id?: string | null
          spotify_song_id?: string | null
          time_window?: string
          total_plays_28d?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "song_snapshots_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "catalog_tracks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "song_snapshots_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_distribution_stats"
            referencedColumns: ["catalog_track_id"]
          },
          {
            foreignKeyName: "song_snapshots_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_performance"
            referencedColumns: ["catalog_track_id"]
          },
          {
            foreignKeyName: "song_snapshots_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_telemetry"
            referencedColumns: ["catalog_track_id"]
          },
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
      spotify_account_artist_access: {
        Row: {
          account_id: string
          created_at: string
          has_access: boolean
          id: string
          last_error: string | null
          last_probed_at: string
          notes: string | null
          source: string
          spotify_artist_id: string
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          has_access: boolean
          id?: string
          last_error?: string | null
          last_probed_at?: string
          notes?: string | null
          source?: string
          spotify_artist_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          has_access?: boolean
          id?: string
          last_error?: string | null
          last_probed_at?: string
          notes?: string | null
          source?: string
          spotify_artist_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "spotify_account_artist_access_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "spotify_accounts"
            referencedColumns: ["account_id"]
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
      spotify_app_access_blocks: {
        Row: {
          app_id: string | null
          app_name: string | null
          client_id: string | null
          created_at: string
          endpoint: string
          error_body: string | null
          function_name: string | null
          http_method: string
          id: number
          playlist_name: string | null
          playlist_owner_id: string | null
          playlist_owner_name: string | null
          raw_url: string | null
          reason: string
          spotify_playlist_id: string | null
          spotify_track_id: string | null
          spotify_user_id: string | null
          spotify_user_name: string | null
        }
        Insert: {
          app_id?: string | null
          app_name?: string | null
          client_id?: string | null
          created_at?: string
          endpoint: string
          error_body?: string | null
          function_name?: string | null
          http_method?: string
          id?: number
          playlist_name?: string | null
          playlist_owner_id?: string | null
          playlist_owner_name?: string | null
          raw_url?: string | null
          reason?: string
          spotify_playlist_id?: string | null
          spotify_track_id?: string | null
          spotify_user_id?: string | null
          spotify_user_name?: string | null
        }
        Update: {
          app_id?: string | null
          app_name?: string | null
          client_id?: string | null
          created_at?: string
          endpoint?: string
          error_body?: string | null
          function_name?: string | null
          http_method?: string
          id?: number
          playlist_name?: string | null
          playlist_owner_id?: string | null
          playlist_owner_name?: string | null
          raw_url?: string | null
          reason?: string
          spotify_playlist_id?: string | null
          spotify_track_id?: string | null
          spotify_user_id?: string | null
          spotify_user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "spotify_app_access_blocks_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "spotify_app_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spotify_app_access_blocks_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "spotify_apps"
            referencedColumns: ["id"]
          },
        ]
      }
      spotify_apps: {
        Row: {
          auth_failure_count: number
          blocked_reason: string | null
          cap_calls_per_hour: number
          cap_calls_per_minute: number
          client_id: string
          client_secret: string
          created_at: string
          development_mode: boolean
          extended_quota: boolean
          id: string
          last_auth_failure_at: string | null
          lifecycle_state: string
          max_accounts: number
          max_playlists: number
          min_health_score: number
          name: string
          notes: string | null
          owner_email: string | null
          purpose: string
          quarantine_reason: string | null
          quarantined_until: string | null
          ready_for_deletion: boolean
          removed_from_pool_at: string | null
          retired_from_production: boolean
          retirement_audit: Json | null
          slug: string
          soft_capacity_cap: number
          status: string
          updated_at: string
        }
        Insert: {
          auth_failure_count?: number
          blocked_reason?: string | null
          cap_calls_per_hour?: number
          cap_calls_per_minute?: number
          client_id: string
          client_secret: string
          created_at?: string
          development_mode?: boolean
          extended_quota?: boolean
          id?: string
          last_auth_failure_at?: string | null
          lifecycle_state?: string
          max_accounts?: number
          max_playlists?: number
          min_health_score?: number
          name: string
          notes?: string | null
          owner_email?: string | null
          purpose?: string
          quarantine_reason?: string | null
          quarantined_until?: string | null
          ready_for_deletion?: boolean
          removed_from_pool_at?: string | null
          retired_from_production?: boolean
          retirement_audit?: Json | null
          slug: string
          soft_capacity_cap?: number
          status?: string
          updated_at?: string
        }
        Update: {
          auth_failure_count?: number
          blocked_reason?: string | null
          cap_calls_per_hour?: number
          cap_calls_per_minute?: number
          client_id?: string
          client_secret?: string
          created_at?: string
          development_mode?: boolean
          extended_quota?: boolean
          id?: string
          last_auth_failure_at?: string | null
          lifecycle_state?: string
          max_accounts?: number
          max_playlists?: number
          min_health_score?: number
          name?: string
          notes?: string | null
          owner_email?: string | null
          purpose?: string
          quarantine_reason?: string | null
          quarantined_until?: string | null
          ready_for_deletion?: boolean
          removed_from_pool_at?: string | null
          retired_from_production?: boolean
          retirement_audit?: Json | null
          slug?: string
          soft_capacity_cap?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      spotify_artist_cache: {
        Row: {
          created_at: string
          enriched_at: string | null
          fetch_error: string | null
          fetch_status: string
          followers: number | null
          genres: string[]
          genres_refreshed_at: string | null
          image_url: string | null
          name: string | null
          popularity: number | null
          raw: Json | null
          refreshed_at: string | null
          source_app_id: string | null
          spotify_artist_id: string
        }
        Insert: {
          created_at?: string
          enriched_at?: string | null
          fetch_error?: string | null
          fetch_status?: string
          followers?: number | null
          genres?: string[]
          genres_refreshed_at?: string | null
          image_url?: string | null
          name?: string | null
          popularity?: number | null
          raw?: Json | null
          refreshed_at?: string | null
          source_app_id?: string | null
          spotify_artist_id: string
        }
        Update: {
          created_at?: string
          enriched_at?: string | null
          fetch_error?: string | null
          fetch_status?: string
          followers?: number | null
          genres?: string[]
          genres_refreshed_at?: string | null
          image_url?: string | null
          name?: string | null
          popularity?: number | null
          raw?: Json | null
          refreshed_at?: string | null
          source_app_id?: string | null
          spotify_artist_id?: string
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
          context: string
          created_at: string
          last_429_at: string | null
          retry_after_sec: number
          status: string
          updated_at: string
        }
        Insert: {
          app_id?: string
          blocked_until?: string | null
          context?: string
          created_at?: string
          last_429_at?: string | null
          retry_after_sec?: number
          status?: string
          updated_at?: string
        }
        Update: {
          app_id?: string
          blocked_until?: string | null
          context?: string
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
          context: string
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
          context?: string
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
          context?: string
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
      spotify_enrichment_queue: {
        Row: {
          attempts: number
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          done_at: string | null
          id: string
          kind: string
          last_error: string | null
          max_attempts: number
          priority: number
          reason: string
          ref_id: string
          scheduled_for: string
          status: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          done_at?: string | null
          id?: string
          kind: string
          last_error?: string | null
          max_attempts?: number
          priority?: number
          reason?: string
          ref_id: string
          scheduled_for?: string
          status?: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          done_at?: string | null
          id?: string
          kind?: string
          last_error?: string | null
          max_attempts?: number
          priority?: number
          reason?: string
          ref_id?: string
          scheduled_for?: string
          status?: string
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
            referencedRelation: "spotify_app_overview"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "spotify_app_overview"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "spotify_app_overview"
            referencedColumns: ["id"]
          },
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
          collaborative: boolean | null
          created_at: string
          description: string | null
          etag: string | null
          fetch_status: string | null
          followers: number | null
          id: string
          image_url: string | null
          last_error: string | null
          meta_refreshed_at: string | null
          name: string | null
          owner_id: string | null
          owner_name: string | null
          public_flag: boolean | null
          snapshot_id: string | null
          source: string | null
          spotify_playlist_id: string
          total_tracks: number | null
          tracks_jsonb: Json | null
          tracks_refreshed_at: string | null
        }
        Insert: {
          cached_at?: string
          collaborative?: boolean | null
          created_at?: string
          description?: string | null
          etag?: string | null
          fetch_status?: string | null
          followers?: number | null
          id?: string
          image_url?: string | null
          last_error?: string | null
          meta_refreshed_at?: string | null
          name?: string | null
          owner_id?: string | null
          owner_name?: string | null
          public_flag?: boolean | null
          snapshot_id?: string | null
          source?: string | null
          spotify_playlist_id: string
          total_tracks?: number | null
          tracks_jsonb?: Json | null
          tracks_refreshed_at?: string | null
        }
        Update: {
          cached_at?: string
          collaborative?: boolean | null
          created_at?: string
          description?: string | null
          etag?: string | null
          fetch_status?: string | null
          followers?: number | null
          id?: string
          image_url?: string | null
          last_error?: string | null
          meta_refreshed_at?: string | null
          name?: string | null
          owner_id?: string | null
          owner_name?: string | null
          public_flag?: boolean | null
          snapshot_id?: string | null
          source?: string | null
          spotify_playlist_id?: string
          total_tracks?: number | null
          tracks_jsonb?: Json | null
          tracks_refreshed_at?: string | null
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
            referencedRelation: "spotify_app_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spotify_tokens_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "spotify_apps"
            referencedColumns: ["id"]
          },
        ]
      }
      spotify_track_cache: {
        Row: {
          album_id: string | null
          artist_ids: string[]
          created_at: string
          duration_ms: number | null
          enriched_at: string | null
          explicit: boolean | null
          fetch_error: string | null
          fetch_status: string
          isrc: string | null
          name: string | null
          popularity: number | null
          popularity_refreshed_at: string | null
          raw: Json | null
          release_date: string | null
          source_app_id: string | null
          spotify_track_id: string
        }
        Insert: {
          album_id?: string | null
          artist_ids?: string[]
          created_at?: string
          duration_ms?: number | null
          enriched_at?: string | null
          explicit?: boolean | null
          fetch_error?: string | null
          fetch_status?: string
          isrc?: string | null
          name?: string | null
          popularity?: number | null
          popularity_refreshed_at?: string | null
          raw?: Json | null
          release_date?: string | null
          source_app_id?: string | null
          spotify_track_id: string
        }
        Update: {
          album_id?: string | null
          artist_ids?: string[]
          created_at?: string
          duration_ms?: number | null
          enriched_at?: string | null
          explicit?: boolean | null
          fetch_error?: string | null
          fetch_status?: string
          isrc?: string | null
          name?: string | null
          popularity?: number | null
          popularity_refreshed_at?: string | null
          raw?: Json | null
          release_date?: string | null
          source_app_id?: string | null
          spotify_track_id?: string
        }
        Relationships: []
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
            referencedRelation: "spotify_app_overview"
            referencedColumns: ["id"]
          },
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
      system_alerts: {
        Row: {
          acked_at: string | null
          acked_by: string | null
          channels: string[]
          cooldown_minutes: number
          correlation_id: string | null
          created_at: string
          dedupe_key: string | null
          delivered_at: string | null
          id: string
          message: string
          metadata: Json
          resolution: string | null
          resolved_at: string | null
          severity: string
          subsystem: string
          title: string
        }
        Insert: {
          acked_at?: string | null
          acked_by?: string | null
          channels?: string[]
          cooldown_minutes?: number
          correlation_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          delivered_at?: string | null
          id?: string
          message: string
          metadata?: Json
          resolution?: string | null
          resolved_at?: string | null
          severity: string
          subsystem: string
          title: string
        }
        Update: {
          acked_at?: string | null
          acked_by?: string | null
          channels?: string[]
          cooldown_minutes?: number
          correlation_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          delivered_at?: string | null
          id?: string
          message?: string
          metadata?: Json
          resolution?: string | null
          resolved_at?: string | null
          severity?: string
          subsystem?: string
          title?: string
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
          catalog_sync_batch_size: number
          catalog_sync_enabled: boolean
          catalog_sync_priority: number
          created_at: string
          engine_campaign_promotes: boolean
          engine_editorial_weights: boolean
          engine_natural_distribution_active: boolean
          engine_natural_distribution_max_per_track_per_day: number
          engine_natural_distribution_max_per_wave_per_track: number
          engine_natural_distribution_tier_delay_days: number
          engine_natural_distribution_wave_size: number
          engine_natural_distribution_window_days: number
          engine_occupancy_autofill: boolean
          engine_priority_active: boolean
          engine_priority_weights: Json
          engine_reorder_active: boolean
          execution_frozen: boolean
          execution_frozen_at: string | null
          execution_frozen_by: string | null
          execution_frozen_reason: string | null
          execution_queue_internal_enabled: boolean
          id: string
          occupancy_engine_mode: string
          singleton_key: string
          updated_at: string
        }
        Insert: {
          ai_editorial_tier?: string
          apify_blocked?: boolean
          apify_blocked_at?: string | null
          apify_blocked_reason?: string | null
          auto_deal_from_campaign?: boolean
          catalog_sync_batch_size?: number
          catalog_sync_enabled?: boolean
          catalog_sync_priority?: number
          created_at?: string
          engine_campaign_promotes?: boolean
          engine_editorial_weights?: boolean
          engine_natural_distribution_active?: boolean
          engine_natural_distribution_max_per_track_per_day?: number
          engine_natural_distribution_max_per_wave_per_track?: number
          engine_natural_distribution_tier_delay_days?: number
          engine_natural_distribution_wave_size?: number
          engine_natural_distribution_window_days?: number
          engine_occupancy_autofill?: boolean
          engine_priority_active?: boolean
          engine_priority_weights?: Json
          engine_reorder_active?: boolean
          execution_frozen?: boolean
          execution_frozen_at?: string | null
          execution_frozen_by?: string | null
          execution_frozen_reason?: string | null
          execution_queue_internal_enabled?: boolean
          id?: string
          occupancy_engine_mode?: string
          singleton_key?: string
          updated_at?: string
        }
        Update: {
          ai_editorial_tier?: string
          apify_blocked?: boolean
          apify_blocked_at?: string | null
          apify_blocked_reason?: string | null
          auto_deal_from_campaign?: boolean
          catalog_sync_batch_size?: number
          catalog_sync_enabled?: boolean
          catalog_sync_priority?: number
          created_at?: string
          engine_campaign_promotes?: boolean
          engine_editorial_weights?: boolean
          engine_natural_distribution_active?: boolean
          engine_natural_distribution_max_per_track_per_day?: number
          engine_natural_distribution_max_per_wave_per_track?: number
          engine_natural_distribution_tier_delay_days?: number
          engine_natural_distribution_wave_size?: number
          engine_natural_distribution_window_days?: number
          engine_occupancy_autofill?: boolean
          engine_priority_active?: boolean
          engine_priority_weights?: Json
          engine_reorder_active?: boolean
          execution_frozen?: boolean
          execution_frozen_at?: string | null
          execution_frozen_by?: string | null
          execution_frozen_reason?: string | null
          execution_queue_internal_enabled?: boolean
          id?: string
          occupancy_engine_mode?: string
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
      catalog_gateway_metrics: {
        Row: {
          avg_duration_ms: number | null
          caller: string | null
          calls: number | null
          endpoint: string | null
          forbidden_calls: number | null
          hour: string | null
          ok_calls: number | null
          ratelimited_calls: number | null
          server_error_calls: number | null
          source: string | null
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
      oauth_migration_actions: {
        Row: {
          assigned_at: string | null
          completed_at: string | null
          current_app: string | null
          current_state: string | null
          playlists_count: number | null
          reconnect_path: string | null
          spotify_user_id: string | null
          status: string | null
          target_app: string | null
        }
        Relationships: []
      }
      spotify_app_overview: {
        Row: {
          accounts_count: number | null
          active_playlists: number | null
          average_latency_ms: number | null
          blocked_reason: string | null
          calls_last_1h: number | null
          calls_last_24h: number | null
          calls_last_5m: number | null
          calls_last_7d: number | null
          cap_calls_per_hour: number | null
          cap_calls_per_minute: number | null
          capacity_score: number | null
          circuit_breaker: string | null
          created_at: string | null
          development_mode: boolean | null
          error_403_last_hour: number | null
          error_429_last_hour: number | null
          extended_quota: boolean | null
          health_score: number | null
          id: string | null
          lifecycle_state: string | null
          max_accounts: number | null
          max_playlists: number | null
          min_health_score: number | null
          name: string | null
          pool_eligible: boolean | null
          purpose: string | null
          quarantined_until: string | null
          removed_from_pool_at: string | null
          retries_last_hour: number | null
          soft_capacity_cap: number | null
          status: string | null
          total_playlists: number | null
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
            referencedRelation: "spotify_app_overview"
            referencedColumns: ["id"]
          },
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
      v_campaign_overview: {
        Row: {
          artist: string | null
          baseline_captured_at: string | null
          campaign_id: string | null
          client_approved_at: string | null
          client_id: string | null
          closed_at: string | null
          contratado: number | null
          created_at: string | null
          curadores_unicos: number | null
          custo_curadores_diretos: number | null
          custo_eco: number | null
          custo_externos: number | null
          custo_operacional: number | null
          deals_abertos: number | null
          deals_concluidos: number | null
          deals_total: number | null
          eco_dispatched: number | null
          eco_dispatched_at: string | null
          eco_total: number | null
          externos_items_total: number | null
          genre: string | null
          margem_pct: number | null
          margem_prevista: number | null
          pacotes_confirmados: number | null
          pacotes_total: number | null
          pendente: number | null
          plan_approved_at: string | null
          progresso_pct: number | null
          recebido: number | null
          status: string | null
          streams_entregues: number | null
          streams_previstos: number | null
          track_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
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
      v_catalog_distribution_plans: {
        Row: {
          artist_name: string | null
          catalog_track_id: string | null
          completed_at: string | null
          expected_end_at: string | null
          id: string | null
          next_wave_at: string | null
          percent_done: number | null
          started_at: string | null
          status: string | null
          total_distributed: number | null
          total_eligible: number | null
          total_pending: number | null
          total_skipped: number | null
          track_name: string | null
          window_days: number | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_distribution_plans_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "catalog_tracks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_distribution_plans_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_distribution_stats"
            referencedColumns: ["catalog_track_id"]
          },
          {
            foreignKeyName: "catalog_distribution_plans_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_performance"
            referencedColumns: ["catalog_track_id"]
          },
          {
            foreignKeyName: "catalog_distribution_plans_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_telemetry"
            referencedColumns: ["catalog_track_id"]
          },
        ]
      }
      v_catalog_occupancy_by_genre: {
        Row: {
          above_ceiling: number | null
          at_ceiling: number | null
          below_ceiling: number | null
          catalog_current: number | null
          catalog_missing: number | null
          catalog_target: number | null
          current_total: number | null
          effective_ceiling_total: number | null
          free_slots_total: number | null
          genre_key: string | null
          genre_name: string | null
          planned_ceiling_total: number | null
          playlists: number | null
          third_party_current: number | null
          third_party_excess: number | null
          third_party_target: number | null
        }
        Relationships: []
      }
      v_catalog_origin_summary: {
        Row: {
          distinct_tracks: number | null
          origin: string | null
          positions: number | null
        }
        Relationships: []
      }
      v_catalog_playlist_occupancy: {
        Row: {
          active_placements: number | null
          active_placements_catalog: number | null
          archived_at: string | null
          available_slots: number | null
          campaign_count: number | null
          campaign_reserved_slots: number | null
          catalog_capacity: number | null
          catalog_count: number | null
          catalog_missing: number | null
          catalog_target: number | null
          cover_url: string | null
          effective_ceiling: number | null
          free_slots: number | null
          genre_id: string | null
          managed_playlist_id: string | null
          planned_ceiling: number | null
          playlist_name: string | null
          third_party_count: number | null
          third_party_excess: number | null
          third_party_max_pct: number | null
          third_party_target: number | null
          total_current: number | null
          tracks_count: number | null
        }
        Relationships: []
      }
      v_catalog_track_distribution_stats: {
        Row: {
          artist_name: string | null
          catalog_track_id: string | null
          first_placement_at: string | null
          genre_id: string | null
          isrc: string | null
          last_active_at: string | null
          placements_active: number | null
          placements_failed: number | null
          placements_pending: number | null
          placements_removed: number | null
          placements_total: number | null
          track_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_tracks_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_tracks_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres_with_health"
            referencedColumns: ["id"]
          },
        ]
      }
      v_catalog_track_performance: {
        Row: {
          added_at: string | null
          artist_name: string | null
          baseline_artist_followers: number | null
          baseline_date: string | null
          baseline_monthly: number | null
          baseline_popularity: number | null
          baseline_spotify_followers: number | null
          catalog_track_id: string | null
          cover_url: string | null
          current_artist_followers: number | null
          current_date: string | null
          current_monthly: number | null
          current_popularity: number | null
          current_spotify_followers: number | null
          delta_artist_followers: number | null
          delta_monthly: number | null
          delta_popularity: number | null
          delta_spotify_followers: number | null
          isrc: string | null
          pct_monthly_growth: number | null
          spotify_track_id: string | null
          track_name: string | null
        }
        Relationships: []
      }
      v_catalog_track_playlist_attribution: {
        Row: {
          catalog_track_id: string | null
          current_plays_7d: number | null
          current_position: number | null
          first_seen_at: string | null
          last_seen_at: string | null
          name: string | null
          observations: number | null
          owner: string | null
          spotify_playlist_id: string | null
          spotify_url: string | null
          status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "song_snapshots_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "catalog_tracks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "song_snapshots_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_distribution_stats"
            referencedColumns: ["catalog_track_id"]
          },
          {
            foreignKeyName: "song_snapshots_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_performance"
            referencedColumns: ["catalog_track_id"]
          },
          {
            foreignKeyName: "song_snapshots_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_telemetry"
            referencedColumns: ["catalog_track_id"]
          },
        ]
      }
      v_catalog_track_telemetry: {
        Row: {
          artist_name: string | null
          baseline_at: string | null
          baseline_plays_28d: number | null
          catalog_track_id: string | null
          growth_abs: number | null
          growth_pct: number | null
          last_captured_at: string | null
          last_plays_28d: number | null
          playlists_present_count: number | null
          snapshots_count: number | null
          spotify_track_id: string | null
          status: string | null
          total_plays_7d_from_playlists: number | null
          track_name: string | null
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
      v_curator_library: {
        Row: {
          curator_id: string | null
          first_seen_at: string | null
          followers: number | null
          image_url: string | null
          is_ecosystem: boolean | null
          last_used_at: string | null
          playlist_name: string | null
          spotify_dead: boolean | null
          spotify_owner_id: string | null
          spotify_owner_name: string | null
          spotify_playlist_id: string | null
          spotify_url: string | null
          streams_7d_total: number | null
          streams_lifetime_total: number | null
          times_used: number | null
          user_id: string | null
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
          is_initial_roster: boolean | null
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
          is_initial_roster?: boolean | null
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
          is_initial_roster?: boolean | null
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
      v_occupancy_executor_metrics: {
        Row: {
          avg_rebuild_ms: number | null
          bucket: string | null
          executed: number | null
          executor_status: string | null
          failed: number | null
          mode: string | null
          ops_total: number | null
          partial: number | null
          plans: number | null
        }
        Relationships: []
      }
      v_occupancy_rebuild_metrics: {
        Row: {
          avg_ms: number | null
          blocked: number | null
          bucket: string | null
          errors: number | null
          executed: number | null
          no_change: number | null
          pending: number | null
          processing: number | null
          total: number | null
          trigger_source: string | null
        }
        Relationships: []
      }
      v_placement_priority_latest: {
        Row: {
          artist_name: string | null
          calculated_at: string | null
          catalog_track_id: string | null
          components: Json | null
          managed_playlist_id: string | null
          placement_id: string | null
          score: number | null
          spotify_artist_id: string | null
          track_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_placements_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "catalog_tracks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_placements_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_distribution_stats"
            referencedColumns: ["catalog_track_id"]
          },
          {
            foreignKeyName: "catalog_placements_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_performance"
            referencedColumns: ["catalog_track_id"]
          },
          {
            foreignKeyName: "catalog_placements_catalog_track_id_fkey"
            columns: ["catalog_track_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_track_telemetry"
            referencedColumns: ["catalog_track_id"]
          },
          {
            foreignKeyName: "catalog_placements_managed_playlist_id_fkey"
            columns: ["managed_playlist_id"]
            isOneToOne: false
            referencedRelation: "managed_playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_placements_managed_playlist_id_fkey"
            columns: ["managed_playlist_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_playlist_occupancy"
            referencedColumns: ["managed_playlist_id"]
          },
          {
            foreignKeyName: "catalog_placements_managed_playlist_id_fkey"
            columns: ["managed_playlist_id"]
            isOneToOne: false
            referencedRelation: "v_playlist_vps_assignment"
            referencedColumns: ["managed_playlist_id"]
          },
          {
            foreignKeyName: "placement_priority_scores_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "catalog_placements"
            referencedColumns: ["id"]
          },
        ]
      }
      v_playlist_track_origin: {
        Row: {
          campaign_id: string | null
          managed_playlist_id: string | null
          origin: string | null
          position: number | null
          spotify_track_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "managed_playlist_tracks_playlist_id_fkey"
            columns: ["managed_playlist_id"]
            isOneToOne: false
            referencedRelation: "managed_playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "managed_playlist_tracks_playlist_id_fkey"
            columns: ["managed_playlist_id"]
            isOneToOne: false
            referencedRelation: "v_catalog_playlist_occupancy"
            referencedColumns: ["managed_playlist_id"]
          },
          {
            foreignKeyName: "managed_playlist_tracks_playlist_id_fkey"
            columns: ["managed_playlist_id"]
            isOneToOne: false
            referencedRelation: "v_playlist_vps_assignment"
            referencedColumns: ["managed_playlist_id"]
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
            referencedRelation: "v_campaign_overview"
            referencedColumns: ["campaign_id"]
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
      v_spotify_app_access_blocks_summary: {
        Row: {
          app_id: string | null
          app_name: string | null
          client_id: string | null
          error_count: number | null
          first_seen: string | null
          last_seen: string | null
          playlist_name: string | null
          playlist_owner_id: string | null
          playlist_owner_name: string | null
          playlist_url: string | null
          reason: string | null
          sample_error: string | null
          spotify_playlist_id: string | null
          spotify_user_id: string | null
          spotify_user_name: string | null
          spotify_user_url: string | null
        }
        Relationships: [
          {
            foreignKeyName: "spotify_app_access_blocks_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "spotify_app_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spotify_app_access_blocks_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "spotify_apps"
            referencedColumns: ["id"]
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
      _begin_canonical_op: { Args: never; Returns: undefined }
      _is_user_jwt_caller: { Args: never; Returns: boolean }
      _normalize_notification_type: {
        Args: { p_type: string }
        Returns: Database["public"]["Enums"]["notification_type"]
      }
      _validate_campaign_activation: {
        Args: { c: Database["public"]["Tables"]["campaigns"]["Row"] }
        Returns: string
      }
      accept_community_invite: { Args: { p_code: string }; Returns: Json }
      activate_campaign: { Args: { p_campaign_id: string }; Returns: Json }
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
      append_print_to_batch: {
        Args: {
          p_batch_id: string
          p_correlation?: string
          p_dom: Json
          p_path: string
          p_signed_url: string
        }
        Returns: {
          batch_id: string
          dom_payload: Json
          is_complete: boolean
          print_paths: Json
          print_urls: Json
          received_parts: number
          status: string
          total_parts: number
          was_duplicate: boolean
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
      approve_campaign_plan: { Args: { p_campaign_id: string }; Returns: Json }
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
      cancel_campaign: { Args: { p_campaign_id: string }; Returns: Json }
      capture_baseline: { Args: { p_campaign_id: string }; Returns: Json }
      claim_collect_queue: {
        Args: { p_ids: string[] }
        Returns: {
          id: string
        }[]
      }
      claim_next_catalog_placements: {
        Args: { _limit?: number; _worker: string }
        Returns: {
          added_at: string | null
          attempts: number
          catalog_track_id: string
          created_at: string
          distribution_batch_id: string | null
          id: string
          last_error_code: string | null
          lease_expires_at: string | null
          locked_at: string | null
          locked_by: string | null
          managed_playlist_id: string
          max_attempts: number
          origin: string
          position: number | null
          priority: number
          removed_at: string | null
          removed_reason: string | null
          scheduled_for: string
          skip_reason: string | null
          skipped_at: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "catalog_placements"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_next_catalog_snapshots: {
        Args: {
          p_lease_seconds?: number
          p_limit?: number
          p_worker_id: string
        }
        Returns: {
          attempts: number
          catalog_track_id: string
          id: string
          lease_expires_at: string
          priority: number
          reason: string
          spotify_track_id: string
        }[]
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
      claim_playlist_for_deal: {
        Args: {
          _deal_id: string
          _followers?: number
          _image_url?: string
          _playlist_name: string
          _spotify_owner_id?: string
          _spotify_owner_name?: string
          _spotify_playlist_id: string
          _spotify_url: string
        }
        Returns: Json
      }
      claim_spotify_enrichment_jobs: {
        Args: { _limit?: number; _worker: string }
        Returns: {
          attempts: number
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          done_at: string | null
          id: string
          kind: string
          last_error: string | null
          max_attempts: number
          priority: number
          reason: string
          ref_id: string
          scheduled_for: string
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "spotify_enrichment_queue"
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
      close_campaign: {
        Args: { p_campaign_id: string; p_force?: boolean }
        Returns: Json
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
      compute_placement_priority: {
        Args: { _placement_id: string }
        Returns: {
          calculated_at: string
          components: Json
          score: number
        }[]
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
      cron_advisory_unlock: { Args: { p_key: number }; Returns: boolean }
      cron_try_advisory_lock: { Args: { p_key: number }; Returns: boolean }
      default_cooldown_days: {
        Args: { _action: Database["public"]["Enums"]["curatorial_action_type"] }
        Returns: number
      }
      delete_campaign: { Args: { p_campaign_id: string }; Returns: Json }
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
      distribute_catalog_track: {
        Args: {
          p_added_by?: string
          p_artist_name?: string
          p_baseline_monthly_listeners?: number
          p_baseline_popularity?: number
          p_baseline_raw?: Json
          p_baseline_streams?: number
          p_cover_url?: string
          p_genre_id: string
          p_isrc?: string
          p_spotify_track_id: string
          p_spotify_uri?: string
          p_track_name?: string
        }
        Returns: Json
      }
      distribute_catalog_track_v1: {
        Args: {
          p_added_by?: string
          p_artist_name?: string
          p_baseline_monthly_listeners?: number
          p_baseline_popularity?: number
          p_baseline_raw?: Json
          p_baseline_streams?: number
          p_cover_url?: string
          p_genre_id: string
          p_isrc?: string
          p_spotify_track_id: string
          p_spotify_uri?: string
          p_track_name?: string
        }
        Returns: Json
      }
      engine_backfill_legacy_distribution_plan: {
        Args: { _days?: number; _track_id: string }
        Returns: string
      }
      engine_create_distribution_plan: {
        Args: { _days?: number; _track_id: string }
        Returns: string
      }
      engine_create_distribution_plan_v1: {
        Args: { _days?: number; _track_id: string }
        Returns: string
      }
      engine_priority_compute_all: {
        Args: { _limit?: number }
        Returns: string
      }
      engine_propose_playlist_occupancy: {
        Args: {
          p_max_per_playlist?: number
          p_max_playlists?: number
          p_playlist_id?: string
        }
        Returns: string
      }
      engine_run_distribution_wave: {
        Args: { _limit?: number }
        Returns: {
          distributed: number
          remaining: number
          skipped: number
        }[]
      }
      engine_run_distribution_wave_v1: {
        Args: { _limit?: number }
        Returns: {
          distributed: number
          remaining: number
          skipped: number
        }[]
      }
      engine_try_consume_target: {
        Args: { _now: string; _target_id: string }
        Returns: boolean
      }
      enqueue_baseline_collection: {
        Args: { p_campaign_id: string }
        Returns: undefined
      }
      enqueue_catalog_snapshots_due: { Args: never; Returns: Json }
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
      evaluate_upload_quarantine: {
        Args: { p_content_hash: string; p_deal_id: string; p_rows: Json }
        Returns: Json
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
      fn_campaign_delivery_accumulated: {
        Args: { p_campaign_id: string }
        Returns: {
          curator_plays: number
          eco_plays: number
          observed_plays: number
          organic_plays: number
          total_plays: number
        }[]
      }
      fn_campaign_playlist_growth: {
        Args: { p_campaign_ids: string[] }
        Returns: {
          attributed_to: string
          baseline_at: string
          baseline_name: string
          baseline_plays: number
          campaign_id: string
          current_name: string
          current_plays: number
          delivery_accumulated: number
          delta: number
          first_seen_at: string
          last_captured_at: string
          last_import_delta: number
          playlist_id: string
          playlist_url: string
        }[]
      }
      fn_curator_delivery_accumulated: {
        Args: { p_campaign_id: string }
        Returns: {
          curator_id: string
          delivery_accumulated: number
          playlists_count: number
        }[]
      }
      fn_deal_delivery_accumulated: {
        Args: { p_deal_id: string }
        Returns: number
      }
      fn_enqueue_catalog_test_snapshot: {
        Args: { p_catalog_track_id: string }
        Returns: {
          catalog_track_id: string
          queue_id: string
          reason: string
          scheduled_for: string
          spotify_track_id: string
          status: string
        }[]
      }
      fn_enqueue_occupancy_rebuild: {
        Args: {
          p_payload?: Json
          p_playlist_id: string
          p_trigger_source: string
        }
        Returns: string
      }
      fn_occupancy_claim_executable_plans: {
        Args: { p_limit?: number }
        Returns: {
          managed_playlist_id: string
          mode: string
          ops_count: number
          plan_id: string
        }[]
      }
      fn_playlist_delivery_accumulated: {
        Args: { p_campaign_id: string }
        Returns: {
          current_reading: number
          delivery_accumulated: number
          last_import_delta: number
          last_reading_at: string
          playlist_id: string
          readings_count: number
        }[]
      }
      fn_playlist_occupancy_rebuild: {
        Args: {
          p_mode?: string
          p_playlist_id: string
          p_trigger_source?: string
        }
        Returns: string
      }
      fn_playlist_occupancy_rebuild_batch: {
        Args: { p_limit?: number; p_policy_type?: string }
        Returns: {
          plan_id: string
          playlist_id: string
        }[]
      }
      fn_process_occupancy_rebuild_queue: {
        Args: { p_limit?: number }
        Returns: {
          duration_ms: number
          ops: number
          plan_id: string
          playlist_id: string
          queue_id: string
          result_status: string
        }[]
      }
      fn_reconcile_catalog_pending: {
        Args: { p_dry_run?: boolean; p_genre_id?: string; p_track_id?: string }
        Returns: {
          alive_placements: number
          already_present: number
          catalog_track_id: string
          eligible_playlists: number
          genre_id: string
          pending_created: number
          track_name: string
        }[]
      }
      fn_resolve_playlist_policy: {
        Args: { p_playlist_id: string }
        Returns: {
          campaign_reserved_slots: number
          catalog_capacity: number
          intercalation_ratio: number
          managed_playlist_id: string
          operational_ceiling: number
          protect_top_n: number
          source: string
          third_party_max_pct: number
        }[]
      }
      force_close_spotify_circuit_breaker: {
        Args: { p_app_id: string; p_context?: string }
        Returns: Json
      }
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
      get_campaign_baseline: {
        Args: { p_campaign_id: string; p_spotify_playlist_id?: string }
        Returns: {
          baseline_plays: number
          campaign_id: string
          captured_at: string
          deal_id: string
          playlist_name: string
          song_id: string
          source: string
          spotify_playlist_id: string
        }[]
      }
      get_campaign_capabilities: {
        Args: { p_campaign_id: string }
        Returns: Json
      }
      get_campaign_playlist_growth: {
        Args: { p_campaign_id: string }
        Returns: {
          attributed_to: string
          baseline_at: string
          baseline_name: string
          baseline_plays: number
          campaign_id: string
          current_name: string
          current_plays: number
          delivery_accumulated: number
          delta: number
          first_seen_at: string
          last_captured_at: string
          last_import_delta: number
          playlist_id: string
          playlist_url: string
        }[]
      }
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
      get_cron_last_success: { Args: { p_fn_name: string }; Returns: string }
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
      get_spotify_app_access_blocks: {
        Args: never
        Returns: {
          app_id: string | null
          app_name: string | null
          client_id: string | null
          error_count: number | null
          first_seen: string | null
          last_seen: string | null
          playlist_name: string | null
          playlist_owner_id: string | null
          playlist_owner_name: string | null
          playlist_url: string | null
          reason: string | null
          sample_error: string | null
          spotify_playlist_id: string | null
          spotify_user_id: string | null
          spotify_user_name: string | null
          spotify_user_url: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "v_spotify_app_access_blocks_summary"
          isOneToOne: false
          isSetofReturn: true
        }
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
      list_open_spotify_breakers: {
        Args: never
        Returns: {
          app_id: string
          app_name: string
          blocked_until: string
          context: string
          last_429_at: string
          retry_after_sec: number
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
      mark_all_notifications_read: {
        Args: { p_user_id?: string }
        Returns: number
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
      pause_campaign: { Args: { p_campaign_id: string }; Returns: Json }
      pick_next_account: {
        Args: { p_app_id?: string; p_purpose?: string }
        Returns: {
          account_id: string
          app_id: string
          slots_remaining: number
          spotify_user_id: string
        }[]
      }
      pick_spotify_app: {
        Args: { p_purpose?: string }
        Returns: {
          capacity_score: number
          client_id: string
          client_secret: string
          health_score: number
          id: string
          name: string
          purpose: string
        }[]
      }
      preview_distribute_catalog_track: {
        Args: { p_genre_id: string; p_spotify_track_id: string }
        Returns: Json
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
      quarantine_spotify_app_dev_mode: {
        Args: { p_app_id: string; p_spotify_user_id?: string }
        Returns: undefined
      }
      raise_spotify_balancer_alert: {
        Args: {
          p_app_id: string
          p_kind: string
          p_message: string
          p_metadata?: Json
          p_severity: string
          p_title: string
        }
        Returns: undefined
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      reap_dead_cron_runs: {
        Args: { p_max_age_minutes?: number }
        Returns: number
      }
      reap_zombie_catalog_placements: { Args: never; Returns: number }
      reap_zombie_playlist_jobs: { Args: never; Returns: number }
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
          p_is_initial_capture: boolean
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
      resolve_notifications_by_dedupe: {
        Args: { p_dedupe_key: string; p_resolution_message?: string }
        Returns: number
      }
      resume_campaign: { Args: { p_campaign_id: string }; Returns: Json }
      revoke_public_token: {
        Args: {
          _actor?: string
          _correlation_id?: string
          _entity_id: string
          _ip?: string
          _kind: string
          _reason?: string
        }
        Returns: Json
      }
      rotate_public_token: {
        Args: {
          _actor?: string
          _correlation_id?: string
          _entity_id: string
          _ip?: string
          _kind: string
          _ttl_days?: number
        }
        Returns: Json
      }
      set_campaign_price: {
        Args: { p_campaign_id: string; p_valor: number }
        Returns: Json
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
      sweep_spotify_balancer_alerts: { Args: never; Returns: undefined }
      sync_campaign_curator_playlist_attribution: {
        Args: { p_campaign_id: string; p_playlist_id?: string }
        Returns: number
      }
      sync_campaign_deals_baseline: {
        Args: { p_campaign_id: string }
        Returns: Json
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
      validate_public_token_state: {
        Args: { _expires_at: string; _revoked_at: string }
        Returns: string
      }
    }
    Enums: {
      analysis_snapshot_status: "processing" | "ready" | "failed" | "superseded"
      analysis_snapshot_step: "sync" | "dna" | "diagnose" | "brain" | "score"
      analysis_snapshot_trigger:
        | "auto_sync"
        | "tracks_changed"
        | "meta_changed"
        | "cover_changed"
        | "manual_reanalyze"
        | "import"
        | "reactivation"
        | "cron_catalog"
        | "observer"
      analysis_step_status:
        | "pending"
        | "running"
        | "done"
        | "failed"
        | "timeout"
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
      analysis_snapshot_status: ["processing", "ready", "failed", "superseded"],
      analysis_snapshot_step: ["sync", "dna", "diagnose", "brain", "score"],
      analysis_snapshot_trigger: [
        "auto_sync",
        "tracks_changed",
        "meta_changed",
        "cover_changed",
        "manual_reanalyze",
        "import",
        "reactivation",
        "cron_catalog",
        "observer",
      ],
      analysis_step_status: ["pending", "running", "done", "failed", "timeout"],
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
