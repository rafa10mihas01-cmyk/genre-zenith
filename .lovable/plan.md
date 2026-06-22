## Contexto da auditoria

Existem **dois `is_default` distintos** no schema — só um é resquício:

| Coluna | Significado | Status |
|---|---|---|
| `spotify_user_tokens.is_default` | Conta primária **por dono** (entre múltiplas contas do mesmo usuário) | ✅ Legítimo, **mantém** |
| `spotify_apps.is_default` | App default **do pool** (NexEngine 10) | ❌ Resquício pré-17-C, **remove** |

### Onde `spotify_apps.is_default` ainda é lido

1. `_shared/spotify.ts::getDefaultSpotifyAppId()` — usada como:
   - Tiebreaker no fallback legado de `getAppCredentials()` (quando `pick_spotify_app` RPC falha)
   - Resolver `appId === "global"` para um app concreto (linhas 204, 224)
   - Selecionar primário em listagens de tokens (linhas 960, 1003)
2. `spotify-auth`, `spotify-invite`, `spotify-public-auth` — escrita/leitura puramente administrativa (garantir exatamente 1 default)
3. `SpotifyBalancerOverviewPanel`, `SpotifyAppsManager` — exibição da estrela "padrão"

A RPC canônica `pick_spotify_app(purpose)` (Fase 16) **já não usa `is_default`** — ranqueia por Capacity + Health Score. Logo, em produção normal o flag praticamente não influencia roteamento.

### Risco residual a tratar antes de dropar

- `appId === "global"` ainda existe em chamadas legadas. Precisa migrar para `pick_spotify_app('write')` antes de remover `getDefaultSpotifyAppId`.
- `purpose='enrich'` no App 10: pós-17-C enrich roda via Cache + Worker, então o purpose também perdeu sentido. Vamos normalizar para `hybrid` (escrita + `/search`).

---

## Plano de execução

### Etapa 1 — Backend: remover dependência funcional do flag

1. Em `_shared/spotify.ts`:
   - Substituir os 2 usos de `getDefaultSpotifyAppId()` para resolver `"global"` (linhas 204, 224) por uma chamada a `pick_spotify_app('write')` com fallback determinístico (primeiro app `status=active` ordenado por `created_at`).
   - Remover `getDefaultSpotifyAppId()` e o tiebreaker `.order("is_default")` no fallback do `getAppCredentials()`.
   - Manter os usos com `spotify_user_tokens.is_default` (linhas 947, 970, 1012) intactos — esses são "primário por dono".

### Etapa 2 — Backend: limpar UX administrativo

2. Em `spotify-auth`, `spotify-invite`, `spotify-public-auth`:
   - Remover toda lógica que marca/desmarca `spotify_apps.is_default` ao criar/editar app ou conta.
   - Manter ordenação por `created_at` nas listagens.

### Etapa 3 — Banco: migração

3. Migration:
   - `ALTER TABLE spotify_apps DROP COLUMN is_default;`
   - `UPDATE spotify_apps SET purpose = 'hybrid' WHERE purpose = 'enrich';` (enrich pós-17-C não existe mais)
   - Não mexer em `spotify_user_tokens.is_default`.

### Etapa 4 — Frontend: limpar referências visuais

4. Remover badge "padrão" e checkbox `is_default` em:
   - `src/components/settings/SpotifyAppsManager.tsx`
   - `src/components/sistema/SpotifyBalancerOverviewPanel.tsx`
   - Linha 415 de `spotify-auth` (`.order("is_default")` no listAppsAdmin).
   
   Manter o badge "padrão" das **contas** (`spotify_user_tokens.is_default`) em `Settings.tsx` e `MinhasPlaylists.tsx` — esses são primário por dono.

### Etapa 5 — Validação

5. Após deploy:
   - Confirmar que `getAppCredentials({purpose:'write'})` segue funcionando (executa create-spotify-playlist em sandbox).
   - Confirmar que `/sistema → Balancer` lista os 4 apps ativos sem erro.
   - Confirmar que admin de Settings ainda permite criar/editar apps (sem o campo "padrão").

---

## Resultado arquitetural

| Antes | Depois |
|---|---|
| App default = roteamento residual + flag administrativo | Conceito eliminado. Único roteador = `pick_spotify_app(purpose)` |
| `purpose='enrich'` no App 10 | Todos os apps ativos = `hybrid` (escrita + exceção `/search`) |
| 4 lugares no código olhando `spotify_apps.is_default` | Zero |

Encerramento natural da 17-C no plano OAuth: roteamento sempre explícito por capacidade e saúde, sem "app especial".
