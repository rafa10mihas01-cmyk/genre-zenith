# DATA_SOURCE_MATRIX — Fase 6.A

> Matriz oficial de fontes de dados da NexEngine.
> Auditoria read-only. Nenhum dado/código foi alterado.
> Data: 17/06/2026.

---

## ITEM 3 — Fonte autoritativa por domínio

### 3.1 Streams / plays / plays_7d / plays_24h / plays_28d

**Fonte primária: VPS Bot.** Secundária: import XLSX.

1. VPS scrapeia Spotify for Artists (Playwright/Browserless self-hosted).
2. POSTa para `bot-ingest-snapshot` ou `bot-ingest-song-snapshot`.
3. `bot-ingest-snapshot/index.ts:70–184` extrai `plays`, `plays_24h`, `plays_7d`, `plays_28d`.
4. Grava via RPC `ingest_campaign_collection_batch` (→ `_shared/collection-writer.ts`) em `campaign_playlist_collections`.
5. Também escreve em `organic_plays_snapshots` (`:458–467`) e atualiza `campaign_playlist_deals.plays_7d` (`:560–562`).

Path XLSX: `import-label-spreadsheet/index.ts:804,847,917` mapeia coluna `streams` → `plays_7d`, mesma RPC + `delivery_proofs.plays_total`.

Campo legado: `plays = plays_7d ?? plays_28d ?? plays_24h ?? 0` (`bot-ingest-snapshot:421`).

### 3.2 Followers

**Playlist followers — duplo:**

| Fonte | Path | Destino |
|---|---|---|
| Spotify API | `enrich-playlists:88,335–336` | `search_results.seguidores`, `followers_source="spotify_api"` |
| Spotify API | `enrich-curator-playlists-spotify:26–38` | `curator_playlists.followers` |
| Spotify API | `enrich-playlist-covers:69` | `managed_playlists.followers` |
| Spotify API | `recheck-archived-followers` | `managed_playlists.followers` (arquivados) |
| VPS Bot | `bot-ingest-snapshot:374` | `organic_plays_snapshots.followers` |

Artist followers: não observado como campo standalone — incerto, requer checagem em runtime.

### 3.3 Playlist Name

| Fonte | Path | Destino |
|---|---|---|
| Spotify API | `enrich-curator-playlists-spotify:34` | `curator_playlists.playlist_name` (canônico) |
| Spotify API | `enrich-playlists` via `getPlaylistMeta` | `search_results.nome_playlist` |
| VPS Bot DOM | `bot-ingest-snapshot:409,430,625` (`p_playlist_name`) | `campaign_playlist_collections.playlist_name` |
| XLSX | `import-label-spreadsheet:241,271,678` | `label_spreadsheet_rows.playlist_name` |
| DB fallback | `import-label-spreadsheet:377–392` | resolve em `curator_playlists` → `managed_playlists` → `playlists` → XLSX cru |

### 3.4 Playlist URL / `spotify_playlist_id`

| Fonte | Path | Destino |
|---|---|---|
| VPS Bot | `bot-ingest-snapshot:394` | `campaign_playlist_collections.spotify_playlist_id` |
| XLSX (URL parser) | `import-label-spreadsheet:114–243` | extrai de URL/URI |
| Spotify API (create) | `create-spotify-playlist:173` | `managed_playlists.spotify_playlist_id` |
| Paste manual | `enrich-curator-paste`, `parse-deal-paste` | `curator_playlists.spotify_playlist_id` |

### 3.5 Playlist Position (posição da track dentro da playlist)

**Fonte: VPS Observer Bot.**

- `observer-ingest-tracks/index.ts` recebe `{playlists:[{spotify_playlist_id, tracks:[{position,track_id,…}]}]}` → grava em `observed_playlist_tracks`.
- Fallback: `snapshot-playlist-tracks` via Spotify API `/v1/playlists/{id}/tracks`.

### 3.6 Curator

| Campo | Fonte | Path |
|---|---|---|
| `curator_name` | Spotify API (`owner.display_name`) | `enrich-curator-playlists-spotify:38`, `_shared/curator-playlist.ts:114` |
| `owner_id` | Spotify API | `_shared/spotify-playlist.ts:276`, `_shared/curator-playlist.ts:113` |
| `curator_name` (manual) | XLSX | `import-label-spreadsheet:342–343` (match contra tabela `curators` por nome) |
| Contato/email | DB apenas | `curators` — nenhum enrich API observado |

### 3.7 Track metadata

| Campo | Fonte | Path |
|---|---|---|
| title, artist, isrc | XLSX | `import-label-spreadsheet:136–137,270` |
| title, artist, cover, duration | Spotify API | `bot-collect-queue:20,451` (`GET /v1/tracks/{id}`), `sync-spotify-editorial-charts` |
| isrc | Spotify API | `fetch-tracks-spotify` (deprecada), `spotify-enrichment-worker` |
| cover_url | Spotify API | `sync-spotify-editorial-charts` → `raw_chart_daily.cover_url`; `enrich-playlists` |
| popularity | Spotify API | `sync-spotify-editorial-charts` → `raw_chart_daily.popularity` |

