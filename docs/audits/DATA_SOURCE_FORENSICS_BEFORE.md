# DATA_SOURCE_FORENSICS_BEFORE — Fase 6.A

> Auditoria forense de fontes de dados da NexEngine.
> **Read-only.** Nenhum arquivo, função ou tabela foi alterado.
> Data: 17/06/2026.

---

## ITEM 1 — Chamadas a APIs externas

### 1.1 Spotify Web API (`api.spotify.com` / `accounts.spotify.com`)

Entrada única canônica: `supabase/functions/_shared/spotify.ts` + `_shared/spotify-client.ts` (multi-app rotation, circuit breaker `spotify_circuit_breaker`, rate-limit, telemetria em `spotify_call_log`).

| Arquivo | Função | Endpoint | Motivo |
|---|---|---|---|
| `_shared/spotify.ts:653,706` | `getSpotifyToken` / `getUserAccessToken` | `POST accounts.spotify.com/api/token` | OAuth client-credentials e refresh |
| `_shared/spotify-playlist.ts:26` | `getPlaylistMeta` | `GET /v1/playlists/{id}` | Metadados (nome, followers, owner, imagens) |
| `enrich-playlists/index.ts:88` | `fetchMeta` | `GET /v1/playlists/{id}?fields=followers,tracks,owner` | Followers canônicos → `search_results` |
| `enrich-curator-playlists-spotify/index.ts:26` | `fetchOne` | `GET /v1/playlists/{id}` | Enriquece `curator_playlists` |
| `enrich-playlist-covers/index.ts:69` | inline | `GET /v1/playlists/{id}?fields=images,followers,owner` | Capas de `managed_playlists` |
| `create-spotify-playlist/index.ts:61` | handler | `GET /v1/search?type=track` | Lookup de track na criação |
| `sync-spotify-editorial-charts` | `fetchTracksBatch` | `GET /v1/tracks?ids=…` | Enrich em `raw_chart_daily` |
| `expand-from-winners/index.ts:28` | inner | `GET /v1/users/{ownerId}/playlists` | Discovery por owner |
| `bot-collect-queue/index.ts:20,451` | handler | `GET /v1/tracks/{trackId}` | Resolver/validar metadata na fila (**fora do shared client**) |
| `diagnose-managed-playlist/index.ts:428,441` | handler | `GET /v1/tracks/{id}`, `GET /v1/artists/{id}` | Diagnóstico IA |
| `spotify-auth/index.ts:127,290,316` | OAuth handler | `/v1/search`, `/api/token`, `/v1/me` | Login interno |
| `spotify-public-auth/index.ts:69,152,181` | public OAuth | `accounts/authorize`, `/api/token`, `/v1/me` | Login curador público |
| `spotify-invite/index.ts:303,321` | invite | `/api/token`, `/v1/me` | Fluxo de convite |
| `validate-fallback/index.ts:89,122–437` | validation | múltiplos `/v1/playlists`, `/v1/me/playlists` | Test suite read/write |
| `spotify-reauth-verify/index.ts:17,92–120` | verify | `/api/token`, `/v1/me`, `/v1/users/{id}/playlists`, CRUD playlist | Verifica permissão write |
| `spotify-enrichment-worker/index.ts:97` | worker | URL dinâmica da fila | Worker de enrichment |
| `recheck-archived-followers` | cron | via `getPlaylistMeta` | Refresh de followers em arquivados |
| `spotify-items-audit/index.ts:17,33` | audit | `/api/token`, dinâmica | Compatibilidade `/items` vs `/tracks` |
| `spotify-items-matrix/index.ts:22,39` | matrix | `/api/token`, dinâmica | Capacidade de endpoints |
| `spotify-fields-probe/index.ts:19,34` | probe | `/api/token`, dinâmica | Disponibilidade de fields |
| `spotify-app01-audit` | audit | shared | Permissões do App01 |
| `genre-spotify-discover` | discover | shared | Discovery por gênero |
| `external-health-probes-cron/index.ts:62` | health | `HEAD accounts.spotify.com/` | Ping de disponibilidade |

### 1.2 Browserless (`browserless.io` / self-hosted)

| Arquivo | Endpoint | Motivo |
|---|---|---|
| `external-health-probes-cron/index.ts:88–96` | `GET ${BROWSERLESS_URL}/pressure` | Health check |
| `_shared/integration-registry.ts:51` | — | Registro de política |

> Edge functions **não usam Browserless diretamente** fora do health probe. O uso real (Playwright) está no bot da VPS (`spotifyDealCollect.js` / observer). Edge só recebe resultado via `bot-ingest-snapshot`, `bot-upload-print`, `observer-ingest-tracks`.

