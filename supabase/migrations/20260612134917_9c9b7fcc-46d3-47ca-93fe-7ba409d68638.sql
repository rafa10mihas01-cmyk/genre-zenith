
-- ============================================================
-- ONDA 1 — Ownership de playlist por deal/campanha
-- Aditivo: nada removido, código existente segue funcionando.
-- ============================================================

-- 1. Coluna de promoção pro ecossistema
ALTER TABLE public.curator_playlists
  ADD COLUMN IF NOT EXISTS promoted_to_ecosystem_at timestamptz;

-- 2. Unique por (deal_id, spotify_playlist_id) — uma playlist por deal
CREATE UNIQUE INDEX IF NOT EXISTS curator_playlists_deal_spid_uq
  ON public.curator_playlists(deal_id, spotify_playlist_id)
  WHERE spotify_playlist_id IS NOT NULL;

-- 3. Trigger: bloqueia INSERT/UPDATE se playlist está no ecossistema ativo
CREATE OR REPLACE FUNCTION public.block_curator_playlist_if_eco()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _eco_id uuid;
BEGIN
  IF NEW.spotify_playlist_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT id INTO _eco_id
  FROM public.managed_playlists
  WHERE spotify_playlist_id = NEW.spotify_playlist_id
    AND archived_at IS NULL
  LIMIT 1;
  IF _eco_id IS NOT NULL THEN
    RAISE EXCEPTION 'PLAYLIST_IS_ECOSYSTEM: spotify_playlist_id=% pertence ao ecossistema (managed_playlist=%)', NEW.spotify_playlist_id, _eco_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_curator_playlist_if_eco ON public.curator_playlists;
CREATE TRIGGER trg_block_curator_playlist_if_eco
  BEFORE INSERT OR UPDATE OF spotify_playlist_id
  ON public.curator_playlists
  FOR EACH ROW
  EXECUTE FUNCTION public.block_curator_playlist_if_eco();

-- 4. Trigger: ao inserir em managed_playlists, marca curator_playlists existentes como promovidos
CREATE OR REPLACE FUNCTION public.promote_curator_playlists_to_ecosystem()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.spotify_playlist_id IS NULL OR NEW.archived_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  UPDATE public.curator_playlists
     SET promoted_to_ecosystem_at = now()
   WHERE spotify_playlist_id = NEW.spotify_playlist_id
     AND promoted_to_ecosystem_at IS NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_promote_to_ecosystem ON public.managed_playlists;
CREATE TRIGGER trg_promote_to_ecosystem
  AFTER INSERT
  ON public.managed_playlists
  FOR EACH ROW
  EXECUTE FUNCTION public.promote_curator_playlists_to_ecosystem();

-- 5. RPC transacional para reivindicar playlist por deal
CREATE OR REPLACE FUNCTION public.claim_playlist_for_deal(
  _deal_id uuid,
  _spotify_playlist_id text,
  _spotify_url text,
  _playlist_name text,
  _followers bigint DEFAULT NULL,
  _image_url text DEFAULT NULL,
  _spotify_owner_id text DEFAULT NULL,
  _spotify_owner_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _eco_id uuid;
  _existing_id uuid;
  _existing_deal uuid;
  _existing_curator uuid;
  _new_id uuid;
BEGIN
  -- 1) Ecossistema
  IF _spotify_playlist_id IS NOT NULL THEN
    SELECT id INTO _eco_id
    FROM public.managed_playlists
    WHERE spotify_playlist_id = _spotify_playlist_id
      AND archived_at IS NULL
    LIMIT 1;
    IF _eco_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'status','ecosystem',
        'managed_playlist_id', _eco_id,
        'spotify_playlist_id', _spotify_playlist_id
      );
    END IF;

    -- 2) Já reivindicada em outro deal?
    SELECT cp.id, cp.deal_id, cd.curator_id
      INTO _existing_id, _existing_deal, _existing_curator
    FROM public.curator_playlists cp
    JOIN public.curator_deals cd ON cd.id = cp.deal_id
    WHERE cp.spotify_playlist_id = _spotify_playlist_id
      AND cp.deal_id <> _deal_id
    ORDER BY cp.added_at DESC
    LIMIT 1;
    IF _existing_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'status','conflict',
        'existing_curator_playlist_id', _existing_id,
        'existing_deal_id', _existing_deal,
        'existing_curator_id', _existing_curator
      );
    END IF;

    -- 3) Já está nesse deal?
    SELECT id INTO _existing_id
    FROM public.curator_playlists
    WHERE deal_id = _deal_id AND spotify_playlist_id = _spotify_playlist_id
    LIMIT 1;
    IF _existing_id IS NOT NULL THEN
      RETURN jsonb_build_object('status','already_claimed','curator_playlist_id', _existing_id);
    END IF;
  END IF;

  -- 4) Insert
  INSERT INTO public.curator_playlists(
    deal_id, spotify_playlist_id, spotify_url, playlist_name,
    followers, image_url, spotify_owner_id, spotify_owner_name,
    match_status, attribution_method
  ) VALUES (
    _deal_id, _spotify_playlist_id, _spotify_url, _playlist_name,
    _followers, _image_url, _spotify_owner_id, _spotify_owner_name,
    'unmatched', 'manual_paste'
  )
  RETURNING id INTO _new_id;

  RETURN jsonb_build_object('status','claimed','curator_playlist_id', _new_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_playlist_for_deal(uuid,text,text,text,bigint,text,text,text) TO authenticated, service_role;
