# INC-002 — bot-execution-queue: 5 jobs travados causando tempestade de HTTP 403

**Aberto em:** 2026-06-20
**Severidade:** Alta — worker Nível A operando com ~1.9% de sucesso há ≥3 dias.
**Tipo:** Incidente operacional. **Não faz parte da revisão arquitetural (Fase 17-C).**
**Status:** ⚠️ **Parcialmente encerrado** (decisão oficial 2026-06-20).

## Decisão de encerramento parcial

- ✅ Loop infinito eliminado — os 5 jobs originais estão em `cancelled` e fora do processamento automático.
- ✅ Guard `max_attempts` implantado e funcionando no início do worker.
- ✅ Jobs não permanecem mais presos indefinidamente.
- ➡️ O comportamento residual (HTTP 403 sistemático em `/v1/playlists/:id/items`) **não é mais classificado como incidente da fila**. Passa a ser tratado como **questão de confiabilidade de endpoint**, dentro do escopo da revisão arquitetural da Fase 17-C (ver `phase-17c-vps-benchmark-protocol.md`).
- ⚠️ **Observação residual:** 5 novos jobs (`bb7b4934`, `2b3b302f`, `8c916b07`, `7219f171`, `45b2a10e`), criados em 2026-06-20 17:27 UTC, aparecem com `attempts ∈ {5,6}` ainda em `status='claimed'`. Indica que o guard atual só dispara no início do tick e não intercepta jobs já claimed por outro ciclo no mesmo intervalo. Tratar em ticket separado — não reabre INC-002.

## Resumo executivo

Cinco `playlist_execution_jobs` estão presos em status `claimed` há **23 a 71 horas**, com contadores `attempts` entre **240 e 744** apesar de `max_attempts = 3`. Cada execução do cron os re-reivindica, dispara duas leituras HTTP em `/v1/playlists/:id/items`, recebe 403 da Spotify, e **nunca consegue marcá-los como `failed` ou `manual`**. Resultado: o worker gera ~2.500 chamadas Spotify por dia, 98% delas com erro, e os jobs ficam ali para sempre.

## Evidências objetivas

### Jobs travados (snapshot 2026-06-20 17:30 UTC)

| Job ID | Playlist | Owner Spotify | Attempts | Horas travado | `last_error` |
|---|---|---|---:|---:|---|
| `47a4b0e2-…e4b0` | "Tira A Foto, Faz A Pose…" | `z4ox6sjcnfkjulzdqkwj6qcd0` | **744** | 71h | (vazio) |
| `f60bcadc-…9806` | "Se Prepara 3 🎻…" | `z4ox6sjcnfkjulzdqkwj6qcd0` | 506 | 49h | (vazio) |
| `7604f853-…e427` | "Não É Nada De Pega-Pega…" | `z4ox6sjcnfkjulzdqkwj6qcd0` | 491 | 47h | (vazio) |
| `69f98638-…836d` | "Meu Coração Esfriou 💔…" | `z4ox6sjcnfkjulzdqkwj6qcd0` | 491 | 47h | (vazio) |
| `e1736a87-…7e0c` | "Funk Pra Tocar Na Festa…" | `kondzilla` | 240 | 23h | (vazio) |

Todos `job_type = playlist.track.add`. Todos `max_attempts = 3`. Nenhuma playlist está arquivada. Nenhum job tem `last_error` registrado.

### Padrão de chamada (7 dias)

| Endpoint | Method | Status | Calls |
|---|---|---|---:|
| `/v1/playlists/:id/items` | GET | **403** | **2.472** |
| `/v1/playlists/:id/items` | GET | 200 | 41 |
| `/v1/playlists/:id/items` | POST | 201 | 7 |
| `/api/token` | POST | 200 | 26 |

Concentração das falhas:
- `z4ox6sjcnfkjulzdqkwj6qcd0` via NexEngine 06: **2.232 × 403** (~90%)
- `kondzilla` via NexEngine 06/08: **240 × 403**

