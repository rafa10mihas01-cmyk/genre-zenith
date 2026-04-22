-- Contas operacionais (espelham contas Spotify conectadas)
CREATE TABLE IF NOT EXISTS public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spotify_user_token_id uuid REFERENCES public.spotify_user_tokens(id) ON DELETE SET NULL,
  email text,
  spotify_user_id text NOT NULL,
  display_name text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','limited','banned')),
  max_playlists int NOT NULL DEFAULT 15,
  current_playlists int NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (spotify_user_id)
);

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_select_accounts" ON public.accounts FOR SELECT TO authenticated USING (has_team_access());
CREATE POLICY "team_insert_accounts" ON public.accounts FOR INSERT TO authenticated WITH CHECK (has_team_access());
CREATE POLICY "team_update_accounts" ON public.accounts FOR UPDATE TO authenticated USING (has_team_access()) WITH CHECK (has_team_access());
CREATE POLICY "team_delete_accounts" ON public.accounts FOR DELETE TO authenticated USING (has_team_access());

CREATE TRIGGER accounts_updated_at BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Histórico de replicações
CREATE TABLE IF NOT EXISTS public.replications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  genre_id uuid NOT NULL,
  source_result_id uuid,            -- playlist semente que disparou
  blueprint_id uuid,                -- blueprint usado
  template_id uuid,                 -- template gerado
  account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  spotify_playlist_id text,
  spotify_url text,
  selection_score numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','generating','approved','created','failed','skipped')),
  error_message text,
  triggered_by text NOT NULL DEFAULT 'manual' CHECK (triggered_by IN ('manual','cron','batch')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_replications_genre ON public.replications(genre_id);
CREATE INDEX idx_replications_status ON public.replications(status);
CREATE INDEX idx_replications_created ON public.replications(created_at DESC);

ALTER TABLE public.replications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_select_replications" ON public.replications FOR SELECT TO authenticated USING (has_team_access());
CREATE POLICY "team_insert_replications" ON public.replications FOR INSERT TO authenticated WITH CHECK (has_team_access());
CREATE POLICY "team_update_replications" ON public.replications FOR UPDATE TO authenticated USING (has_team_access()) WITH CHECK (has_team_access());
CREATE POLICY "team_delete_replications" ON public.replications FOR DELETE TO authenticated USING (has_team_access());

CREATE TRIGGER replications_updated_at BEFORE UPDATE ON public.replications FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Backfill: cria automaticamente accounts pra cada token Spotify já conectado
INSERT INTO public.accounts (spotify_user_token_id, email, spotify_user_id, display_name)
SELECT id, email, spotify_user_id, display_name
FROM public.spotify_user_tokens
ON CONFLICT (spotify_user_id) DO NOTHING;