
-- Tabela de plano diário por playlist
CREATE TABLE public.curator_deal_plan (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id UUID NOT NULL REFERENCES public.curator_deals(id) ON DELETE CASCADE,
  curator_playlist_id UUID NOT NULL REFERENCES public.curator_playlists(id) ON DELETE CASCADE,
  playlist_name TEXT NOT NULL,
  followers BIGINT NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 3,
  start_day INTEGER NOT NULL DEFAULT 1,
  cap_dia INTEGER NOT NULL DEFAULT 0,
  daily JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_streams INTEGER NOT NULL DEFAULT 0,
  engagement_mult INTEGER NOT NULL DEFAULT 30,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (deal_id, curator_playlist_id)
);

CREATE INDEX idx_curator_deal_plan_deal ON public.curator_deal_plan(deal_id);

ALTER TABLE public.curator_deal_plan ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner reads own deal plan"
ON public.curator_deal_plan FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.curator_deals d
    WHERE d.id = curator_deal_plan.deal_id AND d.user_id = auth.uid()
  )
);

-- Status de entrega
CREATE TABLE public.curator_deal_delivery_status (
  deal_id UUID NOT NULL PRIMARY KEY REFERENCES public.curator_deals(id) ON DELETE CASCADE,
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expected_to_date BIGINT NOT NULL DEFAULT 0,
  actual_to_date BIGINT NOT NULL DEFAULT 0,
  delta_pct NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'on_track',
  reason TEXT,
  spike_playlist_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.curator_deal_delivery_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner reads own delivery status"
ON public.curator_deal_delivery_status FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.curator_deals d
    WHERE d.id = curator_deal_delivery_status.deal_id AND d.user_id = auth.uid()
  )
);