### 3.8 Delivery (acumulado da campanha)

**Fonte: função SQL `fn_campaign_delivery_accumulated` (calculada).**

- Frontend lê via RPC: `useDealTodayPlaylistBreakdown.ts:136,144`, `CampanhaExecucao.tsx:713`, `useDeliveryStatus.ts:42`.
- View materializada: `curator_deal_delivery_status`.
- Comentário em `import-label-spreadsheet:880–883`: *"Fonte ÚNICA = fn_campaign_delivery_accumulated → curadores + eco + orgânico, sempre delivery_accumulated (Σ deltas positivos)"*.
- Base: agrega `campaign_playlist_collections` (Σ deltas, com regra atual de `last_24h` somando full e `last_7d` somando delta positivo).

---

## ITEM 4 — Chamadas duplicadas

| Campo | Path A | Path B | Path C | Risco |
|---|---|---|---|---|
| Playlist followers | `enrich-playlists` → `search_results.seguidores` | `enrich-curator-playlists-spotify` → `curator_playlists.followers` | `enrich-playlist-covers:69` → `managed_playlists.followers` | 3 chamadas Spotify para conjuntos sobrepostos |
| Playlist name | Spotify API | XLSX cru | DOM da VPS | XLSX pode estar desatualizado vs Spotify |
| Track metadata | `bot-collect-queue` direto | `spotify-enrichment-worker` | `sync-spotify-editorial-charts` | `bot-collect-queue` fora do shared client (sem CB/cache) |
| Play counts (`plays_7d`) | VPS → `bot-ingest-snapshot` → `campaign_playlist_collections` | XLSX → `import-label-spreadsheet` → mesma RPC | `bot-ingest-dom` → DOM parse → mesma RPC | Convergem na mesma RPC; resolução de conflito SQL-side |
| AI (Claude) | `_shared/ai_service.ts` (central) | `analyze-performance:61` (direto) | `extract-replication-rules:61` (direto) | Duas funções burlam `AI_PROVIDER` e hardcoded `CLAUDE_API_KEY` |

---

## ITEM 6 — Status de cada integração

| Integração | Em uso? | Features | Pode remover? | Substituir por |
|---|---|---|---|---|
| Spotify Web API | SIM (crítico) | Enrich, metadata, OAuth, editorial, sync | NÃO | — |
| Browserless (edge) | Só health probe | health | Stub: SIM. VPS-side: NÃO | — |
| Lovable AI Gateway | SIM (ativo) | IA geral | NÃO | Claude via `AI_PROVIDER` |
| Anthropic (direto) | SIM (2 funções) | `analyze-performance`, `extract-replication-rules` | Direto: refatorar p/ `ai_service.ts` | `_shared/ai_service.ts` `chatClaude()` |
| Kworb | SIM | Chart BR diário → benchmarks | Só se benchmarks deixarem de existir | Spotify Charts (bloqueado); sem alternativa free |
| Apify | PARCIAL — deprecado | `enrich-playlists` (tracks) | SIM quando Phase 1 ligado | Observer bot da VPS |
| VPS Bot | SIM (crítico) | Coleta, prints, heartbeat, queue | NÃO | — |
| Supabase Storage | SIM | Prints, capas, XLSX, falhas observer | NÃO | — |
| SMTP / Lovable email | SIM | Transacional, OTP | NÃO | — |
| Webhook / Slack | SIM (se configurado) | Alertas ops | NÃO se configurado | — |
| `ops-agent-poll` | Stub morto (204) | nenhuma | SIM (stub ou delete) | — |

---

## ITEM 7 — Matriz oficial

