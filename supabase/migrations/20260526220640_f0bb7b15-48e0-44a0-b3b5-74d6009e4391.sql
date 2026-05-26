
CREATE OR REPLACE FUNCTION public.notify_playlist_job_failed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_playlist_name text;
  v_campaign_owner uuid;
  v_track_name text;
  v_job_label text;
BEGIN
  -- só dispara na transição para 'failed'
  IF NEW.status <> 'failed' OR COALESCE(OLD.status, '') = 'failed' THEN
    RETURN NEW;
  END IF;

  -- playlist (via managed_playlists pelo spotify_playlist_id)
  SELECT mp.name INTO v_playlist_name
  FROM public.managed_playlists mp
  WHERE mp.spotify_playlist_id = NEW.spotify_playlist_id
  LIMIT 1;
  v_playlist_name := COALESCE(v_playlist_name, NEW.spotify_playlist_id, 'playlist desconhecida');

  -- dono da campanha
  IF NEW.campaign_id IS NOT NULL THEN
    SELECT c.created_by, c.track_name
      INTO v_campaign_owner, v_track_name
    FROM public.campaigns c
    WHERE c.id = NEW.campaign_id
    LIMIT 1;
  END IF;

  -- sem dono não há a quem notificar
  IF v_campaign_owner IS NULL THEN
    RETURN NEW;
  END IF;

  v_job_label := CASE NEW.job_type
    WHEN 'playlist.track.add' THEN 'Adição'
    WHEN 'playlist.track.reorder' THEN 'Reordenação'
    ELSE NEW.job_type
  END;

  INSERT INTO public.notifications (user_id, type, title, message, action_url, metadata)
  VALUES (
    v_campaign_owner,
    'warning'::public.notification_type,
    'Job falhou: ' || v_job_label || ' em ' || v_playlist_name,
    COALESCE(NEW.last_error, 'Falhou após ' || COALESCE(NEW.attempts, 0) || ' tentativa(s).')
      || CASE WHEN v_track_name IS NOT NULL THEN ' (' || v_track_name || ')' ELSE '' END,
    CASE WHEN NEW.campaign_id IS NOT NULL
         THEN '/campanhas/' || NEW.campaign_id::text || '/execucao'
         ELSE NULL
    END,
    jsonb_build_object(
      'job_id', NEW.id,
      'job_type', NEW.job_type,
      'campaign_id', NEW.campaign_id,
      'spotify_playlist_id', NEW.spotify_playlist_id,
      'spotify_track_id', NEW.spotify_track_id,
      'attempts', NEW.attempts,
      'max_attempts', NEW.max_attempts,
      'last_error', NEW.last_error
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_playlist_job_failed ON public.playlist_execution_jobs;
CREATE TRIGGER trg_notify_playlist_job_failed
AFTER UPDATE OF status ON public.playlist_execution_jobs
FOR EACH ROW
WHEN (NEW.status = 'failed' AND NEW.job_type IN ('playlist.track.add', 'playlist.track.reorder'))
EXECUTE FUNCTION public.notify_playlist_job_failed();
