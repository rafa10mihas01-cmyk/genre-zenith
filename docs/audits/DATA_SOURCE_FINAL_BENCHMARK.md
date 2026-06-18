# FASE 6.A.3 — DATA SOURCE FINAL BENCHMARK

Data: 2026-06-18

## Delta BEFORE → AFTER

| Métrica | BEFORE (6.A.2) | AFTER (6.A.3) |
| --- | --- | --- |
| Callers vivos de `enrich-playlists` (não-gated) | 2 (`brain-run`, `collect-batch`) | **0** |
| Callers gated remanescentes | 1 (`genre-autopilot`) | 1 (`genre-autopilot`) |
| Hits reais `enrich-playlists` últimos 7d | 0 | 0 |
| Fontes oficiais ambíguas para followers | 1 (VPS DOM vs Spotify API) | **0** (enum `followers_source_type` = só `spotify_api`; VPS = histórico) |
| Fetch Spotify síncrono em `bot-collect-queue` | 1 por song sem `artist_id` | **0** (cache + queue) |
| Queries Spotify/dispatch (worst case 5 songs sem artist) | 5 calls/dispatch | 1 query no cache + enqueue assíncrono |

## Latência estimada `bot-collect-queue` (5 songs sem artistId em cache)

| Cenário | BEFORE | AFTER |
| --- | --- | --- |
| Todos cache hits | n/a (sempre fetch) | ~50 ms (1 select batch) |
| Todos miss | ~5 × 300 ms = **1500 ms** | ~50 ms select + ~10 ms enqueue (= 60 ms; artistId resolvido no próximo ciclo) |
| Mix (2 hit, 3 miss) | ~900 ms | ~60 ms |

## Custos Spotify API

- `bot-collect-queue` deixa de gastar `/v1/tracks/{id}` por dispatch. Todas as chamadas são consolidadas no `spotify-enrichment-worker`, que respeita rate limit e circuit breaker.
- `brain-run` deixa de invocar `enrich-playlists` (que por sua vez chamava `/v1/playlists/{id}` + tracks). Eliminação total dos ciclos `MAX_CYCLES` (8/5/3 por gênero) — economia significativa em runs de autopilot, mesmo que zero hits reais já vinham acontecendo.

## Pendências para próxima fase

- Remover `enrich-playlists` definitivamente quando `genre-autopilot` for apagado.
- Remover `genre-autopilot` quando confirmado 30d sem hits no `deprecation_hits`.
- Considerar dropar `spotify_tokens` legacy (mantido só por client_credentials cache; substituível por `spotify_user_tokens` + helper).
