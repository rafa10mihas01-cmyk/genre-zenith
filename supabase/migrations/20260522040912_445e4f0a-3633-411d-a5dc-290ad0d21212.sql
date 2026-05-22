
-- ============ HISTORY TABLES ============

CREATE TABLE public.genre_brain_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  genre_id uuid NOT NULL,
  slug text,
  knowledge_score numeric,
  avg_leadership_score numeric,
  recent_drifts_7d integer,
  active_leaders integer,
  playlists_with_genre integer,
  avg_confidence numeric,
  tokens_total integer,
  tokens_strong integer,
  freshness_avg numeric,
  cluster_strength_avg numeric,
  metadata jsonb DEFAULT '{}'::jsonb,
  captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_gbh_genre_time ON public.genre_brain_history(genre_id, captured_at DESC);
CREATE INDEX idx_gbh_time ON public.genre_brain_history(captured_at DESC);

CREATE TABLE public.genre_trend_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  genre_id uuid,
  subgenre_slug text,
  event_type text NOT NULL CHECK (event_type IN (
    'term_emerging','term_dying','artist_rising','playlist_growing',
    'cluster_heating','editorial_shift','drift_detected','leader_rising','leader_falling'
  )),
  title text NOT NULL,
  description text,
  payload jsonb DEFAULT '{}'::jsonb,
  severity text DEFAULT 'info' CHECK (severity IN ('info','notable','strong')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_gte_time ON public.genre_trend_events(occurred_at DESC);
CREATE INDEX idx_gte_genre_time ON public.genre_trend_events(genre_id, occurred_at DESC);
CREATE INDEX idx_gte_type_time ON public.genre_trend_events(event_type, occurred_at DESC);

CREATE TABLE public.playlist_drift_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id uuid NOT NULL,
  playlist_spotify_id text,
  genre_mix jsonb NOT NULL DEFAULT '{}'::jsonb,
  dominant_genre text,
  track_sample_size integer,
  captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pds_playlist_time ON public.playlist_drift_snapshots(playlist_id, captured_at DESC);

CREATE TABLE public.genre_lexicon_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  genre_id uuid NOT NULL,
  slug text,
  term text NOT NULL,
  weight numeric,
  rank integer,
  status text CHECK (status IN ('emerging','stable','declining','dead')),
  captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_glh_genre_time ON public.genre_lexicon_history(genre_id, captured_at DESC);
CREATE INDEX idx_glh_term ON public.genre_lexicon_history(term, captured_at DESC);

CREATE TABLE public.playlist_leadership_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id uuid NOT NULL,
  leadership_score numeric,
  freshness_rank numeric,
  follower_rank numeric,
  growth_rank numeric,
  activity_rank numeric,
  followers integer,
  rank_position integer,
  evidence jsonb DEFAULT '{}'::jsonb,
  captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_plh_playlist_time ON public.playlist_leadership_history(playlist_id, captured_at DESC);
CREATE INDEX idx_plh_time ON public.playlist_leadership_history(captured_at DESC);

-- ============ RLS ============

ALTER TABLE public.genre_brain_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.genre_trend_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playlist_drift_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.genre_lexicon_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playlist_leadership_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read gbh" ON public.genre_brain_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read gte" ON public.genre_trend_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read pds" ON public.playlist_drift_snapshots FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read glh" ON public.genre_lexicon_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated read plh" ON public.playlist_leadership_history FOR SELECT TO authenticated USING (true);

-- ============ BACKFILL (1 ponto inicial) ============

INSERT INTO public.genre_brain_history (
  genre_id, slug, knowledge_score, avg_leadership_score, recent_drifts_7d,
  active_leaders, playlists_with_genre, avg_confidence, tokens_total, tokens_strong
)
SELECT genre_id, slug, knowledge_score, avg_leadership_score, recent_drifts_7d,
       active_leaders, playlists_with_genre, avg_confidence, tokens_total, tokens_strong
FROM public.genre_brain
WHERE genre_id IS NOT NULL;

INSERT INTO public.playlist_leadership_history (
  playlist_id, leadership_score, freshness_rank, follower_rank, growth_rank, activity_rank, evidence
)
SELECT playlist_id, leadership_score, freshness_rank, follower_rank, growth_rank, activity_rank, evidence
FROM public.playlist_leadership;
