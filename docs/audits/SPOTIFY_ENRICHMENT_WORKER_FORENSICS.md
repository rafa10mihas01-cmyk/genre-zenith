# FASE 6.B — Auditoria Forense do `spotify-enrichment-worker`

**Status:** Read-only. Nenhum código ou banco alterado.
**Data:** 2026-06-18
**Escopo:** descobrir por que o worker abriu um circuit breaker de ~22 h e se ele duplica trabalho do VPS.

---

## TL;DR (resposta direta ao usuário)

A hipótese de que **"o worker duplica trabalho do VPS"** **NÃO se confirma**. O VPS e o worker tratam de dados **disjuntos**:

| Dado | Fonte real hoje | VPS faz? |
|---|---|---|
| Playlist followers (live) | Spotify API (`/v1/playlists/{id}?fields=followers.total` via `sync-managed-playlists`) | Não — VPS só faz snapshot DOM histórico |
| Plays diários da track | VPS (label spreadsheet) | ✅ |
| `track.popularity`, `release_date`, `isrc`, `album_id`, `artist_ids` | Spotify API (`/v1/tracks/{id}` → `spotify_track_cache`) | ❌ VPS não coleta |
| `artist.genres`, `artist.popularity`, `artist.followers`, `image_url` | Spotify API (`/v1/artists/{id}` → `spotify_artist_cache`) | ❌ VPS não coleta |
| Playlist tracklist / membership | Spotify API (`sync-managed-playlist-tracks`) | ❌ |

Portanto o worker **deve existir**. O 429 de 80 398 s veio de **rate-limit do app Spotify (NexEngine 07)**, não de chamadas redundantes. O bloqueio de ~22 h é resposta direta do header `Retry-After` da Spotify e o sistema apenas respeitou.

O ponto real a endereçar **não é desligar o worker** — é (a) distribuir o tráfego entre os 8 apps NexEngine antes do 429 e (b) reduzir a pressão de `diagnose_miss` que enfileirou 2 015 tracks em 24 h.

---

## ITEM 1 — Chamadas feitas pelo worker (`spotify_call_log`)

Query: `function_name = 'spotify-enrichment-worker'`.

| Endpoint | 24 h | 7 d | 30 d | Motivo |
|---|---:|---:|---:|---|
| `GET /v1/tracks/{id}` | 0* | 2 036 | 2 130 | Enriquece `spotify_track_cache` (popularity, isrc, release_date, artist_ids) |
| `GET /v1/artists/{id}` | 0* | 1 623 | 1 746 | Enriquece `spotify_artist_cache` (genres, popularity, followers) |
| `POST accounts.spotify.com/api/token` | 0* | 11 | 12 | Refresh do app token (client credentials) |

\* Janela 24 h está zerada porque o breaker abriu em 2026-06-17 05:15 e bloqueou até 2026-06-18 03:35 — o worker ficou parado durante esse intervalo.

**Consumidor único:** o próprio worker, ao drenar `spotify_enrichment_queue`.

---

## ITEM 2 — Classificação de cada chamada

| Endpoint | VPS já entrega? | Já existe no banco? | Classificação |
|---|---|---|---|
| `/v1/tracks/{id}` | **NÃO** — VPS não coleta `popularity` / `isrc` / `release_date` / `artist_ids` | Sim, em `spotify_track_cache` (alimentado por este worker) | **NECESSÁRIA** |
| `/v1/artists/{id}` | **NÃO** — VPS não coleta genres / popularity / followers de artista | Sim, em `spotify_artist_cache` (alimentado por este worker) | **NECESSÁRIA** |
| `/api/token` | N/A | N/A | **NECESSÁRIA** (OAuth) |

Nenhuma chamada do worker é **DUPLICADA** com o VPS, e nenhuma é **LEGADA**.

