-- Tabela de eventos granulares do bot (cada passo do robô)
CREATE TABLE public.bot_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bot_name text NOT NULL DEFAULT 'spotify-artists-bot',
  session_id text,                          -- agrupa eventos de uma "rodada" do bot
  deal_id uuid,                             -- deal relacionado (opcional)
  song_id uuid,                             -- música relacionada (opcional)
  step text NOT NULL,                       -- ex: 'login', 'search_artist', 'open_artist', 'click_music_tab', 'filter_7d', 'scrape_playlists'
  status text NOT NULL DEFAULT 'running',   -- running | success | error | warning
  message text,                             -- texto humano: "Abrindo artista DJ CLEBER"
  screenshot_url text,                      -- print do estado (opcional)
  url text,                                 -- URL atual do navegador
  duration_ms integer,                      -- duração da etapa
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Índices p/ painel ao vivo
CREATE INDEX idx_bot_events_created_at ON public.bot_events (created_at DESC);
CREATE INDEX idx_bot_events_session ON public.bot_events (session_id, created_at DESC);
CREATE INDEX idx_bot_events_deal ON public.bot_events (deal_id, created_at DESC) WHERE deal_id IS NOT NULL;
CREATE INDEX idx_bot_events_status ON public.bot_events (status, created_at DESC);

-- RLS
ALTER TABLE public.bot_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY team_select_bot_events ON public.bot_events
  FOR SELECT TO authenticated USING (public.has_team_access());

CREATE POLICY team_insert_bot_events ON public.bot_events
  FOR INSERT TO authenticated WITH CHECK (public.has_team_access());

CREATE POLICY team_delete_bot_events ON public.bot_events
  FOR DELETE TO authenticated USING (public.has_team_access());

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.bot_events;
ALTER TABLE public.bot_events REPLICA IDENTITY FULL;