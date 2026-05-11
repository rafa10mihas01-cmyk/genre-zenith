
-- helper: timestamp trigger fn (local, idempotent name)
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TABLE public.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  track_name text NOT NULL,
  artist text,
  spotify_track_id text,
  spotify_track_url text,
  cover_url text,
  goal_plays bigint NOT NULL CHECK (goal_plays > 0),
  deadline date NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','completed','cancelled')),
  total_allocated bigint NOT NULL DEFAULT 0,
  total_delivered bigint NOT NULL DEFAULT 0,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_campaigns_status_deadline ON public.campaigns(status, deadline);
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_select_campaigns_v2 ON public.campaigns FOR SELECT TO authenticated USING (has_team_access());
CREATE POLICY team_insert_campaigns_v2 ON public.campaigns FOR INSERT TO authenticated WITH CHECK (has_team_access());
CREATE POLICY team_update_campaigns_v2 ON public.campaigns FOR UPDATE TO authenticated USING (has_team_access()) WITH CHECK (has_team_access());
CREATE POLICY team_delete_campaigns_v2 ON public.campaigns FOR DELETE TO authenticated USING (has_team_access());
CREATE TRIGGER trg_campaigns_updated BEFORE UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.campaign_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  playlist_id uuid NOT NULL REFERENCES public.playlists(id) ON DELETE RESTRICT,
  target_plays bigint NOT NULL DEFAULT 0 CHECK (target_plays >= 0),
  weight numeric NOT NULL DEFAULT 1,
  delivered_plays bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested','approved','active','paused','completed')),
  position smallint NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, playlist_id)
);
CREATE INDEX idx_campaign_allocations_campaign ON public.campaign_allocations(campaign_id);
CREATE INDEX idx_campaign_allocations_playlist ON public.campaign_allocations(playlist_id, status);
ALTER TABLE public.campaign_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_select_camp_alloc ON public.campaign_allocations FOR SELECT TO authenticated USING (has_team_access());
CREATE POLICY team_insert_camp_alloc ON public.campaign_allocations FOR INSERT TO authenticated WITH CHECK (has_team_access());
CREATE POLICY team_update_camp_alloc ON public.campaign_allocations FOR UPDATE TO authenticated USING (has_team_access()) WITH CHECK (has_team_access());
CREATE POLICY team_delete_camp_alloc ON public.campaign_allocations FOR DELETE TO authenticated USING (has_team_access());
CREATE TRIGGER trg_camp_alloc_updated BEFORE UPDATE ON public.campaign_allocations FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE OR REPLACE FUNCTION public.sync_campaign_total_allocated()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cid uuid;
BEGIN
  v_cid := COALESCE(NEW.campaign_id, OLD.campaign_id);
  UPDATE public.campaigns
     SET total_allocated = COALESCE((SELECT SUM(target_plays) FROM public.campaign_allocations WHERE campaign_id = v_cid), 0)
   WHERE id = v_cid;
  RETURN NULL;
END; $$;

CREATE TRIGGER trg_sync_camp_alloc
  AFTER INSERT OR UPDATE OF target_plays OR DELETE ON public.campaign_allocations
  FOR EACH ROW EXECUTE FUNCTION public.sync_campaign_total_allocated();

