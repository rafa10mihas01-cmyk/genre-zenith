
CREATE TABLE public.label_spreadsheet_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id uuid NOT NULL REFERENCES public.label_spreadsheet_uploads(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL,
  song_id uuid,
  position integer,
  version_name text,
  isrc text,
  playlist_name text NOT NULL,
  playlist_uri text,
  playlist_url text,
  playlist_spotify_id text,
  owner_name text,
  country text,
  streams bigint NOT NULL DEFAULT 0,
  matched_playlist_id uuid REFERENCES public.playlists(id) ON DELETE SET NULL,
  matched_curator_id uuid REFERENCES public.curators(id) ON DELETE SET NULL,
  is_internal boolean NOT NULL DEFAULT false,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_lsr_upload ON public.label_spreadsheet_rows(upload_id);
CREATE INDEX idx_lsr_deal ON public.label_spreadsheet_rows(deal_id, created_at DESC);
CREATE INDEX idx_lsr_matched_playlist ON public.label_spreadsheet_rows(matched_playlist_id) WHERE matched_playlist_id IS NOT NULL;
CREATE INDEX idx_lsr_matched_curator ON public.label_spreadsheet_rows(matched_curator_id) WHERE matched_curator_id IS NOT NULL;
CREATE INDEX idx_lsr_internal ON public.label_spreadsheet_rows(deal_id, is_internal) WHERE is_internal = true;

ALTER TABLE public.label_spreadsheet_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_select_lsr" ON public.label_spreadsheet_rows
  FOR SELECT TO authenticated USING (has_team_access());

CREATE POLICY "team_insert_lsr" ON public.label_spreadsheet_rows
  FOR INSERT TO authenticated WITH CHECK (has_team_access());

CREATE POLICY "team_update_lsr" ON public.label_spreadsheet_rows
  FOR UPDATE TO authenticated USING (has_team_access());

CREATE POLICY "team_delete_lsr" ON public.label_spreadsheet_rows
  FOR DELETE TO authenticated USING (has_team_access());
