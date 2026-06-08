CREATE TABLE IF NOT EXISTS public.anchor_playlists_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_run_id uuid NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  playlist_id uuid NOT NULL,
  anchor_genre text NOT NULL,
  authority_score numeric,
  phase22_purity_pct numeric,
  tracks_total int NOT NULL,
  tracks_own int NOT NULL,
  tracks_foreign int NOT NULL,
  tracks_unknown int NOT NULL,
  own_pct numeric,
  foreign_pct numeric,
  unknown_pct numeric,
  top_contaminant text,
  top_contaminant_pct numeric,
  foreign_breakdown jsonb,
  classification text NOT NULL,
  CONSTRAINT anchor_playlists_audit_class_chk CHECK (classification IN ('forte','media','fraca','invalida'))
);
CREATE INDEX IF NOT EXISTS anchor_audit_run_idx ON public.anchor_playlists_audit(reference_run_id);
CREATE INDEX IF NOT EXISTS anchor_audit_genre_idx ON public.anchor_playlists_audit(anchor_genre);
GRANT SELECT ON public.anchor_playlists_audit TO authenticated;
GRANT ALL ON public.anchor_playlists_audit TO service_role;
ALTER TABLE public.anchor_playlists_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anchor_audit_read_auth" ON public.anchor_playlists_audit FOR SELECT TO authenticated USING (true);