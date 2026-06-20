# Fase 17-B.6 — Política Arquitetural Oficial: Gateway CC × OAuth

**Status:** Oficial · vinculante para todos os workers atuais e futuros.
**Vigência:** A partir da Fase 17-B.6.

---

## 1. Princípio fundamental

> Todo worker que faz I/O com a API do Spotify **deve declarar explicitamente** seu caminho de autenticação. Nenhuma decisão ad-hoc é permitida.

A classificação possível é uma de três:

| Categoria      | Significado                                                                 | Helper obrigatório |
|----------------|------------------------------------------------------------------------------|--------------------|
| `cc-only`      | Só faz leitura de recursos **comprovadamente públicos** (catálogo)          | `_shared/catalog-gateway.ts` (`ccFetch`, `gatewayGet*`) |
| `oauth-only`   | Requer token de usuário (mutação, `/me/*`, recursos privados)               | `_shared/spotify-client.ts` (`getUserToken`, `withSpotifyClient`) |
| `hybrid`       | Mistura leituras públicas + privadas; decide **em runtime** por recurso     | Ambos, com roteamento determinístico (ver §3) |

---

## 2. Regras de roteamento

### 2.1. Recursos sempre públicos → **Gateway CC**

- `GET /v1/tracks/{id}` e batch
- `GET /v1/artists/{id}`, top-tracks, related-artists
- `GET /v1/albums/{id}`
- `GET /v1/search`
- `GET /v1/browse/*`

Workers que só tocam nesses endpoints são `cc-only`.

### 2.2. Recursos que exigem autenticação do dono → **OAuth**

- Qualquer mutação (`POST`, `PUT`, `DELETE`).
- `GET /v1/me/*`.
- Listagem completa de playlists de um usuário (incluindo privadas).
- Upload de cover.

Workers que só tocam nesses endpoints são `oauth-only`.

### 2.3. Leituras de `GET /v1/playlists/{id}` (e `?fields=`, `/tracks`) → **HÍBRIDO POR PADRÃO**

Esta é a regra mais crítica, motivada pela **falha silenciosa do Gateway CC** documentada na matriz de compatibilidade.

**Algoritmo obrigatório** para qualquer leitura de `/v1/playlists/{id}`:

```
1. SELECT 1 FROM managed_playlists WHERE spotify_playlist_id = :id LIMIT 1
2. SE encontrado:
     → usar OAuth do owner (via spotify-client / getUserToken)
3. SE NÃO encontrado:
     → usar Gateway CC (ccFetch / getPlaylistItems)
4. EM CASO DE 404/403 via CC:
     → NÃO promover automaticamente a OAuth (pode ser playlist apagada).
     → Logar e marcar como inacessível.
```

Implementação de referência: `supabase/functions/revalidate-deliveries/index.ts` (Fase 17-B.5.2).

---

## 3. Proibições

- ❌ Decidir CC vs OAuth com base em try/catch silencioso (HTTP 200 com payload vazio não dispara catch).
- ❌ Misturar CC e OAuth no mesmo helper sem roteamento explícito.
- ❌ Usar `fetch` direto contra `api.spotify.com` em código novo — sempre passar por um helper de `_shared/`.
- ❌ Adicionar novos workers sem classificá-los em `phase-17b6-worker-classification.md`.
- ❌ Reativar `NexEngine 09` no pool sem novo client_id válido (quarentena permanente até nova credencial).

---

## 4. Processo para criar/alterar um worker

1. Declarar a categoria do worker (`cc-only` / `oauth-only` / `hybrid`) na primeira linha de comentário do `index.ts`:
   ```ts
   // @spotify-auth-class: hybrid
   ```
2. Registrar em `docs/ops/phase-17b6-worker-classification.md`.
3. Se `hybrid`, implementar o algoritmo §2.3 sem variações.
4. Em PRs de migração: incluir consulta SQL prova de que nenhuma playlist managed está sendo lida via CC após o deploy.

---

## 5. Auditoria recorrente

A query padrão para detectar violações está em `docs/ops/gateway-cc-health-panel.sql`. Critérios adicionais introduzidos nesta fase:

- **Violação A:** linhas em `spotify_call_log` com `app_name` nulo (CC), `endpoint LIKE '%/playlists/%'`, `http_status = 200`, e `playlist_id` que existe em `managed_playlists`.
- **Violação B:** uso de `pick_spotify_app` retornando um app `quarantined` (não deve acontecer; sentinela).
