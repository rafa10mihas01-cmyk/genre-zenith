CREATE TABLE IF NOT EXISTS public.chart_position_benchmarks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  database TEXT NOT NULL DEFAULT 'br',
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 200),
  streams_day BIGINT NOT NULL,
  captured_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (database, position, captured_at)
);

CREATE INDEX IF NOT EXISTS idx_chart_pos_db_pos ON public.chart_position_benchmarks(database, position);
CREATE INDEX IF NOT EXISTS idx_chart_pos_captured ON public.chart_position_benchmarks(captured_at DESC);

ALTER TABLE public.chart_position_benchmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chart_benchmarks read for team"
  ON public.chart_position_benchmarks FOR SELECT
  USING (public.has_team_access());

CREATE POLICY "chart_benchmarks insert admin"
  ON public.chart_position_benchmarks FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "chart_benchmarks update admin"
  ON public.chart_position_benchmarks FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "chart_benchmarks delete admin"
  ON public.chart_position_benchmarks FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));