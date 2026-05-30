
-- Novo estado "awaiting_baseline" no fluxo do deal
ALTER TABLE public.curator_deals DROP CONSTRAINT IF EXISTS curator_deals_state_check;
ALTER TABLE public.curator_deals ADD CONSTRAINT curator_deals_state_check
  CHECK (state = ANY (ARRAY[
    'awaiting_baseline'::text,
    'awaiting_playlists'::text,
    'collecting'::text,
    'active'::text,
    'paused'::text,
    'completed'::text,
    'closed'::text
  ]));

-- Marca quando o bot terminou a 1ª captura baseline (S4A)
ALTER TABLE public.curator_deals
  ADD COLUMN IF NOT EXISTS baseline_captured_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_curator_deals_state_baseline
  ON public.curator_deals(state) WHERE baseline_captured_at IS NULL;

COMMENT ON COLUMN public.curator_deals.baseline_captured_at IS
  'Quando o bot completou a 1ª captura baseline no Spotify for Artists. NULL = deal ainda aguardando baseline; campanha não ativa até preencher.';
