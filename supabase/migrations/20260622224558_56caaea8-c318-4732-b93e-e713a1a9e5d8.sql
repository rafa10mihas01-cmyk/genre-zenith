-- Etapa 2A — Otimização vw_campaign_playlist_growth
-- Índice parcial para eliminar o Seq Scan em campaign_playlist_collections
-- com filtro excluded=false (78% das linhas são descartadas hoje).
-- Cobertura: (campaign_id, playlist_id, captured_at DESC) suporta tanto o
-- JOIN inicial quanto os DISTINCT ON internos da view.
CREATE INDEX IF NOT EXISTS idx_cpc_active
  ON public.campaign_playlist_collections (campaign_id, playlist_id, captured_at DESC)
  WHERE excluded = false;

ANALYZE public.campaign_playlist_collections;