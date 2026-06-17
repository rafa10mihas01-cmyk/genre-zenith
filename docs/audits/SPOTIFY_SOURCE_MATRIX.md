# SPOTIFY — MATRIZ DE FONTES (FINAL)

**Fase:** 6.A.2 · Read-only.

Cada linha = 1 endpoint Spotify usado pela NexEngine. Resposta objetiva para: quem chama, com que frequência (últimos 7d em `spotify_call_log`), pra quê, e pode ser removido / substituído pelo VPS.

| Endpoint | Calls/7d | Top callers | Dado produzido | Tabela destino | Substituível por VPS? | Pode remover? | Veredito |
|---|---:|---|---|---|---|---|---|
| `POST /api/token` (accounts) | 3.199 | `_shared/spotify.ts` (`getSpotifyToken`), `spotify-token-watchdog`, `spotify-auth`, `spotify-public-auth` | OAuth tokens (app + user) | `spotify_tokens`, `spotify_user_tokens` | Não | Não | **MANTER (crítico)** |
| `GET /v1/playlists/:id/items` | 27.570 | `process-catalog-placements`, `revalidate-deliveries`, `snapshot-playlist-tracks`, `sync-managed-playlist-tracks`, `playlist-tracks-list`, `_shared/spotify-playlist.ts` | tracks reais da playlist (URIs em ordem) | `managed_playlist_tracks`, `playlist_track_snapshots`, `observer_playlist_tracks`, `delivery_proofs` | Não — VPS não lê items | Não | **MANTER (crítico)** |
| `POST/PUT/DELETE /v1/playlists/:id/items` | (incluído acima) | `process-catalog-placements`, `bot-execution-queue`, `auto-adjust-playlists`, `apply-managed-cover`, `_shared/spotify-playlist.ts` | mutação: add / remove / reorder | escreve em playlist real | Não | Não | **MANTER (crítico)** |
| `GET /v1/playlists/:id` (fields=name,followers,images,owner,tracks.total) | 2.358 | `refresh-search-results`, `enrich-curator-playlists-spotify`, `register-curator-playlist`, `enrich-playlist-covers`, `recheck-archived-followers`, `backfill-curator-playlist-meta`, `import-managed-playlist`, `fetch-spotify-meta` | name, image, owner, followers (exato), tracks_total | `playlists.*`, `curator_playlists.*`, `managed_playlists.*`, `playlist_followers_snapshots` | **Parcialmente** — VPS dá followers aproximado | Não | **MANTER (fonte oficial de metadata)** |
| `GET /v1/me/playlists` | 1.829 | `sync-managed-playlists`, `import-account-playlists`, `spotify-me-playlist-test` | inventário de playlists do owner OAuth | `managed_playlists` | Não | Não | **MANTER** |
| `GET /v1/me` | (incluído /api/token flow) | `spotify-public-auth`, `spotify-reauth-verify` | identidade do usuário OAuth | `spotify_accounts`, `spotify_user_tokens` | Não | Não | **MANTER** |
| `GET /v1/tracks/:id` | 2.245 | `_shared/spotify-cache` (`getTrackCacheBatch`), `resolve-catalog-track`, `diagnose-managed-playlist`, `bot-collect-queue` (fallback), `fetch-tracks-spotify` | nome, duração, álbum, artistas | `spotify_track_cache`, `catalog_tracks` | Não — VPS conhece o ID mas não a metadata | Não | **MANTER (com cache)** |
| `GET /v1/artists/:id` | 1.663 | `enrich-client-spotify`, `_shared/spotify-cache` (`getArtistCacheBatch`), `diagnose-managed-playlist` | nome, imagem, followers, gêneros | `spotify_artist_cache`, `clients.*` | Não | Não | **MANTER (com cache)** |
| `GET /v1/search` | 709 | `run-search` (gated), `expand-from-winners`, `genre-spotify-discover` | descoberta de playlists / tracks por keyword | `search_results`, `search_tracks` | Não | `run-search` candidato a substituição completa via cache de `search_results` no futuro | **MANTER** |
| `PUT /v1/playlists/:id/images` | 2 | `apply-managed-cover`, `apply-playlist-identity` | upload de capa nova | `managed_playlists.image_url` | Não | Não | **MANTER** |
| `PUT /v1/playlists/:id` (name/desc) | (incluído /v1/playlists/:id) | `apply-playlist-identity` | atualiza nome/descrição da playlist | `managed_playlists.*` | Não | Não | **MANTER** |
| `GET /v1/users/:id` | 3 (grep) | `discover-playlist-owners`, `spotify-public-auth` | perfil público de owner | `playlists.owner_*` | Não | Não | **MANTER** |
| `open.spotify.com/oembed` | 3 | `fetch-spotify-meta` | resolver URL pública sem token | — | Não | Não | **MANTER (raro)** |
| `open.spotify.com/track/:id` | 2 | `fetch-spotify-meta` | scrape público | — | Não | Não | **MANTER (raro)** |
| `charts.spotify.com` (scraping) | varia | `sync-spotify-editorial-charts` | paradas editoriais | `raw_chart_daily`, `editorial_history` | Não | Não | **MANTER** |

