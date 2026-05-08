# Queue / Worker Contract

Arquitetura para substituir a execução monolítica do `spotify-artists-bot`
por um modelo **fila → workers** com retries, observabilidade e escalabilidade
horizontal.

## Visão geral

```
[ enqueue ]  →  jobs_queue (pending)
                     │
                     ▼
              [ worker N ]  ─ claim_next_job ─►  processing
                     │
              ┌──────┴──────┐
              ▼             ▼
        complete_job    fail_job (retry com backoff)
```

- **jobs_queue** — fila com prioridade, retries, scheduled_for, dedupe_key
- **worker_heartbeats** — presença + métricas de cada worker
- **job_incidents** — registro de toda falha/timeout (severidade)

## Endpoints (edge functions)

Auth: header `x-agent-token: <OPS_AGENT_TOKEN>` (mesmo token do agente VPS).
Base URL: `${VITE_SUPABASE_URL}/functions/v1/<name>`.

### POST /jobs-claim
```json
{ "worker_id": "vps-1#w0", "job_types": ["spotify.artist.fetch"], "lease_seconds": 300 }
```
→ `{ "job": { id, job_type, payload, attempts, ... } }` ou `{ "job": null }`.

### POST /jobs-complete
Sucesso:
```json
{ "job_id": "...", "worker_id": "vps-1#w0", "status": "completed", "result": {} }
```
Falha (retry automático até `max_attempts`):
```json
{ "job_id": "...", "worker_id": "vps-1#w0", "status": "failed", "error": "timeout", "force_dead": false }
```

### POST /workers-heartbeat
Enviar a cada 10–30s.
```json
{
  "worker_id": "vps-1#w0",
  "worker_kind": "spotify-artists-worker",
  "hostname": "vps-prod-1",
  "pid": "12345",
  "status": "idle",
  "current_job_id": null,
  "current_job_type": null,
  "jobs_completed": 0,
  "jobs_failed": 0,
  "cpu_percent": 12.4,
  "mem_percent": 38.0,
  "uptime_seconds": 3600,
  "agent_version": "1.0.0",
  "metadata": {}
}
```

### POST /jobs-maintenance
(admin) Requeue de jobs com lease expirado + marca workers ausentes como `offline`.
```json
{ "lease_seconds": 600, "worker_stale_seconds": 120 }
```

## Loop recomendado do worker

```js
while (running) {
  await heartbeat({ status: 'idle' });
  const { job } = await claim({ worker_id, job_types });
  if (!job) { await sleep(2000); continue; }

  await heartbeat({ status: 'busy', current_job_id: job.id, current_job_type: job.job_type });
  try {
    const result = await execute(job);             // lógica específica do tipo
    await complete({ job_id: job.id, status: 'completed', result });
    metrics.completed++;
  } catch (err) {
    const dead = err.fatal === true;
    await complete({
      job_id: job.id, status: 'failed',
      error: String(err?.message ?? err),
      force_dead: dead,
    });
    metrics.failed++;
  }
}
```

## Tipos de job (sugeridos)

| job_type                       | payload mínimo                       |
|--------------------------------|--------------------------------------|
| `spotify.artist.fetch`         | `{ artist_id }`                      |
| `spotify.deal.collect`         | `{ deal_id, song_id }`               |
| `spotify.deal.print_batch`     | `{ deal_id, batch_id }`              |
| `community.member.sync`        | `{ member_id }`                      |

Use `dedupe_key` para evitar enfileirar duas vezes a mesma operação enquanto
ela não terminou (ex.: `dedupe_key = "deal-collect:" + deal_id`).

## Cron de manutenção (opcional)

Agendar no banco com `pg_cron` chamando `jobs-maintenance` a cada minuto:

```sql
select cron.schedule(
  'jobs-maintenance',
  '* * * * *',
  $$ select net.http_post(
       url := 'https://<project>.supabase.co/functions/v1/jobs-maintenance',
       headers := '{"Authorization":"Bearer <SERVICE_ROLE>","Content-Type":"application/json"}'::jsonb,
       body := '{}'::jsonb
     ); $$
);
```

## Painel

- `/sistema → Fila` — KPIs (pending/processing/completed/failed), tabela com
  filtros (status, tipo, busca), ações (requeue, cancelar, excluir, manutenção,
  limpar antigos), realtime via channel `postgres_changes`.
- `/sistema → Workers` — heartbeat dos workers (idle/busy/offline), CPU/RAM,
  jobs concluídos/falhados, uptime, job em execução.
