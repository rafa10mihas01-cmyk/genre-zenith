# FASE 6.C.2 — Auditoria do Balanceamento dos Apps Spotify

> Forense. Sem alteração de código ou banco. Somente evidências.

---

## ITEM 1 — Apps Spotify cadastrados (`spotify_apps`)

| App | ID (curto) | status | is_default | quarentena | usuários OAuth | breaker (last_429_at) |
|---|---|---|---|---|---|---|
| **NexEngine 10** | a7ed22bc… | active | **TRUE** | — | 0 | 2026-06-17 00:15 |
| NexEngine 09 | 3a05802d… | active | f | — | 0 | — |
| NexEngine 08 | e9a23b28… | active | f | — | 4 | 2026-06-14 12:49 |
| **NexEngine 07** | c71fb93a… | active | f | — | **5** | **2026-06-17 05:15** |
| NexEngine 06 | 20c9751d… | active | f | — | 5 | 2026-06-17 03:30 |
| NexEngine 05 | 821cb0cc… | active | f | — | 3 | 2026-06-17 02:00 |
| Nexengine04 | 5eae32c6… | **quarantined** | f | — | 0 | — |
| nexengine-03 | 091a1854… | **quarantined** | f | — | 0 | 2026-06-02 |
| NexEngine | d0676425… | **quarantined** | f | — | 0 | — |
| NexEngine 02 | d17f0d09… | **retired** | f | — | 0 | 2026-06-06 |

Estado atual do `spotify_circuit_breaker` para todos os apps com registro: **`closed`** (nenhum bloqueado no momento). Os timestamps em `last_429_at` são de **17/06** — ou seja, o evento citado pelo usuário (NexEngine 07 em open) já foi normalizado pelo cron de expiração.

---

## ITEM 2 — Onde o app é escolhido

**Arquivo:** `supabase/functions/_shared/spotify.ts`
**Função:** `getAppCredentials(appIdOrOpts?)` — linhas **549-616**
**Selector default:** `getDefaultSpotifyAppId()` — linhas **524-535**

Pseudo-algoritmo (linhas 576-593):

```sql
SELECT … FROM spotify_apps
 WHERE status = 'active'
 ORDER BY is_default DESC, created_at ASC;
-- filter healthy = !excludeAppIds && (quarantined_until IS NULL OR < now())
-- picked = healthy[0] ?? fallback[0] ?? allActive[0]
```

Classificação:
- ❌ Round Robin
- ❌ Random
- ❌ Least Used
- ✅ **Prioridade fixa + Primeiro disponível** — sempre o `is_default=true` mais antigo entre os saudáveis, com `excludeAppIds` opcional para failover sequencial.

Não há contagem de carga, de RPM, nem balanceamento estatístico. Quem é `is_default=true` recebe **100%** das chamadas app-only até cair em quarentena/excludeAppIds.

---

## ITEM 3 — Chamadas Spotify nas últimas 24 h (`spotify_call_log`)

> Observação importante: o `spotify-enrichment-worker` chama `fetch()` direto (não passa por `spotifyFetch`), portanto **suas chamadas não aparecem em `spotify_call_log`**. Por isso a tabela abaixo cobre todas as funções **exceto** o worker; depois reconstruo o worker analiticamente.

```
app_id (curto)          function_name                  calls   429   circuit_open
20c9751d… (NexEng 06)   bot-execution-queue              205     0     0
20c9751d… (NexEng 06)   process-catalog-placements       156     0     0
821cb0cc… (NexEng 05)   process-catalog-placements        90     0    90
c71fb93a… (NexEng 07)   process-catalog-placements       341     0   336   ← TODAS no breaker
e9a23b28… (NexEng 08)   process-catalog-placements        60     0     0
a7ed22bc… (NexEng 10)   link-managed-playlist-accounts     7     0     0
a7ed22bc… (NexEng 10)   resolve-catalog-track              2     0     0
a7ed22bc… (NexEng 10)   distribute-catalog-track           1     0     0
(NULL = app-only/token-watchdog)                         437     0     0
```

NexEngine 07: 341 chamadas, **0 efetivas** (336 bloqueadas pelo breaker antes mesmo de sair) — é exatamente o sintoma observado.

