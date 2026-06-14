
-- 1. Fix SECURITY DEFINER view: recreate as security_invoker
CREATE OR REPLACE VIEW public.v_catalog_track_distribution_stats
WITH (security_invoker = on) AS
SELECT ct.id AS catalog_track_id,
    ct.track_name,
    ct.artist_name,
    ct.isrc,
    ct.genre_id,
    count(cp.id)::integer AS placements_total,
    count(cp.id) FILTER (WHERE cp.status = 'pending'::text)::integer AS placements_pending,
    count(cp.id) FILTER (WHERE cp.status = 'active'::text)::integer AS placements_active,
    count(cp.id) FILTER (
      WHERE cp.status = 'failed'::text
        AND cp.last_error_code IS NOT NULL
        AND cp.updated_at >= (now() - '14 days'::interval)
        AND NOT EXISTS (
          SELECT 1 FROM public.catalog_placements cp_active
          WHERE cp_active.catalog_track_id = ct.id AND cp_active.status = 'active'::text
        )
    )::integer AS placements_failed,
    count(cp.id) FILTER (WHERE cp.status = 'removed'::text)::integer AS placements_removed,
    max(cp.added_at) FILTER (WHERE cp.status = 'active'::text) AS last_active_at,
    min(cp.created_at) AS first_placement_at
FROM public.catalog_tracks ct
LEFT JOIN public.catalog_placements cp ON cp.catalog_track_id = ct.id
GROUP BY ct.id;

-- 2. Curators: revoke direct access to financial/identity columns from authenticated
REVOKE SELECT (pix_key, pix_type, document) ON public.curators FROM authenticated;
REVOKE INSERT (pix_key, pix_type, document) ON public.curators FROM authenticated;
REVOKE UPDATE (pix_key, pix_type, document) ON public.curators FROM authenticated;

-- Admin-only RPC to read payment info
CREATE OR REPLACE FUNCTION public.admin_get_curator_payment(_curator_id uuid)
RETURNS TABLE (pix_key text, pix_type text, document text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden: admin only';
  END IF;
  RETURN QUERY
    SELECT c.pix_key, c.pix_type, c.document
    FROM public.curators c
    WHERE c.id = _curator_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_curator_payment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_curator_payment(uuid) TO authenticated;

-- Admin-only RPC to write payment info
CREATE OR REPLACE FUNCTION public.admin_set_curator_payment(
  _curator_id uuid,
  _pix_type text,
  _pix_key text,
  _document text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden: admin only';
  END IF;
  UPDATE public.curators
     SET pix_type = _pix_type,
         pix_key  = _pix_key,
         document = _document,
         updated_at = now()
   WHERE id = _curator_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_curator_payment(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_curator_payment(uuid, text, text, text) TO authenticated;

-- 5. song_snapshots & song_snapshot_playlists: drop anon SELECT (no public page uses them)
DROP POLICY IF EXISTS "Anon can read catalog song snapshots" ON public.song_snapshots;
DROP POLICY IF EXISTS "Anon can read catalog snapshot playlists" ON public.song_snapshot_playlists;
REVOKE SELECT ON public.song_snapshots FROM anon;
REVOKE SELECT ON public.song_snapshot_playlists FROM anon;
