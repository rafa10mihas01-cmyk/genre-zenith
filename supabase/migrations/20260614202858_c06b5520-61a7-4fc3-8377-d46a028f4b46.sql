
-- Revert column-level revokes; keep team-wide read/write (operador = trusted staff)
GRANT SELECT (pix_key, pix_type, document) ON public.curators TO authenticated;
GRANT INSERT (pix_key, pix_type, document) ON public.curators TO authenticated;
GRANT UPDATE (pix_key, pix_type, document) ON public.curators TO authenticated;
