
-- 1) Restringe políticas de role public -> authenticated nas tabelas de equipe
DO $$
DECLARE
  t text;
  p record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'curator_purchases','curator_fraud_alerts','curator_deal_logs',
    'curator_deal_snapshots','curator_playlists','curator_paste_imports',
    'curator_playlist_library','curator_deals','curators','clients',
    'chart_position_benchmarks'
  ]
  LOOP
    FOR p IN
      SELECT policyname, roles
      FROM pg_policies
      WHERE schemaname='public' AND tablename=t
        AND 'public' = ANY(roles)
    LOOP
      EXECUTE format('ALTER POLICY %I ON public.%I TO authenticated', p.policyname, t);
    END LOOP;
  END LOOP;
END $$;

-- 2) Políticas restritivas explícitas (deny) para tabelas internas
-- song_snapshots
DROP POLICY IF EXISTS "deny_all_song_snapshots" ON public.song_snapshots;
CREATE POLICY "deny_all_song_snapshots" ON public.song_snapshots
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- song_snapshot_playlists
DROP POLICY IF EXISTS "deny_all_song_snapshot_playlists" ON public.song_snapshot_playlists;
CREATE POLICY "deny_all_song_snapshot_playlists" ON public.song_snapshot_playlists
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- organic_plays_snapshots
DROP POLICY IF EXISTS "deny_all_organic_plays_snapshots" ON public.organic_plays_snapshots;
CREATE POLICY "deny_all_organic_plays_snapshots" ON public.organic_plays_snapshots
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- playlist_operation_queue (bloqueia anon; authenticated continua via policies existentes)
DROP POLICY IF EXISTS "deny_anon_playlist_operation_queue" ON public.playlist_operation_queue;
CREATE POLICY "deny_anon_playlist_operation_queue" ON public.playlist_operation_queue
  AS RESTRICTIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);

-- spotify_circuit_breaker
DROP POLICY IF EXISTS "deny_all_spotify_circuit_breaker" ON public.spotify_circuit_breaker;
CREATE POLICY "deny_all_spotify_circuit_breaker" ON public.spotify_circuit_breaker
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- curator_deal_delivery_status — bloqueia escrita pública (mantém leitura via policies permissivas existentes)
DROP POLICY IF EXISTS "deny_anon_writes_curator_deal_delivery_status" ON public.curator_deal_delivery_status;
CREATE POLICY "deny_anon_writes_curator_deal_delivery_status" ON public.curator_deal_delivery_status
  AS RESTRICTIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);

-- chart_position_benchmarks — bloqueia escritas anônimas
DROP POLICY IF EXISTS "deny_anon_writes_chart_position_benchmarks" ON public.chart_position_benchmarks;
CREATE POLICY "deny_anon_writes_chart_position_benchmarks" ON public.chart_position_benchmarks
  AS RESTRICTIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);
