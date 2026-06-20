# Fase 17-B.6 — Classificação dos Workers do Grupo B

**Status:** Oficial · resultado do pré-trabalho da Fase 17-B.6.
**Regra de classificação:** ver `phase-17b6-architectural-policy.md` §1.

> Grupo A (já migrado e congelado) **não consta nesta lista**. Esta tabela cobre apenas workers que ainda usam `_shared/spotify-client` e são candidatos à migração.

---

## Legenda

- `cc-only` — só lê catálogo público (tracks, artists, albums, search, browse). Seguro para migrar 100% ao Gateway CC.
- `oauth-only` — só faz mutação ou lê `/me/*` / privado. **Não migrar** — permanece em OAuth.
- `hybrid` — lê `/playlists/{id}` (qualquer variante) ou enumera playlists de usuário. **Obrigatório** roteamento §2.3 da política.
- `diagnostic` — ferramenta de homologação/diagnóstico operada manualmente; fora de escopo da migração automática.

---

## Workers do Grupo B reclassificados

| Worker                                  | Antes (17-B.6 v1) | **Depois (oficial)** | Justificativa |
|-----------------------------------------|-------------------|----------------------|---------------|
| `refresh-search-results`                | cc-only           | **cc-only** ✅       | Apenas `GET /v1/search`. Migração SEGURA. |
| `hydrate-genre-reference-tracks`        | cc-only           | **cc-only** ✅       | Apenas `GET /v1/tracks/{id}` e `/v1/artists/{id}`. Migração SEGURA. |
| `fetch-tracks-spotify`                  | cc-only           | **cc-only** ✅       | Só `/v1/tracks/{id}` (single + fan-out). |
| `fetch-spotify-meta`                    | hybrid?           | **hybrid** ⚠️        | Lê `/playlists/{id}` + tracks + artists. Requer §2.3. |
| `backfill-playlist-tracks-count`        | cc-only ❌        | **hybrid** ⚠️        | Lê `/playlists/{id}?fields=tracks(total)` — **falha silenciosa em managed** (incidente 17-B.6). |
| `discover-playlist-owners`              | cc-only ❌        | **hybrid** ⚠️        | Lê `/playlists/{id}?fields=owner(...)` — **falha silenciosa em managed** (incidente 17-B.6). |
| `snapshot-playlist-tracks`              | hybrid?           | **hybrid** ⚠️        | Lê `/playlists/{id}/tracks` paginado. |
| `track-playlist-metrics`                | hybrid?           | **hybrid** ⚠️        | Lê `/playlists/{id}?fields=followers(total)`. |
| `track-external-metrics`                | cc-only?          | **hybrid** ⚠️        | Mistura tracks + leitura de playlist externa (pode ser managed em deals). |
| `enrich-playlists`                      | hybrid            | **hybrid** ⚠️        | Lê `/playlists/{id}` completo. |
| `recheck-archived-followers`            | hybrid            | **hybrid** ⚠️        | `followers(total)` em mix público/managed. |
| `playlist-tracks-list`                  | hybrid            | **hybrid** ⚠️        | Endpoint público para o frontend; mas precisa cobrir managed. |
| `genre-spotify-discover`                | cc-only           | **cc-only** ✅       | Só `/v1/search` + `/v1/artists/*`. |
| `process-catalog-placements`            | oauth-only        | **oauth-only** 🔒    | Cria/modifica playlists managed. NÃO migrar. |
| `apply-playlist-plan`                   | oauth-only        | **oauth-only** 🔒    | Mutação. |
| `apply-playlist-identity`               | oauth-only        | **oauth-only** 🔒    | PUT em playlist. |
| `apply-playlist-suggestions`            | oauth-only        | **oauth-only** 🔒    | Mutação. |
| `apply-managed-cover` / `upload-playlist-cover` | oauth-only | **oauth-only** 🔒  | PUT cover. |
| `apply-meta-plan`                       | oauth-only        | **oauth-only** 🔒    | PUT metadata. |
| `auto-adjust-playlists`                 | oauth-only        | **oauth-only** 🔒    | Reorder/remove tracks. |
| `bot-collect-queue` / `bot-execution-queue` | oauth-only    | **oauth-only** 🔒    | Pipeline bot — escrita. |
| `create-spotify-playlist`               | oauth-only        | **oauth-only** 🔒    | POST. |
| `sync-managed-playlists`                | oauth-only        | **oauth-only** 🔒    | `/v1/me/playlists` + write. |
| `sync-managed-playlist-tracks`          | oauth-only        | **oauth-only** 🔒    | Sync de playlist própria. |
| `backfill-managed-playlist-tracks`      | oauth-only        | **oauth-only** 🔒    | Backfill em managed (privadas). |
| `import-managed-playlist` / `import-account-playlists` | oauth-only | **oauth-only** 🔒 | Owner OAuth. |
| `link-managed-playlist-accounts`        | oauth-only        | **oauth-only** 🔒    | OAuth. |
| `diagnose-managed-playlist`             | oauth-only        | **oauth-only** 🔒    | OAuth (managed). |
| `seo-experiment-apply`                  | oauth-only        | **oauth-only** 🔒    | PUT metadata. |
| `revalidate-deliveries`                 | hybrid            | **hybrid** ✅ (já)   | Já implementado em 17-B.5.2 como referência. |
| `spotify-token-watchdog`                | oauth-only        | **oauth-only** 🔒    | Auth interno. |
| `spotify-auth` / `spotify-public-auth` / `spotify-invite` | oauth-only | **oauth-only** 🔒 | Auth/UX. |
| `spotify-enrichment-worker`             | hybrid            | **hybrid** ⚠️        | Enriquece tracks/artists (CC) + playlists managed (OAuth). |
| `engine-health`                         | diagnostic        | **diagnostic** 🧪    | Saúde — fora de escopo. |
| `app-homologation-test`                 | diagnostic        | **diagnostic** 🧪    | Homologação manual. |
| `spotify-resolution-test`               | diagnostic        | **diagnostic** 🧪    | Teste. |
| `spotify-pipeline-audit`                | diagnostic        | **diagnostic** 🧪    | Auditoria. |
| `spotify-tracks-forensics`              | diagnostic        | **diagnostic** 🧪    | Forense. |
| `spotify-me-playlist-test`              | diagnostic        | **diagnostic** 🧪    | Teste `/me`. |
| `diag-observer-extract`                 | diagnostic        | **diagnostic** 🧪    | Diagnóstico. |

