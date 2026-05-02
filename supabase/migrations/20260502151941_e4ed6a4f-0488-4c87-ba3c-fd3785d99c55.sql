-- 1) Garante curator_id em curator_deals (relacionamento explícito)
ALTER TABLE public.curator_deals
  ADD COLUMN IF NOT EXISTS curator_id uuid;

CREATE INDEX IF NOT EXISTS idx_curator_deals_curator_id
  ON public.curator_deals(curator_id);

-- Backfill: liga deals existentes ao curador pelo nome+user_id
UPDATE public.curator_deals d
   SET curator_id = c.id
  FROM public.curators c
 WHERE d.curator_id IS NULL
   AND c.user_id = d.user_id
   AND lower(trim(c.name)) = lower(trim(d.curator_name));

-- 2) Biblioteca persistente de playlists por curador
CREATE TABLE IF NOT EXISTS public.curator_playlist_library (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  curator_id uuid NOT NULL,
  user_id uuid NOT NULL,
  spotify_playlist_id text,
  spotify_url text NOT NULL,
  playlist_name text NOT NULL,
  followers bigint,
  image_url text,
  spotify_owner_id text,
  spotify_owner_name text,
  status text NOT NULL DEFAULT 'active',
  notes text,
  times_used integer NOT NULL DEFAULT 0,
  last_used_at timestamp with time zone,
  first_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT curator_playlist_library_status_chk
    CHECK (status IN ('active', 'inactive', 'burned'))
);

-- Identidade da playlist: spotify_playlist_id quando existe, senão nome normalizado
CREATE UNIQUE INDEX IF NOT EXISTS uq_curator_lib_by_spotify_id
  ON public.curator_playlist_library(curator_id, spotify_playlist_id)
  WHERE spotify_playlist_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_curator_lib_by_name
  ON public.curator_playlist_library(curator_id, lower(trim(playlist_name)))
  WHERE spotify_playlist_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_curator_lib_curator
  ON public.curator_playlist_library(curator_id, last_used_at DESC NULLS LAST);

-- RLS: cada user vê só sua biblioteca
ALTER TABLE public.curator_playlist_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own playlist library"
  ON public.curator_playlist_library FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own playlist library"
  ON public.curator_playlist_library FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own playlist library"
  ON public.curator_playlist_library FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own playlist library"
  ON public.curator_playlist_library FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_curator_lib_touch
  BEFORE UPDATE ON public.curator_playlist_library
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

-- 3) Função utilitária: extrai spotify_playlist_id de uma URL
CREATE OR REPLACE FUNCTION public.extract_spotify_playlist_id(p_url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT (regexp_match(coalesce(p_url, ''), 'playlist[/:]([a-zA-Z0-9]{16,})'))[1];
$$;

-- 4) Trigger: ao inserir/atualizar curator_playlists, alimenta a biblioteca
CREATE OR REPLACE FUNCTION public.sync_playlist_to_library()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_curator_id uuid;
  v_user_id uuid;
  v_spotify_id text;
BEGIN
  -- Resolve curador a partir do deal
  SELECT d.curator_id, d.user_id
    INTO v_curator_id, v_user_id
    FROM public.curator_deals d
   WHERE d.id = NEW.deal_id;

  IF v_curator_id IS NULL OR v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_spotify_id := public.extract_spotify_playlist_id(NEW.spotify_url);

  -- Upsert na biblioteca: por spotify_id quando existe, senão por nome
  IF v_spotify_id IS NOT NULL THEN
    INSERT INTO public.curator_playlist_library
      (curator_id, user_id, spotify_playlist_id, spotify_url, playlist_name,
       followers, image_url, spotify_owner_id, spotify_owner_name,
       times_used, last_used_at)
    VALUES
      (v_curator_id, v_user_id, v_spotify_id, NEW.spotify_url, NEW.playlist_name,
       NEW.followers, NEW.image_url, NEW.spotify_owner_id, NEW.spotify_owner_name,
       1, now())
    ON CONFLICT (curator_id, spotify_playlist_id)
      WHERE spotify_playlist_id IS NOT NULL
    DO UPDATE SET
      playlist_name = COALESCE(EXCLUDED.playlist_name, public.curator_playlist_library.playlist_name),
      followers = COALESCE(EXCLUDED.followers, public.curator_playlist_library.followers),
      image_url = COALESCE(EXCLUDED.image_url, public.curator_playlist_library.image_url),
      spotify_owner_id = COALESCE(EXCLUDED.spotify_owner_id, public.curator_playlist_library.spotify_owner_id),
      spotify_owner_name = COALESCE(EXCLUDED.spotify_owner_name, public.curator_playlist_library.spotify_owner_name),
      last_used_at = now(),
      updated_at = now();
  ELSE
    INSERT INTO public.curator_playlist_library
      (curator_id, user_id, spotify_url, playlist_name,
       followers, image_url, times_used, last_used_at)
    VALUES
      (v_curator_id, v_user_id, NEW.spotify_url, NEW.playlist_name,
       NEW.followers, NEW.image_url, 1, now())
    ON CONFLICT (curator_id, lower(trim(playlist_name)))
      WHERE spotify_playlist_id IS NULL
    DO UPDATE SET
      followers = COALESCE(EXCLUDED.followers, public.curator_playlist_library.followers),
      image_url = COALESCE(EXCLUDED.image_url, public.curator_playlist_library.image_url),
      last_used_at = now(),
      updated_at = now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_playlist_library ON public.curator_playlists;
