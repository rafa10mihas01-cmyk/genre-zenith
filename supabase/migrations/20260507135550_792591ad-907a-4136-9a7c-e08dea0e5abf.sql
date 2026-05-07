
-- 1) Tabela de campanhas
CREATE TABLE IF NOT EXISTS public.community_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  title text NOT NULL,
  brief text,
  points_per_member integer NOT NULL DEFAULT 100 CHECK (points_per_member > 0),
  max_slots integer NOT NULL DEFAULT 10 CHECK (max_slots > 0),
  used_slots integer NOT NULL DEFAULT 0,
  proof_window_hours integer NOT NULL DEFAULT 72 CHECK (proof_window_hours > 0),
  status text NOT NULL DEFAULT 'draft', -- draft | open | closed | archived
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  opened_at timestamptz,
  closed_at timestamptz
);

CREATE INDEX IF NOT EXISTS community_campaigns_status_idx ON public.community_campaigns(status);
CREATE INDEX IF NOT EXISTS community_campaigns_deal_idx ON public.community_campaigns(deal_id);

ALTER TABLE public.community_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY team_select_campaigns ON public.community_campaigns
  FOR SELECT TO authenticated USING (public.has_team_access());
CREATE POLICY team_insert_campaigns ON public.community_campaigns
  FOR INSERT TO authenticated WITH CHECK (public.has_team_access());
CREATE POLICY team_update_campaigns ON public.community_campaigns
  FOR UPDATE TO authenticated USING (public.has_team_access()) WITH CHECK (public.has_team_access());
CREATE POLICY team_delete_campaigns ON public.community_campaigns
  FOR DELETE TO authenticated USING (public.has_team_access());

-- 2) Vínculo + unicidade na participation
ALTER TABLE public.community_participations
  ADD COLUMN IF NOT EXISTS campaign_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS community_part_member_campaign_uniq
  ON public.community_participations(campaign_id, member_id)
  WHERE campaign_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS community_part_campaign_idx
  ON public.community_participations(campaign_id);

-- 3) Trigger updated_at
CREATE OR REPLACE FUNCTION public.community_campaigns_touch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_community_campaigns_touch ON public.community_campaigns;
CREATE TRIGGER trg_community_campaigns_touch
BEFORE UPDATE ON public.community_campaigns
FOR EACH ROW EXECUTE FUNCTION public.community_campaigns_touch();

-- 4) RPC: lista campanhas abertas com vagas (visível pra membro autenticado)
CREATE OR REPLACE FUNCTION public.community_list_open_campaigns()
RETURNS TABLE(
  id uuid,
  title text,
  brief text,
  points_per_member integer,
  remaining_slots integer,
  proof_window_hours integer,
  song_name text,
  song_artist text,
  song_cover_url text,
  song_spotify_url text,
  already_accepted boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_member_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT m.id INTO v_member_id FROM public.community_members m
   WHERE m.user_id = v_uid AND m.status = 'active';
  IF v_member_id IS NULL THEN RAISE EXCEPTION 'not_active_member'; END IF;

  RETURN QUERY
  SELECT c.id,
         c.title,
         c.brief,
         c.points_per_member,
         GREATEST(c.max_slots - c.used_slots, 0) AS remaining_slots,
         c.proof_window_hours,
         d.song_name,
         d.song_artist,
         d.song_cover_url,
         d.song_spotify_url,
         EXISTS (
           SELECT 1 FROM public.community_participations p
            WHERE p.campaign_id = c.id AND p.member_id = v_member_id
         ) AS already_accepted
    FROM public.community_campaigns c
    JOIN public.curator_deals d ON d.id = c.deal_id
   WHERE c.status = 'open'
   ORDER BY c.opened_at DESC NULLS LAST, c.created_at DESC;
END;
$$;

-- 5) RPC: aceitar campanha
CREATE OR REPLACE FUNCTION public.community_accept_campaign(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_member record;
  v_camp record;
  v_part_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT * INTO v_member FROM public.community_members
   WHERE user_id = v_uid;
  IF v_member IS NULL THEN RAISE EXCEPTION 'not_member'; END IF;
  IF v_member.status <> 'active' THEN RAISE EXCEPTION 'member_not_active'; END IF;

  SELECT * INTO v_camp FROM public.community_campaigns
   WHERE id = p_campaign_id FOR UPDATE;
  IF v_camp IS NULL THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  IF v_camp.status <> 'open' THEN RAISE EXCEPTION 'campaign_not_open'; END IF;
  IF v_camp.used_slots >= v_camp.max_slots THEN
    RAISE EXCEPTION 'campaign_full';
  END IF;

  -- Já aceitou?
  IF EXISTS (
    SELECT 1 FROM public.community_participations
     WHERE campaign_id = p_campaign_id AND member_id = v_member.id
  ) THEN
    RAISE EXCEPTION 'already_accepted';
  END IF;

  INSERT INTO public.community_participations (
    campaign_id, deal_id, member_id, user_id, status,
    points_offered, expires_at
  ) VALUES (
    v_camp.id, v_camp.deal_id, v_member.id, v_uid, 'accepted',
    v_camp.points_per_member,
    now() + make_interval(hours => v_camp.proof_window_hours)
  ) RETURNING id INTO v_part_id;

  UPDATE public.community_campaigns
     SET used_slots = used_slots + 1,
         status = CASE WHEN used_slots + 1 >= max_slots THEN 'closed' ELSE status END,
         closed_at = CASE WHEN used_slots + 1 >= max_slots THEN now() ELSE closed_at END
   WHERE id = v_camp.id;

  RETURN jsonb_build_object('ok', true, 'participation_id', v_part_id);
END;
$$;

-- 6) RPC: enviar prova
CREATE OR REPLACE FUNCTION public.community_submit_proof(p_participation_id uuid, p_proof_url text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_part record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_proof_url IS NULL OR length(trim(p_proof_url)) < 8 THEN
    RAISE EXCEPTION 'invalid_proof_url';
  END IF;

  SELECT * INTO v_part FROM public.community_participations
   WHERE id = p_participation_id AND user_id = v_uid;
  IF v_part IS NULL THEN RAISE EXCEPTION 'participation_not_found'; END IF;
  IF v_part.status NOT IN ('accepted', 'submitted') THEN
    RAISE EXCEPTION 'invalid_state';
  END IF;
  IF v_part.expires_at IS NOT NULL AND v_part.expires_at < now() THEN
    RAISE EXCEPTION 'expired';
  END IF;

  UPDATE public.community_participations
     SET proof_url = trim(p_proof_url),
         proof_submitted_at = now(),
         status = 'submitted',
         updated_at = now()
   WHERE id = p_participation_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;
