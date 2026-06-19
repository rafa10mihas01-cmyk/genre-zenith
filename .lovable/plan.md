
# Correção Definitiva — Spotify Circuit Breaker

## Diagnóstico (confirmado)

- `spotify-enrichment-worker` drena fila em lote (BATCH=30, CONCURRENCY=2) → estoura 429 do Spotify.
- O guard global em `_shared/spotify.ts` (linhas 390 e 474) abre **um único** `spotify_circuit_breaker` por `app_id`, sem distinguir contexto (enriquecimento vs operação).
- Operações reais (sync, bot, execução de campanha) passam a falhar com `SPOTIFY_CIRCUIT_OPEN` mesmo sem terem causado nada.
- A RPC `get_blocked_playlist_ids` retorna *playlists* vinculadas ao app bloqueado, e a UI exibe esse número como "Apps bloqueados (N)" — semanticamente errado.

## Objetivo

1. Bloqueio causado por enriquecimento **não pode** derrubar operação.
2. Worker de enriquecimento **não pode** mais estourar 429 em volume normal.
3. UI deve refletir a verdade: apps de fato bloqueados vs playlists afetadas.

## Plano

### 1. Separar o circuit breaker por contexto (banco)

Nova migration:
- Adicionar coluna `context text NOT NULL DEFAULT 'operation'` em `spotify_circuit_breaker` e `spotify_circuit_breaker_log` (`enrichment` | `operation`).
- Trocar PK/unique para `(app_id, context)`.
- Atualizar a RPC `close_expired_spotify_circuit_breakers` para fechar por `(app_id, context)`.
- Atualizar `get_blocked_playlist_ids` para considerar **apenas** `context = 'operation'` (enriquecimento não afeta a tela do operador).

### 2. Propagar `context` no guard (edge functions)

Em `supabase/functions/_shared/spotify.ts`:
- `assertSpotifyCircuitClosed(appId, context)` e `openSpotifyCircuitBreaker(..., context)` passam a aceitar e gravar `context`.
- `spotifyFetch` e o fetch-guard global leem `context` do `resolveLogCtx()` (default `operation`).
- Em `spotify-enrichment-worker/index.ts`, setar `ctx.context = 'enrichment'` antes das chamadas.

Resultado: 429 do worker abre breaker `('app_x','enrichment')`; sync/bot/execução continuam usando `('app_x','operation')` e não veem nada.

### 3. Throttle real no worker

`supabase/functions/spotify-enrichment-worker/index.ts`:
- Reduzir defaults: `BATCH=10`, `CONCURRENCY=1`, `STALL_MS=400` (Spotify Web API tolera ~10 req/s sustentado por app).
- Implementar **token-bucket por app_id** dentro do worker (limite ~5 req/s) — pausa naturalmente antes de levar 429.
- Ao receber 429: abortar o lote inteiro e respeitar `Retry-After` integral antes de re-claim.

### 4. Fallback estruturado nas edges que chamam Spotify

Padrão aplicado em `resolve-catalog-track`, `diagnose-managed-playlist`, `preview-distribute-catalog-track`, `register-curator-playlist`:
- `catch (SpotifyCircuitOpenError)` → retorna **HTTP 200** com `{ ok:false, error:"spotify_circuit_open", fallback:true, context, blocked_until, retry_after_seconds }`.
- Frontend já trata `!r.ok` mostrando mensagem; sem mais 500/tela branca.

### 5. UI honesta

`src/components/operacao/MinhasPlaylists.tsx` + `src/hooks/useSpotifyAppsStatus.ts`:
- Renomear chip para `"{N} playlists em app rate-limited"` (ou ocultar quando todos os breakers forem de `enrichment`).
- Tooltip lista cada app distinto + horário de liberação.
- Adicionar segundo hook `useBlockedAppsCount()` que conta apps únicos com breaker `operation` aberto — usar esse número quando quisermos falar de "apps".

### 6. Botão admin: "Resetar breaker"

Em `/sistema` (aba Saúde) adicionar ação que chama RPC `force_close_spotify_circuit_breaker(app_id, context)` (admin-only) — para destravar manualmente sem esperar `retry_after`.

## Arquivos afetados

```text
supabase/migrations/<novo>.sql              (context + RPCs)
supabase/functions/_shared/spotify.ts       (context no guard)
supabase/functions/spotify-enrichment-worker/index.ts (throttle + ctx)
supabase/functions/resolve-catalog-track/index.ts     (fallback ctx)
supabase/functions/diagnose-managed-playlist/index.ts (fallback ctx)
supabase/functions/preview-distribute-catalog-track/index.ts
supabase/functions/register-curator-playlist/index.ts
src/hooks/useSpotifyAppsStatus.ts           (novo hook + semântica)
src/components/operacao/MinhasPlaylists.tsx (chip honesto)
src/pages/Sistema.tsx                       (botão reset admin)
```

## Critérios de aceite

1. Rodar `spotify-enrichment-worker` em loop por 5 min → nenhum breaker `operation` aberto.
2. Forçar 429 em enriquecimento → operação (sync de playlist) segue funcionando.
3. Chip da UI mostra "0 apps bloqueados" quando só houver breaker de enriquecimento.
4. Botão "Resetar" funciona apenas para admin e fecha o breaker imediatamente.