### 1.3 OpenAI / Lovable AI Gateway / Anthropic

Entrada canônica: `_shared/ai_service.ts` (`chatClaude` → `api.anthropic.com/v1/messages`; `chatLovable` → `ai.gateway.lovable.dev/v1/chat/completions`).

| Arquivo | Endpoint | Motivo |
|---|---|---|
| `_shared/ai_service.ts:54,99` | Anthropic + Lovable Gateway | Roteador central (`AI_PROVIDER`) |
| `analyze-performance/index.ts:61` | `POST api.anthropic.com` | **Bypass do shared** (chama Claude direto) |
| `extract-replication-rules/index.ts:61` | `POST api.anthropic.com` | **Bypass do shared** (chama Claude direto) |
| `learn-genre-aesthetics/index.ts:24` | Lovable Gateway | Estética por gênero |
| `genre-insights/index.ts:70` | Lovable Gateway | Insights de gênero |
| `classify-playlist-genre/index.ts:94` | Lovable Gateway | Classificação |
| `diagnose-managed-playlist/index.ts:285` | Lovable Gateway | Diagnóstico |
| `seo-experiment-suggest/index.ts:162` | Lovable Gateway | SEO |
| `analyze-genre-visual-dna/index.ts:318` | Lovable Gateway | DNA visual |
| `analyze-deal-prints/index.ts:218` | Lovable Gateway | OCR de prints |
| `extract-snapshot-from-print/index.ts:333` | Lovable Gateway | Extração estruturada |
| `generate-cover-variations/index.ts:793` | Lovable Gateway | Prompt de capa |
| `generate-templates/index.ts:37` | Lovable Gateway | Templates |
| `extract-blueprints/index.ts:64` | Lovable Gateway | Blueprints |
| `seed-editorial-terms/index.ts:66` | Lovable Gateway | Termos editoriais |
| `parse-deal-paste/index.ts:83` | Lovable Gateway | Parse de paste |
| `enrich-curator-paste/index.ts:96` | Lovable Gateway | Enrich curador |
| `external-health-probes-cron/index.ts:72` | `GET ai.gateway.lovable.dev/v1/models` | Health |

### 1.4 Kworb (`kworb.net`)

| Arquivo | Endpoint | Motivo |
|---|---|---|
| `sync-kworb-charts/index.ts:11,140` | `GET kworb.net/spotify/country/br_daily.html` | Scrape Top 200 BR diário → `raw_chart_daily` |
| `external-health-probes-cron/index.ts:81` | `HEAD kworb.net/` | Health |

> `charts.spotify.com` **não é chamado em lugar algum.** Spotify bloqueou leituras editoriais em nov/2024. Chart vem de Kworb e depois é enriquecido pela Spotify `/v1/tracks`.

### 1.5 Supabase Storage

| Arquivo | Bucket | Op | Motivo |
|---|---|---|---|
| `import-label-spreadsheet/index.ts:630` | `label-spreadsheets` | upload | Arquivo XLSX original |
| `generate-cover-variations/_watermark.ts:78` | `_brand` | download | Watermark de marca |
| `generate-cover-variations/index.ts:991` | `playlist-covers` | getPublicUrl | Capa gerada |
| `observer-upload-failure/index.ts:45,52` | `observer-failures` | upload | Falhas do bot |
| `recover-stuck-print-batches/index.ts:110` | `bot-print-batches` | createSignedUrl | URL assinada |

### 1.6 Apify (`api.apify.com`)

| Arquivo | Endpoint | Motivo |
|---|---|---|
| `enrich-playlists/index.ts:112–113` | `POST api.apify.com/v2/acts/automation-lab~spotify-scraper/run-sync-get-dataset-items` | Scrape tracks (caminho **deprecado** — circuit breaker `apify_blocked`) |

### 1.7 Outros hostnames

| Hostname | Arquivo | Motivo |
|---|---|---|
| `engine.nexcreatorx.com` | `bot-heartbeat:185`, `share-link:15`, `invite-team-member:105`, `check-spreadsheet-reminders:19` | Domínio público / portal |
| `notify.engine.nexcreatorx.com` | `send-transactional-email:9`, `request-campaign-otp:20`, `request-curator-otp:14` | Email transacional |
| `${SYSTEM_ALERT_WEBHOOK_URL}` | `deliver-system-alerts-cron:87` | Webhook ops |
| `${SLACK_WEBHOOK_URL}` | `deliver-system-alerts-cron:105` | Slack |
| `${SMTP_HOST}` | `smtp-health-probe-cron:16` | Health SMTP |
| `${LOVABLE_SEND_URL}` | `process-email-queue:270` | Email Lovable |

