CREATE TABLE public.campaign_plan_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  old_playlist_id UUID,
  new_playlist_ids UUID[] DEFAULT '{}'::uuid[],
  reason TEXT,
  meta JSONB DEFAULT '{}'::jsonb,
  acted_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_cph_campaign ON public.campaign_plan_history(campaign_id, created_at DESC);

GRANT SELECT ON public.campaign_plan_history TO authenticated;
GRANT ALL ON public.campaign_plan_history TO service_role;

ALTER TABLE public.campaign_plan_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team can read plan history"
ON public.campaign_plan_history
FOR SELECT
TO authenticated
USING (public.has_team_access());
