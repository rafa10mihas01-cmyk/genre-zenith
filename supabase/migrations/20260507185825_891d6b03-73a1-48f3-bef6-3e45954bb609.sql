
-- 1) curator_deal_songs.slug
ALTER TABLE public.curator_deal_songs ADD COLUMN IF NOT EXISTS slug text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_curator_deal_songs_slug
  ON public.curator_deal_songs(slug) WHERE slug IS NOT NULL;

CREATE OR REPLACE FUNCTION public.generate_curator_deal_song_slug(
  p_song text, p_artist text, p_id uuid
) RETURNS text LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE v_base text; v_slug text; v_attempt int := 0;
BEGIN
  v_base := public.slugify(coalesce(p_song,'') || '-' || coalesce(p_artist,''));
  IF v_base IS NULL OR v_base = '' THEN v_base := 'campanha'; END IF;
  v_base := substring(v_base from 1 for 60);
  v_slug := v_base;
  WHILE EXISTS (SELECT 1 FROM public.curator_deal_songs WHERE slug = v_slug AND id <> p_id) LOOP
    v_attempt := v_attempt + 1;
    v_slug := v_base || '-' || substring(replace(p_id::text,'-','') from 1 for 4 + v_attempt);
    IF v_attempt > 5 THEN
      v_slug := v_base || '-' || replace(p_id::text,'-','');
      EXIT;
    END IF;
  END LOOP;
  RETURN v_slug;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_curator_deal_song_slug()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := public.generate_curator_deal_song_slug(NEW.song_name, NEW.song_artist, NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_curator_deal_song_slug ON public.curator_deal_songs;
CREATE TRIGGER trg_curator_deal_song_slug
BEFORE INSERT OR UPDATE OF song_name, song_artist ON public.curator_deal_songs
FOR EACH ROW EXECUTE FUNCTION public.set_curator_deal_song_slug();

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id, song_name, song_artist FROM public.curator_deal_songs WHERE slug IS NULL OR slug = '' LOOP
    UPDATE public.curator_deal_songs
       SET slug = public.generate_curator_deal_song_slug(r.song_name, r.song_artist, r.id)
     WHERE id = r.id;
  END LOOP;
END $$;

-- 2) community_invites.slug
ALTER TABLE public.community_invites ADD COLUMN IF NOT EXISTS slug text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_community_invites_slug
  ON public.community_invites(slug) WHERE slug IS NOT NULL;

CREATE OR REPLACE FUNCTION public.generate_community_invite_slug(
  p_email text, p_note text, p_id uuid
) RETURNS text LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE v_source text; v_base text; v_slug text; v_attempt int := 0;
BEGIN
  IF p_email IS NOT NULL AND position('@' in p_email) > 0 THEN
    v_source := split_part(p_email,'@',1);
  ELSIF p_note IS NOT NULL AND length(trim(p_note)) > 0 THEN
    v_source := p_note;
  ELSE
    v_source := 'convite';
  END IF;
  v_base := public.slugify(v_source);
  IF v_base IS NULL OR v_base = '' THEN v_base := 'convite'; END IF;
  v_base := substring(v_base from 1 for 40);
  v_slug := v_base;
  WHILE EXISTS (SELECT 1 FROM public.community_invites WHERE slug = v_slug AND id <> p_id) LOOP
    v_attempt := v_attempt + 1;
    v_slug := v_base || '-' || substring(replace(p_id::text,'-','') from 1 for 4 + v_attempt);
    IF v_attempt > 5 THEN
      v_slug := v_base || '-' || replace(p_id::text,'-','');
      EXIT;
    END IF;
  END LOOP;
  RETURN v_slug;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_community_invite_slug()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := public.generate_community_invite_slug(NEW.email, NEW.note, NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_community_invite_slug ON public.community_invites;
CREATE TRIGGER trg_community_invite_slug
BEFORE INSERT OR UPDATE OF email, note ON public.community_invites
FOR EACH ROW EXECUTE FUNCTION public.set_community_invite_slug();

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id, email, note FROM public.community_invites WHERE slug IS NULL OR slug = '' LOOP
    UPDATE public.community_invites
       SET slug = public.generate_community_invite_slug(r.email, r.note, r.id)
     WHERE id = r.id;
  END LOOP;
END $$;

-- 3) RPCs aceitam slug ou code antigo
CREATE OR REPLACE FUNCTION public.get_community_invite_by_code(p_code text)
RETURNS TABLE(id uuid, email text, expires_at timestamptz, status text, invited_by_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ci.id, ci.email, ci.expires_at,
    CASE WHEN ci.status='pending' AND ci.expires_at < now() THEN 'expired' ELSE ci.status END,
    'Equipe NexEngine'::text
  FROM public.community_invites ci
  WHERE lower(ci.code) = lower(p_code) OR lower(ci.slug) = lower(p_code)
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.accept_community_invite(p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_email text; v_invite record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  UPDATE public.community_invites SET status='expired', updated_at=now()
   WHERE (lower(code)=lower(p_code) OR lower(slug)=lower(p_code))
     AND status='pending' AND expires_at < now();
  SELECT * INTO v_invite FROM public.community_invites
   WHERE lower(code)=lower(p_code) OR lower(slug)=lower(p_code) LIMIT 1;
  IF v_invite IS NULL THEN RAISE EXCEPTION 'invite_not_found'; END IF;
  IF v_invite.status <> 'pending' THEN RAISE EXCEPTION 'invite_not_available'; END IF;
  IF v_invite.email IS NOT NULL AND lower(v_invite.email) <> lower(coalesce(v_email,'')) THEN
    RAISE EXCEPTION 'invite_email_mismatch';
  END IF;
  UPDATE public.community_invites SET status='accepted', accepted_by=v_uid, accepted_at=now(), updated_at=now()
   WHERE id=v_invite.id AND status='pending';
  RETURN jsonb_build_object('ok', true, 'invite_id', v_invite.id);
END;
$$;