---

## ITEM 2 — Chamadas ao VPS

> **A arquitetura é invertida**: VPS chama edge functions (push model). Nenhuma edge function chama IPs do VPS — apenas o health probe do Browserless self-hosted.

### Endpoints recebedores (VPS → Edge)

| Edge Function | Auth | Payload (resumo) | Motivo |
|---|---|---|---|
| `POST /bot-collect-queue` | `BOT_API_KEY` | `{worker_id, batch_size, catalog_mode?}` | VPS puxa próxima fila |
| `POST /bot-upload-print` | `BOT_API_KEY` + `BOT_INGEST_TOKEN` | `{content_base64, deal_id, song_id, label, dom_playlists}` | Print do Spotify for Artists |
| `POST /bot-ingest-snapshot` | `BOT_INGEST_TOKEN` | `{deal_id, song_id, total_plays, snapshots:[…]}` | Snapshot por playlist (modo deal) |
| `POST /bot-ingest-song-snapshot` | `BOT_INGEST_TOKEN` | `{song_id, total_plays_28d, playlists:[…]}` | Snapshot song-level (catálogo) |
| `POST /bot-ingest-dom` | dupla | HTML DOM do S4A | DOM parse |
| `POST /bot-event-ingest` | `BOT_INGEST_TOKEN` | `{event_type, correlation_id, payload}` | Eventos granulares |
| `POST /bot-execution-complete` | dupla | `{job_id, status, result?}` | Fim de job |
| `POST /bot-heartbeat` | dupla | `{hostname, worker_id, build_version}` | Liveness → `vps_nodes` |
| `GET /bot-execution-queue` | `BOT_API_KEY` | `?limit=N` | Itens da fila |
| `POST /observer-pull-queue` | dupla | `{limit, worker_id}` | Batch de observer |
| `POST /observer-ingest-tracks` | dupla | `{playlists:[{spotify_playlist_id, tracks:[{position,…}]}]}` | Posições/track list |
| `POST /observer-upload-failure` | dupla | `{playlist_id, screenshot_b64?, html?}` | Evidência de falha |
| `GET /jobs-scheduler` | `OPS_AGENT_TOKEN` ou `x-cron-secret` | — | VPS aciona schedule |
| `GET /ops-agent-poll` | `OPS_AGENT_TOKEN` | — | **Stub morto** (204) |
| `POST /ops-agent-report` | `OPS_AGENT_TOKEN` | `{metrics?,heartbeat?}` | Métricas do agente |

Comentário em `jobs-scheduler/index.ts:1`: *"Router chamado pelo VPS scheduler (PM2: nexengine-scheduler)"*.

Tokens em uso: `BOT_API_KEY`, `BOT_INGEST_TOKEN`, `OPS_AGENT_TOKEN`, `CRON_SECRET`.

---

## ITEM 5 — Código legado (resumo; detalhe em LEGACY_API_AUDIT.md)

### 5.1 Funções com `deprecationGate` (Phase 1 — telemetria ativa, kill-switch pronto)

`DEPRECATED_PHASE1_ENABLED=true` bloqueia com HTTP 410. 23 funções:

`analyze-genre-visual-dna`, `analyze-genre`, `auto-replicate-playlists`, `collect-batch`, `create-spotify-playlist`, `daily-collect`, `enrich-playlists` (Apify), `extract-blueprints`, `extract-replication-rules`, `fetch-tracks-spotify`, `generate-cover-variations`, `generate-playlists-briefing`, `generate-templates`, `generate-terms`, `genre-autopilot`, `genre-backfill`, `genre-competitors-sync`, `learning-loop`, `replicate-top`, `revalidate-dataset`, `run-search`, `score-templates`, `seed-editorial-terms`.

### 5.2 Stubs mortos

- `ops-agent-poll/index.ts:1–14` — comentário: *"tabela ops_agent_commands não existe"*. Sempre retorna 204. Mantido para absorver 404 do binário legado da VPS.

### 5.3 Caminhos legacy (A/B / compat)

