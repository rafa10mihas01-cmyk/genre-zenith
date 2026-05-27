CREATE OR REPLACE FUNCTION public.tg_campaign_shadow_close()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Nunca fecha deal por cancelamento/expiração de campanha.
  -- O deal só acompanha a campanha quando ela entra em completed E a meta da campanha foi entregue.
  IF NEW.status = 'completed'
     AND (OLD.status IS DISTINCT FROM NEW.status)
     AND COALESCE(NEW.goal_plays, 0) > 0
     AND COALESCE(NEW.total_delivered, 0)::numeric >= (COALESCE(NEW.goal_plays, 0)::numeric * 0.95)
  THEN
    UPDATE public.curator_deals
       SET closed_at = COALESCE(closed_at, now()),
           closed_status = 'completed',
           closed_reason = COALESCE(closed_reason, 'Campanha concluída com entrega >= 95%')
     WHERE campaign_id = NEW.id
       AND closed_at IS NULL
       AND COALESCE(target_plays, 0) > 0
       AND COALESCE(reconciled_total_plays, 0)::numeric >= (COALESCE(target_plays, 0)::numeric * 0.95);
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_curator_deals_close_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.closed_at IS NOT NULL AND OLD.closed_at IS NULL THEN
    -- Guard de segurança: automações/cron/serviço sem usuário autenticado não podem
    -- fechar deal abaixo de 95% da meta. Fechamento humano via UI continua permitido.
    IF auth.uid() IS NULL
       AND COALESCE(NEW.target_plays, 0) > 0
       AND COALESCE(NEW.reconciled_total_plays, 0)::numeric < (COALESCE(NEW.target_plays, 0)::numeric * 0.95)
    THEN
      RAISE EXCEPTION 'automatic_deal_close_blocked_below_delivery_threshold'
        USING DETAIL = 'Deal below 95% delivery cannot be closed automatically.',
              HINT = 'Keep the deal active with an overdue alert until an admin closes it manually.';
    END IF;

    NEW.state := CASE WHEN NEW.closed_status = 'completed' THEN 'completed' ELSE 'closed' END;
  ELSIF NEW.closed_at IS NULL AND OLD.closed_at IS NOT NULL THEN
    NEW.state := 'awaiting_playlists';
  END IF;
  RETURN NEW;
END;
$$;