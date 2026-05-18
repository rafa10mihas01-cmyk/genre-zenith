-- Tabela raw para snapshots diários do Top 200 (kworb)
CREATE TABLE IF NOT EXISTS public.raw_chart_daily (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  chart_name TEXT NOT NULL DEFAULT 'top200_br',
  chart_date DATE NOT NULL,
  position INT NOT NULL,
  artist TEXT,
  track TEXT,
  streams_day BIGINT NOT NULL DEFAULT 0,
  streams_total BIGINT,
  spotify_track_id TEXT,
  spotify_artist_id TEXT,
  source TEXT NOT NULL DEFAULT 'kworb',
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT raw_chart_daily_unique UNIQUE (chart_name, chart_date, position)
);

CREATE INDEX IF NOT EXISTS idx_raw_chart_daily_date ON public.raw_chart_daily (chart_date DESC);
CREATE INDEX IF NOT EXISTS idx_raw_chart_daily_track ON public.raw_chart_daily (spotify_track_id);

ALTER TABLE public.raw_chart_daily ENABLE ROW LEVEL SECURITY;

-- Time autenticado pode ler tudo
CREATE POLICY "raw_chart_daily_select_authenticated"
ON public.raw_chart_daily FOR SELECT
TO authenticated
USING (true);

-- Habilita extensões para cron
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;