CREATE TRIGGER trg_sync_playlist_library
  AFTER INSERT OR UPDATE ON public.curator_playlists
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_playlist_to_library();

-- 5) Backfill da biblioteca a partir das playlists já existentes
INSERT INTO public.curator_playlist_library
  (curator_id, user_id, spotify_playlist_id, spotify_url, playlist_name,
   followers, image_url, spotify_owner_id, spotify_owner_name,
   times_used, last_used_at, first_seen_at)
SELECT
  d.curator_id,
  d.user_id,
  public.extract_spotify_playlist_id(p.spotify_url) AS spotify_playlist_id,
  p.spotify_url,
  p.playlist_name,
  MAX(p.followers) AS followers,
  MAX(p.image_url) AS image_url,
  MAX(p.spotify_owner_id) AS spotify_owner_id,
  MAX(p.spotify_owner_name) AS spotify_owner_name,
  COUNT(DISTINCT p.deal_id) AS times_used,
  MAX(p.added_at) AS last_used_at,
  MIN(p.added_at) AS first_seen_at
FROM public.curator_playlists p
JOIN public.curator_deals d ON d.id = p.deal_id
WHERE d.curator_id IS NOT NULL
GROUP BY d.curator_id, d.user_id,
         public.extract_spotify_playlist_id(p.spotify_url),
         p.spotify_url, p.playlist_name
ON CONFLICT DO NOTHING;

-- 6) View agregada: performance por playlist do catálogo
CREATE OR REPLACE VIEW public.curator_playlist_library_stats
WITH (security_invoker = on) AS
SELECT
  lib.id AS library_id,
  lib.curator_id,
  lib.user_id,
  lib.spotify_url,
  lib.playlist_name,
  lib.followers,
  lib.image_url,
  lib.status,
  lib.last_used_at,
  COUNT(DISTINCT p.deal_id) AS deals_count,
  COALESCE(SUM(p.streams_7d), 0) AS total_streams_7d,
  COALESCE(SUM(p.streams_total), 0) AS total_streams_lifetime,
  CASE WHEN COUNT(DISTINCT p.deal_id) > 0
       THEN ROUND(SUM(p.streams_7d)::numeric / COUNT(DISTINCT p.deal_id), 0)
       ELSE 0 END AS avg_streams_per_deal
FROM public.curator_playlist_library lib
LEFT JOIN public.curator_deals d
       ON d.curator_id = lib.curator_id
LEFT JOIN public.curator_playlists p
       ON p.deal_id = d.id
      AND (
        (lib.spotify_playlist_id IS NOT NULL
         AND public.extract_spotify_playlist_id(p.spotify_url) = lib.spotify_playlist_id)
        OR
        (lib.spotify_playlist_id IS NULL
         AND lower(trim(p.playlist_name)) = lower(trim(lib.playlist_name)))
      )
GROUP BY lib.id, lib.curator_id, lib.user_id, lib.spotify_url,
         lib.playlist_name, lib.followers, lib.image_url, lib.status,
         lib.last_used_at;