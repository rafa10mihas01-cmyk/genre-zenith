
-- Helper: já existe has_team_access(). Trocar policies "own" por policies de equipe.

-- clients
DROP POLICY IF EXISTS "Users select own clients" ON public.clients;
DROP POLICY IF EXISTS "Users insert own clients" ON public.clients;
DROP POLICY IF EXISTS "Users update own clients" ON public.clients;
DROP POLICY IF EXISTS "Users delete own clients" ON public.clients;
CREATE POLICY "team_select_clients" ON public.clients FOR SELECT USING (public.has_team_access());
CREATE POLICY "team_insert_clients" ON public.clients FOR INSERT WITH CHECK (public.has_team_access());
CREATE POLICY "team_update_clients" ON public.clients FOR UPDATE USING (public.has_team_access());
CREATE POLICY "team_delete_clients" ON public.clients FOR DELETE USING (public.has_team_access());

-- curators
DROP POLICY IF EXISTS "Users select own curators" ON public.curators;
DROP POLICY IF EXISTS "Users insert own curators" ON public.curators;
DROP POLICY IF EXISTS "Users update own curators" ON public.curators;
DROP POLICY IF EXISTS "Users delete own curators" ON public.curators;
CREATE POLICY "team_select_curators" ON public.curators FOR SELECT USING (public.has_team_access());
CREATE POLICY "team_insert_curators" ON public.curators FOR INSERT WITH CHECK (public.has_team_access());
CREATE POLICY "team_update_curators" ON public.curators FOR UPDATE USING (public.has_team_access());
CREATE POLICY "team_delete_curators" ON public.curators FOR DELETE USING (public.has_team_access());

-- curator_deals
DROP POLICY IF EXISTS "Users select own curator_deals" ON public.curator_deals;
DROP POLICY IF EXISTS "Users insert own curator_deals" ON public.curator_deals;
DROP POLICY IF EXISTS "Users update own curator_deals" ON public.curator_deals;
DROP POLICY IF EXISTS "Users delete own curator_deals" ON public.curator_deals;
CREATE POLICY "team_select_curator_deals" ON public.curator_deals FOR SELECT USING (public.has_team_access());
CREATE POLICY "team_insert_curator_deals" ON public.curator_deals FOR INSERT WITH CHECK (public.has_team_access());
CREATE POLICY "team_update_curator_deals" ON public.curator_deals FOR UPDATE USING (public.has_team_access());
CREATE POLICY "team_delete_curator_deals" ON public.curator_deals FOR DELETE USING (public.has_team_access());

-- curator_playlist_library
DROP POLICY IF EXISTS "Users select own playlist library" ON public.curator_playlist_library;
DROP POLICY IF EXISTS "Users insert own playlist library" ON public.curator_playlist_library;
DROP POLICY IF EXISTS "Users update own playlist library" ON public.curator_playlist_library;
DROP POLICY IF EXISTS "Users delete own playlist library" ON public.curator_playlist_library;
CREATE POLICY "team_select_curator_playlist_library" ON public.curator_playlist_library FOR SELECT USING (public.has_team_access());
CREATE POLICY "team_insert_curator_playlist_library" ON public.curator_playlist_library FOR INSERT WITH CHECK (public.has_team_access());
CREATE POLICY "team_update_curator_playlist_library" ON public.curator_playlist_library FOR UPDATE USING (public.has_team_access());
CREATE POLICY "team_delete_curator_playlist_library" ON public.curator_playlist_library FOR DELETE USING (public.has_team_access());

-- curator_purchases
DROP POLICY IF EXISTS "Users select own purchases" ON public.curator_purchases;
DROP POLICY IF EXISTS "Users insert own purchases" ON public.curator_purchases;
DROP POLICY IF EXISTS "Users delete own purchases" ON public.curator_purchases;
CREATE POLICY "team_select_curator_purchases" ON public.curator_purchases FOR SELECT USING (public.has_team_access());
CREATE POLICY "team_insert_curator_purchases" ON public.curator_purchases FOR INSERT WITH CHECK (public.has_team_access());
CREATE POLICY "team_delete_curator_purchases" ON public.curator_purchases FOR DELETE USING (public.has_team_access());

-- Tabelas filhas (deal_id IN ...) — agora liberar para equipe diretamente
DROP POLICY IF EXISTS "Users select own curator_deal_logs" ON public.curator_deal_logs;
DROP POLICY IF EXISTS "Users insert own curator_deal_logs" ON public.curator_deal_logs;
DROP POLICY IF EXISTS "Users update own curator_deal_logs" ON public.curator_deal_logs;
DROP POLICY IF EXISTS "Users delete own curator_deal_logs" ON public.curator_deal_logs;
CREATE POLICY "team_select_curator_deal_logs" ON public.curator_deal_logs FOR SELECT USING (public.has_team_access());
CREATE POLICY "team_insert_curator_deal_logs" ON public.curator_deal_logs FOR INSERT WITH CHECK (public.has_team_access());
CREATE POLICY "team_update_curator_deal_logs" ON public.curator_deal_logs FOR UPDATE USING (public.has_team_access());
CREATE POLICY "team_delete_curator_deal_logs" ON public.curator_deal_logs FOR DELETE USING (public.has_team_access());

