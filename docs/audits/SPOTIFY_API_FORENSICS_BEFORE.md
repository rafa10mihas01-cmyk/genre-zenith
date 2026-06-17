# SPOTIFY API — FORENSICS BEFORE

**Fase:** 6.A.1 · **Data:** 2026-06-17 · **Modo:** somente leitura · **Nada alterado.**

Esta auditoria mapeia 100% das chamadas à infraestrutura Spotify (Web API, OAuth, Charts) feitas pela NexEngine. Os números reais vêm de `spotify_call_log` (últimos 7–14 dias).

---

## 1. Camada de acesso

Todo tráfego HTTP para Spotify passa (ou deveria passar) por dois pontos:

| Arquivo | Papel |
|---|---|
| `supabase/functions/_shared/spotify.ts` | Auth multi-app (Client Credentials + OAuth user), monkey-patch de `fetch`, circuit breaker (`spotify_circuit_breaker`), refresh token automático. |
| `supabase/functions/_shared/spotify-client.ts` | Shim instrumentado em cima do anterior. Loga toda chamada em `spotify_call_log` (function_name, endpoint, http_status, duration, retries, breaker). |
| `supabase/functions/_shared/spotify-playlist.ts` | Helpers canônicos pra `/playlists/{id}/items` (list/add/remove/reorder/replace). Regra de ouro: nenhum edge novo pode chamar `/tracks` direto. |
| `supabase/functions/_shared/spotify-cache.ts` | Cache de `tracks/:id` e `artists/:id` em `spotify_track_cache` / `spotify_artist_cache`. |

OAuth público (login com Spotify) usa `src/lib/spotifyPublicAuth.ts` → edge `spotify-public-auth`.

---

## 2. Inventário de chamadas (estático — grep em `supabase/functions` + `src`)

43 arquivos contêm referência a `api.spotify.com` / `accounts.spotify.com`. Endpoints únicos detectados:

| Endpoint base | Ocorrências (grep) |
|---|---|
| `/v1/playlists/{id}` (+/items, /images) | 93 |
| `/v1/me/playlists` | 18 |
| `/v1/me` | 13 |
| `/v1/tracks/{id}` | 8 |
| `/v1/search` | 7 |
| `/v1/artists/{id}` | 4 |
| `/v1/users/{id}` | 3 |
| `/v1/tracks` (batch) | 2 |
| `/v1/artists` (batch) | 1 |

---

## 3. Inventário por arquivo · função · endpoint · motivo

### 3.1 OAuth / Auth / Token management

| Arquivo | Função | Endpoint | Motivo |
|---|---|---|---|
| `supabase/functions/spotify-auth/index.ts` | OAuth interno multi-app | `accounts.spotify.com/authorize`, `/api/token` | Conecta contas do time aos apps internos. |
| `supabase/functions/spotify-public-auth/index.ts` | OAuth público (login site) | `accounts.spotify.com/authorize`, `/api/token`, `/v1/me` | Login via Spotify na landing. |
| `supabase/functions/spotify-token-watchdog/index.ts` | refresh proativo | `/api/token` | Cron mantém `spotify_user_tokens` vivos. **Ativo (5.961 calls/14d).** |
| `supabase/functions/spotify-reauth-verify/index.ts` | verifica conta | `/v1/me` | Sanity check pós-OAuth. |
| `supabase/functions/spotify-invite/index.ts` | tokens de convite | n/a (DB only) | Whitelist de e-mails. |
| `supabase/functions/_shared/spotify.ts` | `getSpotifyToken` / `getUserAccessToken` | `/api/token` | Camada central — toda chamada autenticada passa aqui. |
| `src/lib/spotifyPublicAuth.ts` | front-end handler | `functions/v1/spotify-public-auth` | Inicia popup OAuth. |

### 3.2 Playlists gerenciadas (Mãe / Filha) — escrita

