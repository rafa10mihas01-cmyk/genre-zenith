ALTER TABLE public.playlist_execution_jobs
ADD CONSTRAINT playlist_execution_jobs_playlist_id_fkey
FOREIGN KEY (playlist_id) REFERENCES public.playlists(id) ON DELETE CASCADE;