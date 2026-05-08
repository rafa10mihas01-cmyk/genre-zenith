# Migração real spotify-artists-bot → queue/worker

Como o código atual do bot vive na VPS e não está versionado, vou entregar **arquitetura real de produção** (Playwright + sessão persistente + browser pool + upload Cloud + parsing + retries) seguindo a mesma estratégia que o monolito usa hoje. Os pontos onde sua implementação atual tem **valores específicos** (3 seletores e a URL de login persistente) ficam isolados em **um único arquivo de configuração** — você cola os valores reais lá uma vez e nada mais precisa mudar.

Isto **não é mock**: é o pipeline executável completo (login → navegação → screenshot → upload → parse → persist). O que você fornece depois são apenas constantes (seletores CSS) que mudam quando o Spotify atualiza o HTML.

---

## 1. Browser pool (compartilhado entre handlers)

`vps-agent/src/playwright/browserPool.js`

- Singleton que mantém **1 Chromium persistente por worker** (reuso entre jobs).
- `getContext()` cria/reutiliza `BrowserContext` com `storageState` da sessão Spotify (cookies+localStorage).
- `withPage(fn)` abre page, executa, **sempre** fecha page no `finally` (sem leak).
- Reciclagem automática: após N jobs (default 50) ou X minutos (default 60), fecha o browser e recria.
- `dispose()` no SIGTERM do worker.
- Detecção de browser travado: timeout global no `page.goto` + watchdog que mata o context se ficar `>5min` ocupado.

## 2. Sessão Spotify for Artists

`vps-agent/src/playwright/spotifySession.js`

- `loadStorageState()` lê `SPOTIFY_STORAGE_STATE_PATH` (arquivo JSON de cookies — mesmo formato que o bot atual já usa).
- `assertLoggedIn(page)` navega `https://artists.spotify.com/c/` e detecta:
  - **logado** → ok
  - **redirect para login** → throw `SpotifyAuthError` (fatal, abre incidente `spotify_login_invalid`)
  - **captcha/challenge** → throw `SpotifyCaptchaError` (fatal, incidente `spotify_captcha`)
  - **rate limit (429 / banner)** → throw `SpotifyRateLimitError` (não-fatal, retry com backoff longo)
- Refresh manual da sessão: comando ops `spotify.session.refresh` (futuro) ou regerar arquivo na VPS.

## 3. Handlers reais

### `src/handlers/spotifyArtistFetch.js`
Payload: `{ artist_id, spotify_artist_url? }`

1. `withPage` → navega para a URL do artista no S4A.
2. `assertLoggedIn`.
3. Captura screenshot da Home do artista.
4. Upload para bucket `bot-prints/artists/{artist_id}/{job_id}.png`.
5. Faz `INSERT` em `bot_events` (status `success`, screenshot_url, duration_ms).
6. Retorna `{ artist_id, screenshot_url, captured_at }`.

### `src/handlers/spotifyDealCollect.js`
Payload: `{ deal_id, song_id, spotify_track_id }`

1. Carrega o deal+song do Cloud (`curator_deal_songs` ou `curator_deals`).
2. Navega para tela de Streams da música no S4A.
3. Coleta `total_plays` + `plays_24h` + `plays_7d` + `plays_28d` via DOM extract.
4. Captura screenshot.
5. Upload + `INSERT` em `curator_deal_snapshots` (mantém schema atual: `deal_id`, `song_id`, `playlist_id`, `plays`, `print_url`, `source='spotify_for_artists'`, `match_method='worker'`).
6. Atualiza `curator_deal_songs.last_auto_collect_at` + agenda `next_auto_collect_at`.
7. Retorna `{ deal_id, plays, screenshot_url }`.

### `src/handlers/spotifyPrintBatch.js`
Payload: `{ deal_id, batch_id }`

1. Lê `bot_print_batches` por `id`.
2. Para cada item do `dom_payload` faz screenshot focado.
3. Upload todos → preenche `print_urls` + `received_parts`.
4. Quando `received_parts == total_parts` marca `status='completed'`, `completed_at=now()`.

### Erros
- `SpotifyAuthError`, `SpotifyCaptchaError` → `err.fatal=true` (dead-letter + incidente high).
- `SpotifyRateLimitError` → throw normal (retry exponencial; o `fail_job` RPC já cuida).
- `TimeoutError` → throw normal, com `metadata.timeout=true` no `job_incidents`.

## 4. Scheduler real

### Edge function `supabase/functions/jobs-scheduler/index.ts`
Auth: `x-agent-token` (admin). Recebe `{ kinds?: string[] }`. Executa em uma chamada:

