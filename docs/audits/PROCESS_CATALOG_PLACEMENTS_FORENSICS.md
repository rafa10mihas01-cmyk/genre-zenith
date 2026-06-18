# FASE 6.C.3 — Forense do `process-catalog-placements`

> Forense. Sem alteração de código ou banco. Evidências objetivas.

---

## ITEM 1 — Fluxo reconstruído

```
pg_cron (a cada 1 min)
  └─► cron-process-catalog-placements           supabase/functions/cron-process-catalog-placements/index.ts:24
        └─► POST /functions/v1/process-catalog-placements  (BATCH_LIMIT=50)   linha 41
              └─► process-catalog-placements/index.ts (Deno.serve)            linha 65
                    ├─► RPC claim_next_catalog_placements(worker, limit)      linha 80   [SKIP LOCKED + lease 2min]
                    ├─► enrich em batch (catalog_tracks + managed_playlists)  linhas 116-123
                    ├─► para cada placement claimado (loop linha 329):
                    │     ├─► getUserToken(owner_spotify_user_id)             linha 332  → _shared/spotify-client.ts:259 → spotify.ts:700 (refreshUserToken, app fixo do user)
                    │     ├─► listPlaylistTrackRefs(playlistId, token)        linha 335  → GET /v1/playlists/:id/items?…&limit=100  (paginado)
                    │     │   _shared/spotify-playlist.ts:108-137
                    │     ├─► addPlaylistTracks(playlistId, [uri], token)     linha 346  → POST /v1/playlists/:id/items
                    │     │   _shared/spotify-playlist.ts:149-169
                    │     ├─► listPlaylistTrackRefs(playlistId, token, force) linha 349  → GET /v1/playlists/:id/items  (confirmação)
                    │     └─► markActive | markRetry | markFailed             linhas 225-326
                    │           ├─► UPDATE catalog_placements (status, scheduled_for, attempts)
                    │           └─► INSERT catalog_placement_execution_log
                    └─► retorna JSON com contadores
```

Resultado final: linhas em `catalog_placements` ficam `active`, `retry` ou `failed`, e a faixa entra de fato na playlist do dono Spotify.

---

## ITEM 2 — Objetivo de negócio

Em português simples: **adicionar automaticamente faixas do "catálogo" da NexEngine nas playlists gerenciadas dos clientes**.

- **Por que existe:** o sistema decide programaticamente que a faixa X deve ser colocada na playlist Y (posição opcional). Essa decisão vira uma linha em `catalog_placements (status='pending')`. O worker é o braço que **executa** essa decisão dentro do Spotify.
- **O que ele calcula:** nada. Ele apenas materializa decisões — verifica se a faixa já está na playlist (anti-duplicidade), insere via POST, reconsulta para confirmar, e marca o resultado.
- **Quem consome o resultado:** `catalog_placements.status='active'` alimenta o catálogo da NexEngine, dashboards de distribuição (`/catalogo`), relatórios de campanha e a UI de monitoramento (`CatalogoMusicaPreview.tsx`).

---

## ITEM 3 — Endpoints chamados por execução

| Endpoint | Método | Por placement | Motivo | Obrigatória |
|---|---|---|---|---|
| `accounts.spotify.com/api/token` | POST | 0–1 por owner (cacheada por execução) | Refresh do user-token quando expira | Sim |
| `api.spotify.com/v1/playlists/:id/items` (com `?fields=…&limit=100`) | **GET** | `ceil(tracks_count/100)` (pré-check, `refsCache` dentro da execução) | Listar refs para anti-duplicidade | Sim |
| `api.spotify.com/v1/playlists/:id/items` | **POST** | 1 | Inserir a faixa (1 URI por placement) | Sim (é o objetivo) |
| `api.spotify.com/v1/playlists/:id/items` (`force=true`) | **GET** | `ceil(tracks_count/100)` | Confirmar que a faixa apareceu | Sim — sem isso vira `ghost_add` |

Evidência real (`spotify_call_log`, 7d, app 07):
```
GET  /v1/playlists/:id/items  → 5.918
POST /v1/playlists/:id/items  →   164
POST /accounts.../api/token   →    31
```
Razão observada: **~36 GETs por 1 POST**. Para uma playlist de ~50 faixas (1 página), o esperado seria ~2 GETs/POST. O excesso vem de **retentativas** que reabrem o ciclo GET-POST-GET sem nunca chegar ao POST (circuit_open aborta antes).

---

## ITEM 4 — Que credencial é usada?

**OAuth do usuário (user-token).** Linha 28 importa `getUserToken`; linha 183 chama `getUserToken(ownerId)`.

Por quê: a Spotify exige que adição/leitura de itens de uma playlist seja feita com **token do dono** da playlist (`playlist-modify-public` / `…-private`). Client-Credentials (app-only) **não tem permissão** para `POST /playlists/:id/items`. Resultado: o worker está estruturalmente preso ao `spotify_user_tokens.app_id` de cada owner.

---

