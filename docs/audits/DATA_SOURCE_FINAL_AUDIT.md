# DATA SOURCE — AUDITORIA FINAL

**Fase:** 6.A.2 · 2026-06-17 · **Read-only.** Nenhum código ou integração alterada.

Esta auditoria consolida a fonte oficial de cada dado da NexEngine, com base em:
- código (`grep` em `src/` e `supabase/functions/`)
- `spotify_call_log` (últimos 14d, ~38.4k calls)
- `deprecation_hits` (últimos 30d)
- `bot_ingest_raw`, `bot_heartbeats`, `bot_events` (últimos 7d)
- `spotify_tokens`, `spotify_user_tokens`

---

## ITEM 1 — Auditoria das leituras de campos

| Campo | Tabela canônica | Origem do dado | Edge function produtora | RPC/View | Frontend principal |
|---|---|---|---|---|---|
| **followers_count** | `playlists`, `curator_playlists`, `search_results.seguidores`, `clients.followers_count` | **Spotify API** (`/v1/playlists/:id?fields=followers.total`, `/v1/artists/:id`) | `enrich-curator-playlists-spotify`, `enrich-playlist-covers`, `enrich-client-spotify`, `recheck-archived-followers`, `register-curator-playlist`, `spotify-enrichment-worker` | view `v_playlist_followers`, `playlist_followers_snapshots` | `Performance.tsx`, `Operacao.tsx`, `useEcoRealCapacity`, `MinhasPlaylists` |
| **playlist_name** | `playlists.name`, `curator_playlists.name`, `managed_playlists.name` | **Spotify API** (`/v1/playlists/:id?fields=name`); XLSX só se ID ausente | `enrich-curator-playlists-spotify`, `fetch-spotify-meta`, `import-managed-playlist`, `backfill-curator-playlist-meta`, `register-curator-playlist` | — | `MinhasPlaylists`, `CampanhaExecucao`, `Catalogo`, hooks de playlist |
| **playlist_image** | `playlists.image_url`, `curator_playlists.image_url` | **Spotify API** (`fields=images`) | `enrich-curator-playlists-spotify`, `enrich-playlist-covers`, `backfill-curator-playlist-meta` | — | `usePlaylistCovers`, listagens de playlists |
| **owner_name** | `playlists.owner_name`, `managed_playlists.owner_id` | **Spotify API** (`fields=owner.display_name,owner.id`) | `enrich-curator-playlists-spotify`, `discover-playlist-owners`, `import-account-playlists` | — | `MinhasPlaylists`, `useCuratorDeals` |
| **tracks_count** | `playlists.tracks_total`, `curator_playlists.tracks_count` | **Spotify API** (`fields=tracks.total`) | `backfill-playlist-tracks-count`, `enrich-playlist-covers` | — | tabelas de playlists |
| **artist_name** | `clients.artist_name`, `spotify_artist_cache.name`, `curator_deal_songs.song_artist` | **Spotify API** (`/v1/artists/:id`) + cache | `enrich-client-spotify`, `_shared/spotify-cache.getArtistCacheBatch` | — | `Clientes.tsx`, `TrackActionsPanel` |
| **artist_image** | `clients.image_url`, `spotify_artist_cache.images` | **Spotify API** (`/v1/artists/:id`) | `enrich-client-spotify` | — | perfil de cliente |
| **album_image** | `spotify_track_cache.album_images` | **Spotify API** (`/v1/tracks/:id`) | `_shared/spotify-cache.getTrackCacheBatch`, `resolve-catalog-track` | — | `TrackActionsPanel`, listagens de músicas |
| **track_metadata** (nome, duração, artistas) | `spotify_track_cache`, `catalog_tracks` | **Spotify API** (`/v1/tracks/:id`); VPS descobre o ID | `resolve-catalog-track`, `spotify-enrichment-worker`, `_shared/spotify-cache` | view `v_catalog_tracks_enriched` | `Catalogo.tsx`, `CampanhaExecucao` |
| **playlist_metadata** (genre, mood, descrição) | `playlist_genres`, `playlists.description`, `genre_filters` | Derivado interno (não vem do Spotify) | `analyze-genre`, `diagnose-managed-playlist` | RPC `fn_playlist_match_score` | `Operacao.tsx`, hooks de brain |

