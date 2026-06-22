-- Remove GRANTs explicitamente (limpeza simbólica — DROP VIEW cascateia automaticamente).
REVOKE ALL ON public.vw_campaign_playlist_growth FROM anon, authenticated, service_role;

-- Aposentadoria oficial da view legada.
DROP VIEW IF EXISTS public.vw_campaign_playlist_growth;

-- Atualiza comentário oficial da RPC marcando-a como única fonte canônica.
COMMENT ON FUNCTION public.fn_campaign_playlist_growth(uuid[]) IS
'FONTE OFICIAL ÚNICA de delivery por campanha/playlist (pós-Etapa 2B, jun/2026). Substituiu definitivamente a view vw_campaign_playlist_growth (aposentada). Contrato: 14 colunas idênticas à view antiga, com predicate pushdown via p_campaign_ids. Todos os consumidores (front, edge functions, RPCs, views) devem usar exclusivamente esta função. Performance: ~7ms P50 warm, −81% buffers vs view antiga.';