⚠️ Limitação documentada em `mem://spotify-enrichment-cache`: apps sem Extended Quota retornam 200 **sem** `popularity` / `followers` / `genres`. As chamadas continuam acontecendo, mas o payload vem incompleto para esses campos — isso é política da Spotify, não bug do worker.

---

## ITEM 3 — Auditoria por endpoint

### `/v1/artists/{id}`  (1 623 calls/7d)

- **Quem enfileira:**
  - `_shared/spotify-cache.ts:121` → `enqueueEnrichment("artist", ids, "diagnose_miss", 3)` quando `getArtistCacheBatch` encontra IDs ausentes/stale (chamado em `diagnose-managed-playlist`).
  - `spotify-enrichment-worker/index.ts:198` → após enriquecer uma track, enfileira `artist_ids` ausentes com `reason="track_dep"`.
- **Quem consome:** `spotify-enrichment-worker` (único caminho).
- **Por que foi chamada:** preencher `genres` / `popularity` / `followers` / `image_url` em `spotify_artist_cache` para diagnose e scoring.
- **Distribuição de razões (últimos 7 d, 1 533 + 36):** `track_dep` (97 %) · `diagnose_miss` (3 %).

### `/v1/tracks/{id}`  (2 036 calls/7d)

- **Quem enfileira:**
  - `_shared/spotify-cache.ts:94` → `enqueueEnrichment("track", ids, "diagnose_miss", 3)` (consumidor: `diagnose-managed-playlist`).
  - `sync-managed-playlist-tracks/index.ts:336` → `enqueueEnrichment("track", newIds, "sync_new", 4)` quando novas tracks entram em playlist gerenciada.
- **Quem consome:** `spotify-enrichment-worker`.
- **Por que foi chamada:** preencher `popularity`, `release_date`, `isrc`, `album_id`, `artist_ids` em `spotify_track_cache`.
- **Distribuição (últimos 7 d, 2 031 jobs):** `diagnose_miss` (99,2 %) · `sync_new` (0,8 %).

### `/v1/albums/{id}`

Worker **não chama**. Album metadata já vem aninhado em `/v1/tracks/{id}`.

### `/v1/playlists/{id}`

Worker **não chama**. Esse endpoint pertence a `sync-managed-playlist*`, `register-curator-playlist`, etc.

### `/v1/search`

Worker **não chama**. Pertence a `run-search` / `refresh-search-results`.

---

## ITEM 4 — Reconstrução do 429 de 80 398 s

Fonte: `spotify_circuit_breaker_log` + `spotify_call_log`.

| Campo | Valor |
|---|---|
| **Horário (UTC)** | 2026-06-17 05:15:04.643 |
| **Horário (SP)** | 2026-06-17 02:15:04 |
| **Worker** | `spotify-enrichment-worker` |
| **App Spotify** | **NexEngine 07** |
| **Endpoint** | `GET /v1/artists/{id}` (ref `5jvQoouPSDvUEwynz5KPpv` e `0EmeFodog0BfCgMzAIvKQp` no mesmo segundo) |
| **HTTP status** | 429 |
| **Retry-After header** | 80 398 s (~22 h 19 min) — vindo direto da Spotify |
| **blocked_until** | 2026-06-18 03:35:02 UTC |
| **Fila no momento** | jobs do dia: 596 artistas + 612 tracks enfileirados em 16/06; pico de 710 artistas + 1 133 tracks em 17/06 (a maior parte enfileirada depois do 429) |
| **Correlation:** | sem `correlation_id` — `caused_by` armazena a URL crua; `source_function` ficou null nesse evento |

**Eventos semelhantes nas últimas 48 h** (mostram que NÃO é caso isolado de um único app):

