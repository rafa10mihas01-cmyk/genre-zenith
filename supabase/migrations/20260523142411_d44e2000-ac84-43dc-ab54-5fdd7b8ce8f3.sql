-- Remove privilege-escalation risk: members can no longer write directly to
-- community_participations. All member writes must go through the
-- SECURITY DEFINER RPCs community_accept_campaign / community_submit_proof,
-- which sanitize fields (status, points, reviewer) server-side.

DROP POLICY IF EXISTS member_insert_own_part ON public.community_participations;
DROP POLICY IF EXISTS member_update_own_part ON public.community_participations;