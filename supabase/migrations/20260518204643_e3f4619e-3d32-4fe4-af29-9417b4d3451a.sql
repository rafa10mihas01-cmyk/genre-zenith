
-- 1. Novas colunas em campaigns (todas nullable, sem quebra)
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS curator_id uuid REFERENCES public.curators(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deal_id uuid REFERENCES public.curator_deals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_campaigns_client ON public.campaigns(client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campaigns_curator ON public.campaigns(curator_id) WHERE curator_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campaigns_deal ON public.campaigns(deal_id) WHERE deal_id IS NOT NULL;

-- 2. Shadow deal só age em campanhas SEM curator definido (legado/fallback)
CREATE OR REPLACE FUNCTION public.tg_campaign_shadow_deal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deal_id uuid;
  v_existing uuid;
BEGIN
  IF NEW.status NOT IN ('active', 'dispatched') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  IF NEW.spotify_track_id IS NULL OR NEW.created_by IS NULL THEN
    RETURN NEW;
  END IF;

  -- NOVO: se campanha já tem curator/deal real, não cria shadow
  IF NEW.curator_id IS NOT NULL OR NEW.deal_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_existing FROM public.curator_deals WHERE campaign_id = NEW.id LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.curator_deals (
    user_id, curator_name, song_spotify_url, song_name, song_artist,
    target_plays, baseline_plays, cost, started_at, state, source, campaign_id
  ) VALUES (
    NEW.created_by, 'Eco Interno (campanha)',
    COALESCE(NEW.spotify_track_url, 'spotify:track:' || NEW.spotify_track_id),
    NEW.track_name, NEW.artist,
    COALESCE(NEW.goal_plays, 0), 0, 0, now(),
    'active', 'campaign_internal', NEW.id
  )
  RETURNING id INTO v_deal_id;

  INSERT INTO public.curator_deal_songs (
    deal_id, spotify_track_id, song_spotify_url, song_name, song_artist,
    auto_collect, auto_collect_interval_minutes, auto_collect_status, position, started_at
  ) VALUES (
    v_deal_id, NEW.spotify_track_id,
    COALESCE(NEW.spotify_track_url, 'spotify:track:' || NEW.spotify_track_id),
    NEW.track_name, NEW.artist, true, 1440, 'idle', 1, now()
  );

  RETURN NEW;
END;
$$;

-- 3. Função approve_campaign: rascunho → ativa + cria deal real
CREATE OR REPLACE FUNCTION public.approve_campaign(p_campaign_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.campaigns%ROWTYPE;
  v_curator public.curators%ROWTYPE;
  v_deal_id uuid;
BEGIN
  SELECT * INTO c FROM public.campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Campanha não encontrada';
  END IF;
  IF c.deal_id IS NOT NULL THEN
    -- já aprovada, apenas garante status active
    UPDATE public.campaigns SET status = 'active' WHERE id = c.id AND status = 'draft';
    RETURN c.deal_id;
  END IF;
  IF c.curator_id IS NULL THEN
    RAISE EXCEPTION 'Campanha sem curador definido — não é possível criar deal';
  END IF;
  IF c.spotify_track_id IS NULL THEN
    RAISE EXCEPTION 'Campanha sem música definida';
  END IF;

  SELECT * INTO v_curator FROM public.curators WHERE id = c.curator_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Curador não encontrado';
  END IF;

  -- Cria deal real (source = NULL, aparece em /deals normalmente)
  INSERT INTO public.curator_deals (
    user_id, curator_id, curator_name,
    song_spotify_url, song_name, song_artist, song_cover_url,
    target_plays, baseline_plays, cost,
    started_at, ends_at, state, campaign_id
  ) VALUES (
    c.created_by, c.curator_id, v_curator.name,
    COALESCE(c.spotify_track_url, 'spotify:track:' || c.spotify_track_id),
    c.track_name, c.artist, c.cover_url,
    COALESCE(c.goal_plays, 0), 0, 0,
    now(), c.deadline::timestamptz, 'collecting', c.id
  )
  RETURNING id INTO v_deal_id;

  -- Adiciona música na fila do bot
  INSERT INTO public.curator_deal_songs (
    deal_id, spotify_track_id, song_spotify_url, song_name, song_artist,
    auto_collect, auto_collect_interval_minutes, auto_collect_status, position, started_at
  ) VALUES (
    v_deal_id, c.spotify_track_id,
    COALESCE(c.spotify_track_url, 'spotify:track:' || c.spotify_track_id),
    c.track_name, c.artist,
    true, 1440, 'idle', 1, now()
  );

  -- Liga deal à campanha + ativa
  UPDATE public.campaigns
     SET deal_id = v_deal_id,
         status = 'active',
         eco_dispatched_at = COALESCE(eco_dispatched_at, now())
   WHERE id = c.id;

  RETURN v_deal_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_campaign(uuid) TO authenticated;