> **Streams / plays** não estão na lista porque não são lidos do Spotify — vêm exclusivamente do VPS (ver item 5).

---

## ITEM 2 — Duplicidades reais

Comparando Spotify API × VPS × Banco, somente 2 campos têm fontes sobrepostas:

| Campo | Fonte A | Fonte B | Onde ocorre | Conflito real? |
|---|---|---|---|---|
| **Followers de playlist** | Spotify API → `playlists.followers_count` (`followers_source='spotify_api'`) | VPS DOM → `playlist_followers_snapshots` (valor exibido, arredondado >1k) | `bot-ingest-snapshot` grava ambos | **Sim** quando UI lê snapshot bruto sem filtrar `followers_source='spotify_api'`. |
| **Playlist name / image** | Spotify API (canônico) | XLSX upload bruto (texto livre) | `import-label-spreadsheet` deixa o texto cru se faltar `spotify_playlist_id` | **Sim transiente** até `enrich-curator-playlists-spotify` rodar inline (que é o caminho default). |

Nenhuma outra duplicação foi detectada. Streams, OAuth, tracks/items, charts e search têm **fonte única**.

---

## ITEM 3 — Auditoria de `enrich-playlists`

| Pergunta | Resposta | Evidência |
|---|---|---|
| Executou nos últimos 30 dias? | **Não** efetivamente. `spotify_call_log` mostra 0 hits Spotify nos últimos 30 dias. | `SELECT * FROM spotify_call_log WHERE function_name='enrich-playlists' AND created_at > now()-interval '30 days'` → 0 linhas |
| Foi chamada (gate bloqueou)? | **Sim, 436 vezes** — bloqueada pelo gate. | `deprecation_hits`: `enrich-playlists` `cron`=434 (último 2026-05-29 20:00), `ui`=2 (último 2026-05-28) |
| Quem chama? (estático) | `collect-batch/index.ts:169`, `brain-run/index.ts:289,743,952` | `rg "enrich-playlists" supabase/functions` |
| Existe cron? | **Sim**, registrado nas migrations (`20260516202212`, `20260519014236`). Histórico mostra cron disparando até 2026-05-29; depois ficou silencioso (gate bloqueia). | `deprecation_hits.source='cron'` parou em 2026-05-29 |
| Existe frontend? | **Não direto.** Última call UI: 2026-05-28 (2 hits no gate). | `deprecation_hits.source='ui'` |
| Existe webhook? | Não. | `rg -n "enrich-playlists" supabase/functions src` não mostra webhook |
| Dependência ativa? | **Indireta** — `collect-batch` e `brain-run` ainda fazem `callFn("enrich-playlists", ...)`, mas ambas estão protegidas: gate retorna 410 e o caller continua. | `collect-batch/index.ts:19` (`skip_enrich`), `brain-run` ignora resposta |
| `deprecationGate` ainda pode executar? | **Sim, se** `DEPRECATED_PHASE1_ENABLED=true`. Hoje a flag está **off** → gate retorna 410. | `_shared/_deprecation.ts:55` lê env `DEPRECATED_PHASE1_ENABLED` |

**Conclusão:** `enrich-playlists` está **funcionalmente morta há 19 dias**. Pode ser removida após confirmar que `collect-batch.skip_enrich` é seguro em produção (já é o default em chamadas atuais).

---

## ITEM 4 — Auditoria por endpoint Spotify (7d reais)

