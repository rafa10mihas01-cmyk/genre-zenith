-- Passo 3: Backup integral antes do cleanup
CREATE TABLE IF NOT EXISTS public.notifications_archive_phase1 AS
SELECT *, now() AS archived_at FROM public.notifications;

REVOKE ALL ON public.notifications_archive_phase1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.notifications_archive_phase1 TO service_role;

ALTER TABLE public.notifications_archive_phase1 ENABLE ROW LEVEL SECURITY;
-- Sem políticas: só service_role acessa via grant direto.