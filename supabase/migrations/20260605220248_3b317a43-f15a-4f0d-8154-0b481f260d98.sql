
-- Staging table
CREATE TABLE IF NOT EXISTS public.patch_b_v2_promoted_cohort (
  ghost_id uuid PRIMARY KEY,
  twin_pid text NOT NULL
);
GRANT ALL ON public.patch_b_v2_promoted_cohort TO service_role;
ALTER TABLE public.patch_b_v2_promoted_cohort ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only" ON public.patch_b_v2_promoted_cohort
  TO service_role USING (true) WITH CHECK (true);

-- Backup table
CREATE TABLE IF NOT EXISTS public.patch_b_v2_promoted_backup (
  id uuid PRIMARY KEY,
  deal_id uuid,
  song_id uuid,
  playlist_name text,
  spotify_url text,
  spotify_playlist_id text,
  spotify_owner_id text,
  spotify_owner_name text,
  image_url text,
  match_status text,
  attribution_method text,
  attribution_reason text,
  streams_total bigint,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.patch_b_v2_promoted_backup TO service_role;
ALTER TABLE public.patch_b_v2_promoted_backup ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only" ON public.patch_b_v2_promoted_backup
  TO service_role USING (true) WITH CHECK (true);

-- Populate staging from yellow audit (twin_count=2, all names exact, owner consistent)
TRUNCATE public.patch_b_v2_promoted_cohort;
INSERT INTO public.patch_b_v2_promoted_cohort (ghost_id, twin_pid)
WITH g AS (
  SELECT cp.id ghost_id, cp.deal_id, cp.playlist_name gname, cp.song_id,
         lower(btrim(cp.playlist_name)) nkey
  FROM public.curator_playlists cp
  WHERE cp.spotify_playlist_id IS NULL
    AND cp.is_baseline = false
    AND cp.match_status != 'baseline'
),
tw AS (
  SELECT g.ghost_id, array_agg(DISTINCT t.spotify_playlist_id) pids,
         BOOL_AND(t.playlist_name = g.gname) ae,
         MIN(t.spotify_owner_name) mn, MAX(t.spotify_owner_name) mx
  FROM g JOIN public.curator_playlists t
    ON t.spotify_playlist_id IS NOT NULL
   AND t.deal_id != g.deal_id
   AND lower(btrim(t.playlist_name)) = g.nkey
  GROUP BY g.ghost_id
)
SELECT ghost_id, pids[1]
FROM tw
WHERE array_length(pids,1) = 2 AND ae AND mn = mx;

-- Backup before mutation
INSERT INTO public.patch_b_v2_promoted_backup
  (id, deal_id, song_id, playlist_name, spotify_url, spotify_playlist_id,
   spotify_owner_id, spotify_owner_name, image_url, match_status,
   attribution_method, attribution_reason, streams_total)
SELECT cp.id, cp.deal_id, cp.song_id, cp.playlist_name, cp.spotify_url,
       cp.spotify_playlist_id, cp.spotify_owner_id, cp.spotify_owner_name,
       cp.image_url, cp.match_status, cp.attribution_method, cp.attribution_reason,
       cp.streams_total
FROM public.curator_playlists cp
JOIN public.patch_b_v2_promoted_cohort pc ON pc.ghost_id = cp.id
ON CONFLICT (id) DO NOTHING;

-- Compute eligible set (no external collision, no internal duplicates — keep highest streams)
WITH targets AS (
  SELECT pc.ghost_id, pc.twin_pid, cp.deal_id, cp.song_id, cp.streams_total
  FROM public.patch_b_v2_promoted_cohort pc
  JOIN public.curator_playlists cp ON cp.id = pc.ghost_id
),
ext_collisions AS (
  SELECT t.ghost_id
  FROM targets t
  JOIN public.curator_playlists e
    ON e.deal_id = t.deal_id
   AND COALESCE(e.song_id,'00000000-0000-0000-0000-000000000000'::uuid) =
       COALESCE(t.song_id,'00000000-0000-0000-0000-000000000000'::uuid)
   AND e.spotify_playlist_id = t.twin_pid
   AND e.id != t.ghost_id
),
ranked AS (
  SELECT t.*,
    ROW_NUMBER() OVER (
      PARTITION BY t.deal_id,
                   COALESCE(t.song_id,'00000000-0000-0000-0000-000000000000'::uuid),
                   t.twin_pid
      ORDER BY t.streams_total DESC, t.ghost_id
    ) AS rn
  FROM targets t
  WHERE t.ghost_id NOT IN (SELECT ghost_id FROM ext_collisions)
),
eligible AS (
  SELECT ghost_id, twin_pid FROM ranked WHERE rn = 1
)
UPDATE public.curator_playlists cp
SET spotify_playlist_id = e.twin_pid,
    spotify_url         = COALESCE(twin.spotify_url, 'https://open.spotify.com/playlist/' || e.twin_pid),
    spotify_owner_id    = twin.spotify_owner_id,
    spotify_owner_name  = twin.spotify_owner_name,
    image_url           = COALESCE(cp.image_url, twin.image_url),
    attribution_method  = 'patch_b_v2_yellow_promoted',
    attribution_reason  = 'Cross-deal twin (yellow→green: twin_count=2, exact name, same owner)'
FROM eligible e
JOIN LATERAL (
  SELECT spotify_url, spotify_owner_id, spotify_owner_name, image_url
  FROM public.curator_playlists
  WHERE spotify_playlist_id = e.twin_pid
  ORDER BY added_at ASC
  LIMIT 1
) twin ON true
WHERE cp.id = e.ghost_id;
