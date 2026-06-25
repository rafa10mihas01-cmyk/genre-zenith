
-- ============================================================
-- 1) Capacidade planejada por gênero (teto operacional)
-- ============================================================
ALTER TABLE public.genre_editorial_policy_defaults
  ADD COLUMN IF NOT EXISTS operational_ceiling integer NOT NULL DEFAULT 150;

ALTER TABLE public.playlist_editorial_policies
  ADD COLUMN IF NOT EXISTS operational_ceiling integer NULL;

COMMENT ON COLUMN public.genre_editorial_policy_defaults.operational_ceiling IS
  'Capacidade planejada por gênero. Referência operacional para cálculo de vagas. NÃO é meta obrigatória nem reflete o tamanho atual das playlists.';
COMMENT ON COLUMN public.playlist_editorial_policies.operational_ceiling IS
  'Override por playlist do teto operacional. NULL = herda do gênero.';

-- Seed dos tetos iniciais (override apenas para Rap; demais ficam no default 150).
UPDATE public.genre_editorial_policy_defaults gepd
   SET operational_ceiling = 130, updated_at = now()
  FROM public.genres g
 WHERE g.id = gepd.genre_id AND lower(g.nome) = 'rap';

UPDATE public.genre_editorial_policy_defaults gepd
   SET operational_ceiling = 150, updated_at = now()
  FROM public.genres g
 WHERE g.id = gepd.genre_id AND lower(g.nome) IN
   ('trap','funk','pop','sertanejo','pagode','forró','piseiro','eletrofunk','axé','agro');

