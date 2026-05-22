CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TABLE public.pricing_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  cost_per_stream_eco numeric NOT NULL DEFAULT 0.028,
  cost_per_stream_ext numeric NOT NULL DEFAULT 0.040,
  price_per_stream_sell numeric NOT NULL DEFAULT 0.080,
  target_margin_pct numeric NOT NULL DEFAULT 50,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pricing_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner reads pricing" ON public.pricing_settings
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Owner inserts pricing" ON public.pricing_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner updates pricing" ON public.pricing_settings
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Owner deletes pricing" ON public.pricing_settings
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER pricing_settings_set_updated_at
  BEFORE UPDATE ON public.pricing_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();