| Endpoint | Calls/7d | Quem chama (top) | Para quê | Pode remover? | Substituível por VPS? | Deve continuar? |
|---|---:|---|---|---|---|---|
| `/v1/playlists/:id/items` | 27.570 | `process-catalog-placements`, `revalidate-deliveries`, `snapshot-playlist-tracks`, `sync-managed-playlist-tracks`, `bot-execution-queue` | LIST/ADD/REMOVE/REORDER de faixas | **Não** | **Não** (VPS não escreve em playlist) | **SIM — crítico** |
| `/api/token` | 3.199 | `_shared/spotify.ts`, `spotify-token-watchdog`, `spotify-auth`, `spotify-public-auth` | OAuth (client credentials + refresh user) | Não | Não | **SIM — crítico** |
| `/v1/playlists/:id` | 2.358 | `refresh-search-results`, `enrich-curator-playlists-spotify`, `register-curator-playlist`, `enrich-playlist-covers`, `import-managed-playlist`, `recheck-archived-followers` | metadata (followers, owner, images, name) | Não | **Parcialmente** (VPS dá followers aproximados) | **SIM** |
| `/v1/tracks/:id` | 2.245 | `_shared/spotify-cache`, `resolve-catalog-track`, `diagnose-managed-playlist`, `bot-collect-queue` | track metadata (nome, álbum, artistas, duração) | Não | Não | **SIM** (com cache) |
| `/v1/artists/:id` | 1.663 | `enrich-client-spotify`, `_shared/spotify-cache`, `diagnose-managed-playlist` | artist metadata | Não | Não | **SIM** (com cache) |
| `/v1/search` | 709 | `run-search`, `expand-from-winners`, `genre-spotify-discover` | descoberta de playlists | `run-search` tem gate (mas ativo) | Não | **SIM** |
| `open.spotify.com/oembed` | 3 | `fetch-spotify-meta` | resolver URL pública sem token | Não | Não | **SIM (raro)** |
| `open.spotify.com/track/:id` | 2 | `fetch-spotify-meta` | scrape público de track | Não | Não | **SIM (raro)** |
| `/v1/playlists/:id/images` | 2 | `apply-managed-cover`, `apply-playlist-identity` | upload de capa | Não | Não | **SIM** |

Nenhum endpoint Spotify é candidato a remoção. Toda redundância está em **funções gated** (item 3), não em endpoints.

---

## ITEM 5 — Auditoria das chamadas VPS

A NexEngine **não chama o VPS**. O fluxo é reverso: o VPS chama edge functions assinando com `x-bot-key` / `x-bot-token`. Inventário (últimos 7d):

| Edge function | Payload | Resposta | Consumidores downstream | Volume 7d |
|---|---|---|---|---|
| `bot-heartbeat` | `{ hostname, status, session, metrics }` | `{ ok, next_poll_ms }` | `bot_heartbeats`, `vps_nodes.last_heartbeat_at` | **60.479 events** |
| `bot-event-ingest` | `{ event_type, payload, severity }` | `{ ok }` | `bot_events`, `system_alerts` | **8.198 events** |
| `bot-ingest-snapshot` | `{ song_id, deal_id, total_plays, snapshots:[{playlist_name, spotify_url, plays}], print_urls? }` | `{ ok, snapshot_id, deal_status }` | `curator_deal_snapshots`, `song_snapshot_playlists`, `delivery_proofs` | rastreado via raw |
| `bot-ingest-song-snapshot` | `{ song_id, total_plays, source, observed_at }` | `{ ok, snapshot_id }` | `song_snapshots` | 155 raw uploads |
| `bot-ingest-dom` | DOM cru de playlist | `{ ok, parsed }` | observer pipeline | sob demanda |
| `bot-upload-print` | multipart screenshot + meta | `{ ok, batch_id, url }` | `bot_print_batches`, dispara `extract-snapshot-from-print` | **1.010 raw uploads** |
| `bot-collect-queue` | `GET ?limit=N` (header x-bot-key) | fila de campanhas com `auto_collect=true` | usado pelo bot para saber o que coletar; raramente bate em Spotify (13 calls/14d, fallback de `artist_id`) | 13 fallbacks |
| `bot-execution-queue` | `GET ?limit=N` | fila de ações a executar em playlists | bot aplica via `_shared/spotify-playlist.ts` | 277 calls/14d |
| `bot-execution-complete` | `{ job_id, status, result }` | `{ ok }` | `playlist_operation_log`, `playlist_operation_queue` | linkado ao queue |
| `observer-pull-queue` / `observer-ingest-tracks` / `observer-upload-failure` | observer-only payloads | — | `observer_runs`, `observer_playlist_tracks` | sob demanda |
| `import-label-spreadsheet` | XLSX upload | `{ ok, upload_id, rows }` | `label_spreadsheet_*`, dispara `enrich-curator-playlists-spotify` inline | 6 raw uploads/7d |