## ITEM 5 — Reconstrução do evento que bloqueou o NexEngine 07

`spotify_call_log` agregado por hora (app 07, função `process-catalog-placements`):

```
hora (UTC)        calls   circuit_open
2026-06-14 20:00   328       328  ← rajada inicial; breaker já aberto, todas abortam
2026-06-14 21:00   336       333
2026-06-14 22:00   336       333
2026-06-14 23:00   350       348
2026-06-15 00:00   324       322
2026-06-15 01:00   318       316
2026-06-15 02:00   342       341
2026-06-15 03:00   284       281
2026-06-15 04:00   327       327
2026-06-15 05:00   301       300
2026-06-15 06:00   242        13  ← breaker normalizou
2026-06-16 13:00   108         0  ← novo pico saudável
2026-06-17 14:00   …          …  ← breaker reabriu
```

Detalhamento do pico:
- **Janela do bloqueio:** 14/06 ~20:00 UTC → 15/06 ~05:30 UTC (~10 h).
- **Usuários OAuth amarrados ao app 07 (5):** `feliguin25`, `22km4cu2qxaxahei7mansie7q`, `americanow61`, `31swa2xl3uawqijufmt3bc4vtvta`, `6p5z5stfg640xtjoobureeo3g`.
- **Playlists envolvidas (sample dos 12 placements ainda pendentes em retry):** `2q5Co7jM5gHDbU6HC3fX02`, `1XvyvHIYMhRJggVmh92rSc`, `6W35mVzLackinkFc87a6wr`, `2sYJfsJFPITk2YtVKMOIx9`, `5enM8nsZ36kAzAZYwQiC6c`, `3qAHWkvqhSVoBV1PHSiPFs`, `0zAhu8LMnrpTmHzmI4nasb`, `1lRozIfEoNcZaMaOvGxEsE`, `2uI17cXYSswuEfkIwyMceQ`, `0w5Ql560B1RktHMM5TnI8a`, `2i4NhiHQFy3oSfofvJGYE8`, `4zi8NHf9q774A2xtPzL91o`.
- **Campanha:** não modelado — `catalog_placements` não tem FK direta para `campaigns`. Origem é o catálogo (`catalog_tracks`), não uma campanha específica.
- **Endpoint dominante:** `GET /v1/playlists/:id/items` (5.918 chamadas em 7 d).
- **correlation_id:** `spotify_call_log` não armazena `correlation_id`; o que existe é `meta` (vazio para este caller) e `function_name`. O agrupamento foi feito por `app_id + function_name + endpoint + hora`.

---

## ITEM 6 — Proporcionalidade

Custo teórico por placement bem-sucedido (playlist com `N` faixas):

| Playlists processadas | GETs | POSTs | Total chamadas Spotify |
|---|---|---|---|
| 1 | `2·ceil(N/100)` | 1 | `2·ceil(N/100)+1` |
| 10 | `20·ceil(N/100)` | 10 | `20·ceil(N/100)+10` |
| 100 | `200·ceil(N/100)` | 100 | `200·ceil(N/100)+100` |

Para N=50 → ~3 chamadas/placement. Para N=500 → ~11 chamadas/placement.

**Efeito multiplicador real (observado, app 07):** placement em estado `retry` por `spotify_circuit_open` é re-agendado em 10–20 min (linhas 231-256). Como o breaker permaneceu aberto várias horas, cada um dos ~12 placements ficou batendo ~3-6×/h × 10 h × 2 GETs = **~720 GETs/placement na janela** — o que casa com os ~5.918 GETs observados (12 placements × ~493 GETs).

Sim, há **multiplicador**: `retry × ceil(N/100) × 2` por ciclo, sem teto enquanto o breaker estiver aberto (linha 234 zera `attempts` no caminho `spotify_circuit_open`, então `max_attempts` nunca para o loop).

---

## ITEM 7 — Repetições

Evidências:

- **Mesma playlist consultada várias vezes:** SIM. Há apenas ~12 placements ativos em retry para o app 07, mas 5.918 GETs em 7 d ⇒ cada playlist foi consultada centenas de vezes. O cache `refsCache` é **escopo de execução** (linhas 189-198) — cada novo cron-tick recria o worker e refaz a leitura.
- **Mesma música consultada várias vezes:** SIM (implícito). Cada retry refaz pré-check + confirm para a mesma `spotify_track_id`.
- **Mesmo usuário repetido:** SIM. `feliguin25` aparece em 5 dos 12 placements pendentes; mesmo `getUserToken` é chamado em iterações distintas (cache só vale dentro da mesma execução, linhas 178-186).
- **Mesma campanha repetida:** N/A (placement não tem `campaign_id`). Mas o mesmo `catalog_track_id` em playlists diferentes do mesmo owner replica todo o ciclo.

Outcome agregado em `catalog_placement_execution_log` (vida toda):
```
skipped/spotify_circuit_open  17.125
active                            866
failed/spotify_circuit_open       307
already_present                    64
failed/exception                   22
failed/spotify_400                  3
```
**95%** das execuções terminam em circuit_open. Cada execução custa ≥1 GET antes do abort.

