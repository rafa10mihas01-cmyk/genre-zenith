CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION public.slugify(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'extensions'
AS $$
  SELECT trim(both '-' from
    regexp_replace(
      regexp_replace(
        lower(public.unaccent(coalesce(p_text, ''))),
        '[^a-z0-9]+', '-', 'g'
      ),
      '-+', '-', 'g'
    )
  );
$$;

ALTER TABLE public.curator_deals
  ADD COLUMN IF NOT EXISTS slug text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_curator_deals_slug
  ON public.curator_deals(slug) WHERE slug IS NOT NULL;

CREATE OR REPLACE FUNCTION public.generate_curator_deal_slug(p_curator text, p_song text, p_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_base text;
  v_slug text;
  v_suffix text;
  v_attempt int := 0;
BEGIN
  v_base := public.slugify(coalesce(p_curator, '') || '-' || coalesce(p_song, ''));
  IF v_base IS NULL OR v_base = '' THEN v_base := 'deal'; END IF;
  v_base := substring(v_base from 1 for 60);

  v_slug := v_base;
  WHILE EXISTS (SELECT 1 FROM public.curator_deals WHERE slug = v_slug AND id <> p_id) LOOP
    v_attempt := v_attempt + 1;
    v_suffix := substring(replace(p_id::text, '-', '') from 1 for 4 + v_attempt);
    v_slug := v_base || '-' || v_suffix;
    IF v_attempt > 5 THEN
      v_slug := v_base || '-' || replace(p_id::text, '-', '');
      EXIT;
    END IF;
  END LOOP;

  RETURN v_slug;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_curator_deal_slug()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := public.generate_curator_deal_slug(NEW.curator_name, NEW.song_name, NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_curator_deal_slug ON public.curator_deals;
CREATE TRIGGER trg_curator_deal_slug
BEFORE INSERT OR UPDATE OF curator_name, song_name ON public.curator_deals
FOR EACH ROW EXECUTE FUNCTION public.set_curator_deal_slug();

UPDATE public.curator_deals
SET slug = public.generate_curator_deal_slug(curator_name, song_name, id)
WHERE slug IS NULL OR slug = '';