---

## Funções Spotify atrás de `deprecationGate`

| Função | Hits no gate (30d) | Calls reais (Spotify) 14d | Status |
|---|---:|---:|---|
| `run-search` | 957 (908 internal + 49 ui) | 1.478 | **Viva** — gate é informativo |
| `enrich-playlists` | 436 (434 cron + 2 ui) | **0** | **Morta há 19 dias** — candidata a remoção |
| `fetch-tracks-spotify` | 13 (ui) | 16 | **Vivinha** (uso manual) |
| `create-spotify-playlist` | 0 | 0 | **Adormecida** (UI manual sob demanda) |
| `analyze-genre` | 160 | 0 (não chama Spotify) | (sem dependência Spotify) |
| `analyze-genre-visual-dna` | 90 | 0 | (sem dependência Spotify) |
| `daily-collect` | 4 | 0 | (sem dependência Spotify) |

---

## Funções Spotify sem nenhuma call em 14d (homologação/diagnóstico)

`spotify-app01-audit`, `spotify-app01-multiowner`, `spotify-fields-probe`, `spotify-items-audit`, `spotify-items-matrix`, `spotify-me-playlist-test`, `spotify-resolution-test`, `spotify-tracks-compare`, `spotify-tracks-forensics`, `spotify-pipeline-audit`, `app-homologation-test`, `validate-fallback`, `spotify-invite`, `spotify-reauth-verify`. Todas zero custo ocioso (sem cron, sem caller frontend constante).

---

## Tokens / tabelas OAuth

| Tabela | Linhas | Última escrita | Status |
|---|---:|---|---|
| `spotify_tokens` (app-only) | 10 (1 por app + 1 legado `singleton_key='app'`) | 2026-06-18 00:30 | **Viva** — cache de Client Credentials |
| `spotify_user_tokens` | (multi-owner) | refresh contínuo via `spotify-token-watchdog` | **Viva** |
| `spotify_apps` | (multi-app) | gerenciado por `spotify-auth` | **Viva** |
| `spotify_oauth_states` | rotativa | CSRF do OAuth | **Viva** |

---

## Recomendações (NÃO executar nesta fase)

1. Remover `enrich-playlists` deploy + chamadas em `brain-run` e `collect-batch` após 30d sem hits úteis.
2. Mover resolução de `spotify_artist_id` de `bot-collect-queue` pro `spotify-enrichment-worker` (já tem fila + cache).
3. Considerar remover `spotify-resolution-test`, `spotify-tracks-compare`, `app-homologation-test`, `validate-fallback` (homologação encerrada).
4. UI: padronizar leitura de followers de playlist via `playlists.followers_count` filtrando `followers_source='spotify_api'`. Tratar `playlist_followers_snapshots` como série temporal **observacional**, nunca como valor exibido.
