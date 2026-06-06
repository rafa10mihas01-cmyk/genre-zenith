# Plano — Blindagem Spotify Fase A (com ajustes obrigatórios)

Objetivo: garantir que um app Spotify com auth inválida **não derrube** diagnose/sync/playlists. Apenas infra — diagnose, score, benchmark, playlists, campanhas ficam intactos.

---

## 1. Migration — `spotify_apps` ganha estado de saúde + rastreabilidade

Adicionar 4 colunas + 3 funções SQL:

```sql
ALTER TABLE public.spotify_apps
  ADD COLUMN auth_failure_count    int          NOT NULL DEFAULT 0,
  ADD COLUMN last_auth_failure_at  timestamptz,
  ADD COLUMN quarantined_until     timestamptz,
  ADD COLUMN quarantine_reason     text;        -- AUTH_INVALID | AUTH_MISSING | RATE_LIMIT | SPOTIFY_5XX | MANUAL

CREATE FUNCTION public.mark_spotify_app_auth_failure(
  p_app_id uuid,
  p_reason text DEFAULT 'AUTH_INVALID',
  p_threshold int DEFAULT 5,
  p_quarantine_minutes int DEFAULT 30
) RETURNS jsonb ...
-- incrementa contador; ao atingir threshold:
--   quarantined_until = now() + interval
--   quarantine_reason = p_reason
--   last_auth_failure_at = now()

CREATE FUNCTION public.reset_spotify_app_auth_failures(p_app_id uuid) ...
-- chamada em sucesso: zera contador, NÃO mexe em quarantined_until

CREATE FUNCTION public.expire_spotify_app_quarantines() ...
-- UPDATE spotify_apps SET quarantine_reason=NULL WHERE quarantined_until < now()
```

`status='quarantined_auto'` é derivado: `status='active' AND quarantined_until > now()`. Coluna `status` permanece para quarentena manual.

---

## 2. `_shared/spotify.ts` — selector com failover + pré-validação

### Novidades

- **`SpotifyAuthInvalidError`** — subclasse de `SpotifyApiError` (para não quebrar `catch (e instanceof SpotifyApiError)` existentes). Carrega `appId` e `reason`.
- **`SpotifyAuthMissingError`** — lançada **antes de qualquer fetch** quando um endpoint exige user token e o app escolhido não tem `spotify_user_tokens` válido. Reason = `AUTH_MISSING_USER_TOKEN`. Custo: 0ms, sem request, sem 401.
- **`markAppAuthFailure(appId, reason)`** — chama RPC, fire-and-forget.

### `getAppCredentials(opts?)` refatorada

```ts
getAppCredentials({ appId?, excludeAppIds?: string[] })
```

- Chama `expire_spotify_app_quarantines()` (fail-silent, <5ms).
- Filtra `status='active' AND (quarantined_until IS NULL OR quarantined_until < now())`.
- Aplica `excludeAppIds` (failover).
- Ordem preservada: `is_default DESC, created_at ASC`.
- Se ninguém saudável → lança `NO_HEALTHY_SPOTIFY_APP`.

### `getSpotifyToken({ excludeAppIds?, requireUserAuth? })` refatorada

- Quando `requireUserAuth=true`:
  - Após escolher app, consulta `spotify_user_tokens` daquele app.
  - Se NENHUM token válido (ou todos expirados sem refresh): **lança `SpotifyAuthMissingError`** sem fazer request.
- Caso contrário: comportamento atual (`client_credentials`).

### Hook 401 nos wrappers

`guardedSpotifyFetch` e o monkey-patch global: quando `r.status === 401` em `api.spotify.com` (não `accounts`) → `markAppAuthFailure(appId, 'AUTH_INVALID')` em fire-and-forget. Não muda o contrato (continua devolvendo o `Response`).

---

## 3. `_shared/spotify-playlist.ts` — fail-fast em 401

`defaultSpotifyFetch`: quando `r.status === 401` → lança **`SpotifyAuthInvalidError`** (não `SpotifyApiError` genérico). Callers que não tratam continuam funcionando (ainda é exception). Callers críticos (snapshot, diagnose) podem `catch` específico para failover.

**Pré-validação adicional:** `listPlaylistTrackRefs` e variantes que tocam endpoints `/v1/playlists/{id}/items` aceitam parâmetro opcional `{ requiresUserAuth?: boolean }`. Se true e o token recebido for `client_credentials` (heurística: token sem `user_id` em cache, ou flag explícita do caller), aborta com `SpotifyAuthMissingError`.

---

## 4. `snapshot-playlist-tracks/index.ts` — streak breaker + failover local

