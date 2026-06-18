# FASE 6.C.1 — AUDITORIA DA DOR ORIGINAL DO VPS OBSERVER

**Data:** 2026-06-18 · **Modo:** read-only · **Janela:** últimos 7 dias em `spotify_call_log`.

A dor original era: a Spotify API bloqueava (429/403) ao tentar obter **playlists de terceiros** e suas **tracks**. O VPS Observer foi criado para retirar essa responsabilidade da Spotify API. Esta auditoria valida se sobrou algum fluxo antigo.

---

## ITEM 1 — Chamadas Spotify originadas de diagnose/observer/descoberta/inteligência

Filtrado de `spotify_call_log` (7d) só nos endpoints `/v1/playlists/:id*`, `/v1/tracks/:id`, `/v1/artists/:id` e cruzado com o caller real:

| Função (caller) | Endpoint | Calls 7d | Motivo | Consumidor do dado |
|---|---|---:|---|---|
| `diagnose-managed-playlist` (single-path experimental, linhas 425-449) | `/v1/tracks/:id` | parte dos 2.036 abaixo (via fila) | Pega metadata de tracks da **playlist gerenciada** | `spotify_track_cache` |
| `diagnose-managed-playlist` | `/v1/artists/:id` | parte dos 1.623 abaixo (via fila) | Metadata de artistas da **playlist gerenciada** | `spotify_artist_cache` |
| `spotify-enrichment-worker` | `/v1/tracks/:id` | **2.036** | Consome `spotify_enrichment_queue`. 2.015/2.036 desses jobs têm `reason='diagnose_miss'` — disparados pelo diagnose-managed-playlist quando o cache de track expira | `spotify_track_cache` |
| `spotify-enrichment-worker` | `/v1/artists/:id` | **1.623** | Mesma fila. 1.533 são `reason='track_dep'` (artista do track recém-enriquecido) | `spotify_artist_cache` |
| `sync-managed-playlist-tracks` | `/v1/playlists/:id/items` | 2.005 | Snapshot oficial de tracklist das **playlists próprias** | `managed_playlist_tracks` |
| `sync-managed-playlists` | `/v1/playlists/:id` | 1.370 | Metadata (name/followers/image) das **playlists próprias** | `managed_playlists` |
| `process-catalog-placements` | `/v1/playlists/:id/items` | 20.235 | Validar/aplicar placements nas **playlists próprias** | `delivery_proofs` |
| `revalidate-deliveries` | `/v1/playlists/:id/items` | 4.210 | Re-validar entregas em **playlists próprias** | `delivery_proofs` |
| `bot-execution-queue` | `/v1/playlists/:id/items` | 251 | Validar mutações em **playlists próprias** | `playlist_execution_jobs` |
| `register-curator-playlist` | `/v1/playlists/:id` + `/items` + `/v1/tracks/:id` | 147 cada | Onboarding de playlist de curador (1ª leitura) | `curator_playlists`, `curator_playlist_library` |
| `refresh-search-results` | `/v1/playlists/:id` | 518 | Atualiza followers/cover de **resultados de busca** (descoberta) | `search_results` |
| `backfill-curator-playlist-meta` | `/v1/playlists/:id` | 44 | Backfill metadata de playlists de curadores | `curator_playlists` |
| `diag-observer-extract` | `/v1/playlists/:id/items` | 37 | Diagnóstico manual (compara taxa de sucesso OAuth vs VPS) | — |
| `fetch-tracks-spotify` | `/v1/playlists/:id/items` | 13 | On-demand legado (gate de deprecação ativo) | `search_tracks` |
| `resolve-catalog-track` | `/v1/tracks/:id` + `/v1/artists/:id` | 22 + 19 | Resolver ISRC do catálogo do cliente | `catalog_tracks` |
| `bot-collect-queue` | `/v1/tracks/:id` | 8 | Fallback para resolver `spotify_artist_id` ao processar prints do bot | `bot_print_batches` |
| `recheck-archived-followers` / `apply-managed-cover` / `import-managed-playlist` | `/v1/playlists/:id*` | 1-3 | Operações pontuais em playlists próprias | `managed_playlists` |

**Filtrando só "playlists de terceiros":** as únicas que tocam playlists não-próprias são `register-curator-playlist`, `backfill-curator-playlist-meta`, `refresh-search-results`, `diag-observer-extract`, `fetch-tracks-spotify`. Nenhuma delas é parte do loop `diagnose`/`observer`/`market intelligence`.

