
-- Phase 5.B.3 — Blindagem: prevent orphan / unknown / no-reference-date uploads
-- from contaminating delivery calculations.

CREATE OR REPLACE FUNCTION public.tg_label_uploads_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason text := NULL;
BEGIN
  IF NEW.reference_date IS NULL THEN
    v_reason := 'missing_reference_date';
  ELSIF NEW.window_kind IS NULL OR NEW.window_kind = 'unknown' THEN
    v_reason := 'unknown_window_kind';
  END IF;

  IF v_reason IS NOT NULL THEN
    NEW.quarantined_at := COALESCE(NEW.quarantined_at, now());
    NEW.quarantine_reason := COALESCE(NEW.quarantine_reason, v_reason);
    NEW.status := 'quarantined';

    INSERT INTO public.system_alerts (severity, subsystem, title, message, dedupe_key, metadata)
    VALUES (
      'warning',
      'delivery',
      'Upload em quarentena (blindagem 5.B.3)',
      format('Upload %s colocado em quarentena: %s', NEW.id, v_reason),
      'upload_quarantine_' || NEW.id::text,
      jsonb_build_object('upload_id', NEW.id, 'reason', v_reason, 'reference_date', NEW.reference_date, 'window_kind', NEW.window_kind)
    )
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_label_uploads_guard ON public.label_spreadsheet_uploads;
CREATE TRIGGER trg_label_uploads_guard
  BEFORE INSERT OR UPDATE ON public.label_spreadsheet_uploads
  FOR EACH ROW EXECUTE FUNCTION public.tg_label_uploads_guard();

-- Guard collections: any row inserted without upload_id (non-baseline) is auto-excluded.
CREATE OR REPLACE FUNCTION public.tg_collections_orphan_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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
$$;

DROP TRIGGER IF EXISTS trg_collections_orphan_guard ON public.campaign_playlist_collections;
CREATE TRIGGER trg_collections_orphan_guard
  BEFORE INSERT ON public.campaign_playlist_collections
  FOR EACH ROW EXECUTE FUNCTION public.tg_collections_orphan_guard();