---

## Resumo numérico

| Categoria      | Qtd | Ação na Fase 17-B.6 |
|----------------|-----|---------------------|
| `cc-only` ✅   | 4   | Migrar 1 a 1, com painel de saúde entre cada deploy. |
| `hybrid` ⚠️    | 10  | Migrar **só após** cada um implementar o algoritmo §2.3. |
| `oauth-only` 🔒| 20+ | **Não migrar** — permanecem em `spotify-client`. |
| `diagnostic` 🧪| 7   | Fora de escopo. |

---

## Ordem sugerida de migração (a confirmar antes de iniciar)

**Onda 1 (cc-only, baixíssimo risco):**

1. `refresh-search-results`
2. `hydrate-genre-reference-tracks`
3. `fetch-tracks-spotify`
4. `genre-spotify-discover`

**Onda 2 (hybrid, após Onda 1 validada):**

5. `backfill-playlist-tracks-count`
6. `discover-playlist-owners`
7. `track-playlist-metrics`
8. `recheck-archived-followers`
9. `snapshot-playlist-tracks`
10. `enrich-playlists`
11. `fetch-spotify-meta`
12. `track-external-metrics`
13. `playlist-tracks-list`
14. `spotify-enrichment-worker`

Entre cada onda: executar `gateway-cc-health-panel.sql` e exigir STATUS GREEN.

---

## Pool OAuth — situação pós Etapa A

| App           | Status        | Observação |
|---------------|---------------|------------|
| NexEngine 05  | active        | Owner Mamute. |
| NexEngine 06  | quarantined   | development_mode bloqueado (Spotify). |
| NexEngine 08  | active (alta taxa de erro) | Investigar separadamente. |
| **NexEngine 09** | **quarantined (perm.)** | invalid_client em 100% das chamadas — removido nesta fase. |
| NexEngine 10  | active        | Gateway CC primário. |
| NexEngine 02  | retired       | — |
| NexEngine     | quarantined   | Antigo. |