CREATE OR REPLACE FUNCTION public.suggest_campaign_playlists(
  p_goal bigint, p_deadline date, p_exclude_active boolean DEFAULT true
) RETURNS TABLE (
  playlist_id uuid, playlist_name text, followers bigint, cover_url text,
  capacity_score numeric, health_score numeric, risk_score numeric,
  expected_delivery bigint, suggested_target bigint, suggested_weight numeric, composite_score numeric
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_days int; v_weeks numeric;
BEGIN
  v_days := GREATEST((p_deadline - CURRENT_DATE)::int, 1);
  v_weeks := v_days::numeric / 7.0;

  RETURN QUERY
  WITH latest_scores AS (
    SELECT DISTINCT ON (ps.playlist_id) ps.playlist_id, ps.capacity_score, ps.health_score, ps.risk_score, ps.metadata
    FROM public.playlist_scores ps ORDER BY ps.playlist_id, ps.calculated_at DESC
  ),
  candidates AS (
    SELECT p.id AS pid, p.name AS pname, p.followers AS pfollowers, p.cover_url AS pcover,
      COALESCE(ls.capacity_score,0)::numeric AS cap,
      COALESCE(ls.health_score,0)::numeric AS health,
      COALESCE(ls.risk_score,0)::numeric AS risk,
      COALESCE(NULLIF((ls.metadata->>'avg_weekly_plays')::numeric,0), COALESCE(ls.capacity_score,0)::numeric * 50) AS weekly_cap
    FROM public.playlists p
    LEFT JOIN latest_scores ls ON ls.playlist_id = p.id
    WHERE p.ownership = 'own'
      AND (NOT p_exclude_active OR p.id NOT IN (
        SELECT ca.playlist_id FROM public.campaign_allocations ca WHERE ca.status IN ('approved','active')
      ))
  ),
  ranked AS (
    SELECT c.*, (c.weekly_cap * v_weeks)::bigint AS expected,
           (0.5*c.cap + 0.3*c.health + 0.2*(100-c.risk))::numeric AS composite
    FROM candidates c WHERE c.weekly_cap > 0
    ORDER BY composite DESC, expected DESC LIMIT 20
  ),
  totals AS (SELECT SUM(expected)::numeric AS total_expected FROM ranked)
  SELECT r.pid, r.pname, r.pfollowers, r.pcover, r.cap, r.health, r.risk, r.expected,
    CASE WHEN t.total_expected IS NULL OR t.total_expected = 0 THEN 0::bigint
         ELSE LEAST(r.expected, GREATEST(0, (p_goal::numeric * r.expected / t.total_expected))::bigint) END,
    CASE WHEN t.total_expected IS NULL OR t.total_expected = 0 THEN 1::numeric
         ELSE (r.expected / t.total_expected)::numeric END,
    r.composite
  FROM ranked r CROSS JOIN totals t ORDER BY r.composite DESC;
END; $$;

GRANT EXECUTE ON FUNCTION public.suggest_campaign_playlists(bigint, date, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.recalc_campaign_progress(p_campaign_id uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int := 0; v_camp record;
BEGIN
  FOR v_camp IN
    SELECT id, started_at FROM public.campaigns
     WHERE (p_campaign_id IS NULL OR id = p_campaign_id)
       AND (p_campaign_id IS NOT NULL OR status = 'active')
  LOOP
    UPDATE public.campaign_allocations ca
       SET delivered_plays = COALESCE(sub.plays_delta, 0)
      FROM (
        SELECT ca2.id AS alloc_id,
          GREATEST(0, COALESCE(MAX(s.plays),0) - COALESCE(MIN(s.plays),0))::bigint AS plays_delta
        FROM public.campaign_allocations ca2
        LEFT JOIN public.curator_playlists cp ON cp.canonical_playlist_id = ca2.playlist_id
        LEFT JOIN public.curator_deal_snapshots s ON s.playlist_id = cp.id AND s.captured_at >= v_camp.started_at
        WHERE ca2.campaign_id = v_camp.id
        GROUP BY ca2.id
      ) sub
     WHERE ca.id = sub.alloc_id;

    UPDATE public.campaigns
       SET total_delivered = COALESCE((SELECT SUM(delivered_plays) FROM public.campaign_allocations WHERE campaign_id = v_camp.id), 0)
     WHERE id = v_camp.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END; $$;

GRANT EXECUTE ON FUNCTION public.recalc_campaign_progress(uuid) TO authenticated;

SELECT cron.schedule(
  'recalc-campaign-progress-daily',
  '30 3 * * *',
  $$SELECT public.recalc_campaign_progress(NULL);$$
);