- `campaign-plan-api/index.ts:197` `legacyStartDay()`
- `_shared/computeEcoPlan.ts:438` `legacyStart()`
- `diagnose-managed-playlist/index.ts:1833` flag `USE_LEGACY_SCORE`
- `spotify-items-audit:145,167,175,185` testes `legacy_get_tracks`
- `bot-upload-print/index.ts:208` rejeita payload `legacy_playlists_label_deprecated`
- `get-client-campaign-public/index.ts:156–162` fallback `legacyDeal`
- `resolve-legacy-token/index.ts:1` mapeia portal antigo
- `_shared/spotify-client.ts:30,276` alias `legacySetSpotifyCtx`
- `extract-snapshot-from-print/index.ts:550` `playsLegacy` fallback
- `genre-confidence-calc/index.ts:237` tag `auto_confidence_v1`
- `genre-autopilot/index.ts:1091` RPC `get_genre_daily_target_v2` (sugere v1 anterior)

### 5.4 Flags de feature legadas

`DEPRECATED_PHASE1_ENABLED`, `USE_LEGACY_SCORE`, `DIAGNOSE_SINGLE_PATH(_TARGET)`.

---

## ITEM 9 — Respostas objetivas

### Existe chamada desnecessária ao Spotify? **SIM**
- `bot-collect-queue/index.ts:20,451` — `fetch("https://api.spotify.com/v1/tracks/{id}")` **fora** do shared client. Sem circuit breaker, sem cache, sem telemetria. Impacto: falhas silenciosas e duplicação de dado disponível em `spotify_track_cache`.
- `analyze-performance/index.ts:61` e `extract-replication-rules/index.ts:61` — chamam `api.anthropic.com` direto, ignorando `_shared/ai_service.ts` (bypass de `AI_PROVIDER` switching).

### Existe chamada duplicada? **SIM**
- Followers de playlist: `enrich-playlists`, `enrich-curator-playlists-spotify`, `enrich-playlist-covers` — três funções fazem `GET /v1/playlists/{id}` em conjuntos sobrepostos, gravando em tabelas diferentes.
- Playlist name: Spotify API (`enrich-curator-playlists-spotify`) **vs** XLSX (`import-label-spreadsheet`) **vs** DOM da VPS (`bot-ingest-snapshot`).
- Track metadata: `bot-collect-queue` (direto) **vs** `spotify-enrichment-worker` **vs** `sync-spotify-editorial-charts`.

### Existe API antiga viva? **SIM**
- Apify em `enrich-playlists` (deployada, atrás de `deprecationGate` + `apify_blocked`).
- `ops-agent-poll` stub deployado.
- 23 funções com `deprecationGate` deployadas e recebendo hits em `deprecation_hits`.

### Existe integração morta? **SIM**
- `ops-agent-poll` — `ops_agent_commands` não existe no banco. Comentário explícito no arquivo.
- Apify parcialmente morto (circuit-breaker `apify_blocked` + rate limit).
- Browserless edge-side: só health probe; uso real é VPS.

### Existe dado vindo da fonte errada? **PARCIALMENTE SIM**
- `import-label-spreadsheet/index.ts:377–393` — quando o `spotify_playlist_id` está ausente e o nome XLSX não casa com nenhum registro do banco (`curator_playlists` / `managed_playlists` / `playlists`), o **texto cru digitado pelo usuário** vira o `playlist_name` canônico. Pode ser abreviado, com typo ou desatualizado vs Spotify ground-truth.

---

## Variáveis de ambiente referenciadas

### Backend (`Deno.env.get`)

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` (fallback — primário é tabela `spotify_apps`), `BOT_API_KEY`, `BOT_INGEST_TOKEN`, `OPS_AGENT_TOKEN`, `CRON_SECRET`, `LOVABLE_API_KEY`, `LOVABLE_AI_MODEL` (default `google/gemini-2.5-flash`), `LOVABLE_SEND_URL`, `CLAUDE_API_KEY`, `CLAUDE_MODEL` (default `claude-sonnet-4-5-20250929`), `AI_PROVIDER`, `APIFY_API_KEY`, `BROWSERLESS_URL`, `BROWSERLESS_TOKEN`, `DEPRECATED_PHASE1_ENABLED`, `ECO_BUDGET_ENABLED`, `USE_LEGACY_SCORE`, `SYSTEM_ALERT_WEBHOOK_URL`, `SLACK_WEBHOOK_URL`, `SMTP_HOST`, `ENRICH_WORKER_*`, `DIAGNOSE_SINGLE_PATH(_TARGET)`.

### Frontend (`import.meta.env`)

`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`, `VITE_APP_RELEASE` (default `"dev"`), `VITE_APP_COMMIT` (default `"dev"`).

### Possivelmente não usadas

- `OPENAI_API_KEY` — só como fallback em `external-health-probes-cron:69`; nunca usado em produção. Lovable Gateway substitui.
- `SUPABASE_FUNCTION_NAME` — checado em `spotify.ts:23` mas não existe no Edge Runtime; sempre cai no parser de `Deno.mainModule`.
