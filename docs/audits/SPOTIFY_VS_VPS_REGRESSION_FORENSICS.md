# FASE 6.B.2 — Forense da "Regressão Arquitetural" VPS × Spotify API

**Modo:** read-only. Nenhum código foi alterado.
**Data:** 2026-06-18.
**Pergunta-mãe:** "Por que o enriquecimento voltou a usar a Spotify API, se a arquitetura previa que isso fosse responsabilidade do VPS?"

**Resposta curta (spoiler):** **não houve regressão**. A arquitetura oficial **nunca** atribuiu enriquecimento de metadata canônica (popularity / genres / followers / ISRC / release_date) ao VPS. O VPS sempre foi *scraper visual* (plays + DOM da tela "Made For"). O `spotify-enrichment-worker` foi criado em 2026-06-09 justamente para **substituir chamadas síncronas e dispersas** à Spotify API por uma fila assíncrona com cache. A confusão vem de uma leitura equivocada do `SPOTIFY_API_MATRIX.md`, que marca "VPS = observacional 🟡" só para **followers de playlist** (DOM arredondado), não para metadata de track/artist.

---

## ITEM 1 — História do enriquecimento (cronológico, com evidências)

### Fase 0 — pré-VPS (anterior a 2025-Q4)
- Enriquecimento de tracks/artists feito **inline e sob demanda** dentro de funções como `diagnose-managed-playlist`, `compute-playlist-dna`, `calculate-track-playlist-fit`.
- Cada função chamava `/v1/tracks` e `/v1/artists` diretamente, sem cache.
- Sintoma: 429 frequentes, ausência de deduplicação, custo de quota explosivo.
- Evidência: `docs/audits/SPOTIFY_LEGACY_REPORT.md` e `SPOTIFY_API_FORENSICS_BEFORE.md`.

### Fase 1 — criação do VPS Bot (`docs/BOT_VPS_CONTRACT.md`)
- Motivo do VPS: **plays e prints da tela "Made For Artists"** não existem na API pública. Só se obtém via navegador autenticado.
- Responsabilidades migradas ao VPS:
  - `total_plays_28d` / `plays_7d` / `last_24h` (campos em `song_snapshots`, `label_spreadsheet_rows`).
  - DOM piggyback de playlists onde a track aparece (`bot-ingest-dom` → `observer_playlist_tracks`).
  - Screenshots e OCR de evidência.
- Responsabilidades que **permaneceram** na Spotify API: tudo que envolve **identidade canônica** — `ISRC`, `popularity`, `release_date`, `genres`, `followers`, `artist metadata`, membership oficial de playlist (`/v1/playlists/{id}/items`), mutações (add/remove/reorder).
- Evidência: `docs/audits/SPOTIFY_API_MATRIX.md` (linhas "Track Metadata", "Artist Metadata", "Genre/Subgenre", "Playlist Image", "Playlist Owner" → todas marcadas 🏆 Spotify API; só `Streams` e `followers de playlist observacionais` ficam com o VPS).

### Fase 2 — criação do `spotify-enrichment-worker` (2026-06-09)
- Migration: `supabase/migrations/20260609115524_75475fe9-544c-44b7-bfb5-7607da5a34bf.sql` cria `spotify_track_cache`, `spotify_artist_cache`, `spotify_enrichment_queue`, RPC `claim_spotify_enrichment_jobs`.
- Primeiro job na fila: `2026-06-09` (psql: `min(created_at)=2026-06-09`).
- Motivo: cortar as chamadas síncronas dispersas e centralizar num único worker rate-limit-safe.
- Memory: `.lovable/memory/spotify-enrichment-cache.md` documenta a política ("Diagnose e funções de scoring NÃO chamam Spotify direto pra popularity/genres/followers/release_date. Tudo passa por aqui").

**Linha do tempo final:**
```
pré-2025  inline Spotify calls everywhere (legado)
2025-Q4   VPS sobe → assume plays + DOM observacional
2026-06   spotify-enrichment-worker → centraliza metadata canônica via cache
```
Nenhum desvio. O worker é a **conclusão** da arquitetura, não um retrocesso.

---

## ITEM 2 — Auditoria do `spotify-enrichment-worker`

