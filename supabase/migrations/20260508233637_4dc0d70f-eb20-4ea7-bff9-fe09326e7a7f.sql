-- Cleanup VPS-agent / queue / workers stack (não faz parte do fluxo principal)
DROP FUNCTION IF EXISTS public.claim_next_job(text, text[], integer) CASCADE;
DROP FUNCTION IF EXISTS public.claim_next_job CASCADE;
DROP FUNCTION IF EXISTS public.complete_job(uuid, text, jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.complete_job CASCADE;
DROP FUNCTION IF EXISTS public.fail_job(uuid, text, text, boolean) CASCADE;
DROP FUNCTION IF EXISTS public.fail_job CASCADE;
DROP FUNCTION IF EXISTS public.requeue_stale_jobs(integer) CASCADE;
DROP FUNCTION IF EXISTS public.requeue_stale_jobs CASCADE;

DROP TABLE IF EXISTS public.ops_chat_messages CASCADE;
DROP TABLE IF EXISTS public.ops_chat_threads CASCADE;
DROP TABLE IF EXISTS public.ops_metrics CASCADE;
DROP TABLE IF EXISTS public.job_incidents CASCADE;
DROP TABLE IF EXISTS public.ops_actions_log CASCADE;
DROP TABLE IF EXISTS public.ops_agent_commands CASCADE;
DROP TABLE IF EXISTS public.worker_heartbeats CASCADE;
DROP TABLE IF EXISTS public.jobs_queue CASCADE;