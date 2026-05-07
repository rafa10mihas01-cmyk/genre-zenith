
-- ============================================================
-- FASE FINAL — Hardening do módulo Comunidade
-- ============================================================

-- ---------- 1) LEDGER IMUTÁVEL DE PONTOS ----------
CREATE TABLE IF NOT EXISTS public.community_points_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id       uuid NOT NULL,
  participation_id uuid,
  campaign_id     uuid,
  points          integer NOT NULL,
  reason          text NOT NULL,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cpl_member_created ON public.community_points_ledger(member_id, created_at DESC);
-- Idempotência: 1 linha (participation, reason)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_cpl_part_reason
  ON public.community_points_ledger(participation_id, reason)
  WHERE participation_id IS NOT NULL;

ALTER TABLE public.community_points_ledger ENABLE ROW LEVEL SECURITY;

-- Apenas team lê tudo; membro lê só do próprio member_id
DROP POLICY IF EXISTS team_select_cpl ON public.community_points_ledger;
CREATE POLICY team_select_cpl ON public.community_points_ledger
  FOR SELECT TO authenticated
  USING (has_team_access() OR member_id IN (SELECT id FROM community_members WHERE user_id = auth.uid()));

-- INSERT/UPDATE/DELETE: NUNCA pelo cliente. Só SECURITY DEFINER funcs.
DROP POLICY IF EXISTS no_client_write_cpl ON public.community_points_ledger;
CREATE POLICY no_client_write_cpl ON public.community_points_ledger
  FOR INSERT TO authenticated WITH CHECK (false);

-- Trigger: bloqueia qualquer UPDATE/DELETE
CREATE OR REPLACE FUNCTION public.cpl_block_mutations()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'community_points_ledger is append-only';
END $$;

DROP TRIGGER IF EXISTS trg_cpl_no_update ON public.community_points_ledger;
CREATE TRIGGER trg_cpl_no_update BEFORE UPDATE OR DELETE ON public.community_points_ledger
  FOR EACH ROW EXECUTE FUNCTION public.cpl_block_mutations();

-- Helper: soma do ledger
CREATE OR REPLACE FUNCTION public.community_member_points(p_member uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(points), 0)::int FROM public.community_points_ledger WHERE member_id = p_member;
$$;

-- Helper: tier
CREATE OR REPLACE FUNCTION public.community_tier_for(p_points int)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_points >= 2001 THEN 'ouro' WHEN p_points >= 501 THEN 'prata' ELSE 'bronze' END;
$$;

-- Recalcula pontos+tier do membro a partir do ledger (SECURITY DEFINER bypassa guard)
CREATE OR REPLACE FUNCTION public.community_recompute_member(p_member uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pts int;
BEGIN
  v_pts := public.community_member_points(p_member);
  UPDATE public.community_members
    SET points = v_pts,
        tier   = public.community_tier_for(v_pts),
        updated_at = now()
    WHERE id = p_member;
END $$;

-- ---------- 2) NOTIFICAÇÕES POR USER ----------
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS user_id uuid;
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications(user_id, created_at DESC) WHERE user_id IS NOT NULL;

-- RLS: team continua vendo tudo; membro só vê próprias (user_id = auth.uid())
DROP POLICY IF EXISTS team_select_notifications ON public.notifications;
CREATE POLICY notif_select ON public.notifications FOR SELECT TO authenticated
  USING (has_team_access() OR (user_id IS NOT NULL AND user_id = auth.uid()));

DROP POLICY IF EXISTS team_update_notifications ON public.notifications;
CREATE POLICY notif_update ON public.notifications FOR UPDATE TO authenticated
  USING (has_team_access() OR (user_id IS NOT NULL AND user_id = auth.uid()))
  WITH CHECK (has_team_access() OR (user_id IS NOT NULL AND user_id = auth.uid()));

-- Helper para criar notificação de membro (SECURITY DEFINER) com dedupe
CREATE OR REPLACE FUNCTION public.notify_member(
  p_user uuid, p_type text, p_title text, p_message text,
  p_action_url text DEFAULT NULL, p_dedupe text DEFAULT NULL,
  p_meta jsonb DEFAULT '{}'::jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  -- dedupe: 5 min mesma chave por user
  IF p_dedupe IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.notifications
     WHERE user_id = p_user
       AND metadata->>'dedupe_key' = p_dedupe
       AND created_at > now() - interval '5 minutes'
  ) THEN RETURN NULL; END IF;

  INSERT INTO public.notifications(user_id, type, title, message, action_url, metadata)
  VALUES (p_user, p_type::notification_type, p_title, p_message, p_action_url,
          p_meta || jsonb_build_object('domain','community','dedupe_key',p_dedupe,'silent', p_type='info'))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ---------- 3) RPC REVIEW (substitui edge function) ----------
