CREATE TABLE public.community_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(8), 'hex'),
  email text,
  invited_by uuid NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_invites_status_chk CHECK (status IN ('pending','accepted','expired','revoked'))
);
CREATE INDEX idx_community_invites_code ON public.community_invites(code);
CREATE INDEX idx_community_invites_status ON public.community_invites(status);
CREATE INDEX idx_community_invites_email ON public.community_invites(lower(email));
ALTER TABLE public.community_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_select_community_invites ON public.community_invites FOR SELECT TO authenticated USING (has_team_access());
CREATE POLICY team_insert_community_invites ON public.community_invites FOR INSERT TO authenticated WITH CHECK (has_team_access());
CREATE POLICY team_update_community_invites ON public.community_invites FOR UPDATE TO authenticated USING (has_team_access()) WITH CHECK (has_team_access());
CREATE POLICY team_delete_community_invites ON public.community_invites FOR DELETE TO authenticated USING (has_team_access());

CREATE TABLE public.community_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  display_name text NOT NULL,
  instagram_handle text,
  playlist_url text,
  spotify_playlist_id text,
  playlist_name text,
  playlist_followers bigint,
  status text NOT NULL DEFAULT 'active',
  tier text NOT NULL DEFAULT 'bronze',
  points integer NOT NULL DEFAULT 0,
  invited_by uuid,
  invite_id uuid REFERENCES public.community_invites(id) ON DELETE SET NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  suspended_at timestamptz,
  suspended_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_members_status_chk CHECK (status IN ('active','paused','suspended','left')),
  CONSTRAINT community_members_tier_chk CHECK (tier IN ('bronze','prata','ouro'))
);
CREATE INDEX idx_community_members_user ON public.community_members(user_id);
CREATE INDEX idx_community_members_status ON public.community_members(status);
ALTER TABLE public.community_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_select_community_members ON public.community_members FOR SELECT TO authenticated USING (has_team_access());
CREATE POLICY team_insert_community_members ON public.community_members FOR INSERT TO authenticated WITH CHECK (has_team_access());
CREATE POLICY team_update_community_members ON public.community_members FOR UPDATE TO authenticated USING (has_team_access()) WITH CHECK (has_team_access());
CREATE POLICY team_delete_community_members ON public.community_members FOR DELETE TO authenticated USING (has_team_access());
CREATE POLICY member_select_own ON public.community_members FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY member_insert_own ON public.community_members FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY member_update_own ON public.community_members FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.community_participations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.community_members(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  deal_id uuid NOT NULL,
  song_id uuid,
  status text NOT NULL DEFAULT 'accepted',
  proof_url text,
  proof_submitted_at timestamptz,
  points_offered integer NOT NULL DEFAULT 0,
  points_awarded integer NOT NULL DEFAULT 0,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_part_status_chk CHECK (status IN ('accepted','submitted','approved','rejected','expired','passed'))
);
CREATE UNIQUE INDEX uniq_community_part_member_deal ON public.community_participations(member_id, deal_id);
CREATE INDEX idx_community_part_status ON public.community_participations(status);
CREATE INDEX idx_community_part_deal ON public.community_participations(deal_id);
ALTER TABLE public.community_participations ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_select_community_part ON public.community_participations FOR SELECT TO authenticated USING (has_team_access());
CREATE POLICY team_insert_community_part ON public.community_participations FOR INSERT TO authenticated WITH CHECK (has_team_access());
CREATE POLICY team_update_community_part ON public.community_participations FOR UPDATE TO authenticated USING (has_team_access()) WITH CHECK (has_team_access());
CREATE POLICY team_delete_community_part ON public.community_participations FOR DELETE TO authenticated USING (has_team_access());
CREATE POLICY member_select_own_part ON public.community_participations FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY member_insert_own_part ON public.community_participations FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY member_update_own_part ON public.community_participations FOR UPDATE TO authenticated USING (auth.uid() = user_id AND status IN ('accepted','submitted')) WITH CHECK (auth.uid() = user_id AND status IN ('accepted','submitted'));

CREATE TRIGGER trg_community_invites_updated BEFORE UPDATE ON public.community_invites FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_community_members_updated BEFORE UPDATE ON public.community_members FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_community_participations_updated BEFORE UPDATE ON public.community_participations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();