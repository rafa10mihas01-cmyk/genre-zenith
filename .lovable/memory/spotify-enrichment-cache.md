---
name: Spotify enrichment cache
description: Arquitetura cache-first pra desacoplar diagnose do Spotify (tabelas, worker, fila)
type: feature
---

Diagnose e funções de scoring NÃO chamam Spotify direto pra popularity/genres/followers/release_date. Tudo passa por:

- `spotify_track_cache` — PK `spotify_track_id`. Guarda name, isrc, album_id, release_date, duration_ms, popularity, artist_ids, popularity_refreshed_at, fetch_status.
- `spotify_artist_cache` — PK `spotify_artist_id`. Guarda name, genres, popularity, followers, image_url, refreshed_at.
- `spotify_enrichment_queue` — fila assíncrona com unique parcial `(kind, ref_id) WHERE status IN (pending, processing)`. RPC `claim_spotify_enrichment_jobs(_worker, _limit)` reserva atomicamente com `FOR UPDATE SKIP LOCKED`.

Helpers (OBRIGATÓRIO usar):
- `supabase/functions/_shared/spotify-cache.ts` → `getTrackCacheBatch(ids[])`, `getArtistCacheBatch(ids[])`, `enqueueEnrichment(kind, ids, reason, priority)`. Misses/stale são enfileirados automaticamente (não bloqueia leitura).

Worker:
- `supabase/functions/spotify-enrichment-worker` — cron 1×/min (job `spotify-enrichment-worker-1min`). Single-path `/v1/tracks/{id}` e `/v1/artists/{id}`. Política: 200→done · 404→not_found · 403→backoff 24h · 429→não consome attempt + retry-after · 5xx→backoff exponencial.

Backfill manual:
- `supabase/functions/cache-backfill` — body `{ playlist_id?, limit? }`. Enfileira IDs distintos de `managed_playlist_tracks` ainda não cacheados.

Gatilhos:
- `sync-managed-playlist-tracks` enfileira `toInsert` (priority 4) após upsert.

TTL (env-configurável):
- `CACHE_TRACK_POP_TTL_DAYS` (14) · `CACHE_ARTIST_POP_TTL_DAYS` (14) · `CACHE_ARTIST_GENRES_TTL_DAYS` (90).

LIMITAÇÃO CONHECIDA (Spotify policy, NÃO arquitetura):
Os apps atuais (sem Extended Quota) recebem 200 mas **sem** `popularity` / `followers` / `genres` mesmo em single-path. Cache armazena o que vier — release_date, isrc, artist_ids continuam funcionando. Popularity ainda existe em `search_tracks` pra fallback. Resolver definitivamente exige Extended Quota num app dedicado.