| opened_at | app | endpoint | retry_after |
|---|---|---|---|
| 2026-06-17 05:15 | NexEngine 07 | `/v1/artists/:id` | 80 398 s |
| 2026-06-17 03:30 | NexEngine 06 | `/v1/artists/:id` | 9 111 s |
| 2026-06-17 02:00 | NexEngine 05 | `/v1/tracks/:id` | 80 396 s |
| 2026-06-17 00:15 | NexEngine ?? | `/v1/tracks/:id` | 44 949 s |
| 2026-06-16 05:37 | (artist) | `/v1/artists/:id` | 66 654 s |

Padrão: vários apps NexEngine pegando 429 em sequência, sempre nos endpoints single-path `/v1/tracks/{id}` e `/v1/artists/{id}`, com Retry-After de horas a quase um dia. Isso é assinatura de **abuse-quota** da Spotify (não throttle normal — throttle normal devolve poucos segundos).

---

## ITEM 5 — VPS faz o mesmo enriquecimento?

| Dado | VPS faz? | Spotify API faz? | Ambos? | Onde escreve |
|---|---|---|---|---|
| **Artista** (genres, popularity, followers, image) | ❌ | ✅ worker | Não | `spotify_artist_cache` |
| **Track** (popularity, isrc, release_date, album_id) | ❌ | ✅ worker | Não | `spotify_track_cache` |
| **Playlist** (name, image, owner, followers, tracklist) | 🟡 só DOM histórico de followers em `playlist_followers_snapshots` | ✅ `sync-managed-playlist*` (não é o worker) | Sim, mas para fins distintos (live vs histórico) | `playlists`, `managed_playlist_tracks`, `playlist_followers_snapshots` |
| **Followers de playlist (live)** | 🟡 DOM observacional, arredondado | ✅ oficial | Sim — mas a oficial já é `spotify_api` (vide Fase 6.A.3) | `playlists.followers_count` |
| **Metadata** (nome de música/artista) | 🟡 texto cru de XLSX / print | ✅ canônica | VPS = fallback, Spotify = canônica | `spotify_*_cache` |
| **Diagnose** (scoring, fit, leadership) | ❌ é cálculo interno do banco | ❌ | N/A (consome cache) | `playlist_diagnoses` etc. |

**Conclusão item 5:** o worker NÃO faz nada que o VPS já faça. O único overlap real (followers de playlist) já foi resolvido na Fase 6.A.3 e nem pertence a este worker.

---

## ITEM 6 — Duplicidades entre VPS e Spotify API

Auditadas, **zero duplicidades envolvem o `spotify-enrichment-worker`**.

Duplicidades que existem em outras camadas (já documentadas em `docs/audits/DATA_SOURCE_FINAL_AUDIT.md`):

| Arquivo | Função | Tipo | Status |
|---|---|---|---|
| `bot-ingest-dom` (heartbeat piggyback) | followers DOM | 🟡 paralelo com `sync-managed-playlists` | OK — alimenta histórico, não estado live |
| `enrich-playlists` (edge function) | refresh metadados de playlist | ⚠️ legacy ainda gated mas sem callers ativos | Documentado para remoção pós-`genre-autopilot` |

Nada disso passa pelo worker auditado.

---

## ITEM 7 — Respostas objetivas

> **O `spotify-enrichment-worker` deveria existir?**
> SIM. É o único produtor de `spotify_track_cache` e `spotify_artist_cache`, e esses dados são consumidos por `diagnose-managed-playlist`, scoring de fit, ecosystem score, leadership e cockpit. Sem ele, diagnose degrada para "sem genres / sem popularity".

> **Quais chamadas dele são obrigatórias?**
> Todas as três: `/v1/tracks/{id}`, `/v1/artists/{id}`, `/api/token`. Nenhuma tem substituto no VPS.

> **Quais devem ser migradas para o VPS?**
> Nenhuma — o VPS hoje não tem visibilidade de `popularity`, `genres` nem `followers` de artista. Para migrar seria preciso adicionar scraping do site `open.spotify.com/artist/{id}` no bot, o que aumenta custo de DOM e ainda assim não devolve `popularity` numérica oficial.