| Arquivo | Endpoint | Motivo |
|---|---|---|
| `supabase/functions/_shared/spotify-playlist.ts` | `GET/POST/PUT/DELETE /v1/playlists/{id}/items` | Helpers canônicos. **27.570 calls/7d — endpoint mais usado.** |
| `supabase/functions/create-spotify-playlist/index.ts` | `POST /v1/users/{id}/playlists` | Cria playlist nova. `deprecationGate`. |
| `supabase/functions/apply-managed-cover/index.ts` | `PUT /v1/playlists/{id}/images` | Sobe capa gerada. |
| `supabase/functions/apply-playlist-identity/index.ts` | `PUT /v1/playlists/{id}` + `/images` | Atualiza nome/desc/capa. |
| `supabase/functions/sync-managed-playlists/index.ts` | `GET /v1/me/playlists` | Lê inventário do dono. **1.829/14d.** |
| `supabase/functions/sync-managed-playlist-tracks/index.ts` | `GET /v1/playlists/{id}/items` | Espelha tracks reais. **2.977/14d.** |
| `supabase/functions/import-account-playlists/index.ts` | `GET /v1/me/playlists` | Import inicial pós-OAuth. |
| `supabase/functions/import-managed-playlist/index.ts` | `GET /v1/playlists/{id}` | Importa 1 playlist por URL. |
| `supabase/functions/auto-adjust-playlists/index.ts` | helpers (add/remove) | Ajustes do brain executor. |
| `supabase/functions/playlist-tracks-list/index.ts` | `GET /v1/playlists/{id}/items` | Lista direto pra UI (cockpit). |

### 3.3 Distribuição / catálogo / placements

| Arquivo | Endpoint | Motivo |
|---|---|---|
| `supabase/functions/process-catalog-placements/index.ts` | `POST/DELETE /v1/playlists/{id}/items` | Worker que aplica placements em lote. **20.292 calls/7d — campeão.** |
| `supabase/functions/distribute-catalog-track/index.ts` | add tracks | Distribuição por gênero. |
| `supabase/functions/resolve-catalog-track/index.ts` | `GET /v1/tracks/{id}` | Resolve URI → spotify_track_id. |
| `supabase/functions/snapshot-playlist-tracks/index.ts` | `GET /v1/playlists/{id}/items` | Snapshot de tracks (espelho). **10.627/14d.** |

### 3.4 Enriquecimento / metadados

| Arquivo | Endpoint | Motivo |
|---|---|---|
| `supabase/functions/enrich-playlists/index.ts` | `GET /v1/playlists/{id}` (fields=followers,images,owner) | Followers reais + Apify pra tracks. **`deprecationGate` ativo.** |
| `supabase/functions/enrich-curator-playlists-spotify/index.ts` | `GET /v1/playlists/{id}?fields=...` | Capa/nome/seguidores de playlists de curadores. **174/14d.** |
| `supabase/functions/enrich-client-spotify/index.ts` | `/v1/artists/{id}` | Followers / imagem de artista cliente. |
| `supabase/functions/enrich-playlist-covers/index.ts` | `/v1/playlists/{id}?fields=images` | Backfill de capas faltantes. |
| `supabase/functions/spotify-enrichment-worker/index.ts` | fila `spotify_enrichment_queue` → vários | Worker genérico. **3.888/14d.** |
| `supabase/functions/backfill-curator-playlist-meta/index.ts` | `/v1/playlists/{id}` | Backfill metadata. |
| `supabase/functions/backfill-playlist-tracks-count/index.ts` | `/v1/playlists/{id}?fields=tracks.total` | Conta tracks. |
| `supabase/functions/fetch-spotify-meta/index.ts` | `/v1/playlists/{id}` + oembed | Resolve URL → metadata. |
| `supabase/functions/recheck-archived-followers/index.ts` | `/v1/playlists/{id}` | Re-valida arquivadas. |
| `supabase/functions/register-curator-playlist/index.ts` | `/v1/playlists/{id}` | Cadastro inicial. **538/14d.** |

