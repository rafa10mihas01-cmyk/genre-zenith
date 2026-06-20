# Fase 17-B.6 — Classificação dos Workers do Grupo B (REVISADA)

**Status:** Oficial · resultado da reauditoria pós tentativa frustrada da Onda 1.
**Regra de classificação:** ver `phase-17b6-architectural-policy.md` §1.
**Método:** leitura completa do `index.ts` + rastreio dos helpers de `_shared/` + cruzamento com `managed_playlists` / `spotify_user_tokens` / `search_results`.

> Esta versão **invalida** a tabela anterior. A premissa de que `refresh-search-results`, `hydrate-genre-reference-tracks`, `fetch-tracks-spotify` e `genre-spotify-discover` eram `cc-only` estava incorreta. Nenhum deles é seguro para CC puro.

---

## Auditoria dos 4 candidatos originais

### 1. `refresh-search-results` → **HYBRID** ⚠️

| Item | Evidência |
|------|-----------|
| Endpoint efetivo | `GET /v1/playlists/{id}?fields=name,images,followers(total),tracks(total)` (via `getPlaylistMeta` em `_shared/spotify-playlist.ts:253`) |
| Helper usado | `getPlaylistMeta` (legado, OAuth via `getAppToken`) |
| Padrão na matriz | #2 + #3 + #5 — **falha silenciosa em managed** |
| Cruzamento | `search_results` ∩ `managed_playlists` = **17 linhas** |
| Risco se migrar para CC puro | Sobrescrever `seguidores`, `total_musicas`, `imagem_url` de 17 managed com NULL/0 sem erro HTTP |
| Veredicto | **HYBRID** — exige roteamento §2.3 antes de migrar |

### 2. `hydrate-genre-reference-tracks` → **HYBRID** ⚠️

| Item | Evidência |
|------|-----------|
| Endpoint efetivo | `GET /v1/playlists/{id}/items?fields=items(track(...))` (via `listPlaylistTracksRich` em `_shared/spotify-playlist.ts:400`) |
| Helper usado | `listPlaylistTracksRich` (legado, OAuth) |
| Padrão na matriz | #7 — **falha silenciosa em managed** (200 com `items: []`) |
| Cruzamento | Itera sobre `search_results` (mesmas 17 managed presentes) |
| Risco se migrar para CC puro | `search_tracks` recebe zero linhas para 17 managed, marcando-as como "sem DNA musical" silenciosamente |
| Veredicto | **HYBRID** — exige roteamento §2.3 antes de migrar |

### 3. `fetch-tracks-spotify` → **HYBRID** ⚠️

| Item | Evidência |
|------|-----------|
| Endpoint efetivo | `GET /v1/playlists/{id}/items?fields=items(track(...))` (mesmo helper acima) |
| Helper usado | `listPlaylistTracksRich` |
| Padrão na matriz | #7 — falha silenciosa em managed |
| Cruzamento | **On-demand** com `playlist_id` no body — caller pode passar qualquer ID, inclusive um de `managed_playlists` (898 candidatas). Já usado por `create-spotify-playlist` e `extract-blueprints` em fluxos que envolvem managed |
| Risco se migrar para CC puro | Retorno vazio para 898 managed, com `saved=0`, sem erro |
| Veredicto | **HYBRID** — exige roteamento §2.3 antes de migrar |

### 4. `genre-spotify-discover` → **JÁ MIGRADO + HYBRID DE BAIXO RISCO** ✅⚠️

| Item | Evidência |
|------|-----------|
| Estado atual | **Já usa `ccFetch` do Catalog Gateway** desde Fase 17-B anterior (linha 11 + 56 + 172) |
| Endpoints | `GET /v1/search?type=playlist` (padrão público — SEGURO) + `GET /v1/playlists/{id}?fields=followers(total),tracks(total,items(...)),owner(id)` (padrões #3 + #4 + #7 da matriz) |
| Cruzamento | IDs vêm de `/v1/search`, que só indexa playlists **públicas**. Managed playlists públicas no banco hoje = **0** (`spotify_playlist_cache.public_flag=true ∩ managed_playlists`) |
| Calls últimos 7 dias | 4 chamadas CC. Sem regressões reportadas no painel. |
| Risco real | Hoje **nulo** (0 managed públicas). Risco futuro se algum dia uma managed for tornada pública pelo owner → falha silenciosa em campos detalhados |
| Veredicto | **HYBRID-PERMISSIVO** — não exige rollback imediato, mas deve ganhar o guard §2.3 na próxima onda pra blindar contra mudança futura de visibilidade |

---

## Conclusão crítica

**A Onda 1 (`cc-only`) NÃO EXISTE.** Todos os 4 workers candidatos lêem `/playlists/{id}` direta ou indiretamente.

Implicações:

1. O plano original (4 ondas: cc-only primeiro, hybrid depois) deve ser **abandonado** ou **redefinido**.
2. Todos os workers restantes do Grupo B caem em `hybrid` ou `oauth-only`. Não há atalho `cc-only`.
3. O único caminho seguro é: **migrar 1 a 1, sempre implementando §2.3 desde o primeiro deploy**.

---

## Plano revisado (proposta para aprovação)

Ordem por risco crescente (mais baixo risco primeiro, para testar o padrão híbrido):

| # | Worker | Justificativa da ordem |
|---|--------|------------------------|
| 1 | `fetch-tracks-spotify` | On-demand, baixo volume, rollback trivial (não roda em cron). Bom alvo de teste. |
| 2 | `refresh-search-results` | Cron mas com job_name claro, fácil monitorar. 17 managed conhecidas. |
| 3 | `hydrate-genre-reference-tracks` | Bound a `requireTeamAccess`, disparo manual frequente. |
| 4 | `genre-spotify-discover` | Hardening — adicionar guard §2.3 mesmo já estando em CC, antes de o cenário "managed pública" aparecer. |

Cada deploy:
- Implementa lookup em `managed_playlists` → OAuth via `_shared/spotify-client`; público → `ccFetch` / `getPlaylistMeta` / `getPlaylistItems` do gateway.
- Mantém helper legado para o ramo OAuth.
- Roda painel `gateway-cc-health-panel.sql` antes de avançar.

---

## Pool OAuth — situação pós Etapa A (inalterada)

| App           | Status        | Observação |
|---------------|---------------|------------|
| NexEngine 05  | active        | Owner Mamute. |
| NexEngine 06  | quarantined   | development_mode bloqueado (Spotify). |
| NexEngine 08  | active (alta taxa de erro) | Investigar separadamente. |
| **NexEngine 09** | **quarantined (perm.)** | invalid_client em 100% das chamadas — removido nesta fase. |
| NexEngine 10  | active        | Gateway CC primário. |
| NexEngine 02  | retired       | — |
| NexEngine     | quarantined   | Antigo. |