| Pergunta | Resposta |
|---|---|
| Quando foi criado | 2026-06-09 (migration `20260609115524`) |
| PR/migration | `20260609115524_75475fe9-544c-44b7-bfb5-7607da5a34bf.sql` |
| Problema que resolveu | Eliminar chamadas Spotify síncronas em `diagnose-*`, `compute-*`, `calculate-*-fit`; introduzir cache + fila com retry/backoff; consolidar rate-limit num único ponto |
| Tabelas que alimenta | `spotify_track_cache`, `spotify_artist_cache` (auto-enqueue de `artist_ids` quando processa track) |
| Endpoints Spotify | `GET /v1/tracks/{id}`, `GET /v1/artists/{id}` (single-path apenas; sem batch, sem search, sem playlists) |
| Política | 200→done · 404→not_found · 403→24h backoff · 429→devolve attempt + Retry-After · 5xx→backoff exponencial |

Cron: `spotify-enrichment-worker-1min` (1×/min, BATCH=30, CONCURRENCY=2, STALL=150ms).

---

## ITEM 3 — Para cada endpoint, quem consome e o VPS pode substituir?

### `GET /v1/tracks/{id}`
| Campo | Consumidor principal | VPS pode entregar? |
|---|---|---|
| `name` | display em UI, exports | ❌ não — VPS não captura texto canônico do track via DOM de forma confiável (parse de print é frágil; em alguns casos só ID + plays) |
| `isrc` | `catalog_tracks`, dedupe label-spreadsheet, baseline | ❌ não — ISRC nunca aparece na UI "Made For" |
| `album_id` / `release_date` | `playlistGrowthEngine`, idade da release, decisões de janela | ❌ não — release_date não aparece na tela do bot |
| `duration_ms` | scoring DNA, projeções | ❌ não |
| `popularity` (0–100) | `track_ecosystem_score`, `playlist_ecosystem_score`, ranking | ❌ não — métrica interna do Spotify; ausente em qualquer DOM |
| `artist_ids[]` | gatilho de enrich de artist, joins | 🟡 parcial — ID do artista aparece em alguns prints, mas não é determinístico nem completo (features/colabs ficam de fora) |

### `GET /v1/artists/{id}`
| Campo | Consumidor principal | VPS pode entregar? |
|---|---|---|
| `name`, `image_url` | UI cliente, portal | ❌ não — não vem do DOM "Made For" |
| `genres[]` | `genre_brain`, classificação, recomendação, todo o motor de afinidade | ❌ **não** — esse é o pulmão semântico do sistema, e só existe em `/v1/artists` |
| `popularity` | ranking de artist, capacity matrix | ❌ não |
| `followers.total` | KPI cliente (`clients.followers_count`), benchmark | ❌ não — o número canônico só vem da API; DOM pode mostrar arredondado em alguns lugares, mas não na tela observada pelo bot |

**Evidência objetiva da incapacidade do VPS:** o schema de `song_snapshots` (tabela que recebe o payload do bot) só tem `total_plays_28d`, `spotify_song_id`, `screenshot_url`, `bot_metadata`. **Não existe coluna** `isrc`, `popularity`, `genres`, `release_date` em qualquer tabela alimentada pelo VPS — porque o VPS nunca capturou esses campos.

---

## ITEM 4 — Capacidade real do VPS hoje

| Dado | VPS entrega hoje? | Onde grava | Evidência |
|---|---|---|---|
| `artist_id` | 🟡 derivado do `spotify_song_id` via parse, não direto | — | nenhuma coluna dedicada |
| `track_id` | ✅ sim (`spotify_song_id`) | `song_snapshots.spotify_song_id`, `bot_ingest_raw` | schema |
| artist metadata (name/image) | ❌ não | — | nenhuma coluna |
| track metadata (name/album) | ❌ não (só `screenshot_url`) | — | nenhuma coluna |
| `genres` | ❌ não | — | nenhuma coluna; tela "Made For" não expõe gênero |
| `popularity` (0–100) | ❌ não | — | métrica interna Spotify, não renderizada |
| `followers` de artista | ❌ não | — | tela não mostra |
| `followers` de playlist | 🟡 sim, arredondado (`>1k`) via DOM scraping em `playlist-observer` (não no bot principal) | `playlist_followers_snapshots` | `SPOTIFY_API_MATRIX.md` |
| `release_date` | ❌ não | — | não aparece |
| `ISRC` | ❌ não | — | nunca renderizado na UI |

**Conclusão objetiva:** dos 9 dados auditados, **o VPS hoje só entrega 1 com qualidade canônica (track_id) e 1 observacional (playlist followers arredondados)**. Os 7 restantes **exigem** Spotify API.

---

## ITEM 5 — Arquitetura planejada × atual