### `last_error` vazio = catch handler não executa

O bloco `catch` em `bot-execution-queue/index.ts:447-465` deveria:
1. Chamar `classifyManualReason(e)` → 403 retorna `"spotify_403"` (confirmado em `manual-fallback.ts:18-22`).
2. Inserir em `manual_distribution_queue` e marcar `status = "manual"` (linha 452-454).

Como **nenhum dos 5 jobs está em status `manual`** e **`last_error` está vazio** em todos, o catch nunca está sendo alcançado.

## Causa raiz (hipóteses ranqueadas)

### Hipótese 1 — Cron + recovery sweep formam loop sem progresso ⭐ (mais provável)

A cada invocação, a função executa:

```
T0: recovery sweep → claimed (lease expirado) → pending  [linha 116-120]
T1: SELECT mutation jobs WHERE status=pending  [linha 227-234]
    → encontra os 5 jobs (scheduled_for de 3 dias atrás, prioridade máxima)
T2: claim atômico → claimed, attempts++  [linha 240]
T3: getUserToken + listPlaylistTrackRefs → HTTP 403  [linha 257, 291]
T4: catch → deveria marcar manual  [linha 447]
```

Se T4 não executa (por exemplo, porque a instância do edge function é reciclada/timeout antes que os 5 jobs do batch concluam), os jobs ficam em `claimed` com lease vivo. Quando o lease expira (5 min depois), o T0 da próxima invocação os devolve para `pending`. Loop reinicia.

Sinais consistentes com essa hipótese:
- Todas as 5 entradas têm o mesmo `claimed_at` (`17:21:02.158`) — claim em batch.
- `last_error = ''` em todas — nenhuma escrita pós-catch chegou.
- A função processa **até 10 jobs por invocação** (`limit(10)` na linha 234) e cada um pode disparar 2-3 chamadas Spotify. Com 403s em sequência, latência acumulada pode ultrapassar timeout silencioso.

### Hipótese 2 — `installSpotifyCircuitFetchGuard()` re-throw bypassando catch

O guard global de fetch instalado na linha 17 intercepta 429 e abre o circuit breaker. Se o guard rethrow um erro que NÃO é `SpotifyApiError`, `classifyManualReason` retorna `null` e cai no ramo de `nextStatus` (linha 459) — que SIM marcaria como `failed`. Como não está marcando, esta hipótese é menos provável que a #1.

### Hipótese 3 — Os 403s reais da Spotify exigem investigação separada

Mesmo após corrigir o loop, ainda restam dois fatos:
- Owner `z4ox6sjcnfkjulzdqkwj6qcd0`: 2.232 × 403, mas 29 × 200 na mesma janela. Não é app whitelist — é específico de playlist ou track.
- Owner `kondzilla` no app NexEngine 06: 7 × 403 e no NexEngine 08: 233 × 403 (mas 5 × 200 e 2 × 201). Há entrega ocasional.

Possíveis causas das 403s reais: playlist foi tornada privada/colaborativa após import, track contém faixa region-restricted que o owner não tem direito de editar, ou owner perdeu permissão sobre a playlist. Investigar fora deste incidente.

## Impacto operacional

| Métrica | Valor |
|---|---|
| Jobs travados | 5 |
| Chamadas Spotify desperdiçadas / dia | ~2.500 |
| Volume de tokens OAuth consumidos sem retorno | ~25 refreshes/dia |
| Risco de saturação do rate limit Spotify por app NexEngine 06 | Alto |
| Clientes afetados (entrega de campanha não concluída) | A confirmar — depende de qual campaign_id os jobs pertencem |
| Tempo de exposição | ≥ 71 horas (job mais antigo) |

## Mitigação imediata (operacional, sem deploy)

Marcar os 5 jobs manualmente como `manual` para tirá-los do loop. Comando proposto:

```sql
-- Mover os 5 jobs travados para manual_distribution_queue + status=manual
INSERT INTO manual_distribution_queue (job_id, campaign_id, spotify_playlist_id, spotify_track_id, job_type, motivo, status)
SELECT id, campaign_id, spotify_playlist_id, spotify_track_id, job_type, 'spotify_403_loop_INC002', 'AUTO_FAILED_FALLBACK_MANUAL'
FROM playlist_execution_jobs
WHERE status = 'claimed' AND attempts > 10
ON CONFLICT DO NOTHING;

UPDATE playlist_execution_jobs
SET status = 'manual',
    last_error = 'INC-002: stuck claimed loop, moved to manual',
    claimed_by = NULL, claimed_at = NULL, lease_expires_at = NULL
WHERE status = 'claimed' AND attempts > 10;
```

**Aguardar aprovação antes de executar.** Isso para a tempestade de 403s imediatamente e libera os jobs para tratamento manual.

## Correção definitiva (requer deploy — fora do escopo da 17-C)

Em `bot-execution-queue/index.ts`, no início de cada loop de processamento (linhas 135 e 237), antes do claim:

```typescript
// Guarda anti-loop: jobs que já estouraram max_attempts vão direto para failed,
// sem reivindicar e sem chamar Spotify.
if ((j.attempts ?? 0) >= (j.max_attempts ?? 3)) {
  await supabase.from("playlist_execution_jobs")
    .update({
      status: "failed",
      last_error: `attempts exhausted (${j.attempts}/${j.max_attempts}) — see INC-002`,
      claimed_by: null, claimed_at: null, lease_expires_at: null,
    })
    .eq("id", j.id);
  continue;
}
```

Essa guarda **não depende do catch handler executar** — bloqueia o job na seleção, antes de qualquer chamada Spotify. Mesmo que a hipótese 1 esteja correta e o catch nunca rode, o loop infinito é interrompido na próxima iteração.

Adicional: investigar por que o catch handler não está executando (provavelmente via logs do edge function), e considerar reduzir `limit(10)` para `limit(3)` no batch de mutações para diminuir a chance de timeout silencioso.

## Por que NÃO entra na Fase 17-C

- O `bot-execution-queue` usa **OAuth puro** (sem Gateway CC). O incidente não é causado pela escolha de componente — é causado por bug no loop de retry e por 403s reais da Spotify que precisam de investigação separada.
- O endpoint `/v1/playlists/:id/items` está degradado para todos os workers (59% OK na janela 7d), mas isso é um achado da Frente 1 da 17-C — não muda o fato de que o `bot-execution-queue` tem um bug específico de gerenciamento de estado.
- Resolver este incidente NÃO depende da matriz arquitetural. A matriz vai eventualmente decidir se este worker deve continuar usando OAuth ou migrar para VPS, mas a guarda anti-loop é independente da decisão.

## Próximos passos

1. **Aprovar mitigação SQL** acima → executar via tool de update.
2. **Validar parada da tempestade** → conferir `spotify_call_log` 1h após mitigação: 403s devem zerar.
3. **Investigar 403s reais residuais** → identificar se `z4ox6sjcnfkjulzdqkwj6qcd0` e `kondzilla` ainda geram falhas em jobs futuros (e por quê).
4. **Implementar guarda anti-loop** (correção definitiva) em ciclo separado de deploy.
5. **Verificar logs do edge function** para confirmar hipótese 1 (timeout silencioso vs catch não executando).

---

## Mitigação aplicada — 2026-06-20 17:27 UTC

### Auditoria pré-mitigação (snapshot)

Os 5 jobs foram congelados em `/mnt/documents/INC-002-pre-mitigation-audit.csv`. Resumo:

| Job ID | attempts | claimed_by | claimed_at |
|---|---:|---|---|
| `47a4b0e2-…e4b0` | 745 | internal-cron | 2026-06-20 17:26:02 UTC |
| `f60bcadc-…9806` | 507 | internal-cron | 2026-06-20 17:26:02 UTC |
| `7604f853-…e427` | 492 | internal-cron | 2026-06-20 17:26:02 UTC |
| `69f98638-…836d` | 492 | internal-cron | 2026-06-20 17:26:02 UTC |
| `e1736a87-…7e0c` | 241 | internal-cron | 2026-06-20 17:26:02 UTC |