CREATE OR REPLACE FUNCTION public.community_review_participation(
  p_participation_id uuid,
  p_action text, -- 'approve' | 'reject'
  p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_part record;
  v_pts int;
  v_user uuid;
BEGIN
  IF NOT has_team_access() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_action NOT IN ('approve','reject') THEN RAISE EXCEPTION 'invalid_action'; END IF;

  SELECT * INTO v_part FROM public.community_participations WHERE id = p_participation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_part.status NOT IN ('accepted','submitted') THEN RAISE EXCEPTION 'invalid_state'; END IF;

  SELECT user_id INTO v_user FROM public.community_members WHERE id = v_part.member_id;

  IF p_action = 'approve' THEN
    v_pts := COALESCE(v_part.points_offered, 0);
    UPDATE public.community_participations
       SET status='approved', points_awarded=v_pts,
           reviewed_by=auth.uid(), reviewed_at=now(), review_note=p_note, updated_at=now()
     WHERE id = p_participation_id;

    -- Ledger (idempotente)
    INSERT INTO public.community_points_ledger(member_id, participation_id, campaign_id, points, reason, created_by)
    VALUES (v_part.member_id, v_part.id, v_part.campaign_id, v_pts, 'approve', auth.uid())
    ON CONFLICT (participation_id, reason) DO NOTHING;

    PERFORM public.community_recompute_member(v_part.member_id);

    PERFORM public.notify_member(v_user, 'info', 'Participação aprovada',
      'Você ganhou ' || v_pts || ' pontos.', '/comunidade/pontos',
      'community_approved_'||v_part.id::text, jsonb_build_object('participation_id', v_part.id));
  ELSE
    UPDATE public.community_participations
       SET status='rejected', points_awarded=0,
           reviewed_by=auth.uid(), reviewed_at=now(), review_note=p_note, updated_at=now()
     WHERE id = p_participation_id;

    PERFORM public.notify_member(v_user, 'warning', 'Participação não aprovada',
      'Sua prova não foi validada desta vez.', '/comunidade/pontos',
      'community_rejected_'||v_part.id::text, jsonb_build_object('participation_id', v_part.id));
  END IF;

  -- Telemetria
  INSERT INTO public.ops_metrics(scope, operation, status, metadata)
  VALUES ('rpc','community_review_participation','success',
          jsonb_build_object('action',p_action,'participation_id',v_part.id,'points',COALESCE(v_pts,0)));

  RETURN jsonb_build_object('ok', true, 'action', p_action, 'points', COALESCE(v_pts,0));
END $$;

-- Reversão de pontos (caso futuramente precisem)
CREATE OR REPLACE FUNCTION public.community_revert_participation(p_participation_id uuid, p_reason text DEFAULT 'manual_revert')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_part record; v_already int;
BEGIN
  IF NOT has_team_access() THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO v_part FROM public.community_participations WHERE id = p_participation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

  SELECT COALESCE(SUM(points),0) INTO v_already
    FROM public.community_points_ledger WHERE participation_id = v_part.id;
  IF v_already = 0 THEN RAISE EXCEPTION 'nothing_to_revert'; END IF;

  INSERT INTO public.community_points_ledger(member_id, participation_id, campaign_id, points, reason, created_by)
  VALUES (v_part.member_id, v_part.id, v_part.campaign_id, -v_already, 'revert:'||p_reason, auth.uid());

  UPDATE public.community_participations SET status='rejected', points_awarded=0, review_note=p_reason, updated_at=now()
   WHERE id = p_participation_id;

  PERFORM public.community_recompute_member(v_part.member_id);
  RETURN jsonb_build_object('ok', true, 'reverted', v_already);
END $$;

-- ---------- 4) LIMITES OPERACIONAIS DO BETA ----------
-- Substitui community_accept_campaign com cooldown + limite diário
CREATE OR REPLACE FUNCTION public.community_accept_campaign(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_member record; v_camp record; v_today int; v_last timestamptz;
BEGIN
  SELECT * INTO v_member FROM public.community_members WHERE user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'not_active_member'; END IF;
  IF v_member.status <> 'active' THEN RAISE EXCEPTION 'member_not_active'; END IF;

  -- Cooldown 60s entre accepts
  SELECT MAX(created_at) INTO v_last FROM public.community_participations WHERE member_id = v_member.id;
  IF v_last IS NOT NULL AND v_last > now() - interval '60 seconds' THEN
    RAISE EXCEPTION 'cooldown_active';
  END IF;

  -- Máx 3 participações ativas por dia
  SELECT COUNT(*) INTO v_today FROM public.community_participations
   WHERE member_id = v_member.id AND created_at > now() - interval '24 hours';
  IF v_today >= 3 THEN RAISE EXCEPTION 'daily_limit_reached'; END IF;

  SELECT * INTO v_camp FROM public.community_campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  IF v_camp.status <> 'open' THEN RAISE EXCEPTION 'campaign_not_open'; END IF;
  IF v_camp.used_slots >= v_camp.max_slots THEN RAISE EXCEPTION 'campaign_full'; END IF;

  IF EXISTS (SELECT 1 FROM public.community_participations
             WHERE campaign_id = p_campaign_id AND member_id = v_member.id) THEN
    RAISE EXCEPTION 'already_accepted';
  END IF;

  INSERT INTO public.community_participations(
    user_id, member_id, deal_id, campaign_id, status, points_offered, expires_at
  ) VALUES (
    auth.uid(), v_member.id, v_camp.deal_id, v_camp.id, 'accepted',
    v_camp.points_per_member, now() + (v_camp.proof_window_hours || ' hours')::interval
  );

  UPDATE public.community_campaigns SET used_slots = used_slots + 1, updated_at = now() WHERE id = v_camp.id;
  IF v_camp.used_slots + 1 >= v_camp.max_slots THEN
    UPDATE public.community_campaigns SET status='closed', closed_at=now() WHERE id = v_camp.id AND status='open';
  END IF;

  PERFORM public.notify_member(auth.uid(), 'info', 'Campanha aceita',
    v_camp.title, '/comunidade/campanhas', 'community_accept_'||v_camp.id::text);

  INSERT INTO public.ops_metrics(scope,operation,status,metadata)
  VALUES ('community','accept_campaign','success',jsonb_build_object('campaign_id',v_camp.id));

  RETURN jsonb_build_object('ok', true);
END $$;

-- Substitui community_submit_proof com rate limit
CREATE OR REPLACE FUNCTION public.community_submit_proof(p_participation_id uuid, p_proof_url text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_part record; v_recent int;
BEGIN
  IF p_proof_url IS NULL OR length(trim(p_proof_url)) < 10 THEN RAISE EXCEPTION 'invalid_proof_url'; END IF;

  SELECT * INTO v_part FROM public.community_participations
   WHERE id = p_participation_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_part.status NOT IN ('accepted','submitted') THEN RAISE EXCEPTION 'invalid_state'; END IF;
  IF v_part.expires_at IS NOT NULL AND v_part.expires_at < now() THEN
    UPDATE public.community_participations SET status='expired', updated_at=now() WHERE id = v_part.id;
    RAISE EXCEPTION 'expired';
  END IF;

  -- Rate limit: máx 5 submits em 10min
  SELECT COUNT(*) INTO v_recent FROM public.community_participations
   WHERE user_id = auth.uid() AND proof_submitted_at > now() - interval '10 minutes';
  IF v_recent >= 5 THEN RAISE EXCEPTION 'rate_limited'; END IF;

  UPDATE public.community_participations
    SET proof_url = p_proof_url, status = 'submitted', proof_submitted_at = now(), updated_at = now()
    WHERE id = p_participation_id;

  PERFORM public.notify_member(auth.uid(), 'info', 'Prova enviada',
    'Vamos validar e te avisamos.', '/comunidade/pontos',
    'community_submitted_'||v_part.id::text);

  INSERT INTO public.ops_metrics(scope,operation,status,metadata)
  VALUES ('community','submit_proof','success',jsonb_build_object('participation_id',v_part.id));

  RETURN jsonb_build_object('ok', true);
END $$;

-- ---------- 5) FEED DA PARTICIPAÇÃO (para membro) ----------
CREATE OR REPLACE FUNCTION public.community_my_participations()
RETURNS TABLE(
  id uuid, status text, title text, song_name text, song_artist text, song_cover_url text,
  points_offered int, points_awarded int, expires_at timestamptz, created_at timestamptz,
  proof_submitted_at timestamptz, reviewed_at timestamptz, review_note text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.status,
         COALESCE(c.title, d.song_name) as title,
         d.song_name, d.song_artist, d.song_cover_url,
         p.points_offered, p.points_awarded, p.expires_at, p.created_at,
         p.proof_submitted_at, p.reviewed_at,
         -- só expõe motivo amigável se rejeitada
         CASE WHEN p.status = 'rejected' THEN 'A prova não foi validada.' ELSE NULL END as review_note
    FROM public.community_participations p
    LEFT JOIN public.community_campaigns c ON c.id = p.campaign_id
    LEFT JOIN public.curator_deals d ON d.id = p.deal_id
   WHERE p.user_id = auth.uid()
   ORDER BY p.created_at DESC
   LIMIT 100;
$$;

-- ---------- 6) AUDITORIA AUTOMÁTICA ----------
CREATE OR REPLACE FUNCTION public.community_audit_report()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r jsonb := '[]'::jsonb;
  v int;
BEGIN
  IF NOT has_team_access() THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- Participações órfãs (sem member válido)
  SELECT COUNT(*) INTO v FROM community_participations p
    WHERE NOT EXISTS (SELECT 1 FROM community_members m WHERE m.id = p.member_id);
  r := r || jsonb_build_object('check','orphan_participations','count',v,'level', CASE WHEN v>0 THEN 'critical' ELSE 'ok' END);

  -- Convites accepted sem member
  SELECT COUNT(*) INTO v FROM community_invites i
   WHERE i.status='accepted' AND NOT EXISTS (SELECT 1 FROM community_members m WHERE m.invite_id = i.id);
  r := r || jsonb_build_object('check','consumed_invites_no_member','count',v,'level', CASE WHEN v>0 THEN 'warning' ELSE 'ok' END);

  -- Slots negativos
  SELECT COUNT(*) INTO v FROM community_campaigns WHERE used_slots < 0 OR used_slots > max_slots;
  r := r || jsonb_build_object('check','campaign_slot_invariant','count',v,'level', CASE WHEN v>0 THEN 'critical' ELSE 'ok' END);

  -- Playlist duplicada
  SELECT COUNT(*) INTO v FROM (
    SELECT spotify_playlist_id FROM community_members WHERE spotify_playlist_id IS NOT NULL
    GROUP BY spotify_playlist_id HAVING COUNT(*) > 1) x;
  r := r || jsonb_build_object('check','duplicate_playlists','count',v,'level', CASE WHEN v>0 THEN 'critical' ELSE 'ok' END);

  -- Pontos divergentes do ledger
  SELECT COUNT(*) INTO v FROM community_members m
   WHERE m.points <> COALESCE((SELECT SUM(points) FROM community_points_ledger l WHERE l.member_id = m.id), 0);
  r := r || jsonb_build_object('check','points_vs_ledger','count',v,'level', CASE WHEN v>0 THEN 'critical' ELSE 'ok' END);

  -- Participações expiradas ainda 'accepted'/'submitted'
  SELECT COUNT(*) INTO v FROM community_participations
   WHERE status IN ('accepted','submitted') AND expires_at IS NOT NULL AND expires_at < now();
  r := r || jsonb_build_object('check','stale_active_participations','count',v,'level', CASE WHEN v>0 THEN 'warning' ELSE 'ok' END);

  -- Campanhas closed aceitando (sanity: nenhuma participação criada após closed_at)
  SELECT COUNT(*) INTO v FROM community_participations p
    JOIN community_campaigns c ON c.id = p.campaign_id
   WHERE c.status='closed' AND c.closed_at IS NOT NULL AND p.created_at > c.closed_at;
  r := r || jsonb_build_object('check','accept_after_close','count',v,'level', CASE WHEN v>0 THEN 'critical' ELSE 'ok' END);

  -- RLS abertas indevidamente (tabelas community_*)
  SELECT COUNT(*) INTO v FROM pg_policies
   WHERE schemaname='public' AND tablename LIKE 'community_%' AND qual = 'true';
  r := r || jsonb_build_object('check','community_open_rls','count',v,'level', CASE WHEN v>0 THEN 'critical' ELSE 'ok' END);

  RETURN jsonb_build_object('generated_at', now(), 'checks', r);
END $$;

-- Job leve de expiração lazy (chamável pelo client)
CREATE OR REPLACE FUNCTION public.community_expire_stale()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  WITH upd AS (
    UPDATE public.community_participations
       SET status='expired', updated_at=now()
     WHERE status IN ('accepted','submitted')
       AND expires_at IS NOT NULL AND expires_at < now()
     RETURNING user_id, id
  )
  SELECT COUNT(*) INTO n FROM upd;
  RETURN COALESCE(n,0);
END $$;