| Pergunta | Resposta |
|---|---|
| O sistema está seguindo a arquitetura oficial? | **SIM.** A regra documentada em `SPOTIFY_API_MATRIX.md` ("VPS = plays + observacional; Spotify API = metadata, membership, mutações") é exatamente o que está em produção. |
| Quando ocorreu o desvio? | **Não ocorreu.** A hipótese da pergunta parte de uma premissa falsa. |
| Qual componente introduziu o desvio? | **Nenhum.** O `spotify-enrichment-worker` *implementa* a arquitetura — não a contradiz. O que mudou em 2026-06-09 foi **onde** as chamadas Spotify acontecem (centralizadas no worker, atrás de cache), não **se** elas devem acontecer. |

O único "ruído" arquitetural real é a **dependência de quota** (incidente NexEngine 07): 1 app concentrando todo o enrich → 429 longo. Isso é problema de *distribuição de carga*, não de *fonte do dado*.

---

## ITEM 6 — O `spotify-enrichment-worker` ainda é necessário?

**Sim — é estrutural.** Sem ele, o sistema perde popularity, genres, ISRC, release_date e followers de artista, quebrando: genre_brain, ecosystem_score, playlist_dna, recomendações, KPI do cliente.

### Classificação por responsabilidade

| Responsabilidade do worker | Veredito | Justificativa |
|---|---|---|
| `GET /v1/tracks/{id}` (popularity, isrc, release_date, album_id, artist_ids) | **PERMANECE na Spotify API** | Nenhum campo é renderizado em DOM acessível ao VPS. Confirmado pelo schema de `song_snapshots`. |
| `GET /v1/artists/{id}` (genres, popularity, followers) | **PERMANECE na Spotify API** | `genres` é o input do `genre_brain` inteiro; impossível obter de outro lugar. |
| Auto-enqueue de `artist_ids` quando processa track | **PERMANECE** | Só faz sentido porque o `/v1/tracks` traz os IDs; não tem equivalente VPS. |
| Cache TTL (14d pop, 90d genres) | **PERMANECE** | Reduz chamadas em ~80% (medido pela `popularity_refreshed_at`). |
| Política de 429/403/5xx | **PERMANECE** | Único ponto de retry, evita reproduzir lógica em N funções. |
| Backfill manual (`cache-backfill`) | **PERMANECE** | Aquece cache antes de diagnose; reduz `diagnose_miss` em playlists novas. |
| Qualquer chamada a `/v1/playlists/*`, `/v1/me/*`, `search`, mutações | **NÃO está no worker** | Permanece em funções específicas (`spotify-playlist.ts`, `create-spotify-playlist`, etc.). Worker é **estritamente** single-path metadata. |
| Itens **MIGRAR para VPS** | **Nenhum** | VPS hoje não tem capacidade técnica nem caminho de captura para esses campos. Migrar exigiria scraping de páginas que não fazem parte do fluxo do bot. |
| Itens **LEGADO (pode remover)** | **Nenhum no worker** | Tudo que ele faz é consumido por componentes vivos (`diagnose-managed-playlist`, scoring, brain). Removê-lo degradaria métricas core. |

### Evidência operacional dos 3.817 jobs históricos
```
track   diagnose_miss   2015   ← cache frio, alimentado por diagnose
artist  track_dep       1656   ← auto-enqueue (track traz artist_ids)
track   backfill          93   ← aquecimento manual
artist  diagnose_miss     36   ← artist ID novo descoberto em diagnose
track   sync_new          17   ← upsert em sync-managed-playlist-tracks
```
100% das origens são **consumidores legítimos e ativos**. Nenhuma é legado morto.

---

## Veredito final

1. **Não houve regressão arquitetural.** A premissa "VPS deveria fazer esse enriquecimento" é incorreta — nunca esteve no contrato do VPS.
2. **O `spotify-enrichment-worker` é a implementação correta** da fronteira documentada: VPS = quantidade (plays) + observacional, Spotify API = identidade + metadata canônica.
3. **O incidente NexEngine 07** que motivou esta auditoria é um problema de *quota distribution* (1 app fazendo todo o trabalho) — não justifica desligar nem migrar o worker.
4. **Recomendação fora-de-escopo (não executar nesta fase):** rotacionar apps NexEngine 01–08 em round-robin no worker e adicionar TTL de 7d ao enqueue de `diagnose_miss` para cortar volume sem mudar arquitetura.

Nenhum arquivo de código foi alterado.