### 3.5 Search / descoberta

| Arquivo | Endpoint | Motivo |
|---|---|---|
| `supabase/functions/run-search/index.ts` | `GET /v1/search?type=playlist` | Buscador editorial. **1.478/14d. `deprecationGate` ativo.** |
| `supabase/functions/refresh-search-results/index.ts` | `/v1/playlists/{id}` | Revalida resultados de search. **4.284/14d.** |
| `supabase/functions/expand-from-winners/index.ts` | `/v1/search` | Expansão automática. **2.150/14d. `deprecationGate`-adjacent.** |
| `supabase/functions/genre-spotify-discover/index.ts` | `/v1/search` | Discovery por gênero. |
| `supabase/functions/discover-playlist-owners/index.ts` | `/v1/playlists/{id}?fields=owner` | Mapeia donos. |
| `supabase/functions/fetch-tracks-spotify/index.ts` | `/v1/tracks/{id}` (batch) | Metadata em lote. **`deprecationGate`. 16/14d.** |

### 3.6 Diagnóstico / brain / curadoria

| Arquivo | Endpoint | Motivo |
|---|---|---|
| `supabase/functions/diagnose-managed-playlist/index.ts` | `/v1/tracks/{id}`, `/v1/artists/{id}` | Brain ranking. **783/14d.** |
| `supabase/functions/revalidate-deliveries/index.ts` | `/v1/playlists/{id}/items` | Verifica se música ainda está dentro. **8.762/14d.** |
| `supabase/functions/_shared/spotify-cache.ts` | `getTrackCacheBatch`, `getArtistCacheBatch` | Cache pra evitar refetch. |

### 3.7 Bot / VPS bridge

| Arquivo | Endpoint | Motivo |
|---|---|---|
| `supabase/functions/bot-collect-queue/index.ts` | `GET /v1/tracks/{id}` (l.20, l.451) | **Resolve `spotify_artist_id` ausente do cliente.** Fallback raro — 13 calls em 14d. |
| `supabase/functions/bot-execution-queue/index.ts` | helpers de playlist | Aplica ações pendentes. **277/14d.** |

### 3.8 Auditoria / homologação (não-produção)

`spotify-app01-audit`, `spotify-app01-multiowner`, `spotify-items-audit`, `spotify-items-matrix`, `spotify-fields-probe`, `spotify-me-playlist-test`, `spotify-resolution-test`, `spotify-tracks-compare`, `spotify-tracks-forensics`, `spotify-pipeline-audit`, `app-homologation-test`, `validate-fallback` — ferramentas internas, sem cron, executadas só sob demanda.

### 3.9 Charts editoriais

| Arquivo | Endpoint | Motivo |
|---|---|---|
| `supabase/functions/sync-spotify-editorial-charts/index.ts` | `charts.spotify.com` (scraping) | Sync de paradas. **Tem entrada própria em `config.toml`** (única `[functions.*]` no arquivo). |

---

## 4. Dado a dado: necessidade vs. duplicação