**O fluxo `diagnose` em si NÃO chama Spotify API para playlists de terceiros.** Ele só chama `/v1/tracks/:id` e `/v1/artists/:id` para enriquecer cache das tracks que já estão **dentro da playlist gerenciada** que está sendo diagnosticada (via fila → `spotify-enrichment-worker`).

---

## ITEM 2 — Esses dados já existem no VPS Observer?

| Chamada | Já existe em `observer_playlist_tracks`? | Onde |
|---|---|---|
| `/v1/tracks/:id` (nome, artista) para tracks de playlists **gerenciadas** | **NÃO** — observer só captura playlists 3rd-party listadas em `observed_playlists` | — |
| `/v1/artists/:id` (followers, gêneros) | **NÃO** — observer não coleta artista | — |
| `/v1/playlists/:id/items` (sync-managed-playlist-tracks) | **NÃO** — playlist própria, não está em `observed_playlists` | — |
| `/v1/playlists/:id/items` (process-catalog-placements / revalidate) | **NÃO** — exige tracklist **agora**, observer roda 1x/dia | — |
| `/v1/playlists/:id/items` (register-curator-playlist, onboarding) | **PARCIAL** — se a playlist foi promovida para `observed_playlists`, sim, mas onboarding precisa do dado em tempo real | `observer_playlist_tracks.spotify_track_id + position` |
| `/v1/playlists/:id` (refresh-search-results — followers/cover) | **NÃO** — observer só captura tracks, não followers nem cover oficial | — |

Conclusão do ITEM 2: a **grande maioria** das chamadas que sobraram trata de **playlists próprias** ou de metadata (followers, cover, artist genres) que o VPS Observer **nunca foi desenhado para capturar**. Schema de `observer_playlist_tracks`: `spotify_playlist_id, spotify_track_id, position, name, artist, album_name, album_cover_url, duration_ms, captured_at, captured_date, correlation_id, raw` — track-level apenas.

---

## ITEM 3 — Existe chamada Spotify usada SÓ para descobrir tracks de playlists de terceiros?

**SIM, mas marginal e legada:**

1. **`fetch-tracks-spotify`** — 13 calls/7d, atrás de `deprecationGate`. Uso manual on-demand pelo Editor / extract-blueprints.
2. **`register-curator-playlist`** — 147 calls/7d. Onboarding de playlist nova; precisa da tracklist no momento do registro para popular `curator_playlist_library`. O observer só pegaria essa playlist **no próximo run diário** se ela for adicionada a `observed_playlists`.
3. **`diag-observer-extract`** — 37 calls/7d. É diagnóstico manual comparando OAuth observador vs VPS; **não é fluxo de produção**.

Por que ainda existem:
- `fetch-tracks-spotify` está deprecado mas vivo para uso manual raro.
- `register-curator-playlist` exige resposta síncrona (UI cadastrando curador); a arquitetura `playlists_to_observe → observer-pull-queue` é assíncrona por design.

---

## ITEM 4 — Fluxo completo (playlist de terceiros)

```
Playlist de terceiros (curador, concorrente, modelo de mercado)
        │
        ├── descoberta:
        │     • run-search / genre-spotify-discover         → SPOTIFY API /v1/search
        │     • register-curator-playlist (UI)              → SPOTIFY API /v1/playlists/:id
        │     • promote-search-to-observer                  → grava em observed_playlists
        │
        ├── lista de tracks (modo recorrente diário):
        │     • observer-pull-queue                         → VPS Observer (pull batch)
        │     • bot da VPS scrapeia Spotify Web (sem API)
        │     • observer-ingest-tracks                      → grava observer_playlist_tracks
        │
        ├── lista de tracks (modo on-demand / legado):
        │     • register-curator-playlist                   → SPOTIFY API /v1/playlists/:id/items
        │     • fetch-tracks-spotify (gated)                → SPOTIFY API /v1/playlists/:id/items
        │     • diag-observer-extract (diagnóstico)         → SPOTIFY API /v1/playlists/:id/items
        │
        ├── posição das tracks:
        │     • observer_playlist_tracks.position           → VPS Observer (único produtor)
        │
        ├── grava no banco:
        │     • VPS Observer            → observer_playlist_tracks (18.009 linhas/7d, 453 playlists, 6.904 tracks)
        │     • Spotify API (legado)    → search_tracks, curator_playlist_library
        │
        └── consumidores hoje:
              • diagnose-managed-playlist          lê search_tracks, genre_benchmarks  (NÃO lê observer_playlist_tracks)
              • observer-pull-queue                lê observer_playlist_tracks só para dedupe diário
              • NENHUMA outra função lê observer_playlist_tracks  (rg confirmou: 0 consumidores)
```

