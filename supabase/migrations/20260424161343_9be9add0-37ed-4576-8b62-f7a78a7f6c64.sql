
-- Fase 1.1 — UNIQUE parcial em playlist_templates.spotify_playlist_id
CREATE UNIQUE INDEX IF NOT EXISTS uq_playlist_templates_spotify_playlist_id
  ON public.playlist_templates(spotify_playlist_id)
  WHERE spotify_playlist_id IS NOT NULL;

-- Fase 1.2 — UNIQUE em spotify_user_tokens.spotify_user_id
-- (limpa duplicatas mantendo a mais recente, se existirem)
DELETE FROM public.spotify_user_tokens a
USING public.spotify_user_tokens b
WHERE a.spotify_user_id = b.spotify_user_id
  AND a.updated_at < b.updated_at;

CREATE UNIQUE INDEX IF NOT EXISTS uq_spotify_user_tokens_spotify_user_id
  ON public.spotify_user_tokens(spotify_user_id);

-- Fase 1.3 — CHECK constraints (valores canônicos)
ALTER TABLE public.playlist_templates
  DROP CONSTRAINT IF EXISTS chk_playlist_templates_status,
  ADD CONSTRAINT chk_playlist_templates_status
    CHECK (status IN ('pending','approved','created','archived','rejected'));

ALTER TABLE public.playlist_templates
  DROP CONSTRAINT IF EXISTS chk_playlist_templates_perfclass,
  ADD CONSTRAINT chk_playlist_templates_perfclass
    CHECK (performance_class IS NULL OR performance_class IN ('alta','media','baixa'));

ALTER TABLE public.playlist_templates
  DROP CONSTRAINT IF EXISTS chk_playlist_templates_quality_tier,
  ADD CONSTRAINT chk_playlist_templates_quality_tier
    CHECK (quality_tier IN ('hot','medium','weak','archived'));

ALTER TABLE public.replication_rules
  DROP CONSTRAINT IF EXISTS chk_replication_rules_priority,
  ADD CONSTRAINT chk_replication_rules_priority
    CHECK (priority IN ('alta','media','baixa'));

ALTER TABLE public.replication_rules
  DROP CONSTRAINT IF EXISTS chk_replication_rules_confidence,
  ADD CONSTRAINT chk_replication_rules_confidence
    CHECK (confidence IN ('alta','media','baixa'));

ALTER TABLE public.playlist_blueprints
  DROP CONSTRAINT IF EXISTS chk_playlist_blueprints_priority,
  ADD CONSTRAINT chk_playlist_blueprints_priority
    CHECK (replication_priority IN ('alta','media','baixa'));

ALTER TABLE public.playlist_blueprints
  DROP CONSTRAINT IF EXISTS chk_playlist_blueprints_confidence,
  ADD CONSTRAINT chk_playlist_blueprints_confidence
    CHECK (confidence IN ('alta','media','baixa'));

-- Fase 1.4 — autovacuum agressivo nas tabelas com bloat alto
ALTER TABLE public.autopilot_runs SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.05
);
ALTER TABLE public.search_tracks SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.05
);

-- Fase 1.5 — índice composto pra DISTINCT ON em snapshots
CREATE INDEX IF NOT EXISTS idx_pms_template_collected_desc
  ON public.playlist_metrics_snapshots(template_id, collected_at DESC);

-- Fase 2.8 — trigger auto_create_account: só dispara quando spotify_user_id muda
DROP TRIGGER IF EXISTS trg_auto_create_account_for_token ON public.spotify_user_tokens;
CREATE TRIGGER trg_auto_create_account_for_token
  AFTER INSERT OR UPDATE OF spotify_user_id ON public.spotify_user_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_create_account_for_token();

-- ON CONFLICT explícito na função (corrige silenciamento genérico)
CREATE OR REPLACE FUNCTION public.auto_create_account_for_token()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.accounts (
    spotify_user_token_id, spotify_user_id, display_name, email,
    status, max_playlists, current_playlists
  )
  VALUES (
    NEW.id, NEW.spotify_user_id, COALESCE(NEW.display_name, NEW.spotify_user_id),
    NEW.email, 'active', 15, 0
  )
  ON CONFLICT (spotify_user_id) DO NOTHING;
  RETURN NEW;
END;
$function$;