---

## ITEM 4 — As ~2.015 tracks novas

O `spotify-enrichment-worker` usa `getAppToken()` **sem `appId`** (`spotify-enrichment-worker/index.ts:58`). Isso entra no caminho default do `getAppCredentials()`, que sempre escolhe `is_default DESC, created_at ASC`.

→ Em condições saudáveis, **100% das 2.015 tracks foram enriquecidas via NexEngine 10** (único app com `is_default=true`).

| App | % do enrichment worker |
|---|---|
| NexEngine 10 | **100%** |
| Todos os outros (05, 06, 07, 08, 09) | **0%** |

Conclusão direta: as 2.015 tracks **não passaram por NexEngine 07** em momento algum. O 429 do app 07 não veio do enrichment-worker.

---

## ITEM 5 — Comportamento do Circuit Breaker

Arquivos relevantes:
- `_shared/spotify.ts`: `assertSpotifyCircuitClosed()`, `installSpotifyCircuitFetchGuard()`.
- `_shared/spotify-client.ts:208`: trata `SpotifyCircuitOpenError`.
- `_shared/spotify.ts:524-535` e `573-593`: filtra `quarantined_until > now()` na seleção.

Comportamento por pergunta:

1. **Sai imediatamente da rotação?** Apenas se `quarantined_until` for setado **e** o caller estiver no caminho `getAppCredentials()` sem appId. Sim para chamadas app-only via `getAppToken()`.
2. **Novas chamadas deixam de escolhê-lo?** Sim no caminho app-only (filtro `quarantined_until` linha 587). **Não** no caminho de user-token: `getUserToken(userId)` → `refreshUserToken` → `getAppCredentials(row.app_id)` (linha 701) → carrega o app **fixo** do usuário, mesmo se quarentenado/breaker aberto.
3. **Outro App assume automaticamente?** Só para client-credentials puro. Para user-token, **não há failover** — o usuário está amarrado ao app que emitiu seu refresh-token (restrição do OAuth da Spotify).
4. **Existe failover?** Existe `excludeAppIds` em `GetSpotifyTokenOpts` (linha 620) e `getAppCredentials({excludeAppIds})`, mas **só é invocado quando o caller passa explicitamente** — não há failover automático no worker nem no `process-catalog-placements`. Nenhum caller atual usa `excludeAppIds`.
5. **Retry em outro App?** Não. `SpotifyCircuitOpenError` é propagado; o caller decide o que fazer (worker libera o job; placements re-enfileiram).

---

## ITEM 6 — Simulação do cenário NexEngine 07

NexEngine 07 tem **5 usuários OAuth amarrados** (`spotify_user_tokens.app_id`):

```
app_id                                  users
20c9751d… (NexEng 06)                     5
c71fb93a… (NexEng 07)                     5   ← afetados
e9a23b28… (NexEng 08)                     4
821cb0cc… (NexEng 05)                     3
```

`process-catalog-placements:183` chama `getUserToken(ownerId)`. O refresh-token Spotify só funciona com o `client_id`/`client_secret` do **app que emitiu o refresh**. **Não é tecnicamente possível** trocar para outro app sem reautenticar o usuário.

→ As 336 chamadas que bateram no breaker do NexEngine 07 nas últimas 24 h **não poderiam ter sido redistribuídas** para apps saudáveis dentro da arquitetura atual de OAuth Spotify. Elas pertencem a 5 contas humanas atadas àquele `client_id`.

---

## ITEM 7 — Configurações que fixam app

| Vínculo | Onde | Efeito |
|---|---|---|
| `is_default=true` em `spotify_apps` | `spotify.ts:530-531`, `581` | NexEngine 10 recebe 100% das chamadas app-only. |
| `spotify_user_tokens.app_id` | `spotify.ts:701` (`refreshUserToken` lê `row.app_id`) | Cada usuário OAuth está **fixo** ao app que emitiu o refresh-token. Sem failover. |
| `spotify_tokens.singleton_key = app:<app_id>` | `spotify.ts:636-648` | Cache de token client-credentials é per-app. |
| `appHint`/`appId` em `SpotifyFetchOptions` | `spotify-client.ts:64,74` | Aceito, mas **nenhum caller** usa hoje (busca `rg "appHint\|appId:" supabase/functions/` → só registry interno). |
| `excludeAppIds` em `GetSpotifyTokenOpts` | `spotify.ts:620` | Existe mecanismo de exclusão; **nenhum caller invoca**. |
| `quarantined_until` em `spotify_apps` | `spotify.ts:587` | Tira o app da rotação **app-only**; não afeta user-token. |
| Variáveis `SPOTIFY_CLIENT_ID/SECRET` | `spotify.ts:604-615` | Fallback final quando não há app cadastrado. Hoje irrelevante. |

