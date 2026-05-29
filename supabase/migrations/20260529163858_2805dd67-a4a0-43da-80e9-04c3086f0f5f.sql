-- Gap 20: garantir email único entre clientes (apenas quando informado)
CREATE UNIQUE INDEX IF NOT EXISTS clients_email_unique_idx
  ON public.clients (lower(email))
  WHERE email IS NOT NULL;

-- Gap 14: documentar diferença entre as duas filas de playlist
COMMENT ON TABLE public.playlist_operation_queue IS
  'Fila de operações de alto nível por playlist (sync, diagnose, brain, apply-plan). '
  'Cada linha representa um JOB que coordena uma rodada completa de manutenção curatorial. '
  'NÃO usar para ações atômicas de track — para isso usar playlist_execution_jobs.';

COMMENT ON TABLE public.playlist_execution_jobs IS
  'Fila de ações atômicas no Spotify (add/remove/reorder de uma única track). '
  'Cada linha representa UMA chamada HTTP isolada à Web API, executada pelo bot. '
  'Para coordenar rodadas completas de manutenção use playlist_operation_queue.';