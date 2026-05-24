
-- Fix #1: Proteção de posição via trigger.
-- Impede que duas campanhas ATIVAS tenham alocação na mesma (managed_playlist_id, spotify_track_id).
-- Partial unique index não funciona aqui porque spotify_track_id vive em campaigns (outra tabela)
-- e índices parciais exigem expressões imutáveis. Usamos trigger BEFORE INSERT/UPDATE.

CREATE OR REPLACE FUNCTION public.check_campaign_eco_allocation_uniqueness()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_track_id text;
  v_status   text;
  v_conflict_campaign_id uuid;
  v_conflict_track text;
  v_conflict_playlist text;
BEGIN
  -- Pega track + status da campanha desta alocação
  SELECT spotify_track_id, status
    INTO v_track_id, v_status
  FROM public.campaigns
  WHERE id = NEW.campaign_id;

  -- Sem track id (campanha externa pura) ou campanha não-ativa → não aplica regra
  IF v_track_id IS NULL OR v_status NOT IN ('active','paused') THEN
    RETURN NEW;
  END IF;

  -- Procura conflito: outra alocação na mesma playlist, em campanha DIFERENTE,
  -- com mesmo spotify_track_id e status ativa/pausada.
  SELECT c2.id, c2.track_name, mp.name
    INTO v_conflict_campaign_id, v_conflict_track, v_conflict_playlist
  FROM public.campaign_eco_allocations a2
  JOIN public.campaigns c2 ON c2.id = a2.campaign_id
  LEFT JOIN public.managed_playlists mp ON mp.id = a2.managed_playlist_id
  WHERE a2.managed_playlist_id = NEW.managed_playlist_id
    AND a2.campaign_id <> NEW.campaign_id
    AND c2.spotify_track_id = v_track_id
    AND c2.status IN ('active','paused')
  LIMIT 1;

  IF v_conflict_campaign_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Esta faixa já tem campanha ativa nesta playlist. (faixa: %, playlist: %, campanha em conflito: %)',
      COALESCE(v_conflict_track, '?'),
      COALESCE(v_conflict_playlist, '?'),
      v_conflict_campaign_id
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cea_unique_active ON public.campaign_eco_allocations;
CREATE TRIGGER trg_cea_unique_active
BEFORE INSERT OR UPDATE OF managed_playlist_id, campaign_id
ON public.campaign_eco_allocations
FOR EACH ROW
EXECUTE FUNCTION public.check_campaign_eco_allocation_uniqueness();

-- Também precisamos disparar verificação quando uma campanha vira 'active':
-- nesse momento, alocações dela (criadas em draft) podem colidir com outras já ativas.
CREATE OR REPLACE FUNCTION public.check_campaign_activation_no_conflict()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conflict record;
BEGIN
  IF NEW.spotify_track_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('active','paused') THEN RETURN NEW; END IF;
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  SELECT a1.managed_playlist_id, mp.name AS playlist_name, c2.id AS other_campaign_id, c2.track_name
    INTO v_conflict
  FROM public.campaign_eco_allocations a1
  JOIN public.campaign_eco_allocations a2
    ON a2.managed_playlist_id = a1.managed_playlist_id
   AND a2.campaign_id <> a1.campaign_id
  JOIN public.campaigns c2
    ON c2.id = a2.campaign_id
   AND c2.status IN ('active','paused')
   AND c2.spotify_track_id = NEW.spotify_track_id
  LEFT JOIN public.managed_playlists mp ON mp.id = a1.managed_playlist_id
  WHERE a1.campaign_id = NEW.id
  LIMIT 1;

  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION
      'Conflito ao ativar campanha: faixa já em campanha ativa na playlist "%" (campanha em conflito: %)',
      COALESCE(v_conflict.playlist_name, '?'),
      v_conflict.other_campaign_id
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_campaign_activation_no_conflict ON public.campaigns;
CREATE TRIGGER trg_campaign_activation_no_conflict
BEFORE UPDATE OF status ON public.campaigns
FOR EACH ROW
EXECUTE FUNCTION public.check_campaign_activation_no_conflict();
