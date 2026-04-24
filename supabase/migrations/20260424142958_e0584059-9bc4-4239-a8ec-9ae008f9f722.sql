-- =========================================================
-- AUDIT #7 — FASE C (Performance & Custo)
-- =========================================================

-- C.1) Índice em genres(ativo, status) — reduz seq scans em hot paths
CREATE INDEX IF NOT EXISTS idx_genres_ativo_status
  ON public.genres (ativo, status)
  WHERE ativo = true;

-- C.1b) Índice em accounts(status, current_playlists) — accounts manager + replicação
CREATE INDEX IF NOT EXISTS idx_accounts_status_capacity
  ON public.accounts (status, current_playlists)
  WHERE status = 'active';

-- C.3) Limpeza de logs legados com UUIDs em `acao` (poluição cardinalidade)
--      Normaliza histórico antigo de brain-job:<uuid> para 'brain-job-legacy'
--      (será sobrescrito pela mudança em brain-run que passará a usar 'brain-job' apenas)
UPDATE public.collection_logs
   SET acao = 'brain-job-legacy'
 WHERE acao LIKE 'brain-job:%';

-- Garantir que cleanup_old_logs_and_snapshots já cobre esse caso (>30d serão removidos).