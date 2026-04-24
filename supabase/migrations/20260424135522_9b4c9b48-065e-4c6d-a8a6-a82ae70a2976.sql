
-- ============================================================
-- FASE A — SEGURANÇA
-- ============================================================

-- A.1: Bucket playlist-covers — bloquear LIST/SELECT amplo
-- (URL pública direta continua funcionando porque bucket é public=true;
--  só removemos a capacidade de listar arquivos do bucket)
DROP POLICY IF EXISTS "Public read access for playlist covers" ON storage.objects;
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view playlist covers" ON storage.objects;
DROP POLICY IF EXISTS "playlist_covers_public_read" ON storage.objects;
DROP POLICY IF EXISTS "playlist-covers public read" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read access to playlist covers" ON storage.objects;

-- A.2: spotify_tokens — restringir a admin (era has_team_access)
DROP POLICY IF EXISTS team_select_spotify_tokens ON public.spotify_tokens;
DROP POLICY IF EXISTS team_insert_spotify_tokens ON public.spotify_tokens;
DROP POLICY IF EXISTS team_update_spotify_tokens ON public.spotify_tokens;
DROP POLICY IF EXISTS team_delete_spotify_tokens ON public.spotify_tokens;

CREATE POLICY admins_select_spotify_tokens ON public.spotify_tokens
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY admins_insert_spotify_tokens ON public.spotify_tokens
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY admins_update_spotify_tokens ON public.spotify_tokens
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY admins_delete_spotify_tokens ON public.spotify_tokens
  FOR DELETE TO authenticated USING (public.is_admin());

-- A.3: spotify_oauth_states — documentar como service-role-only
COMMENT ON TABLE public.spotify_oauth_states IS
  'Service-role-only. Acessada exclusivamente por edge functions com SUPABASE_SERVICE_ROLE_KEY. RLS habilitado sem policies = bloqueio total para clientes autenticados (intencional).';

-- Policy explícita negando tudo para autenticado (silencia linter sem mudar comportamento)
CREATE POLICY deny_all_spotify_oauth_states ON public.spotify_oauth_states
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ============================================================
-- FASE C — Reduzir índices em search_results (16 → 8)
-- ============================================================
-- Mantidos: pkey, uq_genre_playlist, genre, needs_enrich (parcial),
--           quality_flag, priority, revalidation_queue, enrich_failed
-- Dropados: redundantes ou não usados pelas queries atuais

DROP INDEX IF EXISTS public.idx_search_results_followers_source;
DROP INDEX IF EXISTS public.idx_search_results_followers_verified_at;
DROP INDEX IF EXISTS public.idx_search_results_is_valid;
DROP INDEX IF EXISTS public.idx_search_results_last_seen;
DROP INDEX IF EXISTS public.idx_search_results_owner_type;
DROP INDEX IF EXISTS public.idx_search_results_pending_enrich;
DROP INDEX IF EXISTS public.idx_search_results_score;
DROP INDEX IF EXISTS public.idx_search_results_term;