DROP POLICY IF EXISTS "Users select own deal_snapshots" ON public.curator_deal_snapshots;
DROP POLICY IF EXISTS "Users insert own deal_snapshots" ON public.curator_deal_snapshots;
DROP POLICY IF EXISTS "Users update own deal_snapshots" ON public.curator_deal_snapshots;
DROP POLICY IF EXISTS "Users delete own deal_snapshots" ON public.curator_deal_snapshots;
CREATE POLICY "team_select_curator_deal_snapshots" ON public.curator_deal_snapshots FOR SELECT USING (public.has_team_access());
CREATE POLICY "team_insert_curator_deal_snapshots" ON public.curator_deal_snapshots FOR INSERT WITH CHECK (public.has_team_access());
CREATE POLICY "team_update_curator_deal_snapshots" ON public.curator_deal_snapshots FOR UPDATE USING (public.has_team_access());
CREATE POLICY "team_delete_curator_deal_snapshots" ON public.curator_deal_snapshots FOR DELETE USING (public.has_team_access());

DROP POLICY IF EXISTS "Users select own curator_deal_songs" ON public.curator_deal_songs;
DROP POLICY IF EXISTS "Users insert own curator_deal_songs" ON public.curator_deal_songs;
DROP POLICY IF EXISTS "Users update own curator_deal_songs" ON public.curator_deal_songs;
DROP POLICY IF EXISTS "Users delete own curator_deal_songs" ON public.curator_deal_songs;
CREATE POLICY "team_select_curator_deal_songs" ON public.curator_deal_songs FOR SELECT USING (public.has_team_access());
CREATE POLICY "team_insert_curator_deal_songs" ON public.curator_deal_songs FOR INSERT WITH CHECK (public.has_team_access());
CREATE POLICY "team_update_curator_deal_songs" ON public.curator_deal_songs FOR UPDATE USING (public.has_team_access());
CREATE POLICY "team_delete_curator_deal_songs" ON public.curator_deal_songs FOR DELETE USING (public.has_team_access());

DROP POLICY IF EXISTS "Users select own fraud_alerts" ON public.curator_fraud_alerts;
DROP POLICY IF EXISTS "Users insert own fraud_alerts" ON public.curator_fraud_alerts;
DROP POLICY IF EXISTS "Users update own fraud_alerts" ON public.curator_fraud_alerts;
DROP POLICY IF EXISTS "Users delete own fraud_alerts" ON public.curator_fraud_alerts;
CREATE POLICY "team_select_curator_fraud_alerts" ON public.curator_fraud_alerts FOR SELECT USING (public.has_team_access());
CREATE POLICY "team_insert_curator_fraud_alerts" ON public.curator_fraud_alerts FOR INSERT WITH CHECK (public.has_team_access());
CREATE POLICY "team_update_curator_fraud_alerts" ON public.curator_fraud_alerts FOR UPDATE USING (public.has_team_access());
CREATE POLICY "team_delete_curator_fraud_alerts" ON public.curator_fraud_alerts FOR DELETE USING (public.has_team_access());

DROP POLICY IF EXISTS "Users select own paste_imports" ON public.curator_paste_imports;
DROP POLICY IF EXISTS "Users insert own paste_imports" ON public.curator_paste_imports;
DROP POLICY IF EXISTS "Users delete own paste_imports" ON public.curator_paste_imports;
CREATE POLICY "team_select_curator_paste_imports" ON public.curator_paste_imports FOR SELECT USING (public.has_team_access());
CREATE POLICY "team_insert_curator_paste_imports" ON public.curator_paste_imports FOR INSERT WITH CHECK (public.has_team_access());
CREATE POLICY "team_delete_curator_paste_imports" ON public.curator_paste_imports FOR DELETE USING (public.has_team_access());

DROP POLICY IF EXISTS "Users select own curator_playlists" ON public.curator_playlists;
DROP POLICY IF EXISTS "Users insert own curator_playlists" ON public.curator_playlists;
DROP POLICY IF EXISTS "Users update own curator_playlists" ON public.curator_playlists;
DROP POLICY IF EXISTS "Users delete own curator_playlists" ON public.curator_playlists;
CREATE POLICY "team_select_curator_playlists" ON public.curator_playlists FOR SELECT USING (public.has_team_access());
CREATE POLICY "team_insert_curator_playlists" ON public.curator_playlists FOR INSERT WITH CHECK (public.has_team_access());
CREATE POLICY "team_update_curator_playlists" ON public.curator_playlists FOR UPDATE USING (public.has_team_access());
CREATE POLICY "team_delete_curator_playlists" ON public.curator_playlists FOR DELETE USING (public.has_team_access());
