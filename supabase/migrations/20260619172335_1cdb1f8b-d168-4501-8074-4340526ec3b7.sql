
DROP VIEW IF EXISTS public.v_campaign_overview CASCADE;

CREATE VIEW public.v_campaign_overview
WITH (security_invoker = true)
AS
WITH
diretos AS (
  SELECT
    cd.campaign_id,
    COALESCE(SUM(cd.cost), 0)::numeric AS custo_curadores_diretos,
    COALESCE(SUM(cd.target_plays), 0)::bigint AS deals_streams_previstos,
    COALESCE(SUM(GREATEST(COALESCE(cd.reconciled_total_plays,0) - COALESCE(cd.baseline_plays,0), 0)), 0)::bigint AS deals_streams_entregues
  FROM public.curator_deals cd
  WHERE cd.external_package_item_id IS NULL
  GROUP BY cd.campaign_id
),
deals_all AS (
  SELECT
    cd.campaign_id,
    COUNT(*)::int AS deals_total_all,
    COUNT(*) FILTER (WHERE cd.closed_status IS NULL OR cd.closed_status NOT IN ('completed','closed'))::int AS deals_abertos_all,
    COUNT(*) FILTER (WHERE cd.closed_status IN ('completed','closed'))::int AS deals_concluidos_all
  FROM public.curator_deals cd
  GROUP BY cd.campaign_id
),
eco AS (
  SELECT
    a.campaign_id,
    COUNT(*)::int AS eco_total,
    COUNT(*) FILTER (WHERE a.status = 'dispatched')::int AS eco_dispatched,
    COALESCE(SUM(a.planned_streams), 0)::bigint AS eco_streams_previstos,
    COALESCE(SUM(a.planned_streams) FILTER (WHERE a.status = 'dispatched'), 0)::bigint AS eco_streams_entregues,
    COALESCE(SUM(a.planned_streams * COALESCE(a.cost_per_stream_op, 0)), 0)::numeric AS custo_eco
  FROM public.campaign_eco_allocations a
  GROUP BY a.campaign_id
),
ext AS (
  SELECT
    p.campaign_id,
    COUNT(DISTINCT p.id)::int AS pacotes_total,
    COUNT(DISTINCT p.id) FILTER (WHERE p.status IN ('confirmed','active','completed'))::int AS pacotes_confirmados,
    COUNT(i.id)::int AS externos_items_total,
    COALESCE(SUM(i.assigned_cost), 0)::numeric AS custo_externos,
    COALESCE(SUM(i.assigned_streams), 0)::bigint AS externos_streams_previstos
  FROM public.campaign_external_packages p
  LEFT JOIN public.campaign_external_package_items i ON i.package_id = p.id
  GROUP BY p.campaign_id
),
curadores AS (
  SELECT campaign_id, COUNT(DISTINCT curator_id)::int AS n FROM (
    SELECT cd.campaign_id, cd.curator_id
      FROM public.curator_deals cd
      WHERE cd.curator_id IS NOT NULL AND cd.campaign_id IS NOT NULL
    UNION
    SELECT a.campaign_id, mp.curator_id
      FROM public.campaign_eco_allocations a
      JOIN public.managed_playlists mp ON mp.id = a.managed_playlist_id
      WHERE mp.curator_id IS NOT NULL
    UNION
    SELECT p.campaign_id, i.curator_id
      FROM public.campaign_external_packages p
      JOIN public.campaign_external_package_items i ON i.package_id = p.id
      WHERE i.curator_id IS NOT NULL
  ) s
  GROUP BY campaign_id
)
SELECT
  c.id              AS campaign_id,
  c.client_id,
  c.status,
  c.track_name,
  c.artist,
  NULL::text        AS genre,
  c.created_at,
  c.plan_approved_at,
  c.client_approved_at,
  c.baseline_captured_at,
  c.eco_dispatched_at,
  c.closed_at,

  COALESCE(c.valor_cobrado, 0)::numeric  AS contratado,
  COALESCE(c.valor_recebido, 0)::numeric AS recebido,
  GREATEST(COALESCE(c.valor_cobrado,0) - COALESCE(c.valor_recebido,0), 0)::numeric AS pendente,

  COALESCE(diretos.custo_curadores_diretos, 0) AS custo_curadores_diretos,
  COALESCE(eco.custo_eco, 0)                    AS custo_eco,
  COALESCE(ext.custo_externos, 0)               AS custo_externos,
  ( COALESCE(diretos.custo_curadores_diretos,0)
  + COALESCE(eco.custo_eco,0)
  + COALESCE(ext.custo_externos,0) )            AS custo_operacional,

  ( COALESCE(c.valor_cobrado,0)
    - ( COALESCE(diretos.custo_curadores_diretos,0)
      + COALESCE(eco.custo_eco,0)
      + COALESCE(ext.custo_externos,0) ) )      AS margem_prevista,

  CASE WHEN COALESCE(c.valor_cobrado,0) > 0
       THEN ROUND(
         ( ( COALESCE(c.valor_cobrado,0)
             - ( COALESCE(diretos.custo_curadores_diretos,0)
               + COALESCE(eco.custo_eco,0)
               + COALESCE(ext.custo_externos,0) ) )
           / c.valor_cobrado ) * 100, 2)
       ELSE 0
  END                                            AS margem_pct,

  COALESCE(deals_all.deals_total_all, 0)        AS deals_total,
  COALESCE(deals_all.deals_abertos_all, 0)      AS deals_abertos,
  COALESCE(deals_all.deals_concluidos_all, 0)   AS deals_concluidos,
  COALESCE(eco.eco_total, 0)                    AS eco_total,
  COALESCE(eco.eco_dispatched, 0)               AS eco_dispatched,
  COALESCE(ext.pacotes_total, 0)                AS pacotes_total,
  COALESCE(ext.pacotes_confirmados, 0)          AS pacotes_confirmados,
  COALESCE(ext.externos_items_total, 0)         AS externos_items_total,
  COALESCE(curadores.n, 0)                      AS curadores_unicos,

  ( COALESCE(diretos.deals_streams_previstos, 0)
  + COALESCE(eco.eco_streams_previstos, 0)
  + COALESCE(ext.externos_streams_previstos, 0) )::bigint AS streams_previstos,

  ( COALESCE(diretos.deals_streams_entregues, 0)
  + COALESCE(eco.eco_streams_entregues, 0) )::bigint      AS streams_entregues,

  CASE
    WHEN ( COALESCE(diretos.deals_streams_previstos,0)
         + COALESCE(eco.eco_streams_previstos,0)
         + COALESCE(ext.externos_streams_previstos,0) ) > 0
    THEN LEAST(
      ROUND(
        ( ( COALESCE(diretos.deals_streams_entregues,0)
          + COALESCE(eco.eco_streams_entregues,0) )::numeric
          /
          ( COALESCE(diretos.deals_streams_previstos,0)
          + COALESCE(eco.eco_streams_previstos,0)
          + COALESCE(ext.externos_streams_previstos,0) )::numeric
        ) * 100, 2),
      100)
    ELSE 0
  END                                            AS progresso_pct

FROM public.campaigns c
LEFT JOIN diretos   ON diretos.campaign_id   = c.id
LEFT JOIN deals_all ON deals_all.campaign_id = c.id
LEFT JOIN eco       ON eco.campaign_id       = c.id
LEFT JOIN ext       ON ext.campaign_id       = c.id
LEFT JOIN curadores ON curadores.campaign_id = c.id;

GRANT SELECT ON public.v_campaign_overview TO authenticated;
GRANT SELECT ON public.v_campaign_overview TO service_role;

COMMENT ON VIEW public.v_campaign_overview IS
  'Fase 14.1 - fonte unica de verdade para Cliente/Campanha/Financeiro/Cockpit/Home. Anti-duplicidade: curator_deals com external_package_item_id NAO entram em custo_curadores_diretos.';
