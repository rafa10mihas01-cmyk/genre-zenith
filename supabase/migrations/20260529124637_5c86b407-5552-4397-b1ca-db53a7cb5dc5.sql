-- Função única de recálculo: cobre deals de curador (externos) + snapshots eco (bot)
CREATE OR REPLACE FUNCTION public.recompute_campaign_total_delivered(p_campaign_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_curator_plays bigint;
  v_eco_plays bigint;
  v_total bigint;
BEGIN
  IF p_campaign_id IS NULL THEN RETURN; END IF;

  -- Entregas via curador externo
  SELECT COALESCE(SUM(reconciled_total_plays), 0)::bigint INTO v_curator_plays
    FROM public.curator_deals
   WHERE campaign_id = p_campaign_id;

  -- Entregas via ecossistema próprio: último snapshot por playlist
  SELECT COALESCE(SUM(latest.plays_28d), 0)::bigint INTO v_eco_plays
    FROM (
      SELECT DISTINCT ON (managed_playlist_id) plays_28d
        FROM public.campaign_eco_snapshots
       WHERE campaign_id = p_campaign_id
       ORDER BY managed_playlist_id, captured_at DESC
    ) latest;

  v_total := COALESCE(v_curator_plays, 0) + COALESCE(v_eco_plays, 0);

  UPDATE public.campaigns
     SET total_delivered = v_total
   WHERE id = p_campaign_id
     AND total_delivered IS DISTINCT FROM v_total;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recompute_campaign_total_delivered(uuid) FROM anon, authenticated;

-- Trigger para curator_deals (substitui o existente, mantendo nome)
CREATE OR REPLACE FUNCTION public.sync_campaign_total_delivered()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP IN ('INSERT','UPDATE')) AND NEW.campaign_id IS NOT NULL THEN
    PERFORM public.recompute_campaign_total_delivered(NEW.campaign_id);
  END IF;
  IF (TG_OP IN ('UPDATE','DELETE')) AND OLD.campaign_id IS NOT NULL
     AND (TG_OP = 'DELETE' OR OLD.campaign_id IS DISTINCT FROM NEW.campaign_id) THEN
    PERFORM public.recompute_campaign_total_delivered(OLD.campaign_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Trigger para campaign_eco_snapshots (NOVO)
CREATE OR REPLACE FUNCTION public.sync_campaign_total_delivered_eco()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP IN ('INSERT','UPDATE')) AND NEW.campaign_id IS NOT NULL THEN
    PERFORM public.recompute_campaign_total_delivered(NEW.campaign_id);
  END IF;
  IF (TG_OP IN ('UPDATE','DELETE')) AND OLD.campaign_id IS NOT NULL
     AND (TG_OP = 'DELETE' OR OLD.campaign_id IS DISTINCT FROM NEW.campaign_id) THEN
    PERFORM public.recompute_campaign_total_delivered(OLD.campaign_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_campaign_total_delivered_eco() FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_campaign_total_delivered_eco ON public.campaign_eco_snapshots;
CREATE TRIGGER trg_sync_campaign_total_delivered_eco
AFTER INSERT OR UPDATE OF plays_28d, campaign_id OR DELETE
ON public.campaign_eco_snapshots
FOR EACH ROW
EXECUTE FUNCTION public.sync_campaign_total_delivered_eco();

-- Backfill: recalcula todas as campanhas com as duas fontes combinadas
DO $do$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.campaigns LOOP
    PERFORM public.recompute_campaign_total_delivered(r.id);
  END LOOP;
END
$do$;