---

## ITEM 8 — Existe concentração de carga?

**SIM.**

- **Causa raiz #1 (estrutural):** `is_default=true` único + ordenação determinística → todo tráfego app-only (incluindo o `spotify-enrichment-worker` que processou as 2.015 tracks) vai para **NexEngine 10**.
- **Causa raiz #2 (OAuth Spotify):** Cada `spotify_user_tokens.app_id` é fixo. Os 5 usuários atrelados a **NexEngine 07** geram tráfego concentrado nesse app sempre que o `process-catalog-placements` roda sobre suas playlists — sem failover possível.
- **Componente que faz a concentração:** `getAppCredentials()` (linha 549) para app-only + `refreshUserToken()` (linha 700) para user-token. Ambos respeitam vinculação estática.

---

## ITEM 9 — O bloqueio do NexEngine 07 foi consequência do cold-start do cache?

**Não. O cold-start atingiu NexEngine 10**, não o 07.

Evidências:
1. As 2.015 tracks foram enriquecidas via `spotify-enrichment-worker` → `getAppToken()` sem `appId` → **NexEngine 10** (único `is_default=true`).
2. `spotify_call_log` mostra que o tráfego concentrado em **NexEngine 07** vem de `process-catalog-placements` (341 chamadas, 336 abortadas em breaker), função que usa **user-token** atrelado aos 5 usuários do app 07.
3. `last_429_at` de NexEngine 07 = 2026-06-17 05:15. O breaker abriu numa janela anterior independente do ciclo de enriquecimento.

→ O bloqueio do NexEngine 07 e o cold-start do cache (NexEngine 10) são **dois eventos paralelos e desacoplados**. O balanceamento atual contribui indiretamente: como user-tokens são fixos, qualquer pico de operações sobre playlists daqueles 5 usuários satura **somente** o app 07 sem alívio possível pelos demais.

---

## CONCLUSÃO

1. **O algoritmo de distribuição está correto?**
   Correto **funcionalmente** (escolhe app saudável determinístico, respeita quarentena), mas **não é balanceamento** — é prioridade fixa.

2. **Existe balanceamento real entre os Apps?**
   **Não.** App-only sempre cai no `is_default`. User-token é amarrado por OAuth. Não há round-robin, least-used, nem token-bucket cruzado.

3. **O App 07 recebeu carga desproporcional?**
   **Sim**, mas pela dimensão **user-token** (5 usuários OAuth atrelados). Não foi escolha do balanceador — foi consequência de cada usuário ter autenticado historicamente com aquele `client_id`.

4. **Gargalo na seleção de Apps?**
   Sim:
   - Único `is_default=true` (NexEngine 10) absorve 100% das chamadas app-only — incluindo o worker de enrichment.
   - Ausência de failover automático quando breaker abre no caminho user-token.
   - `appHint`/`excludeAppIds` existem na API mas nenhum caller os usa.

5. **Oportunidades de melhoria sem alterar arquitetura:**
   - Distribuir `is_default` rotativo ou implementar round-robin entre apps `active` saudáveis no `getAppCredentials()` sem appId (5 linhas em `spotify.ts:577-593`).
   - Usar `excludeAppIds` automaticamente quando `spotify_circuit_breaker.status='open'` para o caminho app-only.
   - Migrar usuários OAuth dos apps com poucos vínculos para reduzir concentração (admin manual; requer reautenticação).
   - Mover o `spotify-enrichment-worker` para usar `spotifyFetch` (observabilidade) e aceitar `appId` rotativo por job.

Nenhuma alteração feita. Apenas evidências.
