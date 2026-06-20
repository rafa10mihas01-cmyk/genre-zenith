# Fase 17-B.6 — Matriz de Compatibilidade Gateway CC × OAuth

**Status:** Oficial · referência para todas as migrações futuras de workers de leitura.
**Última atualização:** Fase 17-B.6 (pré-trabalho).

---

## 1. Contexto

Durante a tentativa inicial de migrar workers do Grupo B para o Catalog Gateway (Client Credentials, doravante **CC**), observou-se um comportamento crítico:

> O Gateway CC pode retornar **HTTP 200 com payload parcial** (campos omitidos) quando a playlist é **managed/privada**, em vez de retornar 403/404.

Isso provoca **corrupção silenciosa de dados** (ex.: `tracks_count` sobrescrito com 0). A matriz abaixo documenta, para cada formato de leitura usado pelos workers, o comportamento esperado em playlists públicas e managed.

Convenções:

- **CC** = chamada via Catalog Gateway (Client Credentials, sem usuário).
- **OAuth** = chamada com `Authorization: Bearer <user_token>` (Owner do recurso).
- **Managed** = playlist em `managed_playlists` (criada/possuída por contas do ecossistema; pode ser privada).
- **Pública** = playlist de terceiro, marcada como pública no Spotify.

---

## 2. Matriz `GET /v1/playlists/{id}` e variantes `?fields=`

| # | Endpoint / Fields                                        | Pública (CC) | Pública (OAuth) | Managed Privada (CC)                  | Managed (OAuth)        | Caminho recomendado |
|---|----------------------------------------------------------|--------------|------------------|---------------------------------------|------------------------|---------------------|
| 1 | `GET /playlists/{id}` (sem fields)                       | 200, payload completo | 200, payload completo | 200, payload **parcial/vazio** (sem `tracks`, sem `owner` em alguns shapes) ou 404 | 200, payload completo  | **HÍBRIDO** |
| 2 | `GET /playlists/{id}?fields=tracks(total)`               | 200, `tracks.total` correto | 200, idem | 200 com `tracks: { total: 0 }` (**silencioso!**) | 200, total correto | **HÍBRIDO** |
| 3 | `GET /playlists/{id}?fields=followers(total)`            | 200, correto | 200, idem | 200, com `followers.total` zerado ou ausente | 200, correto | **HÍBRIDO** |
| 4 | `GET /playlists/{id}?fields=owner(id,display_name,uri)`  | 200, correto | 200, idem | 200, `owner` **ausente** (campo omitido) | 200, correto | **HÍBRIDO** |
| 5 | `GET /playlists/{id}?fields=name,description,images`     | 200, correto | 200, idem | 200, parcial (alguns campos vazios) ou 404 | 200, correto | **HÍBRIDO** |
| 6 | `GET /playlists/{id}/tracks?limit=100&offset=…`          | 200, items completos | 200, idem | 200 com `items: []` ou 404 | 200, items completos | **HÍBRIDO** |
| 7 | `GET /playlists/{id}?fields=tracks.items(track(id,uri))` | 200, correto | 200, idem | 200 com `tracks.items: []` (**silencioso!**) | 200, correto | **HÍBRIDO** |

> **Regra empírica:** *qualquer* leitura de `/playlists/{id}` (com ou sem `fields=`) é **NÃO SEGURA** via CC para playlists managed. O servidor não devolve erro — devolve dados parciais.

---

## 3. Matriz para recursos puros (sem ambiguidade pública/privada)

| Endpoint                                  | CC seguro? | Observações |
|-------------------------------------------|------------|-------------|
| `GET /v1/tracks/{id}`                     | ✅ Sim     | Catálogo público. Já migrado (Grupo A). |
| `GET /v1/tracks?ids=…` (batch)            | ⚠️ Indireto | Pool atual não suporta batch — usar `gatewayGetTracksBatch()` (fan-out single). |
| `GET /v1/artists/{id}`                    | ✅ Sim     | Catálogo público. |
| `GET /v1/artists?ids=…` (batch)           | ⚠️ Indireto | Igual a tracks — fan-out via gateway helper. |
| `GET /v1/artists/{id}/top-tracks`         | ✅ Sim     | Catálogo público. |
| `GET /v1/artists/{id}/related-artists`    | ✅ Sim     | Catálogo público. |
| `GET /v1/albums/{id}`                     | ✅ Sim     | Catálogo público. |
| `GET /v1/search`                          | ✅ Sim     | Já validado (Grupo A). |
| `GET /v1/browse/categories/…`             | ✅ Sim     | Editorial público. |
| `GET /v1/me/*`                            | ❌ Não     | Requer OAuth obrigatoriamente. |
| `GET /v1/users/{id}/playlists`            | ⚠️ Parcial | CC só retorna públicas. Para enumerar managed/privadas → OAuth do owner. |
| `POST/PUT/DELETE /v1/playlists/{id}/…`    | ❌ Não     | Mutação requer OAuth do owner. |

---

## 4. Sintomas observáveis da falha silenciosa

Ao auditar logs/dados após uma migração CC mal feita, procurar por:

- `tracks_count` ou `followers` caindo para `0` em IDs de `managed_playlists`.
- Campo `owner` ausente em snapshots recém-criados.
- HTTP 200 em `spotify_call_log` para playlist managed, mas com `duration_ms` muito baixo (< 50ms) — indicativo de payload pequeno/vazio.
- Ausência de erro 403/404 correspondente.

---

## 5. Procedimento para adicionar nova entrada à matriz

1. Identificar formato exato do endpoint usado pelo worker.
2. Testar em par: uma playlist **pública conhecida** + uma **managed privada conhecida**.
3. Registrar status HTTP + payload textual (campos presentes/ausentes).
4. Atualizar tabela acima.
5. Atualizar a classificação do worker em `phase-17b6-worker-classification.md`.