| Endpoint chamado | Dado buscado | Já existe no banco? | Já chega pelo VPS? | Necessária? |
|---|---|---|---|---|
| `/v1/playlists/{id}/items` (LIST) | tracks reais da playlist | parcial (`managed_playlist_tracks`, `observer_playlist_tracks`) | **não** (VPS faz screenshot, não lê items) | **SIM** — só Spotify entrega URI verdadeiro. |
| `/v1/playlists/{id}/items` (ADD/PUT/DELETE) | mutação | escreve | n/a | **SIM** — única forma de executar. |
| `/v1/playlists/{id}?fields=followers,images,owner,name` | meta + followers reais | `playlists.followers_count`, `image_url` | **parcialmente** — VPS captura followers via DOM, mas é número exibido (arredondado >1k). | **SIM** pro número fiel; redundante com VPS pra valores aproximados. |
| `/v1/me/playlists` | inventário do dono | `managed_playlists` | não | **SIM** — único pra listar tudo do owner. |
| `/v1/tracks/{id}` | nome/duração/artistas | `spotify_track_cache`, `catalog_tracks` | parcial (VPS conhece spotify_track_id após screenshot) | **SIM** quando cache miss; cache mata 90%+. |
| `/v1/artists/{id}` | nome/imagem/followers de artista | `spotify_artist_cache`, `clients.spotify_artist_id` | não | **SIM** quando cache miss. |
| `/v1/search` | descoberta de playlists | n/a (resultado vai pra `search_results`) | não | **SIM** — VPS não faz busca. |
| `/v1/playlists/{id}/images` | upload de capa | escreve | n/a | **SIM**. |
| `/api/token` | refresh OAuth | `spotify_user_tokens` | não | **SIM**. |
| `charts.spotify.com` | paradas editoriais | `raw_chart_daily` | não | **SIM**. |
| `open.spotify.com/oembed` | resolver URL pública sem token | n/a | não | **SIM** — usado só no resolver de URL. |

---

## 5. Auditoria pontual (Item 3)

| Função | Ainda executa? | Chamada por | Última utilização | Pode remover? | Substituível por |
|---|---|---|---|---|---|
| `spotify-auth` | **SIM** | `src/pages/Settings.tsx`, `SpotifyAppsManager.tsx` | UI ativa | **Não** — gerencia apps multi-owner | — |
| `spotify-public-auth` | **SIM** | `src/lib/spotifyPublicAuth.ts` (landing) | em produção | **Não** — login OAuth público | — |
| `diagnose-managed-playlist` | **SIM** | `usePlaylistBrain`, `TrackActionsPanel`, `MinhasPlaylists`, `useDiagnosisActions`, `evaluate-plan-snapshots` | 2026-06-09 (783/14d) | **Não** — coração do brain executor | — |
| `enrich-playlists` (**DEPRECATED**) | **Sim**, mas atrás de `deprecationGate` | `collect-batch`, `brain-run` (3 sites) | gate libera só se `DEPRECATED_PHASE1_ENABLED` | **Sim, candidato** após validar zero hits em `deprecation_hits` por 7d | `enrich-curator-playlists-spotify` + `enrich-playlist-covers` cobrem a maior parte |
| `enrich-curator-playlists-spotify` | **SIM** | `import-label-spreadsheet` (inline) + curl backfill | 2026-06-09 (174/14d) | **Não** | — |
| `bot-collect-queue` | **SIM** (raro) | `BaselineAwaitingBanner.tsx` (cliente) | 2026-06-14 (13/14d) | **Não, mas avaliar mover** chamada Spotify pra fallback noturno | resolução de `artist_id` poderia rodar no `spotify-enrichment-worker` |

---

## 6. Duplicações VPS × Spotify API

**Sim, existem dois pontos de sobreposição:**

| Dado | Fonte VPS | Fonte Spotify | Impacto | Recomendação |
|---|---|---|---|---|
| **Followers de playlist** | `bot-ingest-snapshot` → `playlist_followers_snapshots` (valor do DOM, arredondado >1k) | `enrich-playlists` / `enrich-curator-playlists-spotify` (fiel) | Dois números diferentes coexistem; UI mistura. | Definir Spotify API como oficial pra followers (`playlists.followers_source = 'spotify_api'`), VPS como observacional. |
| **Plays diárias (24h)** | VPS (campo `streams` da label spreadsheet → `last_24h`) | n/a | sem sobreposição | manter VPS. |
| **Playlist name / image** | XLSX importer (`import-label-spreadsheet`) deixa texto cru se Spotify ID faltar | `enrich-curator-playlists-spotify` corrige depois | UI mostra nome cru até backfill. | Sempre disparar `enrich-curator-playlists-spotify` inline (já é o caminho default). |
| **Tracks da playlist** | n/a (VPS não lê items) | `/v1/playlists/{id}/items` | sem duplicação | manter Spotify. |

