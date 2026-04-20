-- Limpar todos os gêneros exceto funk, sertanejo e piseiro
WITH keep AS (
  SELECT id FROM public.genres WHERE slug IN ('funk','sertanejo','piseiro')
)
DELETE FROM public.search_tracks
WHERE genre_id IS NULL OR genre_id NOT IN (SELECT id FROM keep);

WITH keep AS (
  SELECT id FROM public.genres WHERE slug IN ('funk','sertanejo','piseiro')
)
DELETE FROM public.search_results
WHERE genre_id IS NULL OR genre_id NOT IN (SELECT id FROM keep);

WITH keep AS (
  SELECT id FROM public.genres WHERE slug IN ('funk','sertanejo','piseiro')
)
DELETE FROM public.search_terms
WHERE genre_id IS NULL OR genre_id NOT IN (SELECT id FROM keep);

WITH keep AS (
  SELECT id FROM public.genres WHERE slug IN ('funk','sertanejo','piseiro')
)
DELETE FROM public.genre_models
WHERE genre_id IS NULL OR genre_id NOT IN (SELECT id FROM keep);

WITH keep AS (
  SELECT id FROM public.genres WHERE slug IN ('funk','sertanejo','piseiro')
)
DELETE FROM public.collection_logs
WHERE genre_id IS NOT NULL AND genre_id NOT IN (SELECT id FROM keep);

DELETE FROM public.genres WHERE slug NOT IN ('funk','sertanejo','piseiro');