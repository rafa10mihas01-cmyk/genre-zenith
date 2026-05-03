-- Coluna auto_collect e campos relacionados em curator_deal_songs
ALTER TABLE public.curator_deal_songs
  ADD COLUMN IF NOT EXISTS auto_collect boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_auto_collect_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_auto_collect_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_collect_interval_minutes integer NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS auto_collect_status text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS auto_collect_error text;

-- Índice para fila de coleta (busca rápida por candidatos)
CREATE INDEX IF NOT EXISTS idx_cds_auto_collect_queue
  ON public.curator_deal_songs (next_auto_collect_at)
  WHERE auto_collect = true;

-- Tabela de heartbeats do bot
CREATE TABLE IF NOT EXISTS public.bot_heartbeats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_name text NOT NULL DEFAULT 'spotify-artists-bot',
  status text NOT NULL DEFAULT 'online',
  spotify_session_valid boolean NOT NULL DEFAULT true,
  last_collect_at timestamptz,
  message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bot_heartbeats_created
  ON public.bot_heartbeats (bot_name, created_at DESC);

ALTER TABLE public.bot_heartbeats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_select_bot_heartbeats" ON public.bot_heartbeats
  FOR SELECT TO authenticated USING (public.has_team_access());
CREATE POLICY "team_insert_bot_heartbeats" ON public.bot_heartbeats
  FOR INSERT TO authenticated WITH CHECK (public.has_team_access());
CREATE POLICY "team_delete_bot_heartbeats" ON public.bot_heartbeats
  FOR DELETE TO authenticated USING (public.has_team_access());