```text
let currentAppId = ...
let token        = await getSpotifyToken({ requireUserAuth: true para playlists privadas })
let consecutiveAuthFailures = 0
let triedApps   = new Set([currentAppId])

for playlist in list:
  try:
    refs = await fetchRefs(token)
    consecutiveAuthFailures = 0
  catch SpotifyAuthMissingError:
    # falhou em 0ms — não chegou no Spotify
    log AUTH_MISSING_USER_TOKEN { app, playlist }
    markAppAuthFailure(currentAppId, 'AUTH_MISSING')
    try failover (excludeAppIds=triedApps) → senão break AUTH_BREAKER_OPEN
    continue (retenta mesma playlist)
  catch SpotifyAuthInvalidError:
    consecutiveAuthFailures++
    markAppAuthFailure(currentAppId, 'AUTH_INVALID')
    if consecutiveAuthFailures == 1:
      try { token = await getSpotifyToken({ excludeAppIds: [...triedApps] }) }
      catch NO_HEALTHY_SPOTIFY_APP: break AUTH_BREAKER_OPEN
      triedApps.add(currentAppId = novo)
      continue
    if consecutiveAuthFailures >= 5:
      break AUTH_BREAKER_OPEN
```

Resposta JSON ganha:
```json
"auth_breaker": {
  "triggered": true|false,
  "quarantined": [{ "app_id", "reason", "until" }],
  "failover_used": true|false,
  "final_app_id": "..."
}
```

---

## 5. Teste obrigatório de failover (gate de deploy)

**Antes de marcar a Fase A como entregue**, rodar cenário controlado:

1. Garantir 2+ apps `active` no pool (ex.: NexEngine 02 e 05).
2. Forçar NexEngine 02 a ser escolhido primeiro (`is_default=true`) e remover/invalidar seu token (cenário do incidente).
3. Disparar `snapshot-playlist-tracks` com uma playlist privada.
4. **Resultado esperado:**
   - ✓ 1 chamada → 401 → `markAppAuthFailure` → quarentena imediata (threshold 1 nesse teste, ou contador já em 4)
   - ✓ failover para NexEngine 05
   - ✓ snapshot conclui com `final_app_id = NexEngine 05`
   - ✓ nenhum 429
   - ✓ nenhum breaker global
   - ✓ `spotify_apps[02].quarantine_reason = 'AUTH_INVALID'`
   - ✓ `spotify_apps[02].quarantined_until = now()+30min`
5. **Se qualquer item falhar → reverter, não liberar.**

Documentar o resultado do teste no comentário do deploy.

---

## 6. Arquivos tocados

| Arquivo | Mudança |
|---|---|
| `supabase/migrations/<ts>_spotify_app_health.sql` | 4 colunas + 3 funções |
| `supabase/functions/_shared/spotify.ts` | `SpotifyAuthInvalidError`, `SpotifyAuthMissingError`, `markAppAuthFailure`, `getAppCredentials({excludeAppIds})`, `getSpotifyToken({excludeAppIds, requireUserAuth})`, hook 401 nos wrappers |
| `supabase/functions/_shared/spotify-playlist.ts` | `defaultSpotifyFetch` joga `SpotifyAuthInvalidError` em 401; opção `requiresUserAuth` |
| `supabase/functions/snapshot-playlist-tracks/index.ts` | streak counter, failover local, resposta com `auth_breaker` |

**NÃO** toca: `diagnose-managed-playlist`, lógica de score/benchmark/playlists/campanhas, UI. Demais edge functions herdam o failover de `getSpotifyToken()` sem mudança de contrato.

---

## 7. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| `SpotifyAuthInvalidError` quebra caller que esperava `SpotifyApiError` | é subclasse — `instanceof SpotifyApiError` continua true |
| Quarentena agressiva derruba pool inteiro em incidente Spotify-wide | threshold 5 + TTL 30min; se NENHUM app saudável, `getAppCredentials` faz fallback pra quarentenado (padrão atual `activeRows.length>0 ? activeRows : allRows`) |
| Pré-validação adiciona 1 query extra | `expire_spotify_app_quarantines()` é UPDATE indexado <5ms |
| `requireUserAuth` mal classificado pode falhar requests públicos válidos | flag opcional, default `false`; apenas `snapshot-playlist-tracks` ativa para playlists privadas |
| Fase B (toasts/dashboard) fica de fora | confirmado pelo usuário — só executar após Fase A validada e teste passado |

---

## 8. Critério de sucesso resumido

Cenário "5× 401 consecutivos" do incident:

```text
ANTES: 746 × 401 em 3 min → 429 → breaker global 12h
DEPOIS: 1 × 401 → quarentena 30min (motivo registrado) → failover → operação continua
```

Ou (cenário mais comum):

```text
ANTES: snapshot dispara request em playlist privada com client_credentials → 401 garantido
DEPOIS: SpotifyAuthMissingError em 0ms → failover para app com user token → 200 OK
```