**Auth:** `x-bot-key` ou `x-bot-token` (env `BOT_API_KEY` / `BOT_INGEST_TOKEN`). Todos os edges checam via `isAuthorizedBot(req)`. Nenhum edge VPS exige JWT.

---

## ITEM 6 — Matriz oficial

| Campo | Fonte Oficial | Fonte Secundária | Consumidores | Status |
|---|---|---|---|---|
| **Streams (diários 24h)** | VPS → `label_spreadsheet_rows.plays_7d` / `song_snapshots.total_plays` | — | `fn_campaign_delivery_accumulated`, `CampanhaExecucao`, `Performance` | ✅ OK |
| **Followers (playlist)** | Spotify API → `playlists.followers_count` (com `followers_source='spotify_api'`) | VPS DOM → `playlist_followers_snapshots` (observacional) | `Operacao`, `useEcoRealCapacity`, `useEcosystemCapacity` | ⚠ filtrar sempre por `followers_source` |
| **Playlist Position** | Spotify API → `managed_playlist_tracks.position`, `observer_playlist_tracks.position` | — | `MinhasPlaylists`, brain | ✅ OK |
| **Playlist Name** | Spotify API → `playlists.name`, `curator_playlists.name` | XLSX bruto (transiente até enrich) | `MinhasPlaylists`, `CampanhaExecucao`, `Catalogo` | ⚠ depende do enrich inline |
| **Playlist URL** | Derivada de `spotify_playlist_id` (`https://open.spotify.com/playlist/<id>`) | XLSX | listagens, UI de share | ✅ OK |
| **Playlist Image** | Spotify API → `playlists.image_url`, `curator_playlists.image_url` | — | `usePlaylistCovers`, listagens | ✅ OK |
| **Playlist Followers** | (mesmo que "Followers" acima) | — | — | ⚠ |
| **Playlist Tracks (items)** | Spotify API → `managed_playlist_tracks`, `playlist_track_snapshots` | — | `TrackActionsPanel`, `useTrackPresence`, `revalidate-deliveries` | ✅ OK |
| **Track Metadata** | Spotify API → `spotify_track_cache`, `catalog_tracks` | — | `Catalogo`, `CampanhaExecucao` | ✅ OK |
| **Artist Metadata** | Spotify API → `spotify_artist_cache`, `clients.*` | — | `Clientes`, `TrackActionsPanel` | ✅ OK |
| **Delivery (acumulado da campanha)** | RPC `fn_campaign_delivery_accumulated` (cima dos snapshots do VPS) | — | `CampanhaExecucao`, `Performance`, `useCampaignDelivery` | ✅ OK (após Fase 5.B.3) |
| **Curadores** (catálogo) | `curators` (deals reais) + `external_curators` (CRM/leads) | — | `Prospecao.tsx` (2 abas: Ativos · Prospecção) | ✅ OK — **não unificar** |

---

## ITEM 7 — Consumidores lendo a fonte errada

