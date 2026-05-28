CREATE TABLE public.spotify_circuit_breaker (
  app_id text PRIMARY KEY DEFAULT 'global',
  status text NOT NULL DEFAULT 'closed' CHECK (status IN ('open', 'closed')),
  blocked_until timestamptz,
  last_429_at timestamptz,
  retry_after_sec integer NOT NULL DEFAULT 0 CHECK (retry_after_sec >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.spotify_circuit_breaker TO service_role;

ALTER TABLE public.spotify_circuit_breaker ENABLE ROW LEVEL SECURITY;

CREATE INDEX spotify_circuit_breaker_status_until_idx
  ON public.spotify_circuit_breaker (status, blocked_until);

CREATE OR REPLACE FUNCTION public.touch_spotify_circuit_breaker_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER touch_spotify_circuit_breaker_updated_at
BEFORE UPDATE ON public.spotify_circuit_breaker
FOR EACH ROW
EXECUTE FUNCTION public.touch_spotify_circuit_breaker_updated_at();

CREATE OR REPLACE FUNCTION public.close_expired_spotify_circuit_breakers()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  UPDATE public.spotify_circuit_breaker
  SET status = 'closed',
      blocked_until = NULL,
      retry_after_sec = 0
  WHERE status = 'open'
    AND blocked_until IS NOT NULL
    AND blocked_until <= now();

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.close_expired_spotify_circuit_breakers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_expired_spotify_circuit_breakers() TO service_role;

INSERT INTO public.spotify_circuit_breaker (app_id, status)
VALUES ('global', 'closed')
ON CONFLICT (app_id) DO NOTHING;