---

## ITEM 5 — Existe responsabilidade que deveria estar no VPS e ainda está na Spotify API?

**SIM — uma única, e é a confirmada nas fases 6.B.4/6.B.5:**

- **Listar tracklist de playlists de terceiros para análise competitiva** (`diagnose-managed-playlist` deveria ler `observer_playlist_tracks` em vez de continuar dependendo de `search_tracks` + Spotify API). Isso é **gap de consumo**, não regressão — o produtor existe, o consumidor nunca foi escrito (commit `fd02d284`).

**NÃO se aplica:**
- `/v1/tracks/:id` e `/v1/artists/:id` da diagnose **não são** responsabilidade do observer (observer não captura artist genres/followers, e as tracks em questão estão **na playlist própria**, não em terceiras).
- `/v1/playlists/:id/items` de `process-catalog-placements`, `revalidate-deliveries`, `sync-managed-playlist-tracks`, `bot-execution-queue` são todas em **playlists próprias** — observer não substitui.
- `/v1/playlists/:id` (followers, cover oficial) — observer não captura essa metadata.

---

## ITEM 6 — Chamadas que desapareceriam se o Diagnose lesse `observer_playlist_tracks`

Hoje o diagnose usa `observer_playlist_tracks` em **zero** queries. Se passasse a usá-la corretamente (substituindo o pool de `search_tracks` para benchmark competitivo):

| Categoria | Calls 7d hoje | Eliminadas? | Estimativa pós-integração |
|---|---:|---|---:|
| `/v1/playlists/:id/items` para playlists de terceiros (fluxo diagnose puro) | **0** | — | 0 — diagnose já não chama isso direto |
| `/v1/playlists/:id/items` em `fetch-tracks-spotify` (extract-blueprints) | 13 | **SIM**, parcial — se blueprints lerem observer primeiro | ~3 |
| `/v1/playlists/:id/items` em `register-curator-playlist` (onboarding) | 147 | **NÃO** — síncrono no cadastro | 147 |
| `/v1/tracks/:id` (`spotify-enrichment-worker` reason=`diagnose_miss`) | 2.015 | **SIM** se observer trouxer name+artist já preenchidos para tracks 3rd-party que aparecem como candidatas (today já vêm) | -300 a -800 (depende de overlap entre candidatos do diagnose e o pool capturado) |
| `/v1/artists/:id` (worker reason=`track_dep`) | 1.533 | **NÃO** diretamente — observer não captura artist. Permanece. | 1.533 |
| `/v1/playlists/:id` (refresh-search-results, followers/cover) | 518 | **NÃO** — observer não captura followers | 518 |

**Total realista eliminável:** ~300-800 calls/semana (todas em `/v1/tracks/:id` via worker `diagnose_miss`). **Não** desaparece `/v1/artists/:id` nem `/v1/playlists/:id` (followers/cover) — essas continuam sendo responsabilidade da Spotify API por design original.

---

## CONCLUSÃO (em português simples)

**O problema que motivou a criação do VPS Observer foi eliminado?**

**SIM, no fluxo principal.** Nenhuma função de `diagnose`, `market intelligence` ou `observer` chama hoje a Spotify API para **listar tracks de playlists de terceiros** de forma recorrente. O VPS Observer recebe `observed_playlists`, scrapeia, e grava em `observer_playlist_tracks` (18.009 linhas em 7 dias, 453 playlists, 6.904 tracks únicas). A dor original do 429 nesse endpoint específico, **acabou**.

**Existe algum fluxo antigo da Spotify API sobrevivendo dentro do Diagnose?**

**NÃO no sentido da dor original.** O que o diagnose ainda dispara via Spotify API (`/v1/tracks/:id` + `/v1/artists/:id` através do `spotify-enrichment-worker`) é metadata de **tracks da própria playlist gerenciada** e de seus artistas — informação que o observer **nunca capturou** e que **não cabe** no schema atual de `observer_playlist_tracks`.

**Sobrevivências legadas reais, mas marginais:**
- `fetch-tracks-spotify` (13/7d, deprecado, on-demand).
- `register-curator-playlist` (147/7d, síncrono no cadastro).
- `diag-observer-extract` (37/7d, diagnóstico manual).

**Único gap arquitetural real:** `diagnose-managed-playlist` não lê `observer_playlist_tracks` para enriquecer o pool de benchmark competitivo — isso é o gap apontado em 6.B.4/6.B.5, e elimina ~300-800 calls/semana de `/v1/tracks/:id`, **não** as chamadas de artist nem as de followers/cover.