| Arquivo | Linha | Problema | Impacto |
|---|---|---|---|
| Componentes que lêem `playlist_followers_snapshots` diretamente sem checar `followers_source` | (vários, ver `rg "playlist_followers_snapshots" src/`) | mistura valor VPS (DOM, arredondado) com valor Spotify API (fiel) | Pequenas inconsistências (±centenas) na UI de capacidade |
| `import-label-spreadsheet` deixa `name` cru se faltar `spotify_playlist_id` | `supabase/functions/import-label-spreadsheet/index.ts` (lógica de fallback) | nome incorreto até o enrich rodar | Transiente — `enrich-curator-playlists-spotify` é chamado inline |
| `bot-collect-queue` resolve `spotify_artist_id` **inline com Spotify API** | `supabase/functions/bot-collect-queue/index.ts:19, 451` | acopla a fila do bot ao breaker do Spotify (raro: 13/14d) | Baixo — funciona, mas ideal mover pro `spotify-enrichment-worker` |
| `brain-run` ainda chama `enrich-playlists` (gated) em 3 sites | `supabase/functions/brain-run/index.ts:289,743,952` | 410 silencioso | Zero hoje (gate); precisa limpeza eventual |
| `collect-batch` ainda chama `enrich-playlists` | `supabase/functions/collect-batch/index.ts:169` | 410 silencioso | Zero (gate) |

Nenhum consumidor está produzindo **dados errados em produção**. Os pontos acima são dívida técnica, não bugs ativos.

---

## ITEM 8 — Respostas objetivas

| Pergunta | Resposta | Evidência |
|---|---|---|
| Existe chamada duplicada ao Spotify? | **Não.** O endpoint `/v1/playlists/:id` é chamado por 6 funções diferentes, mas cada uma em contexto distinto (enrich vs refresh vs register vs backfill). Caches L1 (`spotify_track_cache`, `spotify_artist_cache`, `spotify_playlist_cache`) absorvem repetição. | `spotify_call_log` 7d |
| Existe dado vindo simultaneamente do VPS e Spotify? | **Sim, 1 campo: followers de playlist.** VPS escreve em `playlist_followers_snapshots` (DOM), Spotify escreve em `playlists.followers_count` com `followers_source='spotify_api'`. Pipelines independentes, escrevem em colunas distintas. | item 2 |
| Existe integração legada ainda ativa? | **Sim, atrás do gate:** `enrich-playlists`, `fetch-tracks-spotify`, `create-spotify-playlist`, `run-search`. Todas gated; só `run-search` tem hits Spotify reais. Tabela `spotify_tokens` (10 linhas, último update 2026-06-18 00:30) ainda recebe escritas — não é dead. | `deprecation_hits`, `spotify_tokens` |
| Existe função depreciada ainda executando? | **`run-search` sim** (1.478 calls Spotify em 14d, 908 hits no gate em 30d — gate é informativo, executa). **`enrich-playlists` não** — 0 calls Spotify em 30d, 436 hits bloqueados pelo gate. **`fetch-tracks-spotify`** roda esporadicamente via UI (16 calls/14d). | `spotify_call_log` + `deprecation_hits` |
| Existe inconsistência entre Banco / VPS / Spotify? | **Apenas a já conhecida:** followers de playlist (Spotify exato vs VPS DOM arredondado). Nenhuma outra inconsistência sistêmica detectada. | item 2, item 6 |

---

## Resumo executivo

- **Fontes oficiais definidas para 12 campos.** Toda decisão futura deve respeitar esta matriz.
- **1 duplicação real** (followers de playlist) — solução é a UI sempre filtrar por `followers_source='spotify_api'` ao ler `playlists.followers_count`.
- **`enrich-playlists` está clinicamente morta há 19 dias** (gate bloqueando 100% das chamadas). Apta a remoção em fase 6.B.
- **Nenhuma chamada duplicada Spotify→Spotify**, nenhum endpoint candidato a remoção.
- **VPS não é chamado pela NexEngine.** Fluxo é sempre VPS→edge (assinatura `x-bot-key`).
- **Tabela legada `spotify_tokens`** ainda viva — coexiste com `spotify_user_tokens` e cache em `spotify_apps`. Não é órfã; recebe escrita ativa de `_shared/spotify.ts` (cache de app-only token).

**Nenhuma alteração foi feita. Auditoria concluída.**