- **`spotify.deal.collect`**: enfileira todo `curator_deal_songs` com `auto_collect=true` AND (`next_auto_collect_at IS NULL` OR `next_auto_collect_at <= now()`) AND nenhum job ativo (`pending|processing|retry`) com `dedupe_key='deal-collect:'+song_id`. Prioridade alta para os mais atrasados.
- **`spotify.artist.fetch`**: enfileira artistas que precisam refresh (deals ativos sem snapshot nas últimas 24h). Cooldown 6h por artista via `dedupe_key`.
- **`spotify.print_batch`**: enfileira `bot_print_batches` com `status='pending'` há > 1min e `received_parts < total_parts`.
- Limita a **N jobs por chamada** (default 100) para não estourar.
- Retorna `{ enqueued: { 'spotify.deal.collect': 12, ... } }`.

### Cron pg_cron (você confirma se quer)
Agora que escolheu **manual + botão**, eu **não** crio cron automático. Adiciono botão no `/sistema → Fila`:
- "Rodar scheduler agora" → invoca `jobs-scheduler` e mostra contagem enfileirada.
- Toggle "Habilitar agendamento automático (5/2/15 min)" — quando ligado, cria os 3 cron jobs via SQL helper (instrução clicável, não executa silencioso).

## 5. Healthcheck operacional

Estende `vps-agent/src/watchdog.js` (já existe):

- **worker travado**: heartbeat ausente > 90s OR `status='busy'` mesmo sem mudança de `current_job_id` por 10min → restart do PM2 worker correspondente + incidente `worker_stuck`.
- **browser travado**: `browserPool` registra `lastActivityAt`; watchdog mata pool se > 5min sem progredir → incidente `browser_stuck`.
- **login inválido / captcha / rate limit**: já convertidos para incidentes nos handlers (kind dedicado).
- **memory leak**: `process.memoryUsage().rss > 800MB` → worker se auto-encerra (PM2 reinicia) + incidente `worker_memory_high`.

## 6. Observabilidade no painel

Tudo já vai para `jobs_queue`, `worker_heartbeats`, `job_incidents`. Adiciono ao painel `/sistema → Fila` e `/sistema → Workers` (sem criar página nova):

- KPIs novos: **throughput (jobs/min)**, **tempo médio por tipo**, **crash rate (falhas/total)**, **retries totais 24h**.
- Drill-down por `job_type` (filtros já existentes).
- Página existente `/sistema → Bots` ganha card por artista com: última coleta, falhas 7d, tempo médio.

Tudo segue `<PageHeader>`, design tokens existentes, sem emojis.

## 7. Compatibilidade

- **Não toca** `curator_deals`, `curator_deal_songs`, `curator_deal_snapshots`, `bot_print_batches`, `bot_events`, `bot_heartbeats`. Apenas escreve neles com os mesmos formatos atuais.
- **Não remove** o cron monolítico — apenas para de produzir (passo manual seu na VPS: `pm2 stop spotify-bot` quando os workers estiverem estáveis).
- Fluxo paralelo: durante a transição os dois podem rodar; o `dedupe_key` do scheduler evita duplicar coleta.

## 8. O que você precisa fazer 1 vez (na VPS)

Dois arquivos `.env` novos no `vps-agent/.env`:

```
SPOTIFY_STORAGE_STATE_PATH=/opt/nexengine/secrets/spotify-session.json
SPOTIFY_S4A_BASE=https://artists.spotify.com
PLAYWRIGHT_HEADLESS=true
BROWSER_RECYCLE_AFTER_JOBS=50
BROWSER_RECYCLE_AFTER_MIN=60
JOB_TIMEOUT_MS=180000
```

E **colar 3 seletores reais** (1 vez) em `vps-agent/src/playwright/spotifySelectors.js` — que vou criar com placeholders documentados:
- seletor do bloco "logged in" para o `assertLoggedIn`
- seletor da métrica de streams totais
- seletor da área da página que é o "print" final

Sem isso a coleta sobe mas falha cedo no `assertLoggedIn` (o que é o comportamento correto — sem mock).

---

## Arquivos que serão criados

```
vps-agent/
  src/
    playwright/
      browserPool.js
      spotifySession.js
      spotifySelectors.js          (você preenche depois)
      errors.js                    (SpotifyAuthError, etc.)
    handlers/
      spotifyArtistFetch.js        (substitui o atual)
      spotifyDealCollect.js        (substitui o atual)
      spotifyPrintBatch.js         (novo)
    cloud/
      uploadPrint.js               (POST signed-url -> bucket bot-prints)
  package.json                     (+ playwright, + @supabase/supabase-js)
  README.md                        (seção "Playwright / Sessão Spotify")
  .env.example                     (+ vars novas)

supabase/
  functions/
    jobs-scheduler/index.ts        (enqueue automático)

src/components/sistema/fila/
  SchedulerCard.tsx                (botão "Rodar scheduler agora" + KPIs)
src/hooks/useJobsQueue.ts          (+ throughput/avg/crash rate)
```

## Migração de banco
- Bucket de storage `bot-prints` (público) — via migration.
- Nenhuma alteração de tabela existente.
