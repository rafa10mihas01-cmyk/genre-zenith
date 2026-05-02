
-- =========================================================
-- Curadores como entidade global com saldo de plays
-- =========================================================

-- 1) Tabela curators (saldo global do curador)
CREATE TABLE IF NOT EXISTS public.curators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  contact text,
  notes text,
  purchased_plays bigint NOT NULL DEFAULT 0,    -- total comprado (soma dos lotes)
  total_cost numeric DEFAULT 0,                  -- custo total acumulado
  spotify_owner_id text,
  spotify_owner_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE (user_id, name)
);

ALTER TABLE public.curators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own curators"
  ON public.curators FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users insert own curators"
  ON public.curators FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own curators"
  ON public.curators FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own curators"
  ON public.curators FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_curators_user_id ON public.curators(user_id);
CREATE INDEX IF NOT EXISTS idx_curators_active ON public.curators(user_id) WHERE archived_at IS NULL;

CREATE TRIGGER trg_curators_updated_at
  BEFORE UPDATE ON public.curators
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) curator_deals.curator_id (vínculo com a entidade curador)
ALTER TABLE public.curator_deals
  ADD COLUMN IF NOT EXISTS curator_id uuid REFERENCES public.curators(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_curator_deals_curator_id ON public.curator_deals(curator_id);

-- 3) curator_deal_songs.duration_days (música = daily_goal × duration_days)
ALTER TABLE public.curator_deal_songs
  ADD COLUMN IF NOT EXISTS duration_days integer NOT NULL DEFAULT 30;

-- 4) Backfill: criar 1 curador por (user_id, curator_name) e vincular deals
INSERT INTO public.curators (user_id, name, purchased_plays, total_cost, spotify_owner_id, spotify_owner_url, created_at)
SELECT 
  d.user_id,
  d.curator_name,
  COALESCE(SUM(d.target_plays), 0)::bigint AS purchased_plays,
  COALESCE(SUM(d.cost), 0) AS total_cost,
  MAX(d.spotify_owner_id),
  MAX(d.spotify_owner_url),
  MIN(d.created_at)
FROM public.curator_deals d
WHERE NOT EXISTS (
  SELECT 1 FROM public.curators c 
  WHERE c.user_id = d.user_id AND c.name = d.curator_name
)
GROUP BY d.user_id, d.curator_name;

UPDATE public.curator_deals d
   SET curator_id = c.id
  FROM public.curators c
 WHERE d.user_id = c.user_id 
   AND d.curator_name = c.name
   AND d.curator_id IS NULL;

-- 5) View de saldo do curador (consumido = soma dos target das músicas ativas)
CREATE OR REPLACE VIEW public.v_curator_balance
WITH (security_invoker = on) AS
SELECT
  c.id AS curator_id,
  c.user_id,
  c.name,
  c.purchased_plays,
  COALESCE(SUM(s.target_plays) FILTER (WHERE d.closed_at IS NULL), 0)::bigint AS consumed_plays,
  GREATEST(c.purchased_plays - COALESCE(SUM(s.target_plays) FILTER (WHERE d.closed_at IS NULL), 0), 0)::bigint AS remaining_plays,
  CASE 
    WHEN COALESCE(SUM(s.target_plays) FILTER (WHERE d.closed_at IS NULL), 0) > c.purchased_plays 
    THEN COALESCE(SUM(s.target_plays) FILTER (WHERE d.closed_at IS NULL), 0) - c.purchased_plays
    ELSE 0
  END::bigint AS overbooked_plays,
  c.total_cost,
  c.archived_at
FROM public.curators c
LEFT JOIN public.curator_deals d ON d.curator_id = c.id
LEFT JOIN public.curator_deal_songs s ON s.deal_id = d.id
GROUP BY c.id;

-- 6) Trigger para garantir target_plays = daily_goal × duration_days nas músicas
CREATE OR REPLACE FUNCTION public.compute_song_target_plays()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.daily_goal > 0 AND NEW.duration_days > 0 THEN
    NEW.target_plays := NEW.daily_goal * NEW.duration_days;
  END IF;
  IF NEW.started_at IS NOT NULL AND NEW.duration_days > 0 AND NEW.ends_at IS NULL THEN
    NEW.ends_at := NEW.started_at + (NEW.duration_days || ' days')::interval;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_song_target_plays ON public.curator_deal_songs;
CREATE TRIGGER trg_song_target_plays
  BEFORE INSERT OR UPDATE OF daily_goal, duration_days, started_at ON public.curator_deal_songs
  FOR EACH ROW EXECUTE FUNCTION public.compute_song_target_plays();

-- Aplicar nas linhas existentes
UPDATE public.curator_deal_songs
   SET duration_days = GREATEST(
     CASE 
       WHEN started_at IS NOT NULL AND ends_at IS NOT NULL 
       THEN GREATEST(EXTRACT(DAY FROM (ends_at - started_at))::int, 1)
       ELSE 30
     END, 1
   )
 WHERE duration_days = 30;
