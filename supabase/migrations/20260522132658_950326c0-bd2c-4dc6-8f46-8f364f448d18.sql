create table if not exists public.cron_health (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  status text not null default 'ok',
  metrics jsonb not null default '{}'::jsonb,
  message text,
  duration_ms integer,
  ran_at timestamptz not null default now()
);

create index if not exists idx_cron_health_job_ran on public.cron_health (job_name, ran_at desc);

alter table public.cron_health enable row level security;

-- Admins podem ler tudo (usa helper has_role já existente no projeto)
do $$ begin
  if exists (select 1 from pg_proc where proname = 'has_role') then
    create policy "admins read cron_health"
      on public.cron_health for select
      to authenticated
      using (public.has_role(auth.uid(), 'admin'));
  end if;
end $$;