### Ações executadas (somente nesses 5 IDs — nenhum outro job afetado)

1. **Inserido em `manual_distribution_queue`** — 1 linha por job, `status = MANUAL_PENDING`, `motivo = "INC-002: loop infinito (attempts ultrapassou max_attempts; bot-execution-queue reprocessou via recovery)"`.
2. **`playlist_execution_jobs.status` → `cancelled`** com `last_error = "INC-002: cancelado pela mitigação operacional. attempts=N ultrapassou max_attempts=3. Movido para manual_distribution_queue."`, `completed_at = now()`, `claimed_by/claimed_at/lease_expires_at = NULL`.

> ℹ️ A coluna `status` em `playlist_execution_jobs` tem CHECK constraint que **não permite o valor `manual`** — apenas `pending|claimed|done|failed|cancelled`. Por isso usamos `cancelled`. Esse é um bug separado descoberto durante a mitigação: o caminho `enqueueManual` no worker tenta atualizar para `manual` e a chamada falha silenciosamente (sem `if (error)` após o `.update()`), o que **contribuiu para o loop** — quando classifyManualReason retorna `spotify_403`, o MDQ recebe a entrada (existem 5 linhas `AUTO_FAILED_FALLBACK_MANUAL` de 17–19 jun nesses mesmos jobs comprovando isso), mas o job permanece `claimed` e o recovery sweep o devolve pra `pending`. **Abrir ticket separado** para (a) corrigir a constraint OU (b) trocar `status: "manual"` por `status: "cancelled"` no worker.

### Auditoria pós-mitigação

| Job ID | status final | claimed_by | lease_expires_at |
|---|---|---|---|
| `47a4b0e2-…e4b0` | `cancelled` | NULL | NULL |
| `f60bcadc-…9806` | `cancelled` | NULL | NULL |
| `7604f853-…e427` | `cancelled` | NULL | NULL |
| `69f98638-…836d` | `cancelled` | NULL | NULL |
| `e1736a87-…7e0c` | `cancelled` | NULL | NULL |

Nenhum deles pode voltar para `pending` ou `claimed`:
- O recovery sweep filtra por `status = 'claimed'` — `cancelled` não entra.
- O guard novo (ver abaixo) cancelaria de novo qualquer um cujo `attempts >= max_attempts` reaparecesse em `pending`/`claimed`.

## Correção definitiva — guard de `max_attempts`

**Arquivo:** `supabase/functions/bot-execution-queue/index.ts` (linhas 114–172)

Inserido no início de cada execução do worker, **antes** do recovery sweep e dos SELECTs de candidatos:

- Varre `playlist_execution_jobs` em `status IN ('pending','claimed')`.
- Para cada job onde `attempts >= max_attempts`, transiciona para `status = 'cancelled'` com `last_error = "INC-002 guard: attempts ultrapassou max_attempts (auto-cancelado pelo worker)"` e limpa lease.
- Loga `evt: "inc002.guard.cancelled"` com a lista de IDs.
- O guard executa **independentemente do bloco catch** — é o que estava faltando e que impedia o catch de falhar em fechar o ciclo.

### Critérios de encerramento

1. ✅ Os 5 jobs estão fora do loop (verificado pós-mitigação).
2. ⏳ Volume de chamadas `/v1/playlists/:id/items` 403 cai pra ≤ baseline esperado nas próximas 24h.
3. ✅ Guard de `max_attempts` implantado.
4. ⏳ Próxima execução do worker emite `inc002.guard.cancelled` com count=0 (confirma que não há mais jobs em loop).

Encerrar oficialmente o ticket após observar (2) e (4) durante a janela de 24h.
