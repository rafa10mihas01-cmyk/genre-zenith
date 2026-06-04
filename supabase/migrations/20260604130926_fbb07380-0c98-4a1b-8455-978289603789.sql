ALTER TABLE public.campaigns ALTER COLUMN engagement_multiplier SET DEFAULT 35;
ALTER TABLE public.managed_playlists ADD COLUMN IF NOT EXISTS engagement_multiplier_override smallint NULL;
COMMENT ON COLUMN public.managed_playlists.engagement_multiplier_override IS 'Override manual do multiplicador saves→plays/mês para esta playlist específica. NULL = usa o multiplicador da campanha (padrão 35).';