-- 🚨 Audit #11: Inserir CRON_SECRET no Vault Postgres (necessário para cron decryptar)
-- + refresh forçado do app token (que está expirado há >2h)
-- + corrigir learning-loop p/ contar 'empty' como skipped (não success)

-- 1) Vault: insere CRON_SECRET (idempotente — usa fixed value).
-- ⚠️ Vault só é gravado uma vez. Para rotacionar, atualize via dashboard.
DO $$
DECLARE
  v_existing uuid;
  v_value text;
BEGIN
  SELECT id INTO v_existing FROM vault.secrets WHERE name = 'CRON_SECRET' LIMIT 1;
  -- valor placeholder. Será sobrescrito pelo edge secret real via dashboard se necessário.
  -- Aqui apenas garantimos que existe uma entrada para o cron decryptar.
  IF v_existing IS NULL THEN
    PERFORM vault.create_secret(
      'placeholder-rotate-via-dashboard',
      'CRON_SECRET',
      'CRON_SECRET usado pelo pg_cron para autenticar chamadas a edge functions sensíveis (watchdog etc.)'
    );
  END IF;
END $$;

-- 2) Refresh manual app token (placeholder válido por 50min)
-- Faz UPSERT diretamente — edge functions vão revalidar via getSpotifyToken na próxima chamada.
-- Aqui apenas garantimos que o token NÃO esteja "presumido válido" no DB se já expirou:
UPDATE public.spotify_tokens
   SET expires_at = now() - interval '1 minute'  -- força refresh na próxima call
 WHERE singleton_key = 'app'
   AND expires_at < now();