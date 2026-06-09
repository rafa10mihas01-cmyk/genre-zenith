# Plano — Cache Permanente de Enriquecimento Spotify

## Objetivo
Desacoplar a `diagnose-managed-playlist` da API do Spotify. A diagnose passa a ler de tabelas locais (`spotify_track_cache`, `spotify_artist_cache`), e o enriquecimento real do Spotify acontece em jobs assíncronos fora do hot path. 429/403/timeout do Spotify deixam de quebrar a análise — pioram a frescor, não o resultado.

---

## 1. Modelagem das tabelas

### 1.1 `spotify_track_cache`
Uma linha por track ID. Imutável o suficiente pra durar meses (popularity é o único campo "vivo").

| coluna | tipo | nota |
|---|---|---|
| `spotify_track_id` | text PK | |
| `name` | text | |
| `isrc` | text | nullable |
| `album_id` | text | nullable |
| `release_date` | date | nullable — vem do album |
| `duration_ms` | int | |
| `explicit` | bool | |
| `popularity` | smallint | 0–100, **único campo com TTL curto** |
| `artist_ids` | text[] | FK lógica pra `spotify_artist_cache` |
| `raw` | jsonb | resposta crua (debug, opcional) |
| `source_app_id` | uuid | app que enriqueceu |
| `enriched_at` | timestamptz | preenchimento inicial |
| `popularity_refreshed_at` | timestamptz | última atualização de popularity |
| `fetch_status` | text | `ok` / `not_found` / `forbidden` / `error` |
| `fetch_error` | text | nullable |
| `created_at` | timestamptz default now() | |

Índices: `(popularity_refreshed_at)`, GIN em `artist_ids`, `(fetch_status)`.

### 1.2 `spotify_artist_cache`
| coluna | tipo | nota |
|---|---|---|
| `spotify_artist_id` | text PK | |
| `name` | text | |
| `genres` | text[] | TTL médio |
| `popularity` | smallint | TTL curto |
| `followers` | int | TTL curto |
| `image_url` | text | nullable |
| `raw` | jsonb | opcional |
| `enriched_at` | timestamptz | |
| `refreshed_at` | timestamptz | última atualização de popularity/followers |
| `genres_refreshed_at` | timestamptz | última atualização de genres |
| `fetch_status` | text | `ok` / `not_found` / `forbidden` / `error` |
| `fetch_error` | text | |

Índices: `(refreshed_at)`, `(genres_refreshed_at)`, `(fetch_status)`.

### 1.3 `spotify_enrichment_queue`
Fila simples, dedupada por `(kind, ref_id)`.

| coluna | tipo |
|---|---|
| `id` | uuid PK |
| `kind` | text — `track` \| `artist` |
| `ref_id` | text — spotify id |
| `reason` | text — `new` / `ttl_expired` / `forced` / `diagnose_miss` |
| `priority` | smallint default 5 (1 = mais alta) |
| `attempts` | smallint default 0 |
| `max_attempts` | smallint default 5 |
| `status` | text — `pending` / `processing` / `done` / `failed` / `skipped_forbidden` |
| `last_error` | text |
| `scheduled_for` | timestamptz default now() |
| `claimed_by` | text |
| `claimed_at` | timestamptz |
| `done_at` | timestamptz |
| `created_at` | timestamptz default now() |

Unique parcial: `(kind, ref_id) WHERE status IN ('pending','processing')` — evita duplicar trabalho.
Índice: `(status, scheduled_for, priority)`.

### 1.4 TTLs (configuráveis em `system_flags`)
- `cache.track.popularity_ttl_days` — default **14**
- `cache.artist.popularity_ttl_days` — default **14**
- `cache.artist.followers_ttl_days` — default **14**
- `cache.artist.genres_ttl_days` — default **90** (genres mudam quase nada)
- `cache.track.core_ttl_days` — default **365** (release_date/isrc/artist_ids são imutáveis)
- `cache.stale_grace_days` — default **90** — diagnose ainda aceita cache mesmo expirado, só agenda refresh

---

## 2. Fluxo de atualização

### 2.1 Diagnose (leitura)
```
para cada track da playlist:
  row = select * from spotify_track_cache where spotify_track_id = ?
  se row existe:
    usa popularity/release_date/artist_ids
    se popularity_refreshed_at < now() - ttl: enqueue(track, reason='ttl_expired', priority=6)
  senão:
    marca como no_data
    enqueue(track, reason='diagnose_miss', priority=3)

artist_ids agregados:
  rows = select * from spotify_artist_cache where spotify_artist_id = any(?)
  mesma lógica: usa o que existe, agenda o que faltou/expirou
```

A diagnose **nunca chama Spotify diretamente**. Termina sempre — `no_data` cai conforme a fila esquenta.

### 2.2 Worker (`spotify-enrichment-worker`, edge function cron 1×/min)
```
claim até N (ex.: 25) jobs pending mais antigos
para cada job:
  GET /v1/tracks/{id} ou /v1/artists/{id} (single-path)
  200 → upsert no cache, status=done
  404 → upsert fetch_status='not_found', status=done
  403 → status='skipped_forbidden', backoff longo (24h)
  429 → não consome attempt, reagenda +retry-after, abre circuit breaker do app por X min
  5xx/timeout → attempts++, scheduled_for = now() + backoff exponencial
rotaciona apps 05/06/07/10 por request (já existe `spotify_circuit_breaker`)
respeita concorrência baixa (2 req simultâneas, 150–300ms entre lotes)
```

