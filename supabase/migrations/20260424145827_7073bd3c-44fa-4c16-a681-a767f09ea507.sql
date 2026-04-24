-- ════════════════════════════════════════════════════════════════════
-- Auditoria #9 — Fases A+B+C (apenas DB)
-- ════════════════════════════════════════════════════════════════════

-- ─── B.2: 1 só is_default em spotify_user_tokens ───
CREATE UNIQUE INDEX IF NOT EXISTS idx_spotify_user_tokens_one_default
  ON public.spotify_user_tokens(is_default) WHERE is_default = true;

-- ─── B.3: bloqueia reuso de oauth state ───
CREATE OR REPLACE FUNCTION public.prevent_oauth_state_reuse()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS NOT NULL
     AND OLD.consumed_at <> NEW.consumed_at THEN
    RAISE EXCEPTION 'oauth state already consumed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_oauth_state_reuse ON public.spotify_oauth_states;
CREATE TRIGGER trg_prevent_oauth_state_reuse
  BEFORE UPDATE ON public.spotify_oauth_states
  FOR EACH ROW EXECUTE FUNCTION public.prevent_oauth_state_reuse();

-- ─── B.4: bloqueia delete do último admin ───
CREATE OR REPLACE FUNCTION public.prevent_last_admin_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_remaining int;
BEGIN
  IF OLD.role <> 'admin'::public.app_role THEN
    RETURN OLD;
  END IF;
  SELECT COUNT(*) INTO v_remaining
    FROM public.user_roles
   WHERE role = 'admin'::public.app_role AND id <> OLD.id;
  IF v_remaining = 0 THEN
    RAISE EXCEPTION 'cannot delete the last admin' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_last_admin_delete ON public.user_roles;
CREATE TRIGGER trg_prevent_last_admin_delete
  BEFORE DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_last_admin_delete();

-- ─── B.6: reconciliação accounts.current_playlists ───
CREATE OR REPLACE FUNCTION public.reconcile_account_playlist_counts()
RETURNS TABLE(spotify_user_id text, before_count int, after_count int, drift int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH actual AS (
    SELECT t.spotify_owner_id AS uid, COUNT(*)::int AS real_count
      FROM public.playlist_templates t
     WHERE t.status = 'created'
       AND t.spotify_playlist_id IS NOT NULL
       AND t.spotify_owner_id IS NOT NULL
     GROUP BY t.spotify_owner_id
  ),
  upd AS (
    UPDATE public.accounts a
       SET current_playlists = COALESCE(act.real_count, 0),
           updated_at = now()
      FROM actual act
     WHERE a.spotify_user_id = act.uid
       AND a.current_playlists <> act.real_count
    RETURNING a.spotify_user_id, a.current_playlists AS new_c
  ),
  unmatched AS (
    UPDATE public.accounts a
       SET current_playlists = 0, updated_at = now()
     WHERE a.current_playlists > 0
       AND NOT EXISTS (SELECT 1 FROM actual act WHERE act.uid = a.spotify_user_id)
    RETURNING a.spotify_user_id, 0 AS new_c
  )
  SELECT u.spotify_user_id::text, NULL::int, u.new_c, NULL::int FROM upd u
  UNION ALL
  SELECT u.spotify_user_id::text, NULL::int, u.new_c, NULL::int FROM unmatched u;
END;
$$;

-- ─── A.4: força singleton em spotify_tokens (já tem unique, mas garantir 1 row) ───
DELETE FROM public.spotify_tokens WHERE singleton_key <> 'app';

-- ─── C.1: drop de 17 índices nunca usados ───
DROP INDEX IF EXISTS public.idx_accounts_status_capacity;
DROP INDEX IF EXISTS public.idx_genres_ativo_status;
DROP INDEX IF EXISTS public.idx_pl_blueprints_genre;
DROP INDEX IF EXISTS public.idx_pl_blueprints_score;
DROP INDEX IF EXISTS public.idx_pl_templates_score;
DROP INDEX IF EXISTS public.idx_playlist_templates_final_score;
DROP INDEX IF EXISTS public.idx_pms_spotify;
DROP INDEX IF EXISTS public.idx_replication_rules_type;
DROP INDEX IF EXISTS public.idx_search_results_revalidation_queue;
DROP INDEX IF EXISTS public.idx_search_tracks_genre_track;
DROP INDEX IF EXISTS public.idx_templates_genre_evaluated;
DROP INDEX IF EXISTS public.idx_genre_models_history_created_at;
DROP INDEX IF EXISTS public.idx_genre_models_history_genre_id;
DROP INDEX IF EXISTS public.idx_notifications_read;
DROP INDEX IF EXISTS public.idx_pi_scope;
DROP INDEX IF EXISTS public.idx_playlist_adjustments_genre;
DROP INDEX IF EXISTS public.idx_playlist_adjustments_template;