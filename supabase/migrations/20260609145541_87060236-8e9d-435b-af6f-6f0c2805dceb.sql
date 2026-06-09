
-- Tighten RLS read policies to require team access instead of any authenticated user

-- playlist_dna_lexicon_proposals
DROP POLICY IF EXISTS lex_proposals_read_auth ON public.playlist_dna_lexicon_proposals;
CREATE POLICY lex_proposals_read_auth ON public.playlist_dna_lexicon_proposals
  FOR SELECT TO authenticated USING (public.has_team_access());

-- playlist_dna group
DROP POLICY IF EXISTS playlist_dna_read_auth ON public.playlist_dna;
CREATE POLICY playlist_dna_read_auth ON public.playlist_dna
  FOR SELECT TO authenticated USING (public.has_team_access());

DROP POLICY IF EXISTS playlist_dna_runs_read_auth ON public.playlist_dna_runs;
CREATE POLICY playlist_dna_runs_read_auth ON public.playlist_dna_runs
  FOR SELECT TO authenticated USING (public.has_team_access());

DROP POLICY IF EXISTS quality_runs_read_auth ON public.playlist_dna_quality_runs;
CREATE POLICY quality_runs_read_auth ON public.playlist_dna_quality_runs
  FOR SELECT TO authenticated USING (public.has_team_access());

DROP POLICY IF EXISTS blind_runs_read_auth ON public.dna_blind_test_runs;
CREATE POLICY blind_runs_read_auth ON public.dna_blind_test_runs
  FOR SELECT TO authenticated USING (public.has_team_access());

DROP POLICY IF EXISTS blind_playlists_read_auth ON public.dna_blind_test_playlists;
CREATE POLICY blind_playlists_read_auth ON public.dna_blind_test_playlists
  FOR SELECT TO authenticated USING (public.has_team_access());

DROP POLICY IF EXISTS anchor_audit_read_auth ON public.anchor_playlists_audit;
CREATE POLICY anchor_audit_read_auth ON public.anchor_playlists_audit
  FOR SELECT TO authenticated USING (public.has_team_access());

-- spotify_enrichment_queue
DROP POLICY IF EXISTS team_read_seq ON public.spotify_enrichment_queue;
CREATE POLICY team_read_seq ON public.spotify_enrichment_queue
  FOR SELECT TO authenticated USING (public.has_team_access());

-- spotify caches
DROP POLICY IF EXISTS team_read_stc ON public.spotify_track_cache;
CREATE POLICY team_read_stc ON public.spotify_track_cache
  FOR SELECT TO authenticated USING (public.has_team_access());

DROP POLICY IF EXISTS team_read_sac ON public.spotify_artist_cache;
CREATE POLICY team_read_sac ON public.spotify_artist_cache
  FOR SELECT TO authenticated USING (public.has_team_access());
