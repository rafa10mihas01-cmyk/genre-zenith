
REVOKE EXECUTE ON FUNCTION public.community_review_participation(uuid, text, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.community_revert_participation(uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.community_my_participations() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.community_audit_report() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.community_expire_stale() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.community_recompute_member(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.notify_member(uuid, text, text, text, text, text, jsonb) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.community_member_points(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.community_review_participation(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_revert_participation(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_my_participations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_audit_report() TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_expire_stale() TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_member_points(uuid) TO authenticated;
