
-- ============================================================
-- PATCH B — Etapas 1 e 2 (com dedup p/ uq_snapshot_batch_playlist)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.curator_playlists_ghost_repoint_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  ghost_id uuid NOT NULL,
  twin_id uuid NOT NULL,
  ghost_name text,
  twin_name text,
  twin_spotify_id text,
  norm_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.curator_playlists_ghost_repoint_map TO authenticated;
GRANT ALL ON public.curator_playlists_ghost_repoint_map TO service_role;
ALTER TABLE public.curator_playlists_ghost_repoint_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "repoint_map_admin_read"
  ON public.curator_playlists_ghost_repoint_map FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

WITH norm AS (
  SELECT id, deal_id, added_at, playlist_name, spotify_playlist_id, match_status,
         regexp_replace(lower(unaccent(coalesce(playlist_name,''))), '[^a-z0-9]+', '', 'g') AS key
  FROM public.curator_playlists
),
ghosts AS (
  SELECT * FROM norm WHERE match_status='organic' AND spotify_playlist_id IS NULL AND length(key)>3
),
counts AS (
  SELECT g.id AS ghost_id, count(*) AS n FROM ghosts g
  JOIN norm t ON t.deal_id=g.deal_id AND t.id<>g.id AND t.match_status IN ('curator','baseline')
             AND t.spotify_playlist_id IS NOT NULL AND t.key=g.key
  GROUP BY g.id
),
picked AS (
  SELECT g.id AS ghost_id, g.deal_id, g.playlist_name AS ghost_name, g.key AS norm_key,
         t.id AS twin_id, t.playlist_name AS twin_name, t.spotify_playlist_id AS twin_sid
  FROM ghosts g
  JOIN counts c ON c.ghost_id=g.id AND c.n=1
  JOIN norm t ON t.deal_id=g.deal_id AND t.id<>g.id AND t.match_status IN ('curator','baseline')
             AND t.spotify_playlist_id IS NOT NULL AND t.key=g.key
)
INSERT INTO public.curator_playlists_ghost_repoint_map
  (deal_id, ghost_id, twin_id, ghost_name, twin_name, twin_spotify_id, norm_key)
SELECT deal_id, ghost_id, twin_id, ghost_name, twin_name, twin_sid, norm_key FROM picked;

-- Backup (estrutura + dados)
CREATE TABLE IF NOT EXISTS public.curator_deal_snapshots_repoint_backup AS
SELECT s.*, s.playlist_id AS original_playlist_id_backup, now() AS backed_up_at
FROM public.curator_deal_snapshots s WHERE 1=0;

INSERT INTO public.curator_deal_snapshots_repoint_backup
SELECT s.*, s.playlist_id AS original_playlist_id_backup, now() AS backed_up_at
FROM public.curator_deal_snapshots s
WHERE s.playlist_id IN (SELECT ghost_id FROM public.curator_playlists_ghost_repoint_map);

GRANT SELECT ON public.curator_deal_snapshots_repoint_backup TO authenticated;
GRANT ALL ON public.curator_deal_snapshots_repoint_backup TO service_role;
ALTER TABLE public.curator_deal_snapshots_repoint_backup ENABLE ROW LEVEL SECURITY;
CREATE POLICY "repoint_backup_admin_read"
  ON public.curator_deal_snapshots_repoint_backup FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Reapontamento com dedup: para cada (batch_id, twin_id), só atualiza o snap de maior plays.
-- Snaps "perdedores" do empate permanecem no ghost (sem perda — backup capturou tudo).
WITH candidates AS (
  SELECT s.id AS snap_id, s.batch_id, s.plays, s.captured_at, m.twin_id
  FROM public.curator_deal_snapshots s
  JOIN public.curator_playlists_ghost_repoint_map m ON m.ghost_id = s.playlist_id
),
ranked AS (
  SELECT snap_id, twin_id,
    row_number() OVER (
      PARTITION BY COALESCE(batch_id::text,'no-batch-'||snap_id::text), twin_id
      ORDER BY plays DESC NULLS LAST, captured_at DESC NULLS LAST, snap_id
    ) AS rn
  FROM candidates
),
winners AS (SELECT snap_id, twin_id FROM ranked WHERE rn = 1)
UPDATE public.curator_deal_snapshots s
SET playlist_id = w.twin_id,
    match_method = 'repointed_from_ghost'
FROM winners w
WHERE s.id = w.snap_id;
