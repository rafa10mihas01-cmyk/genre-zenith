
UPDATE public.campaigns c
   SET total_delivered = COALESCE(f.total_plays, 0)
  FROM public.campaigns c2
  CROSS JOIN LATERAL public.fn_campaign_delivery_accumulated(c2.id) f
 WHERE c2.id = c.id
   AND c.total_delivered IS DISTINCT FROM COALESCE(f.total_plays, 0);
