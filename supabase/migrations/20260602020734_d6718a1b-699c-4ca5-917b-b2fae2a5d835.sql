ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS last_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_found integer,
  ADD COLUMN IF NOT EXISTS last_sync_imported integer,
  ADD COLUMN IF NOT EXISTS last_sync_pending integer,
  ADD COLUMN IF NOT EXISTS last_sync_already_existed integer,
  ADD COLUMN IF NOT EXISTS last_sync_auto_archived integer;

-- Backfill rápido pra Royal Lists com os números reais que acabamos de auditar.
UPDATE public.accounts
SET last_sync_at = '2026-06-02 01:38:57+00',
    last_sync_found = 107,
    last_sync_imported = 50,
    last_sync_pending = 57,
    last_sync_already_existed = 0,
    last_sync_auto_archived = 14
WHERE spotify_user_id = 'z4ox6sjcnfkjulzdqkwj6qcd0';