Nenhuma chamada Spotify é feita simultaneamente com VPS no mesmo ciclo de coleta — são pipelines independentes que escrevem em colunas diferentes. O risco está na **leitura ambígua** no frontend, não no fetch duplicado.

---

## 7. Legado / morto

Ver `SPOTIFY_LEGACY_REPORT.md`.

---

## 8. Relatório final (Item 7)

| Métrica | Valor |
|---|---|
| Funções edge que tocam Spotify (estático) | **43 arquivos** |
| Funções com calls Spotify reais nos últimos 14d | **32** |
| Endpoints distintos chamados (7d) | **9** |
| Funções atrás de `deprecationGate` que ainda chamam Spotify | **enrich-playlists, fetch-tracks-spotify, run-search, create-spotify-playlist** (4) |
| Funções nunca executadas em 14d mas presentes | spotify-app01-multiowner, spotify-fields-probe, spotify-items-audit, spotify-items-matrix, spotify-me-playlist-test, spotify-resolution-test, spotify-tracks-compare, spotify-tracks-forensics, spotify-pipeline-audit, validate-fallback, app-homologation-test, spotify-app01-audit, spotify-reauth-verify, spotify-invite (auditoria/homologação) |
| Duplicações reais com VPS | **2** (followers de playlist; metadata cru de XLSX) |
| Fontes oficiais propostas | ver matriz |

**Total de calls Spotify reais (7d):** ~38.4k requests, das quais **72% = `/v1/playlists/{id}/items`** (process-catalog-placements + revalidate-deliveries + snapshot-playlist-tracks).

---

## Anexo — Top funções por volume (últimos 14d, `spotify_call_log`)

| function_name | calls | última |
|---|---:|---|
| process-catalog-placements | 20.292 | 2026-06-17 |
| snapshot-playlist-tracks | 10.627 | 2026-06-07 |
| revalidate-deliveries | 8.762 | 2026-06-16 |
| spotify-token-watchdog | 5.961 | 2026-06-17 |
| refresh-search-results | 4.284 | 2026-06-16 |
| spotify-enrichment-worker | 3.888 | 2026-06-17 |
| sync-managed-playlist-tracks | 2.977 | 2026-06-17 |
| expand-from-winners | 2.150 | 2026-06-10 |
| sync-managed-playlists | 1.829 | 2026-06-16 |
| run-search | 1.478 | 2026-06-15 |
| diagnose-managed-playlist | 783 | 2026-06-09 |
| engine-health | 711 | 2026-06-15 |
| register-curator-playlist | 538 | 2026-06-16 |
| bot-execution-queue | 277 | 2026-06-17 |
| import-account-playlists | 201 | 2026-06-06 |
| enrich-curator-playlists-spotify | 174 | 2026-06-09 |
| recheck-archived-followers | 103 | 2026-06-14 |
| link-managed-playlist-accounts | 79 | 2026-06-17 |
| playlist-tracks-list | 46 | 2026-06-15 |
| backfill-curator-playlist-meta | 45 | 2026-06-16 |
| resolve-catalog-track | 44 | 2026-06-17 |
| diag-observer-extract | 37 | 2026-06-15 |
| fetch-spotify-meta | 37 | 2026-06-15 |
| fetch-tracks-spotify | 16 | 2026-06-15 |
| bot-collect-queue | 13 | 2026-06-14 |
| apply-managed-cover | 11 | 2026-06-16 |
| apply-playlist-identity | 7 | 2026-06-07 |
| distribute-catalog-track | 6 | 2026-06-17 |
| import-managed-playlist | 1 | 2026-06-13 |

**Sem alterações foram feitas. Auditoria 100% read-only.**
