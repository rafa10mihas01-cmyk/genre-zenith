-- A.1 Trigger cleanup spotify_oauth_states (função já existe)
DROP TRIGGER IF EXISTS trg_cleanup_spotify_oauth_states ON public.spotify_oauth_states;
CREATE TRIGGER trg_cleanup_spotify_oauth_states
AFTER INSERT ON public.spotify_oauth_states
FOR EACH STATEMENT
EXECUTE FUNCTION public.cleanup_spotify_oauth_states();

-- A.2 Decrementar current_playlists ao arquivar/deletar template
CREATE OR REPLACE FUNCTION public.decrement_account_on_template_release()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_owner text;
BEGIN
  -- DELETE: decrementar se template estava publicado
  IF TG_OP = 'DELETE' THEN
    v_owner := OLD.spotify_owner_id;
    IF v_owner IS NOT NULL AND OLD.spotify_playlist_id IS NOT NULL THEN
      UPDATE public.accounts
        SET current_playlists = GREATEST(current_playlists - 1, 0),
            updated_at = now()
      WHERE spotify_user_id = v_owner;
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE: decrementar se transitou para archived (e estava publicada)
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'archived'
       AND OLD.status <> 'archived'
       AND OLD.spotify_playlist_id IS NOT NULL
       AND OLD.spotify_owner_id IS NOT NULL THEN
      UPDATE public.accounts
        SET current_playlists = GREATEST(current_playlists - 1, 0),
            updated_at = now()
      WHERE spotify_user_id = OLD.spotify_owner_id;
    END IF;
    RETURN NEW;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_decrement_account_on_template_archive ON public.playlist_templates;
CREATE TRIGGER trg_decrement_account_on_template_archive
AFTER UPDATE OF status ON public.playlist_templates
FOR EACH ROW
EXECUTE FUNCTION public.decrement_account_on_template_release();

DROP TRIGGER IF EXISTS trg_decrement_account_on_template_delete ON public.playlist_templates;
CREATE TRIGGER trg_decrement_account_on_template_delete
AFTER DELETE ON public.playlist_templates
FOR EACH ROW
EXECUTE FUNCTION public.decrement_account_on_template_release();

-- Constraint: current_playlists não pode ser negativo
ALTER TABLE public.accounts
  DROP CONSTRAINT IF EXISTS accounts_current_playlists_non_negative;
ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_current_playlists_non_negative
  CHECK (current_playlists >= 0);

-- A.3 CHECK em performance_class — primeiro normaliza dados existentes
UPDATE public.playlist_templates
   SET performance_class = lower(trim(performance_class))
 WHERE performance_class IS NOT NULL
   AND performance_class <> lower(trim(performance_class));

-- Mapeia valores fora do canon para NULL (não vamos perder dados, mas não validar)
UPDATE public.playlist_templates
   SET performance_class = NULL
 WHERE performance_class IS NOT NULL
   AND performance_class NOT IN ('alta','media','baixa');

ALTER TABLE public.playlist_templates
  DROP CONSTRAINT IF EXISTS playlist_templates_performance_class_check;
ALTER TABLE public.playlist_templates
  ADD CONSTRAINT playlist_templates_performance_class_check
  CHECK (performance_class IS NULL OR performance_class IN ('alta','media','baixa'));

-- A.4 Limites do bucket playlist-covers (2MB, image/jpeg|png|webp)
UPDATE storage.buckets
   SET file_size_limit = 2097152,
       allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']
 WHERE id = 'playlist-covers';

-- C.1 (aproveitando esta migration) — drop índices duplicados
DROP INDEX IF EXISTS public.idx_collection_logs_created_at;        -- duplicata de idx_collection_logs_created
DROP INDEX IF EXISTS public.idx_metrics_snapshots_template_collected; -- duplicata
DROP INDEX IF EXISTS public.idx_playlist_metrics_snap_collected;      -- duplicata (mantém idx_pms_template)