---

## ITEM 8 — Informações já existentes no banco

| Consulta feita ao Spotify | Já existe no banco? | Onde |
|---|---|---|
| `GET /playlists/:id/items` (pré-check anti-duplicidade) | **SIM** | `managed_playlist_tracks (playlist_id, spotify_track_id, position, added_at)` — 36.539 linhas, 677 playlists, atualizado até 17/06 |
| `GET /playlists/:id/items` (confirmação pós-POST) | **NÃO de forma confiável** | `managed_playlist_tracks` só é atualizada por `sync-managed-playlist-tracks` em ciclos próprios (não imediato) |
| `POST /playlists/:id/items` | **N/A** | Operação de mutação no Spotify — só pode acontecer lá |
| `POST /api/token` (refresh) | Parcial | `spotify_user_tokens.access_token` é cacheado com `expires_at`; refresh só dispara quando expirado |

Spot-check das 4 playlists travadas no app 07:

```
spotify_playlist_id        managed_playlists.tracks_count   managed_playlist_tracks.local_rows
2q5Co7jM5gHDbU6HC3fX02     0                                30
5enM8nsZ36kAzAZYwQiC6c     0                                33
0w5Ql560B1RktHMM5TnI8a     48                               48
1lRozIfEoNcZaMaOvGxEsE     0                                20
```
Existe cópia local atualizada, mas o worker não a consulta.

---

## ITEM 9 — Redundâncias identificadas

1. **Pré-check** (`listPlaylistTrackRefs` antes do POST) poderia consultar `managed_playlist_tracks` em vez do Spotify. Eliminaria `~ceil(N/100)` GETs por placement.
2. **Refresh de token a cada execução** — o cache `tokenCache` (linha 178) é só per-execution. Como cron roda 1×/min, há um refresh teórico a cada 60s por owner, embora `spotify_user_tokens.expires_at` permita reaproveitar por ~1h. (Mitigação parcial existe via `spotify_tokens` no caminho `getUserAccessToken`, mas ainda há 31 POSTs `/api/token` em 7d só pra esse caller.)
3. **Confirmação pós-POST** — sempre re-pagina a playlist inteira. Poderia checar apenas a presença da faixa adicionada (Spotify devolve `snapshot_id`, e existe `GET /me/tracks/contains` para escopo similar) ou confiar no `snapshot_id` retornado e validar de forma incremental.
4. **Retry em circuit_open** — o caminho `spotify_circuit_open` zera attempts (linha 234), o que evita aposentadoria do job mas remove o teto. Enquanto o breaker estiver aberto, o mesmo placement re-bate indefinidamente. Cada tentativa custa ≥1 GET pré-check **antes** do abort.

Não é solução — apenas inventário de redundâncias.

---

## ITEM 10 — Causa raiz do bloqueio do NexEngine 07

**Resposta: E) Arquitetura — com componente forte de C) Consultas redundantes.**

Justificativa:
- O **balanceamento amarra OAuth↔App** (Spotify): 5 usuários fixos no app 07. Sem failover.
- O **fluxo de execução é 3 chamadas por placement** (GET-POST-GET) em vez de 1 mutação confiando no estado local.
- O **retry em circuit_open zera attempts** e re-agenda em 10–20 min — laço quase infinito enquanto breaker estiver aberto.
- O **pré-check ignora `managed_playlist_tracks`**, que tem o dado.

Tudo isso é decisão arquitetural. **Não é loop bug** (cada retry é deliberado), **não é volume normal** (95% das execuções abortam), e **não é processamento excessivo per se** (são poucos placements — 12 ativos). É a combinação de fixação OAuth-por-app + custo de 3 chamadas/placement + retries sem teto.

---

## CONCLUSÃO

1. **O `process-catalog-placements` está fazendo o mínimo necessário?**
   **Não.** Para cada placement faz GET+POST+GET na Spotify mesmo havendo cópia local atualizada em `managed_playlist_tracks`.

2. **Existe desperdício de chamadas?**
   **Sim, comprovado.** 5.918 GETs em 7 d contra ~1.170 outcomes totais no app 07 → ~5 GETs por outcome; em outcomes bem-sucedidos isolados o custo é 2 GETs + 1 POST por placement. O pré-check é totalmente substituível por leitura de banco.

3. **O bloqueio do app 07 era inevitável?**
   **Parcialmente.** Inevitável **enquanto** (a) os 5 usuários estiverem fixos nesse app, (b) o pré-check for via Spotify e (c) circuit_open re-agendar sem teto. Os três fatores são arquiteturais; nenhum é limite intrínseco da Spotify.

4. **O fluxo está saudável?**
   **Não.** Outcome global: 95% das execuções terminam em `skipped/spotify_circuit_open`, 5% completam (`active` + `already_present`). Razão sinal/ruído ~1:20.

Nada foi alterado. Apenas evidências.
