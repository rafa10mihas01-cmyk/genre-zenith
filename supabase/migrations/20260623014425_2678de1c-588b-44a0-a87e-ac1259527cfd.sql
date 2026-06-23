CREATE OR REPLACE FUNCTION public.tg_collections_orphan_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_is_bot_snapshot boolean;
BEGIN
  v_is_bot_snapshot :=
    COALESCE(NEW.is_baseline, false) = false
    AND NEW.upload_id IS NULL
    AND (
      NEW.snapshot_run_id IS NOT NULL
      OR COALESCE(NEW.source, '') IN ('s4a_dom', 'bot', 'spotify_for_artists')
    );

  -- Coletas automáticas do bot não têm upload_id por desenho: o vínculo de prova
  -- é snapshot_run_id -> bot_print_batches. Não podem ser auto-excluídas.
  IF v_is_bot_snapshot THEN
    NEW.excluded := false;
    IF NEW.exclusion_reason IN ('orphan_no_upload_id', 'phase_5b3_orphan_no_upload_id') THEN
      NEW.exclusion_reason := NULL;
    END IF;
    RETURN NEW;
  END IF;

  -- Blindagem continua valendo para linhas realmente órfãs de importação manual.
  IF NEW.upload_id IS NULL AND COALESCE(NEW.is_baseline, false) = false THEN
    NEW.excluded := true;
    NEW.exclusion_reason := COALESCE(NEW.exclusion_reason, 'orphan_no_upload_id');

    INSERT INTO public.system_alerts (severity, subsystem, title, message, dedupe_key, metadata)
    VALUES (
      'warning',
      'delivery',
      'Linha órfã marcada como excluded (blindagem 5.B.3)',
      format('Collection row %s sem upload_id foi auto-excluída', NEW.id),
      'orphan_collection_' || COALESCE(NEW.campaign_id::text,'?') || '_' || COALESCE(NEW.playlist_id,'?'),
      jsonb_build_object('campaign_id', NEW.campaign_id, 'playlist_id', NEW.playlist_id)
    )
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

UPDATE public.campaign_playlist_collections
   SET excluded = false,
       exclusion_reason = NULL
 WHERE COALESCE(is_baseline, false) = false
   AND upload_id IS NULL
   AND COALESCE(excluded, false) = true
   AND exclusion_reason IN ('orphan_no_upload_id', 'phase_5b3_orphan_no_upload_id')
   AND (
     snapshot_run_id IS NOT NULL
     OR COALESCE(source, '') IN ('s4a_dom', 'bot', 'spotify_for_artists')
   );

ANALYZE public.campaign_playlist_collections;