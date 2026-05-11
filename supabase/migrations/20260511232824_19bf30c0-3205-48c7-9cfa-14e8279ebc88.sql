-- Fase 1: Canonical Playlist Layer

CREATE TABLE IF NOT EXISTS public.playlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spotify_playlist_id text NOT NULL UNIQUE,
  name text,
  ownership text NOT NULL DEFAULT 'external' CHECK (ownership IN ('own','curator','external')),
  account_id uuid NULL,
  source text NOT NULL DEFAULT 'external' CHECK (source IN ('managed','library','deal','bot','apify','external')),
  followers bigint,
  cover_url text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_playlists_ownership ON public.playlists(ownership);
CREATE INDEX IF NOT EXISTS idx_playlists_account_id ON public.playlists(account_id);
CREATE INDEX IF NOT EXISTS idx_playlists_source ON public.playlists(source);

ALTER TABLE public.playlists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_select_playlists ON public.playlists;
DROP POLICY IF EXISTS team_insert_playlists ON public.playlists;
DROP POLICY IF EXISTS team_update_playlists ON public.playlists;
DROP POLICY IF EXISTS team_delete_playlists ON public.playlists;
CREATE POLICY team_select_playlists ON public.playlists FOR SELECT TO authenticated USING (has_team_access());
CREATE POLICY team_insert_playlists ON public.playlists FOR INSERT TO authenticated WITH CHECK (has_team_access());
CREATE POLICY team_update_playlists ON public.playlists FOR UPDATE TO authenticated USING (has_team_access()) WITH CHECK (has_team_access());
CREATE POLICY team_delete_playlists ON public.playlists FOR DELETE TO authenticated USING (has_team_access());

CREATE OR REPLACE FUNCTION public.playlists_touch_last_seen()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.last_seen_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_playlists_touch_last_seen ON public.playlists;
CREATE TRIGGER trg_playlists_touch_last_seen
  BEFORE UPDATE ON public.playlists
  FOR EACH ROW
  EXECUTE FUNCTION public.playlists_touch_last_seen();

ALTER TABLE public.managed_playlists
  ADD COLUMN IF NOT EXISTS canonical_playlist_id uuid NULL REFERENCES public.playlists(id) ON DELETE SET NULL;
ALTER TABLE public.curator_playlist_library
  ADD COLUMN IF NOT EXISTS canonical_playlist_id uuid NULL REFERENCES public.playlists(id) ON DELETE SET NULL;
ALTER TABLE public.curator_playlists
  ADD COLUMN IF NOT EXISTS canonical_playlist_id uuid NULL REFERENCES public.playlists(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_managed_playlists_canonical ON public.managed_playlists(canonical_playlist_id);
CREATE INDEX IF NOT EXISTS idx_curator_playlist_library_canonical ON public.curator_playlist_library(canonical_playlist_id);
CREATE INDEX IF NOT EXISTS idx_curator_playlists_canonical ON public.curator_playlists(canonical_playlist_id);

-- Backfill A: managed_playlists (dedup via DISTINCT ON)
INSERT INTO public.playlists (spotify_playlist_id, name, ownership, account_id, source, followers, cover_url, first_seen_at, last_seen_at)
SELECT DISTINCT ON (mp.spotify_playlist_id)
       mp.spotify_playlist_id, mp.name, 'own', mp.account_id, 'managed',
       mp.followers, mp.cover_url, COALESCE(mp.created_at, now()), now()
FROM public.managed_playlists mp
WHERE mp.spotify_playlist_id IS NOT NULL
ORDER BY mp.spotify_playlist_id, mp.created_at DESC NULLS LAST
ON CONFLICT (spotify_playlist_id) DO UPDATE
  SET name = COALESCE(public.playlists.name, EXCLUDED.name),
      followers = COALESCE(EXCLUDED.followers, public.playlists.followers),
      cover_url = COALESCE(EXCLUDED.cover_url, public.playlists.cover_url),
      account_id = COALESCE(public.playlists.account_id, EXCLUDED.account_id),
      ownership = CASE
        WHEN public.playlists.ownership = 'own' THEN 'own'
        WHEN public.playlists.ownership = 'curator' THEN 'curator'
        ELSE EXCLUDED.ownership
      END,
      last_seen_at = now();

UPDATE public.managed_playlists mp
SET canonical_playlist_id = p.id
FROM public.playlists p
WHERE p.spotify_playlist_id = mp.spotify_playlist_id
  AND mp.canonical_playlist_id IS NULL;

-- Backfill B: curator_playlist_library
INSERT INTO public.playlists (spotify_playlist_id, name, ownership, source, followers, cover_url, first_seen_at, last_seen_at)
SELECT DISTINCT ON (cpl.spotify_playlist_id)
       cpl.spotify_playlist_id, cpl.playlist_name, 'curator', 'library',
       cpl.followers, cpl.image_url, COALESCE(cpl.first_seen_at, cpl.created_at, now()), now()
FROM public.curator_playlist_library cpl
WHERE cpl.spotify_playlist_id IS NOT NULL
ORDER BY cpl.spotify_playlist_id, cpl.updated_at DESC NULLS LAST
ON CONFLICT (spotify_playlist_id) DO UPDATE
  SET name = COALESCE(public.playlists.name, EXCLUDED.name),
      followers = COALESCE(EXCLUDED.followers, public.playlists.followers),
      cover_url = COALESCE(public.playlists.cover_url, EXCLUDED.cover_url),
      ownership = CASE
        WHEN public.playlists.ownership = 'own' THEN 'own'
        WHEN public.playlists.ownership = 'curator' THEN 'curator'
        ELSE EXCLUDED.ownership
      END,
      last_seen_at = now();

UPDATE public.curator_playlist_library cpl
SET canonical_playlist_id = p.id
FROM public.playlists p
WHERE p.spotify_playlist_id = cpl.spotify_playlist_id
  AND cpl.canonical_playlist_id IS NULL;

-- Backfill C: curator_playlists
INSERT INTO public.playlists (spotify_playlist_id, name, ownership, source, followers, cover_url, first_seen_at, last_seen_at)
SELECT DISTINCT ON (cp.spotify_playlist_id)
       cp.spotify_playlist_id, cp.playlist_name, 'curator', 'deal',
       cp.followers, cp.image_url, COALESCE(cp.added_at, now()), now()
FROM public.curator_playlists cp
WHERE cp.spotify_playlist_id IS NOT NULL
ORDER BY cp.spotify_playlist_id, cp.added_at DESC NULLS LAST
ON CONFLICT (spotify_playlist_id) DO UPDATE
  SET name = COALESCE(public.playlists.name, EXCLUDED.name),
      followers = COALESCE(EXCLUDED.followers, public.playlists.followers),
      cover_url = COALESCE(public.playlists.cover_url, EXCLUDED.cover_url),
      ownership = CASE
        WHEN public.playlists.ownership = 'own' THEN 'own'
        WHEN public.playlists.ownership = 'curator' THEN 'curator'
        ELSE EXCLUDED.ownership
      END,
      last_seen_at = now();

UPDATE public.curator_playlists cp
SET canonical_playlist_id = p.id
FROM public.playlists p
WHERE p.spotify_playlist_id = cp.spotify_playlist_id
  AND cp.canonical_playlist_id IS NULL;