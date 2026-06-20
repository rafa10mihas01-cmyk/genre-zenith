# Fase 17-C — Contrato HTTP do Observer

Decisão (Fase 17-C): o Observer existente na VPS deixa de ser apenas um ingestor em lote e passa a expor uma API HTTP que substitui a Spotify Web API para **leitura de playlists públicas de terceiros**.

Este documento é o **contrato que a VPS precisa implementar**. As Edge Functions deste repositório vão consumir essa API através do helper `supabase/functions/_shared/observer-playlist.ts`.

## 1. Base

```
Base URL:  https://<observer-host>/observer
Auth:      Header  X-Observer-Token: <OBSERVER_TOKEN>
Content:   application/json; charset=utf-8
```

A URL e o token serão registrados como secrets na Lovable Cloud:

- `OBSERVER_BASE_URL` (ex.: `https://nexengine-bot-02.example.com/observer`)
- `OBSERVER_TOKEN`

## 2. Endpoints

Os endpoints **espelham o shape da Spotify Web API** sempre que possível, para que os workers não precisem reescrever parsing.

### 2.1 `GET /playlists/:id`

Metadados da playlist.

```json
{
  "id": "37i9dQZF1DXcBWIGoYBM5M",
  "name": "Today's Top Hits",
  "description": "...",
  "snapshot_id": "MTcwM...",
  "owner": { "id": "spotify", "display_name": "Spotify", "type": "user" },
  "followers": { "total": 34567890 },
  "images": [{ "url": "...", "width": 640, "height": 640 }],
  "public": true,
  "collaborative": false,
  "tracks": { "total": 50 },
  "observer": {
    "captured_at": "2026-06-20T18:54:00Z",
    "source": "cache" | "fresh_scrape",
    "ttl_seconds": 3600
  }
}
```

Query params opcionais:
- `?fresh=1` força scrape ignorando cache.
- `?max_age=<seg>` aceita cache até essa idade (default: TTL do Observer).

### 2.2 `GET /playlists/:id/items`

Lista de tracks da playlist, com paginação espelhada da Web API.

```json
{
  "href": "/observer/playlists/{id}/items?offset=0&limit=100",
  "limit": 100,
  "offset": 0,
  "total": 245,
  "next": "/observer/playlists/{id}/items?offset=100&limit=100",
  "previous": null,
  "items": [
    {
      "added_at": null,
      "added_by": null,
      "is_local": false,
      "track": {
        "id": "abc",
        "uri": "spotify:track:abc",
        "name": "...",
        "duration_ms": 213000,
        "artists": [{ "id": "...", "name": "..." }],
        "album": { "id": "...", "name": "...", "images": [...] }
      },
      "position": 0
    }
  ],
  "observer": { "captured_at": "...", "source": "cache" | "fresh_scrape" }
}
```

Query params:
- `offset`, `limit` (limit máximo 100).
- `fresh=1`, `max_age=<seg>`.

### 2.3 `GET /playlists/:id/followers`

Atalho de leitura — evita baixar a playlist inteira só pra contar.

```json
{ "id": "...", "followers": { "total": 34567890 }, "observer": { ... } }
```

### 2.4 `GET /playlists/:id/owner`

```json
{ "id": "...", "owner": { "id": "...", "display_name": "...", "type": "user" }, "observer": { ... } }
```

### 2.5 `GET /health`

```json
{ "ok": true, "version": "1.0.0", "uptime_seconds": 12345, "queue_depth": 0 }
```

## 3. Comportamento

Para qualquer endpoint de playlist:

```
recebe request
  └─ snapshot da playlist no banco com idade ≤ TTL?
       ├─ sim → devolve do cache  (source: "cache")
       └─ não → scrape sincrônico do open.spotify.com
                grava em observed_playlists + observer_playlist_tracks
                devolve  (source: "fresh_scrape")
```

A cada visita (cache miss ou `fresh=1`), o Observer **deve atualizar**:

- tracks completas (com paginação do DOM, sem cortar em 100)
- `owner` (id, nome, tipo)
- `followers.total`
- `name`
- `images` (image_url principal)
- `description`
- `snapshot_id` ou `snapshot_timestamp` (algum identificador estável de versão)

