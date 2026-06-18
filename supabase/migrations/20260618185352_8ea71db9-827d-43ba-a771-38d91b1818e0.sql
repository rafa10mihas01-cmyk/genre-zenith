-- FASE 9.2C — Drop de tabelas de auditoria pós-migração sem consumidores.
-- Validação prévia (9.2C): zero referências em supabase/functions, src/, scripts/, pg_proc, pg_views.

DROP TABLE IF EXISTS public.curator_deal_snapshots_repoint_backup;
DROP TABLE IF EXISTS public._audit_post_baseline_migration;