CREATE TABLE IF NOT EXISTS public.bot_print_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  song_id uuid,
  batch_key text NOT NULL,
  total_parts int NOT NULL,
  received_parts int NOT NULL DEFAULT 0,
  print_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  print_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  processed_at timestamptz,
  UNIQUE (deal_id, song_id, batch_key)
);

CREATE INDEX IF NOT EXISTS idx_bot_print_batches_status ON public.bot_print_batches(status, created_at DESC);

ALTER TABLE public.bot_print_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_select_print_batches" ON public.bot_print_batches FOR SELECT TO authenticated USING (public.has_team_access());
CREATE POLICY "team_insert_print_batches" ON public.bot_print_batches FOR INSERT TO authenticated WITH CHECK (public.has_team_access());
CREATE POLICY "team_update_print_batches" ON public.bot_print_batches FOR UPDATE TO authenticated USING (public.has_team_access()) WITH CHECK (public.has_team_access());
CREATE POLICY "team_delete_print_batches" ON public.bot_print_batches FOR DELETE TO authenticated USING (public.has_team_access());

CREATE TRIGGER trg_bot_print_batches_updated_at
  BEFORE UPDATE ON public.bot_print_batches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();