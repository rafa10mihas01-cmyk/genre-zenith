-- Garantir extensão unaccent disponível
CREATE EXTENSION IF NOT EXISTS unaccent;

WITH ge AS (
  SELECT id, nome FROM public.genres WHERE ativo
),
mp AS (
  SELECT id AS playlist_id, lower(unaccent(coalesce(name,''))) AS n FROM public.managed_playlists
),
hits AS (
  SELECT d.playlist_id,
         d.dominant_genre_id,
         d.dominant_genre_name,
         g.id   AS name_genre_id,
         g.nome AS name_genre_name,
         mp.n   AS name_norm
  FROM public.playlist_dna d
  JOIN mp ON mp.playlist_id = d.playlist_id
  JOIN ge g ON mp.n ~* ('\m'||g.nome||'\M')
  WHERE d.classification <> 'Insuficiente'
    AND d.dominant_genre_id IS NOT NULL
    AND g.id <> d.dominant_genre_id
),
agg AS (
  SELECT playlist_id, jsonb_agg(
           jsonb_build_object(
             'type','name_vs_dna_genre',
             'name_indicates_genre', name_genre_name,
             'dna_indicates_genre',  dominant_genre_name
           )
         ) AS conflicts
  FROM hits
  GROUP BY playlist_id
)
UPDATE public.playlist_dna d
SET name_conflict = a.conflicts
FROM agg a
WHERE a.playlist_id = d.playlist_id
  AND (d.name_conflict IS NULL OR d.name_conflict = 'null'::jsonb);

-- Atualiza contagem no run mais recente
UPDATE public.playlist_dna_quality_runs q
SET conflitos = (SELECT count(*) FROM public.playlist_dna WHERE name_conflict IS NOT NULL),
    top_confused = COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'playlist_id', d.playlist_id,
        'name', mp.name,
        'followers', mp.followers,
        'dna_genre', d.dominant_genre_name,
        'conflict', d.name_conflict,
        'confidence', d.classification_confidence,
        'niche_adherence', d.niche_adherence_score
      ) ORDER BY mp.followers DESC NULLS LAST)
      FROM (
        SELECT * FROM public.playlist_dna WHERE name_conflict IS NOT NULL
        ORDER BY (SELECT followers FROM public.managed_playlists WHERE id = playlist_dna.playlist_id) DESC NULLS LAST
        LIMIT 50
      ) d
      JOIN public.managed_playlists mp ON mp.id = d.playlist_id
    ), '[]'::jsonb)
WHERE q.id = (SELECT id FROM public.playlist_dna_quality_runs ORDER BY started_at DESC LIMIT 1);