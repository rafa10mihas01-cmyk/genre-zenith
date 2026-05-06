DELETE FROM public.curator_purchases
WHERE id IN (
  'c30e9b7f-a80c-41c7-9017-e62895e9b255',
  '1959009f-0e17-433f-96cd-c7af1c198fe4'
);

DELETE FROM public.curators
WHERE id IN (
  '323d5426-420f-4ac9-b1d0-c392bf8c4788',
  'f37de5a5-c2e6-44bd-a14e-2718c83b1bd8'
)
AND NOT EXISTS (SELECT 1 FROM public.curator_deals d WHERE d.curator_id = curators.id);