
-- Add slug column to spotify_apps
ALTER TABLE public.spotify_apps ADD COLUMN IF NOT EXISTS slug text;

-- Helper to slugify a name
CREATE OR REPLACE FUNCTION public.spotify_app_slugify(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(both '-' from regexp_replace(lower(unaccent(coalesce(input,''))), '[^a-z0-9]+', '-', 'g'));
$$;

-- Backfill existing rows (unique by appending suffix if collision)
DO $$
DECLARE r record; base text; candidate text; i int;
BEGIN
  FOR r IN SELECT id, name FROM public.spotify_apps WHERE slug IS NULL OR slug = '' LOOP
    base := NULLIF(public.spotify_app_slugify(r.name), '');
    IF base IS NULL THEN base := 'app'; END IF;
    candidate := base; i := 1;
    WHILE EXISTS (SELECT 1 FROM public.spotify_apps WHERE slug = candidate AND id <> r.id) LOOP
      i := i + 1;
      candidate := base || '-' || i;
    END LOOP;
    UPDATE public.spotify_apps SET slug = candidate WHERE id = r.id;
  END LOOP;
END$$;

-- Make slug NOT NULL + UNIQUE
ALTER TABLE public.spotify_apps ALTER COLUMN slug SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS spotify_apps_slug_key ON public.spotify_apps(slug);

-- Auto-generate slug on insert if not provided
CREATE OR REPLACE FUNCTION public.spotify_apps_set_slug()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE base text; candidate text; i int;
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    base := NULLIF(public.spotify_app_slugify(NEW.name), '');
    IF base IS NULL THEN base := 'app'; END IF;
    candidate := base; i := 1;
    WHILE EXISTS (SELECT 1 FROM public.spotify_apps WHERE slug = candidate) LOOP
      i := i + 1;
      candidate := base || '-' || i;
    END LOOP;
    NEW.slug := candidate;
  ELSE
    NEW.slug := public.spotify_app_slugify(NEW.slug);
  END IF;
  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS trg_spotify_apps_set_slug ON public.spotify_apps;
CREATE TRIGGER trg_spotify_apps_set_slug
BEFORE INSERT OR UPDATE OF slug, name ON public.spotify_apps
FOR EACH ROW EXECUTE FUNCTION public.spotify_apps_set_slug();