-- ============================================================
-- 2) Resolver de política passa a devolver o teto operacional
-- ============================================================
DROP FUNCTION IF EXISTS public.fn_resolve_playlist_policy(uuid);
CREATE OR REPLACE FUNCTION public.fn_resolve_playlist_policy(p_playlist_id uuid)
RETURNS TABLE(
  managed_playlist_id uuid,
  campaign_reserved_slots integer,
  catalog_capacity integer,
  third_party_max_pct numeric,
  protect_top_n integer,
  intercalation_ratio integer,
  operational_ceiling integer,
  source text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    mp.id,
    COALESCE(pep.campaign_reserved_slots, gepd.campaign_reserved_slots, 15),
    COALESCE(pep.catalog_capacity,        gepd.catalog_capacity,        18),
    COALESCE(pep.third_party_max_pct,     gepd.third_party_max_pct,     50.00),
    COALESCE(pep.protect_top_n,           gepd.protect_top_n,           10),
    COALESCE(pep.intercalation_ratio,     gepd.intercalation_ratio,     4),
    COALESCE(pep.operational_ceiling,     gepd.operational_ceiling,     150),
    CASE
      WHEN pep.id  IS NOT NULL THEN 'playlist'
      WHEN gepd.id IS NOT NULL THEN 'genre_default'
      ELSE 'system_default'
    END
  FROM public.managed_playlists mp
  LEFT JOIN public.playlist_editorial_policies pep
    ON pep.managed_playlist_id = mp.id AND pep.is_active
  LEFT JOIN public.genre_editorial_policy_defaults gepd
    ON gepd.genre_id = mp.genre_id
  WHERE mp.id = p_playlist_id;
$$;
GRANT EXECUTE ON FUNCTION public.fn_resolve_playlist_policy(uuid) TO authenticated, service_role;

-- ============================================================
-- 3) Occupancy Engine — REGRAS OFICIAIS de capacidade planejada
--    - Abaixo do teto -> só INSERT.
--    - No teto -> 1 REMOVE (ThirdParty) + 1 INSERT por entrada de catálogo.
--    - Acima do teto -> ceiling efetivo = max(current, planned). Mesmo regime.
--    - Catalog e Campaign NUNCA são removidos pelo motor.
--    - Sem limpeza em massa. Máx. 5 substituições por ciclo (todas pareadas).
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_playlist_occupancy_rebuild(
  p_playlist_id uuid,
  p_mode text DEFAULT 'SHADOW'::text,
  p_trigger_source text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_plan_id uuid;
  v_policy record;
  v_mp record;
  v_block_reason text := NULL;
  v_event_class text;

  v_total_current   integer := 0;
  v_campaign_count  integer := 0;
  v_catalog_count   integer := 0;
  v_third_count     integer := 0;

  v_planned_ceiling   integer := 150;
  v_effective_ceiling integer := 150;
  v_free_slots        integer := 0;
  v_mode_branch       text;

  v_max_substitutions constant integer := 5;
  v_pending record;
  v_victim_track text;
  v_victim_pos integer;
  v_insert_pos integer;
  v_inserts integer := 0;
  v_removes integer := 0;
  v_processed integer := 0;
BEGIN
  IF p_mode NOT IN ('SHADOW','DUAL_WRITE','PRIMARY') THEN
    RAISE EXCEPTION 'invalid mode: %', p_mode;
  END IF;

  SELECT mp.id, mp.spotify_playlist_id, mp.archived_at, mp.execution_mode,
         mp.operational_status, mp.genre_id
    INTO v_mp
  FROM public.managed_playlists mp
  WHERE mp.id = p_playlist_id;

  IF v_mp.id IS NULL THEN
    RAISE EXCEPTION 'playlist % nao encontrada', p_playlist_id;
  END IF;

  v_block_reason := CASE
    WHEN v_mp.spotify_playlist_id IS NULL OR v_mp.spotify_playlist_id = '' THEN 'no_spotify_id'
    WHEN v_mp.execution_mode = 'MANUAL_ONLY'::playlist_execution_mode THEN 'manual_only'
    WHEN COALESCE(v_mp.operational_status,'') = 'do_not_operate' THEN 'do_not_operate'
    ELSE NULL
  END;

  SELECT * INTO v_policy FROM public.fn_resolve_playlist_policy(p_playlist_id);
  v_planned_ceiling := COALESCE(v_policy.operational_ceiling, 150);

  v_event_class := CASE
    WHEN p_trigger_source IN (
      'catalog_placement_insert',
      'catalog_placement_update',
      'catalog_insert',
      'campaign_closed',
      'managed_tracks_delete',
      'manual_remove',
      'free_slot_available'
    ) THEN 'INSERTION_DRIVEN'
    ELSE 'NO_OP'
  END;

  INSERT INTO public.occupancy_plans (managed_playlist_id, mode, status, policy_snapshot, trigger_source)
  VALUES (
    p_playlist_id, p_mode,
    CASE WHEN v_block_reason IS NOT NULL THEN 'blocked' ELSE 'draft' END,
    to_jsonb(v_policy),
    p_trigger_source
  ) RETURNING id INTO v_plan_id;

  IF v_block_reason IS NOT NULL THEN
    UPDATE public.occupancy_plans
       SET block_reason = v_block_reason, finalized_at = now()
     WHERE id = v_plan_id;
    RETURN v_plan_id;
  END IF;

  DROP TABLE IF EXISTS _cur;
  CREATE TEMP TABLE _cur ON COMMIT DROP AS
  SELECT
    mpt.spotify_track_id,
    mpt.position,
    COALESCE(o.origin, 'ThirdParty') AS origin
  FROM public.managed_playlist_tracks mpt
  LEFT JOIN public.v_playlist_track_origin o
    ON o.managed_playlist_id = mpt.playlist_id
   AND o.spotify_track_id   = mpt.spotify_track_id
  WHERE mpt.playlist_id = p_playlist_id;

  SELECT count(*) INTO v_total_current FROM _cur;
  SELECT count(*) INTO v_campaign_count FROM _cur WHERE origin='Campaign';
  SELECT count(*) INTO v_catalog_count  FROM _cur WHERE origin='Catalog';
  SELECT count(*) INTO v_third_count    FROM _cur WHERE origin='ThirdParty';

  -- REGRA OFICIAL — teto operacional efetivo:
  -- Playlists abaixo do planejado crescem até o planejado.
  -- Playlists já acima preservam o tamanho atual como teto operacional (Regra 3).
  v_effective_ceiling := GREATEST(v_planned_ceiling, v_total_current);
  v_free_slots        := GREATEST(0, v_effective_ceiling - v_total_current);
  v_mode_branch       := CASE
    WHEN v_total_current <  v_planned_ceiling THEN 'below_ceiling'
    WHEN v_total_current =  v_planned_ceiling THEN 'at_ceiling'
    ELSE 'above_ceiling'
  END;

  IF v_event_class = 'NO_OP' THEN
    UPDATE public.occupancy_plans
       SET status='ready', finalized_at=now(),
           stats = jsonb_build_object(
             'total_current', v_total_current,
             'campaign_count', v_campaign_count,
             'catalog_count', v_catalog_count,
             'third_party_count', v_third_count,
             'planned_ceiling', v_planned_ceiling,
             'effective_ceiling', v_effective_ceiling,
             'free_slots', v_free_slots,
             'mode_branch', v_mode_branch,
             'event_class', 'NO_OP',
             'trigger_source', p_trigger_source,
             'policy_source', v_policy.source,
             'reason', 'event_does_not_require_action'
           )
     WHERE id = v_plan_id;
    RETURN v_plan_id;
  END IF;

  -- Itera as músicas de catálogo pendentes (placements ativos ainda não na playlist).
  FOR v_pending IN
    SELECT ct.spotify_track_id
      FROM public.catalog_placements cp
      JOIN public.catalog_tracks ct ON ct.id = cp.catalog_track_id
     WHERE cp.managed_playlist_id = p_playlist_id
       AND cp.status = 'active'
       AND NOT EXISTS (SELECT 1 FROM _cur c WHERE c.spotify_track_id = ct.spotify_track_id)
     ORDER BY cp.created_at ASC
     LIMIT v_max_substitutions
  LOOP
    v_processed := v_processed + 1;

    -- CASO A — abaixo do teto efetivo: só INSERT, nunca remove (Regra 1).
    IF v_total_current < v_effective_ceiling THEN
      v_insert_pos := v_total_current;
      INSERT INTO public.occupancy_plan_ops (
        plan_id, op_type, spotify_track_id, classification, to_position, reason
      ) VALUES (
        v_plan_id, 'INSERT', v_pending.spotify_track_id, 'Catalog',
        v_insert_pos, 'fill_free_slot_below_ceiling'
      );
      INSERT INTO _cur (spotify_track_id, position, origin)
      VALUES (v_pending.spotify_track_id, v_insert_pos, 'Catalog');
      v_total_current := v_total_current + 1;
      v_catalog_count := v_catalog_count + 1;
      v_inserts       := v_inserts + 1;
      CONTINUE;
    END IF;

    -- CASO B — no teto ou acima: substituição gradual 1×1 (Regras 2, 3 e 4).
    -- Vítima é SEMPRE ThirdParty (Catalog e Campaign jamais são removidos pelo motor).
    v_victim_track := NULL; v_victim_pos := NULL;

    SELECT spotify_track_id, position
      INTO v_victim_track, v_victim_pos
      FROM _cur
     WHERE origin = 'ThirdParty'
     ORDER BY position DESC
     LIMIT 1;

    -- Sem ThirdParty disponível: não remove (Regra 5 — sem limpeza em massa).
    IF v_victim_track IS NULL THEN
      EXIT;
    END IF;

    INSERT INTO public.occupancy_plan_ops (
      plan_id, op_type, spotify_track_id, classification, from_position, reason
    ) VALUES (
      v_plan_id, 'REMOVE', v_victim_track, 'ThirdParty', v_victim_pos,
      CASE WHEN v_mode_branch = 'above_ceiling'
           THEN 'gradual_substitution_above_ceiling'
           ELSE 'substitution_at_ceiling' END
    );
    INSERT INTO public.occupancy_plan_ops (
      plan_id, op_type, spotify_track_id, classification, to_position, reason
    ) VALUES (
      v_plan_id, 'INSERT', v_pending.spotify_track_id, 'Catalog', v_victim_pos,
      CASE WHEN v_mode_branch = 'above_ceiling'
           THEN 'gradual_substitution_above_ceiling'
           ELSE 'substitution_at_ceiling' END
    );

    DELETE FROM _cur WHERE spotify_track_id = v_victim_track;
    v_third_count   := v_third_count - 1;
    INSERT INTO _cur (spotify_track_id, position, origin)
    VALUES (v_pending.spotify_track_id, v_victim_pos, 'Catalog');
    v_catalog_count := v_catalog_count + 1;
    v_removes       := v_removes + 1;
    v_inserts       := v_inserts + 1;
  END LOOP;

  UPDATE public.occupancy_plans
     SET status='ready', finalized_at=now(),
         stats = jsonb_build_object(
           'total_current', v_total_current,
           'campaign_count', v_campaign_count,
           'catalog_count', v_catalog_count,
           'third_party_count', v_third_count,
           'planned_ceiling', v_planned_ceiling,
           'effective_ceiling', v_effective_ceiling,
           'free_slots', v_free_slots,
           'mode_branch', v_mode_branch,
           'event_class', v_event_class,
           'trigger_source', p_trigger_source,
           'policy_source', v_policy.source,
           'pending_processed', v_processed,
           'inserts', v_inserts,
           'removes', v_removes
         )
   WHERE id = v_plan_id;

  RETURN v_plan_id;
END;
$function$;
