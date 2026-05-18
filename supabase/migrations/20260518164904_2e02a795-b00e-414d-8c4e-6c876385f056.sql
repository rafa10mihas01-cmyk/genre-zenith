ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS engagement_multiplier smallint NOT NULL DEFAULT 30
  CHECK (engagement_multiplier BETWEEN 1 AND 200);

COMMENT ON COLUMN public.campaigns.engagement_multiplier IS
  'Plays/save/mês usado como estratégia da campanha. 18=conservador · 30=mercado · 50=altamente engajado. Reescala o teto de capacidade das playlists eco e a distribuição.';