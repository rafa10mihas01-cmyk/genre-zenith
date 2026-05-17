
REVOKE EXECUTE ON FUNCTION public.apply_playlist_cooldown(uuid, public.curatorial_action_type, text, integer, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_playlist_action_blocked(uuid, public.curatorial_action_type) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_active_cooldowns(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.trg_auto_apply_cooldown() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.apply_playlist_cooldown(uuid, public.curatorial_action_type, text, integer, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_playlist_action_blocked(uuid, public.curatorial_action_type) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_active_cooldowns(uuid) TO authenticated, service_role;

ALTER FUNCTION public.default_cooldown_days(public.curatorial_action_type) SET search_path = public;
ALTER FUNCTION public.map_adjustment_to_curatorial(text) SET search_path = public;
