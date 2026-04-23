
-- =========================================
-- 1) Realtime channel authorization for notifications
-- =========================================
-- Habilitar RLS em realtime.messages e permitir apenas membros da equipe
-- a se inscreverem em qualquer tópico de notifications.
ALTER TABLE IF EXISTS realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Team can read realtime messages" ON realtime.messages;
CREATE POLICY "Team can read realtime messages"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (public.has_team_access());

DROP POLICY IF EXISTS "Team can broadcast realtime messages" ON realtime.messages;
CREATE POLICY "Team can broadcast realtime messages"
  ON realtime.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_team_access());

-- =========================================
-- 2) CSRF state store for spotify-auth OAuth
-- =========================================
CREATE TABLE IF NOT EXISTS public.spotify_oauth_states (
  state text PRIMARY KEY,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz
);

ALTER TABLE public.spotify_oauth_states ENABLE ROW LEVEL SECURITY;

-- Sem policies públicas: só edge functions com service role conseguem ler/escrever.
-- (Sem policy = sem acesso para anon/authenticated, exatamente o que queremos.)

-- Limpa estados antigos (> 30 min) automaticamente em cada novo insert via função.
CREATE OR REPLACE FUNCTION public.cleanup_spotify_oauth_states()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.spotify_oauth_states
  WHERE created_at < now() - interval '30 minutes';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS spotify_oauth_states_cleanup ON public.spotify_oauth_states;
CREATE TRIGGER spotify_oauth_states_cleanup
  AFTER INSERT ON public.spotify_oauth_states
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.cleanup_spotify_oauth_states();