| Domínio | Fonte Oficial | Consumidores | Fonte Legada | Status |
|---|---|---|---|---|
| Streams / plays | VPS Bot → `bot-ingest-snapshot` / `bot-ingest-song-snapshot` → `campaign_playlist_collections` | `useDealTodayPlaylistBreakdown`, `CampanhaExecucao` | XLSX, `bot-ingest-dom` | dual (VPS primário) |
| plays_7d | VPS (windowed) | `campaign_playlist_collections.plays_7d` | Campo `plays` (assumido 7d) | canônico |
| plays_24h | VPS (windowed) | `organic_plays_snapshots` | `plays` fallback | dual |
| Playlist followers | Spotify API (`enrich-playlists` / `enrich-curator-playlists-spotify`) | `search_results`, `curator_playlists`, `managed_playlists` | VPS em `organic_plays_snapshots.followers` | dual |
| Playlist name | Spotify API | `curator_playlists.playlist_name`, `managed_playlists.name` | XLSX cru, VPS DOM | dual |
| Playlist URL / spotify_id | User input / Spotify API (create) | `curator_playlists`, `managed_playlists`, `campaign_playlist_collections` | — | canônico |
| Track position | VPS observer bot → `observer-ingest-tracks` | `observed_playlist_tracks` | Spotify API `snapshot-playlist-tracks` | dual |
| Curator name | Spotify API (`owner.display_name`) | `curator_playlists.playlist_name` | XLSX match por nome | dual |
| Curator contato | DB (`curators`) | `useCuratorLibrary` etc | — | canônico |
| Track title / artist / isrc | XLSX (campanhas) | `label_spreadsheet_rows`, `songs` | Spotify API enrich | dual |
| Track cover | Spotify API | `raw_chart_daily.cover_url`, `managed_playlists.imagem_url` | — | canônico |
| Track ISRC | XLSX | `songs.isrc` | — | canônico |
| Delivery acumulado | DB function `fn_campaign_delivery_accumulated` | `useDeliveryStatus`, views de delivery | — | canônico |
| Chart BR Top 200 | Kworb → `raw_chart_daily` | `sync-spotify-editorial-charts`, benchmarks | Spotify editorial (bloqueado nov/2024) | canônico (Kworb only) |
| Conteúdo IA | Lovable Gateway / Anthropic | consumidores de `ai_service.ts` | 2 chamadas Anthropic diretas | dual |

---

## ITEM 8 — Diagrama de fluxo

Versão Mermaid no arquivo separado `docs/audits/DATA_FLOW_DIAGRAM.mmd`.

Versão ASCII:

```text
┌─────────────────────────────────────────────────────────────────┐
│                       FRONTEND (React/Vite)                      │
│  useDeliveryStatus  useCockpitQueries  useDealTodayPlaylistBreakdown │
│  CampanhaExecucao   CuratorDeals       SpotifyAppsManager        │
└──────────────┬───────────────────────────┬──────────────────────┘
               │ supabase-js .from()/.rpc()│ fetch() direto
               ▼                           ▼
┌──────────────────────────┐  ┌────────────────────────────────────┐
│  Supabase PostgREST /    │  │  Edge Functions                    │
│  Views / RPC             │  │  spotify-auth / spotify-public-auth │
│  fn_campaign_delivery_   │  │  import-label-spreadsheet           │
│  accumulated             │  │  diagnose-managed-playlist          │
│  curator_deal_delivery_  │  │  enrich-playlists (DEPRECATED)      │
│  status                  │  │  enrich-curator-playlists-spotify   │
└──────────┬───────────────┘  │  sync-kworb-charts                  │
           │                  │  bot-collect-queue ◄──────────────┐ │
           │                  │  bot-ingest-snapshot ◄─────────┐  │ │
           │                  │  bot-ingest-song-snapshot ◄────┐│  │ │
           │                  │  observer-pull-queue ◄─────────┼┼──┼┐│
           │                  │  observer-ingest-tracks ◄──────┘│  │││
           │                  │  bot-heartbeat ◄────────────────┘  │││
           │                  │  bot-upload-print ◄────────────────┘││
           │                  └─────────┬──────────────────────────┘ │
           │                            │                            │
           │     ┌──────────────────────┼──────────────────┐         │
           ▼     ▼                      ▼                  ▼         │
┌──────────────┐ ┌────────────┐ ┌─────────────┐ ┌───────────────┐  │
│  Supabase DB │ │ Spotify    │ │ Lovable AI  │ │  Kworb.net    │  │
│  (Postgres)  │ │ Web API    │ │ Gateway /   │ │  (scraping)   │  │
│              │ │            │ │ Anthropic   │ └───────────────┘  │
│ campaign_pl* │ │ /v1/...    │ │             │                    │
│ organic_*    │ │ accounts/  │ │ ai.gateway. │ ┌───────────────┐  │
│ curator_*    │ │  api/token │ │ lovable.dev │ │   Apify       │  │
│ managed_*    │ └────────────┘ │             │ │(DEPRECATED -  │  │
│ search_*     │                │ api.anthrop.│ │ circuit-broken│  │
│ label_*      │                │  com        │ └───────────────┘  │
│ raw_chart_*  │                └─────────────┘                     │
│ deprecation_*│                                                    │
│ vps_nodes    │  ┌─────────────────────────────────────────────────│
└──────────────┘  │   VPS (nexengine-scheduler / nexengine-bot /    │
                  │        observer-bot)                            │
                  │                                                 │
                  │   Browserless (Playwright) ───────────────►    │
                  │   spotifyDealCollect.js                         │
                  │   Observer bot scraper                          │
                  │   PM2 nexengine-scheduler                       │
                  └──────┬──────────────────────────────────────────┘
                         │ push → edge functions
                         │ (BOT_API_KEY + BOT_INGEST_TOKEN)
                         └──── volta para Edge Functions acima
```
