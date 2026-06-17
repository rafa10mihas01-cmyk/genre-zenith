# SPOTIFY — LEGACY REPORT

**Fase:** 6.A.1 · Read-only.

Inventário de funções, endpoints e tokens **legados, depreciados ou inativos** relacionados a Spotify.

---

## 1. Funções Spotify atrás de `deprecationGate`

Todas continuam deployed; o gate (`_shared/_deprecation.ts`) decide via flag `DEPRECATED_PHASE1_ENABLED` se executam ou retornam 410. Hoje **a flag está desligada para a maioria**, mas continuam recebendo chamadas internas.

| Função | Última call em log | Chamada por (estático) | Substituta natural |
|---|---|---|---|
| `enrich-playlists` | (gated; sem hits úteis recentes) | `collect-batch`, `brain-run` (3 sites) | `enrich-curator-playlists-spotify` + `enrich-playlist-covers` + `recheck-archived-followers` |
| `fetch-tracks-spotify` | 2026-06-15 (16/14d) | scripts manuais | `resolve-catalog-track` + `spotify-enrichment-worker` |
| `create-spotify-playlist` | sem chamadas em 14d | UI manual de criação | manter sob demanda (ação rara) |
| `run-search` | 2026-06-15 (1.478/14d) | UI de busca editorial | ainda viva — gate é informativo, **não remover** |

Outras funções com `deprecationGate` mas **sem dependência Spotify** (apenas mantidas pra rastrear hits): `analyze-genre`, `analyze-genre-visual-dna`, `auto-replicate-playlists`, `collect-batch`, `daily-collect`, `extract-blueprints`, `extract-replication-rules`, `generate-cover-variations`, `generate-playlists-briefing`, `generate-templates`, `generate-terms`, `genre-autopilot`, `genre-backfill`, `genre-competitors-sync`, `learning-loop`, `replicate-top`, `revalidate-dataset`, `score-templates`, `seed-editorial-terms`.

---

## 2. Funções Spotify sem nenhuma chamada em 14d

Candidatas a **homologação encerrada / remover na próxima limpeza**:

| Função | Tipo | Decisão sugerida |
|---|---|---|
| `spotify-app01-audit` | auditoria 1-off | manter (diagnóstico) |
| `spotify-app01-multiowner` | teste multi-owner | manter (diagnóstico) |
| `spotify-fields-probe` | probe de fields | manter (diagnóstico) |
| `spotify-items-audit` | auditoria do `/items` | manter (diagnóstico) |
| `spotify-items-matrix` | matriz de items | manter (diagnóstico) |
| `spotify-me-playlist-test` | teste de `/v1/me/playlists` | manter (diagnóstico) |
| `spotify-resolution-test` | teste resolução URL | candidato a remover |
| `spotify-tracks-compare` | compara tracks | candidato a remover |
| `spotify-tracks-forensics` | forensics de tracks | manter (uso em incidentes) |
| `spotify-pipeline-audit` | pipeline check | manter (diagnóstico) |
| `app-homologation-test` | homologação geral | candidato a remover |
| `validate-fallback` | fallback de validação | candidato a remover |
| `spotify-invite` | tokens de convite OAuth | manter — depende de `spotify_invite_tokens` |
| `spotify-reauth-verify` | sanity pós-OAuth | manter |

> Nenhuma é cron. Todas só rodam sob demanda. Custo zero ocioso.

---

## 3. OAuth / tokens

| Item | Status |
|---|---|
| `spotify_user_tokens` | **vivo** — refresh contínuo pelo `spotify-token-watchdog` (5.961 calls/14d). |
| `spotify_apps` | **vivo** — multi-app gerenciado por `spotify-auth`. |
| `spotify_oauth_states` | **vivo** — usado por `spotify-auth` e `spotify-public-auth` (CSRF). |
| `spotify_oauth_audit` | **vivo** — log estruturado. |
| `spotify_invite_tokens` | **vivo** — controla whitelist de convites. |
| `spotify_email_allowlist` | **vivo** — checado no callback público. |
| `spotify_tokens` (tabela antiga) | **suspeita de legado** — 6 colunas, sem inserts recentes. Confirmar com `SELECT count(*) FROM spotify_tokens WHERE updated_at > now() - interval '30 days'`. |
| `spotify_circuit_breaker` / `_log` | **vivo** — protege todas as calls. |
| `spotify_call_log` | **vivo** — coração da observabilidade desta auditoria. |
| `spotify_track_cache` / `spotify_artist_cache` / `spotify_playlist_cache` | **vivos** — caches L1. |
| `spotify_enrichment_queue` | **vivo** — drenado pelo `spotify-enrichment-worker`. |
| `spotify_editorial_blocklist` | **vivo** (consultado por discovery). |
| `spotify_accounts` | **vivo** — contas OAuth do time. |

---

## 4. Endpoints duplicados / suspeitos

| Endpoint | Comentário |
|---|---|
| `GET /v1/playlists/{id}/items` chamado direto (sem `_shared/spotify-playlist.ts`) | Ainda existe em código antigo. A regra de ouro do helper diz: nenhum código novo pode chamar direto. **Não detectamos quebra**, mas vale auditar usos diretos no próximo passo. |
| `accounts.spotify.com/api/token` em locais fora de `_shared/spotify.ts` | Esperado em `spotify-auth` e `spotify-public-auth`; **fora deles seria bug**. Auditoria atual não encontrou outros usos. |
| `open.spotify.com/oembed` e `open.spotify.com/track/:id` (5 calls/7d) | Usado por `fetch-spotify-meta` pra resolver URLs públicas sem token. Não duplica nada. **OK.** |

---

## 5. Substituições recomendadas (sem executar nesta fase)

| Caminho atual | Caminho oficial sugerido |
|---|---|
| `enrich-playlists` chamado por `brain-run` / `collect-batch` | substituir por `enrich-curator-playlists-spotify` quando o alvo for playlist gerenciada, `enrich-playlist-covers` quando for só capa. |
| `bot-collect-queue` resolvendo `artist_id` inline | mover essa resolução pro `spotify-enrichment-worker` (já tem fila + cache). |
| `fetch-tracks-spotify` | quando precisar de batch, usar `getTrackCacheBatch` do `_shared/spotify-cache.ts` (que já bate na API só em cache miss). |
| Followers de playlist via VPS DOM | manter como observacional; UI deve ler de `playlists.followers_count` sempre que `followers_source = 'spotify_api'`. |

---

## 6. Resumo final

- **23 funções edge** declaram `deprecationGate`, das quais **4 ainda dependem de Spotify** (`enrich-playlists`, `fetch-tracks-spotify`, `create-spotify-playlist`, `run-search`).
- **14 funções Spotify** existem apenas pra auditoria/homologação — zero calls em 14d.
- **0 tokens órfãos** detectados (todos os artefatos OAuth têm consumidor ativo).
- **2 duplicações reais** com VPS (followers de playlist; metadata cru de XLSX) — descritas em `SPOTIFY_API_FORENSICS_BEFORE.md` §6.
- **1 candidato a confirmar legado**: tabela `spotify_tokens` (antiga, possivelmente substituída por `spotify_user_tokens` + `spotify_apps`).

**Nenhum código ou integração foi alterado nesta fase.**
