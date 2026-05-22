
-- Phase 3: Clusters + Leadership

CREATE TABLE public.playlist_clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subgenre_id uuid REFERENCES public.subgenres(id) ON DELETE SET NULL,
  genre_id uuid,
  label text,
  strength numeric NOT NULL DEFAULT 0,
  sample_size integer NOT NULL DEFAULT 0,
  centroid jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_playlist_clusters_subgenre ON public.playlist_clusters(subgenre_id);
CREATE INDEX idx_playlist_clusters_genre ON public.playlist_clusters(genre_id);

CREATE TABLE public.playlist_cluster_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id uuid NOT NULL REFERENCES public.playlist_clusters(id) ON DELETE CASCADE,
  playlist_id uuid NOT NULL REFERENCES public.playlists(id) ON DELETE CASCADE,
  similarity numeric NOT NULL DEFAULT 0,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(cluster_id, playlist_id)
);
CREATE INDEX idx_pcm_playlist ON public.playlist_cluster_members(playlist_id);
CREATE INDEX idx_pcm_cluster ON public.playlist_cluster_members(cluster_id);

CREATE TABLE public.playlist_leadership (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id uuid NOT NULL REFERENCES public.playlists(id) ON DELETE CASCADE,
  leadership_score numeric NOT NULL DEFAULT 0,
  follower_rank numeric NOT NULL DEFAULT 0,
  growth_rank numeric NOT NULL DEFAULT 0,
  activity_rank numeric NOT NULL DEFAULT 0,
  benchmark_rank numeric NOT NULL DEFAULT 0,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(playlist_id)
);
CREATE INDEX idx_leadership_score ON public.playlist_leadership(leadership_score DESC);

ALTER TABLE public.playlist_clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playlist_cluster_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playlist_leadership ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage clusters" ON public.playlist_clusters
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Authenticated read clusters" ON public.playlist_clusters
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage cluster members" ON public.playlist_cluster_members
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Authenticated read cluster members" ON public.playlist_cluster_members
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage leadership" ON public.playlist_leadership
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Authenticated read leadership" ON public.playlist_leadership
  FOR SELECT TO authenticated USING (true);
