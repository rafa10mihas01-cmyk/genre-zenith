ALTER TABLE public.raw_chart_daily
  ADD COLUMN IF NOT EXISTS cover_url text,
  ADD COLUMN IF NOT EXISTS album_name text,
  ADD COLUMN IF NOT EXISTS popularity integer;

CREATE INDEX IF NOT EXISTS idx_raw_chart_daily_chartname_date
  ON public.raw_chart_daily (chart_name, chart_date DESC, position);