> **Quais podem ser desligadas sem regressão?**
> Nenhuma chamada **atual**. O que pode ser **reduzido** sem regressão:
> 1. Throttling de `diagnose_miss` — hoje qualquer diagnose enfileira o miss imediatamente; uma janela "no máximo 1 enqueue por ref_id a cada 7 d" cortaria volume sem perder dados (cache já tem TTL).
> 2. Roteamento round-robin entre os 8 apps NexEngine no worker — hoje o worker pega um único `getAppToken()` e martela com ele até 429. Distribuir os ~500 calls/dia entre 8 apps mantém cada app abaixo do limite que dispara abuse-quota.

---

## ENTREGÁVEL — Plano de separação definitiva VPS × Spotify API

### MUNDO VPS (continua dono de)

- Scraping de plays diários (label spreadsheet → `song_snapshots`, `label_spreadsheet_rows`).
- Snapshot DOM de followers de playlist (`playlist_followers_snapshots`, observacional).
- Heartbeat piggyback de followers (`bot-ingest-dom`).
- Coleta de prints (`bot-upload-print`, `extract-snapshot-from-print`).
- Execução de fila (`bot-execution-queue`, `bot-collect-queue`).
- Detecção visual (`analyze-deal-prints`).

### MUNDO SPOTIFY API (continua dono de)

- **OAuth** (`spotify-token-watchdog`, `getAppToken`, `spotify_user_tokens`).
- **Edição de playlists** (add/remove/reorder via `_shared/spotify-playlist.ts`).
- **Listagem de playlists da conta** (`sync-managed-playlists`, `link-managed-playlist-accounts`).
- **Tracklist live** (`sync-managed-playlist-tracks`).
- **Followers oficiais** (`sync-managed-playlists` → `playlists.followers_count`).
- **Enriquecimento de metadata canônica** (`spotify-enrichment-worker` → caches de track/artist). **CONFIRMADO COMO NECESSÁRIO.**
- **Search** (`run-search`).
- **Charts editoriais** (`charts-collect` etc.).

### Recomendações operacionais (não-blocking, fora desta fase)

1. **Round-robin de apps no worker.** Em vez de `getAppToken()` único por execução, pegar app menos usado em `spotify_call_log` nos últimos 60 min. Mitiga abuse-quota.
2. **Dedup de `diagnose_miss`.** Adicionar guard "não enfileira se `ref_id` já foi enriquecido nos últimos 7 d" em `spotify-cache.ts`. Reduz 90 % dos jobs `diagnose_miss`.
3. **Telemetria do breaker.** Preencher `caused_by` com `function_name:reason` e `source_function` no `openSpotifyCircuitBreaker` para que o próximo 429 seja rastreável sem cruzar logs.

Nenhuma das três é alteração desta fase — todas exigem aprovação explícita.

---

## Apêndice — Evidência crua

```
-- volume de enfileiramento por razão (7d)
SELECT kind, reason, COUNT(*) FROM spotify_enrichment_queue
WHERE created_at > now() - interval '7 days' GROUP BY 1,2;
--  track  | diagnose_miss | 2015
--  artist | track_dep     | 1533
--  artist | diagnose_miss |   36
--  track  | sync_new      |   16

-- chamadas do worker
SELECT endpoint, COUNT(*) FROM spotify_call_log
WHERE function_name='spotify-enrichment-worker' AND created_at > now()-interval '7 days'
GROUP BY 1;
--  /v1/tracks/:id  | 2036
--  /v1/artists/:id | 1623
--  /api/token      |   11

-- breaker event
SELECT opened_at, blocked_until, retry_after_sec, caused_by
FROM spotify_circuit_breaker_log ORDER BY opened_at DESC LIMIT 1;
--  2026-06-17 05:15:04 | 2026-06-18 03:35:02 | 80398
--  caused_by: https://api.spotify.com/v1/artists/5jvQoouPSDvUEwynz5KPpv
```
