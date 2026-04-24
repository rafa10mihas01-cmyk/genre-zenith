-- =========================================================
-- AUDIT #8 C.2 — Singleton lookup em system_flags (855 seq_scan / 1 row)
-- =========================================================
ALTER TABLE public.system_flags
  ADD COLUMN IF NOT EXISTS singleton_key text NOT NULL DEFAULT 'app';

-- Mantém só a linha mais antiga (oldest = canônica, conforme uso atual)
DELETE FROM public.system_flags a
 USING public.system_flags b
 WHERE a.id <> b.id
   AND a.created_at > b.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS idx_system_flags_singleton
  ON public.system_flags (singleton_key);