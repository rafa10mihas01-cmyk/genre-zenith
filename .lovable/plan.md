
# Fase 5A — Blindagem da Importação de Playlists

## Estado atual (já existe e fica intocado)

- **Endpoint único:** `register-curator-playlist` (edge function) recebe até 200 URLs, processa em paralelo (5 por vez), classifica, faz `bulk insert` em `curator_playlists`.
- **Modos:** `public_token` (portal do curador, força `match_status='curator'`) ou JWT (admin, classificador completo).
- **Já implementado:**
  - Limite de 200 URLs (linha 85)
  - Dedup contra playlists já existentes no deal (`existingIds`)
  - Detecção de URL inválida, not_found, error
  - Bloqueio se a faixa já estiver na playlist (`track_already_present`)
  - Bulk insert único no fim
  - Resumo `summary` com `total / inserted / blocked / duplicate / track_already_present / invalid / not_found / error`

## O que falta (lacunas reais identificadas)

1. **Dedup intra-payload** — se o mesmo URL vier 2x na mesma chamada, hoje é processado 2x (duas chamadas Spotify) e a segunda só é bloqueada porque a primeira já foi inserida (race possível).
2. **Lock de importação** — duas abas / clique duplo / submit duplo do mesmo token+song podem rodar em paralelo; só `existingIds` no início protege parcialmente.
3. **Rate limit do portal público** — token público hoje aceita N chamadas seguidas sem freio; risco de flood/abuso e queima de quota Spotify.
4. **Retry/backoff Spotify** — `fetchPlaylistMeta` e `checkTrackInPlaylist` falham na 1ª 429/timeout; URL vai para `error` sem segunda chance.
5. **Timeout operacional** — função pode rodar até o limite do Deno; sem corte explícito quando Spotify trava.
6. **Feedback visual** — UI já mostra "X adicionadas / Y já tinham a música / Z erros" mas não distingue duplicadas-na-importação, inválidas, not_found.

## O que NÃO muda (explícito)

- `match_status='curator'` para portal público — preservado
- Whitelist dinâmica (`knownCuratorOwnerIds`, `curatorPlaylistNames`) — preservada
- Bulk insert único no fim — preservado
- Coleta automática (cron + bot) — não tocada
- Classificador (`classifyPlaylist`) — não tocado
- Schema do banco — não tocado

## Plano de execução

### 1. Dedup intra-payload (`register-curator-playlist`)

Antes do loop de processamento:
- Normalizar cada URL → extrair `playlist_id`
- `Map<playlist_id, item>` para colapsar duplicatas
- URLs duplicadas dentro do mesmo payload viram status `duplicate_in_payload` (sem chamar Spotify)
- Adiciona campo `duplicate_in_payload` ao `summary`

### 2. Lock de importação (`register-curator-playlist`)

Lock leve em memória do processo da edge function, escopado por `deal_id + song_id`:
- `Map<key, timestamp>` em escopo de módulo
- Se já existe lock < 60s → retorna `423 Locked` com mensagem `"Importação em andamento, aguarde alguns segundos"`
- Lock liberado no `finally`
- Bom o suficiente para clique duplo e abas duplicadas no mesmo cold-start. Para garantir cross-instance, manteríamos sem expansão para banco nesta fase (próxima fase se necessário).

### 3. Rate limit do portal público (`register-curator-playlist`)

Nota: a regra interna do projeto desencoraja rate limiting de backend pesado. Aplicaremos só uma trava leve **específica desta rota pública**, em memória por instância:
- `Map<public_token, [timestamps]>`
- Janela: 5 importações por `public_token` por minuto
- Se exceder → `429` com mensagem clara
- Não usa banco, não persiste — proteção mínima contra flood acidental e clique repetido

### 4. Retry/backoff Spotify (`_shared/curator-playlist.ts`)

Em `fetchPlaylistMeta` e `checkTrackInPlaylist`:
- Wrapper `fetchWithRetry(url, opts)`
  - Retries: 3 tentativas
  - Backoff: 300ms → 800ms → 2000ms
  - Retry em: status 429, 502, 503, 504, network error
  - Em 429: respeita header `Retry-After` se presente (cap em 5s para não estourar timeout)
  - Em 401: 1 retry após renovar token (já existe `getSpotifyToken`)
- Sem alterar a interface pública das funções

### 5. Timeout operacional por URL

No loop de processamento de cada item:
- `Promise.race([processItem(), timeout(15s)])`
- Se estourar → `status: "error"`, `error: "spotify_timeout"`
- Garante que 1 playlist travada não pendura a chamada inteira

### 6. Feedback visual (`CuratorPage.tsx` + `LogPrintDialog.tsx`)

No toast pós-importação, expor todos os contadores do `summary`:
```
"X adicionadas · Y duplicadas · Z já com a música · W inválidas · K com erro"
```
- Apenas componentes/strings, sem mudar lógica
- Se `summary.duplicate_in_payload > 0` → mensagem dedicada
- Se `summary.error > 0` → toast.warning em vez de success

## Arquivos a editar

- `supabase/functions/register-curator-playlist/index.ts` — dedup, lock, rate limit, timeout por item
- `supabase/functions/_shared/curator-playlist.ts` — `fetchWithRetry` + uso em `fetchPlaylistMeta` e `checkTrackInPlaylist`
- `src/pages/CuratorPage.tsx` — toast detalhado pós-importação (handleImportFile + handleAddOne se aplicável)

Nenhuma migration, nenhuma mudança de schema, nenhuma mudança em coleta/cálculo.

## Critério de aceite

- Mesma URL repetida 100x na lista → 1 chamada Spotify, 1 inserida, 99 marcadas como `duplicate_in_payload`
- 2 cliques no botão "Importar" em <1s → 1 importação roda, 2ª recebe 423 com mensagem clara
- Spotify devolve 429 → automático: 3 retries com backoff antes de falhar a URL
- Toast pós-importação detalha cada categoria
- Comportamento das URLs válidas é idêntico ao atual (mesma classificação, mesmo bulk insert)

