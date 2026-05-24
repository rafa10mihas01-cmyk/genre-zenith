ALTER TABLE public.playlist_execution_jobs
  ADD COLUMN IF NOT EXISTS from_position integer,
  ADD COLUMN IF NOT EXISTS to_position integer;

ALTER TABLE public.playlist_execution_jobs
  DROP CONSTRAINT IF EXISTS playlist_execution_jobs_job_type_check;

ALTER TABLE public.playlist_execution_jobs
  ADD CONSTRAINT playlist_execution_jobs_job_type_check
  CHECK (job_type = ANY (ARRAY[
    'playlist.track.add'::text,
    'playlist.track.remove'::text,
    'playlist.track.reorder'::text
  ]));