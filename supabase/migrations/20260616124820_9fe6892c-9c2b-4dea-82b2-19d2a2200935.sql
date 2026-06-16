-- Corrige FK violation em catalog_snapshot_queue.
-- O trigger BEFORE INSERT 'catalog_track_baseline_enqueue' tentava inserir
-- em catalog_snapshot_queue referenciando NEW.id antes da linha existir em
-- catalog_tracks, causando 23503. O enqueue já é feito corretamente pelo
-- trigger AFTER 'trg_catalog_tracks_enqueue_baseline'. Aqui mantemos só o
-- side-effect de agendar next_auto_collect_at (que precisa rodar em BEFORE).
CREATE OR REPLACE FUNCTION public.tg_catalog_track_enqueue_baseline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'active' AND NEW.next_auto_collect_at IS NULL THEN
    NEW.next_auto_collect_at :=
      now() + make_interval(mins => COALESCE(NEW.auto_collect_interval_minutes, 2880));
  END IF;
  RETURN NEW;
END;
$function$;