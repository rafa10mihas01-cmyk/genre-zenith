-- 1) Coluna gerada (sempre derivada — não pode divergir, não precisa backfill)
ALTER TABLE public.curator_playlists
  ADD COLUMN is_observational boolean
  GENERATED ALWAYS AS (
    attribution_method = 'baseline_observed' AND spotify_playlist_id IS NULL
  ) STORED;

-- 2) Índice para filtros frequentes
CREATE INDEX IF NOT EXISTS idx_curator_playlists_is_observational
  ON public.curator_playlists (is_observational)
  WHERE is_observational = false;

-- 3) View operacional (fonte de verdade pública)
CREATE OR REPLACE VIEW public.v_curator_playlists_operational AS
SELECT * FROM public.curator_playlists
WHERE is_observational = false;

-- 4) View observacional (curator-brain, fraud, ecossistema, auditoria)
CREATE OR REPLACE VIEW public.v_curator_playlists_observational AS
SELECT * FROM public.curator_playlists
WHERE is_observational = true;

-- 5) Grants
GRANT SELECT ON public.v_curator_playlists_operational TO authenticated;
GRANT SELECT ON public.v_curator_playlists_observational TO authenticated;
GRANT ALL ON public.v_curator_playlists_operational TO service_role;
GRANT ALL ON public.v_curator_playlists_observational TO service_role;

-- 6) Comentários (documentação inline)
COMMENT ON COLUMN public.curator_playlists.is_observational IS
  'TRUE quando attribution_method=baseline_observed E spotify_playlist_id IS NULL. Indica playlist observada no ecossistema do Spotify for Artists, NÃO entregue pelo curador. Excluir dos KPIs operacionais (streams_total, CPP, PDF, Hub Cliente, Hub Curador, Financeiro).';

COMMENT ON VIEW public.v_curator_playlists_operational IS
  'Fonte de verdade pública: apenas curadoria entregue (exclui observacionais). Usar em PDF, Hub Cliente, Hub Curador, Financeiro, CPP, KPIs lifetime.';

COMMENT ON VIEW public.v_curator_playlists_observational IS
  'Ecossistema observado pelo Spotify for Artists (sem ID, sem ação possível). Disponível para curator-brain, fraud detection, ecossistema, debug e auditoria.';