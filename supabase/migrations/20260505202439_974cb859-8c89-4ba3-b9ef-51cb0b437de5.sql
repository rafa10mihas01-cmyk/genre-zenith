-- Corrige o job que recupera músicas presas para não criar loop imediato.
-- Antes ele voltava queued/error para idle sem empurrar a próxima coleta,
-- então a fila pegava de novo no mesmo minuto.
SELECT cron.unschedule('reset-stuck-bot-songs')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reset-stuck-bot-songs');

SELECT cron.schedule(
  'reset-stuck-bot-songs',
  '*/5 * * * *',
  $$
  UPDATE public.curator_deal_songs
     SET auto_collect_status = 'idle',
         auto_collect_error = trim(concat(coalesce(auto_collect_error, ''), ' [auto-reset: stuck > 10min]')),
         next_auto_collect_at = CASE
           WHEN next_auto_collect_at IS NULL OR next_auto_collect_at <= now()
             THEN now() + (GREATEST(coalesce(auto_collect_interval_minutes, 1440), 1) || ' minutes')::interval
           ELSE next_auto_collect_at
         END,
         updated_at = now()
   WHERE auto_collect_status IN ('queued','error')
     AND updated_at < now() - interval '10 minutes';
  $$
);

-- Normaliza qualquer item que esteja travado agora, sem desligar a auto-coleta.
-- Isso tira o banner de "coletando agora" e agenda a próxima tentativa para o intervalo real.
UPDATE public.curator_deal_songs
   SET auto_collect_status = 'idle',
       auto_collect_error = NULL,
       next_auto_collect_at = COALESCE(
         last_auto_collect_at + (GREATEST(coalesce(auto_collect_interval_minutes, 1440), 1) || ' minutes')::interval,
         now() + (GREATEST(coalesce(auto_collect_interval_minutes, 1440), 1) || ' minutes')::interval
       ),
       updated_at = now()
 WHERE auto_collect_status IN ('queued','error')
   AND last_auto_collect_at IS NOT NULL;