## 4. Erros

| HTTP | quando | body |
|---|---|---|
| 200 | sucesso | shape acima |
| 400 | id inválido | `{ "error": "invalid_playlist_id" }` |
| 401 | token ausente/inválido | `{ "error": "unauthorized" }` |
| 404 | playlist inexistente / privada | `{ "error": "not_found" }` |
| 410 | playlist removida do Spotify | `{ "error": "gone" }` |
| 429 | rate limit do Observer | `{ "error": "rate_limited", "retry_after_seconds": N }` + header `Retry-After` |
| 502 | scrape falhou (DOM, network) | `{ "error": "scrape_failed", "reason": "..." }` |
| 503 | Observer ocupado / fila cheia | `{ "error": "busy", "retry_after_seconds": N }` |

## 5. Rate limit recomendado

- Padrão: 60 req/min por consumer (suficiente para todos os workers atuais somados).
- Burst: 10.
- Workers respeitam `Retry-After` em 429/503.

## 6. Telemetria mínima esperada

O Observer deve manter, no próprio banco local OU em log que possamos puxar:
- contadores por endpoint (count, p50/p95/p99 ms, % erro);
- contagem de scrapes vs cache hits;
- quantidade de playlists pendentes na fila de scrape sincrônico.

## 7. O que **não** muda na VPS

- O bot do **Spotify for Artists** continua intocado.
- O job atual de promoção via `promote-search-to-observer` continua existindo (alimenta `observed_playlists` com novos candidatos vindos de search).
- A coleta em lote diária pode continuar como warm-up de cache; a novidade é apenas o modo **on-demand sincrônico via HTTP**.

---

## 8. Plano de migração dos workers (lado Lovable)

Só inicia depois que `GET /health` da VPS responder 200 com a base/token configurados em secrets.

Ordem proposta (menor risco → maior), cada item troca apenas a **origem dos dados**:

1. `playlist-tracks-list`
2. `backfill-playlist-tracks-count`, `backfill-managed-playlist-tracks`, `backfill-curator-playlist-meta`
3. `recheck-archived-followers`, `discover-playlist-owners`
4. `enrich-playlists`, `enrich-curator-playlists-spotify`, `enrich-playlist-covers`, `enrich-playlist-dna`
5. `compute-playlist-dna`, `compute-playlist-dna-shadow`
6. `observer-pull-queue` / `observer-ingest-tracks` (loop interno do bot atual; revisitar)
7. `validate-fallback`, `revalidate-deliveries`, `extract-snapshot-from-print`
8. `apply-playlist-suggestions`, `apply-playlist-identity` (apenas trechos de leitura)
9. `sync-managed-playlist-tracks` (leitura remota antes do diff; mutações continuam OAuth)
10. `import-account-playlists` (apenas itens; `/me/playlists` continua OAuth), `import-label-spreadsheet`, `genre-spotify-discover`

Padrão de substituição:

```ts
// antes
await defaultSpotifyFetch(`https://api.spotify.com/v1/playlists/${id}/items?...`, ..., token)

// depois
await observerListAllPlaylistItems(id, { fields, market })
```

Critério de pronto da fase:
- `rg "api\.spotify\.com/v1/playlists"` em `supabase/functions/` retorna apenas trechos de mutação OAuth.
- `spotify_call_log` mostra leituras de playlist com `source='observer'`.
- Este documento marcado como concluído.

---

## 9. Status atual

- [x] Contrato definido (este doc).
- [x] Client `_shared/observer-playlist.ts` criado e pronto para uso assim que os secrets `OBSERVER_BASE_URL` / `OBSERVER_TOKEN` forem registrados.
- [ ] VPS implementa os endpoints `/observer/*` conforme seção 2.
- [ ] Secrets `OBSERVER_BASE_URL` e `OBSERVER_TOKEN` registrados.
- [ ] `GET /observer/health` validado.
- [ ] Migração dos workers (seção 8) — bloqueada até os três itens acima.
