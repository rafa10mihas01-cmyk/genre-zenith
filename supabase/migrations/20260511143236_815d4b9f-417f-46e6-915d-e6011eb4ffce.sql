
-- 1) Cache de IA por hash de print
CREATE TABLE IF NOT EXISTS public.ai_print_cache (
  print_hash text PRIMARY KEY,
  model text NOT NULL,
  result jsonb NOT NULL,
  tokens_used integer,
  hits integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_hit_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_print_cache_created ON public.ai_print_cache (created_at DESC);
ALTER TABLE public.ai_print_cache ENABLE ROW LEVEL SECURITY;
-- somente service role acessa (sem policies públicas)

-- 2) Quota mensal de IA por usuário
CREATE TABLE IF NOT EXISTS public.ai_quota_user (
  user_id uuid NOT NULL,
  month_start date NOT NULL,
  tokens_used bigint NOT NULL DEFAULT 0,
  cap_tokens bigint NOT NULL DEFAULT 5000000, -- ~5M tokens / user / mês default
  blocked boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, month_start)
);
ALTER TABLE public.ai_quota_user ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users view own ai quota"
ON public.ai_quota_user FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "admins view all ai quota"
ON public.ai_quota_user FOR SELECT
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "admins manage ai quota"
ON public.ai_quota_user FOR ALL
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- 3) Rate limit distribuído (chave: ip|user|route)
CREATE TABLE IF NOT EXISTS public.rate_limits (
  key text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON public.rate_limits (window_start);
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
-- sem policies públicas (apenas service role/edge)

CREATE OR REPLACE FUNCTION public.bump_rate_limit(
  p_key text,
  p_window_seconds integer DEFAULT 60,
  p_limit integer DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window timestamptz;
  v_count integer;
BEGIN
  v_window := to_timestamp(
    (extract(epoch from now())::bigint / p_window_seconds) * p_window_seconds
  );

  INSERT INTO public.rate_limits (key, window_start, count)
  VALUES (p_key, v_window, 1)
  ON CONFLICT (key, window_start)
  DO UPDATE SET count = public.rate_limits.count + 1
  RETURNING count INTO v_count;

  RETURN jsonb_build_object(
    'allowed', v_count <= p_limit,
    'count', v_count,
    'limit', p_limit,
    'window_start', v_window
  );
END;
$$;

-- 4) Índice composto para get_curator_deal_progress filtrando por song_id
CREATE INDEX IF NOT EXISTS idx_cds_deal_song_captured
  ON public.curator_deal_snapshots (deal_id, song_id, captured_at DESC);

-- 5) Limpeza de prints antigos já processados (>30 dias)
CREATE OR REPLACE FUNCTION public.cleanup_old_bot_prints()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_deleted int := 0;
  v_obj record;
BEGIN
  FOR v_obj IN
    SELECT o.name
    FROM storage.objects o
    WHERE o.bucket_id = 'bot-prints'
      AND o.created_at < now() - interval '30 days'
      AND EXISTS (
        SELECT 1 FROM public.bot_print_batches b
        WHERE b.processed_at IS NOT NULL
          AND o.name LIKE '%' || b.id::text || '%'
      )
    LIMIT 500
  LOOP
    DELETE FROM storage.objects
      WHERE bucket_id = 'bot-prints' AND name = v_obj.name;
    v_deleted := v_deleted + 1;
  END LOOP;

  RETURN jsonb_build_object('deleted', v_deleted, 'completed_at', now());
END;
$$;

-- 6) Limpeza diária de rate_limits e cache antigo
CREATE OR REPLACE FUNCTION public.cleanup_rate_limits_and_ai_cache()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rl int;
  v_ai int;
BEGIN
  WITH d AS (
    DELETE FROM public.rate_limits
     WHERE window_start < now() - interval '1 day'
     RETURNING 1
  ) SELECT count(*) INTO v_rl FROM d;

  WITH d AS (
    DELETE FROM public.ai_print_cache
     WHERE last_hit_at < now() - interval '60 days'
     RETURNING 1
  ) SELECT count(*) INTO v_ai FROM d;

  RETURN jsonb_build_object(
    'rate_limits_deleted', v_rl,
    'ai_cache_deleted', v_ai,
    'completed_at', now()
  );
END;
$$;
