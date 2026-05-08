
-- ============================================================
-- 1. Helper para checar se o user atual é admin (via user_roles)
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  );
$$;

-- ============================================================
-- 2. Threads de conversa do Copiloto IA
-- ============================================================
CREATE TABLE public.ops_chat_threads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  title         text NOT NULL DEFAULT 'Nova conversa',
  model         text NOT NULL DEFAULT 'google/gemini-2.5-pro',
  pinned        boolean NOT NULL DEFAULT false,
  archived_at   timestamptz,
  last_message_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ops_chat_threads_user ON public.ops_chat_threads(user_id, last_message_at DESC NULLS LAST);

ALTER TABLE public.ops_chat_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_all_ops_chat_threads ON public.ops_chat_threads
  FOR ALL TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

-- ============================================================
-- 3. Mensagens do chat
-- ============================================================
CREATE TABLE public.ops_chat_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id     uuid NOT NULL REFERENCES public.ops_chat_threads(id) ON DELETE CASCADE,
  role          text NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content       text,
  tool_calls    jsonb NOT NULL DEFAULT '[]'::jsonb,
  tool_call_id  text,
  attachments   jsonb NOT NULL DEFAULT '[]'::jsonb,
  model         text,
  tokens_in     integer,
  tokens_out    integer,
  status        text NOT NULL DEFAULT 'complete' CHECK (status IN ('streaming','complete','error')),
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ops_chat_messages_thread ON public.ops_chat_messages(thread_id, created_at);

ALTER TABLE public.ops_chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_all_ops_chat_messages ON public.ops_chat_messages
  FOR ALL TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

-- Bumpa last_message_at do thread automaticamente
CREATE OR REPLACE FUNCTION public.bump_ops_thread_last_msg()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.ops_chat_threads
     SET last_message_at = NEW.created_at,
         updated_at      = now()
   WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bump_ops_thread_last_msg
  AFTER INSERT ON public.ops_chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.bump_ops_thread_last_msg();

-- ============================================================
-- 4. Log de ações operacionais (tudo que o painel executa)
-- ============================================================
CREATE TABLE public.ops_actions_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid,
  action        text NOT NULL,                -- ex: 'pm2_restart','bot_kill','clear_queue','shell_exec'
  scope         text NOT NULL DEFAULT 'system', -- 'system' | 'bot' | 'deal' | 'agent'
  target        text,                          -- id/nome do alvo (ex: 'spotify-bot', deal_id, ...)
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','success','error','rejected')),
  result        jsonb NOT NULL DEFAULT '{}'::jsonb,
  error         text,
  duration_ms   integer,
  requires_confirmation boolean NOT NULL DEFAULT false,
  confirmed_by  uuid,
  confirmed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);

CREATE INDEX idx_ops_actions_log_created ON public.ops_actions_log(created_at DESC);
CREATE INDEX idx_ops_actions_log_status  ON public.ops_actions_log(status, created_at DESC);

ALTER TABLE public.ops_actions_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_all_ops_actions_log ON public.ops_actions_log
  FOR ALL TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

-- ============================================================
-- 5. Fila de comandos para o Agente VPS
--    O agente faz long-poll/Realtime nesta tabela, executa,
--    e atualiza status + stdout/stderr.
-- ============================================================
CREATE TABLE public.ops_agent_commands (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      text NOT NULL DEFAULT 'default',  -- suporte futuro a múltiplos agentes
  action_log_id uuid REFERENCES public.ops_actions_log(id) ON DELETE SET NULL,
  kind          text NOT NULL CHECK (kind IN ('shell','pm2','system_metrics','restart_bot','custom')),
  command       text,                              -- ex: "pm2 restart spotify-bot"
  args          jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','picked','running','success','error','timeout','cancelled')),
  picked_at     timestamptz,
  started_at    timestamptz,
  finished_at   timestamptz,
  exit_code     integer,
  stdout        text,
  stderr        text,
  duration_ms   integer,
  timeout_ms    integer NOT NULL DEFAULT 30000,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ops_agent_cmds_queue ON public.ops_agent_commands(agent_id, status, created_at) WHERE status IN ('queued','picked','running');
CREATE INDEX idx_ops_agent_cmds_recent ON public.ops_agent_commands(created_at DESC);

ALTER TABLE public.ops_agent_commands ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_all_ops_agent_commands ON public.ops_agent_commands
  FOR ALL TO authenticated
  USING (public.is_current_user_admin())
  WITH CHECK (public.is_current_user_admin());

-- Realtime no terminal (stream de stdout/stderr para frontend)
ALTER PUBLICATION supabase_realtime ADD TABLE public.ops_agent_commands;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ops_chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ops_actions_log;

-- ============================================================
-- 6. Métricas reais de servidor no heartbeat do bot
--    Reaproveita bot_heartbeats; agente envia esses campos.
-- ============================================================
ALTER TABLE public.bot_heartbeats
  ADD COLUMN IF NOT EXISTS cpu_percent      numeric,
  ADD COLUMN IF NOT EXISTS mem_percent      numeric,
  ADD COLUMN IF NOT EXISTS mem_used_mb      integer,
  ADD COLUMN IF NOT EXISTS mem_total_mb     integer,
  ADD COLUMN IF NOT EXISTS swap_percent     numeric,
  ADD COLUMN IF NOT EXISTS disk_percent     numeric,
  ADD COLUMN IF NOT EXISTS disk_used_gb     numeric,
  ADD COLUMN IF NOT EXISTS disk_total_gb    numeric,
  ADD COLUMN IF NOT EXISTS uptime_seconds   bigint,
  ADD COLUMN IF NOT EXISTS load_avg         jsonb,
  ADD COLUMN IF NOT EXISTS pm2_processes    jsonb,
  ADD COLUMN IF NOT EXISTS chrome_instances integer,
  ADD COLUMN IF NOT EXISTS agent_version    text;

-- ============================================================
-- 7. Bucket privado para uploads do Copiloto (logs, etc)
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('ops-uploads', 'ops-uploads', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "ops_uploads_admin_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'ops-uploads' AND public.is_current_user_admin());

CREATE POLICY "ops_uploads_admin_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ops-uploads' AND public.is_current_user_admin());

CREATE POLICY "ops_uploads_admin_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'ops-uploads' AND public.is_current_user_admin());