### 2.3 Entradas no cache (gatilhos de enqueue)
- `sync-managed-playlist-tracks` ao inserir em `managed_playlist_tracks`: enqueue novos track_ids (priority=4).
- `diagnose-managed-playlist` ao detectar miss/stale: enqueue (priority 3/6).
- Backfill manual: edge function `cache-backfill` que varre `managed_playlist_tracks` distinct e enfileira tudo que falta (priority=8, em lotes).

### 2.4 Refresh proativo (cron diário)
SQL agendado:
```sql
insert into spotify_enrichment_queue (kind, ref_id, reason, priority)
select 'track', spotify_track_id, 'ttl_expired', 7
from spotify_track_cache
where popularity_refreshed_at < now() - interval '14 days'
  and fetch_status = 'ok'
on conflict do nothing
limit 2000;
```
Mesmo para artists. Limita volume diário pra caber no quota.

---

## 3. Impacto nas edge functions

| função | mudança |
|---|---|
| `diagnose-managed-playlist` | remove `useSinglePath` e blocos `fetchAllSingle`. Substitui por dois SELECTs no cache + lógica de fallback. Reverte para um único pass — sem rede pra Spotify. |
| `sync-managed-playlist-tracks` | após upsert das tracks, insert na `spotify_enrichment_queue` (kind=track) com `on conflict do nothing`. |
| `spotify-enrichment-worker` | **nova**. Cron 1×/min. Claim → fetch single-path → upsert cache → libera. |
| `cache-backfill` | **nova**, admin-only. Enfileira tudo que falta no cache para tracks/artists já conhecidos. |
| `_shared/spotify-cache.ts` | **novo helper** — `getTrackCached(ids[])`, `getArtistCached(ids[])`, `enqueueEnrichment(...)`. Toda função que precisar de popularity passa por aqui. |

Cron via `pg_cron` + `pg_net` chamando o worker.

---

## 4. Impacto nos custos

- **Spotify**: chamadas deixam de escalar com `playlists × diagnoses/dia`. Passam a escalar com `tracks novas/dia + refresh TTL`. Catálogo atual estimado em ~10–20k tracks únicas; refresh quinzenal = ~700–1400 req/dia distribuídas em 4 apps ≈ folgado dentro do quota mesmo sem Extended.
- **Banco**: 2 tabelas novas, ~50–200k linhas no estado estacionário. Custo desprezível. `raw` jsonb opcional pode ser desligado se quiser.
- **Edge function**: worker é leve (25 req/min). Cron de manutenção desprezível.
- **Saving real**: hoje a diagnose da ADRENALINA queima ~93 req/track + ~50 req/artist a cada execução. Com cache: 0 req em regime normal.

---

## 5. Impacto no tempo da diagnose

| etapa | hoje (single-path live) | com cache |
|---|---|---|
| enrich tracks (93) | ~45–60s + risco de 429 | 1 SELECT (~50ms) |
| enrich artists (~50) | ~25–40s + risco de 429 | 1 SELECT (~50ms) |
| análise/scoring | 1–2s | 1–2s |
| **total** | **70–100s, frequentemente falhando** | **2–3s, determinístico** |

Diagnose vira instantânea. `no_data` só aparece para tracks recém-importadas, e cai sozinho conforme o worker drena a fila (minutos, não horas).

---

## 6. Plano de rollout

1. Migration: criar `spotify_track_cache`, `spotify_artist_cache`, `spotify_enrichment_queue` + GRANTs + RLS (service_role + admin read).
2. Adicionar flags de TTL em `system_flags`.
3. Criar `_shared/spotify-cache.ts`.
4. Criar `spotify-enrichment-worker` + cron 1×/min.
5. Criar `cache-backfill` e rodar uma vez pra popular o catálogo atual (em background, priority baixa).
6. Atualizar `sync-managed-playlist-tracks` pra enfileirar novos IDs.
7. Reescrever bloco de enriquecimento da `diagnose-managed-playlist` pra ler do cache.
8. Validar com ADRENALINA: rodar backfill da playlist (~143 ids), aguardar worker drenar, rodar diagnose, conferir `no_data → 0`, `promote/remove/cover/saturação` populados.
9. Habilitar refresh proativo (cron diário).

---

## 7. Riscos e mitigações

- **Catálogo inicial frio**: primeiras diagnoses ainda terão `no_data` alto. Mitigado pelo backfill prévio.
- **Spotify ban prolongado**: cache permite continuar operando com dados de até 90 dias (grace). Pior caso: popularity desatualizada, não diagnose quebrada.
- **Tracks deletadas/regionais**: tratadas como `fetch_status='not_found'`, não voltam pra fila.
- **Quota worker**: round-robin de apps + circuit breaker já existente cobre. Worker é o **único lugar** que fala com Spotify pra enriquecimento.
