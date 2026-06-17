# LEGACY_API_AUDIT — Fase 6.A

> Auditoria de código legado e integrações deprecadas.
> Read-only. Nenhuma alteração foi feita.
> Data: 17/06/2026.

---

## Tier 1 — Phase 1 Deprecated (`deprecationGate` ativo, kill-switch pronto)

23 funções registram em `deprecation_hits`. Para bloquear todas com HTTP 410: `DEPRECATED_PHASE1_ENABLED=true`.

| # | Função | Linha do gate |
|---|---|---|
| 1 | `analyze-genre-visual-dna` | `index.ts:33` |
| 2 | `analyze-genre` | `index.ts:87` |
| 3 | `auto-replicate-playlists` | `index.ts:55` |
| 4 | `collect-batch` | `index.ts:41` |
| 5 | `create-spotify-playlist` | `index.ts:79` |
| 6 | `daily-collect` | `index.ts:14` |
| 7 | `enrich-playlists` (+ Apify) | `index.ts:132` |
| 8 | `extract-blueprints` | `index.ts:131` |
| 9 | `extract-replication-rules` | `index.ts:92` |
| 10 | `fetch-tracks-spotify` | `index.ts:56` |
| 11 | `generate-cover-variations` | `index.ts:846` |
| 12 | `generate-playlists-briefing` | `index.ts:50` |
| 13 | `generate-templates` | `index.ts:115` |
| 14 | `generate-terms` | `index.ts:55` |
| 15 | `genre-autopilot` | `index.ts:966` |
| 16 | `genre-backfill` | `index.ts:53` |
| 17 | `genre-competitors-sync` | `index.ts:83` |
| 18 | `learning-loop` | `index.ts:80` |
| 19 | `replicate-top` | `index.ts:83` |
| 20 | `revalidate-dataset` | `index.ts:189` |
| 21 | `run-search` | `index.ts:67` |
| 22 | `score-templates` | `index.ts:98` |
| 23 | `seed-editorial-terms` | `index.ts:95` |

---

## Tier 2 — Stubs mortos (safe to delete)

| Função | Evidência | Status |
|---|---|---|
| `ops-agent-poll` | `index.ts:1–14` — comentário: *"tabela ops_agent_commands não existe"*. Sempre 204. | Dead stub — mantido só pra absorver 404 do binário legado da VPS. |

---

## Tier 3 — Caminhos legacy mantidos (A/B / compat)

| Arquivo:Linha | Padrão | Nota |
|---|---|---|
| `campaign-plan-api/index.ts:197` | `legacyStartDay()` | Fórmula antiga de distribuição diária |
| `_shared/computeEcoPlan.ts:438` | `legacyStart()` | Mesma fórmula no eco-plan |
| `diagnose-managed-playlist/index.ts:1833` | flag `USE_LEGACY_SCORE` | A/B do scoring antigo |
| `spotify-items-audit/index.ts:145,167,175,185` | `legacy_get_tracks`, `test3_legacy_get_tracks` | Comparação `/tracks` vs `/items` |
| `bot-upload-print/index.ts:208` | erro `legacy_playlists_label_deprecated` | Rejeita payload antigo do bot |
| `get-client-campaign-public/index.ts:156–162` | `legacyDeal` fallback | Resolve campanhas com token antigo |
| `resolve-legacy-token/index.ts:1` | função inteira | Mapeia portal `/campanha/:token` antigo |
| `_shared/spotify-client.ts:30,276` | alias `legacySetSpotifyCtx` | Compat |
| `extract-snapshot-from-print/index.ts:550` | `playsLegacy = parsePlaysText(...)` | Fallback sem janelas estruturadas |
| `genre-confidence-calc/index.ts:237` | `source: "auto_confidence_v1"` | Tag de versão antiga |
| `genre-autopilot/index.ts:1091` | RPC `get_genre_daily_target_v2` | Sugere existência prévia de `_v1` |
| `enrich-playlists/index.ts:1` | comentário | Apify supersedido pelo VPS bot |

---

## Tier 4 — Flags de feature legadas

- `DEPRECATED_PHASE1_ENABLED` — kill-switch global das 23 funções.
- `USE_LEGACY_SCORE` — A/B em `diagnose-managed-playlist`.
- `DIAGNOSE_SINGLE_PATH` / `DIAGNOSE_SINGLE_PATH_TARGET` — debug.

---

## Tier 5 — Tokens / vars legadas

- Portal antigo: token resolvido por `resolve-legacy-token` → `LegacyCampaignRedirect`.
- `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` (env) — substituídos por tabela `spotify_apps`; mantidos como fallback em `_shared/spotify.ts:9–10`.
- `OPENAI_API_KEY` — só lido como fallback em `external-health-probes-cron:69`. Lovable Gateway substitui em produção.
- `SUPABASE_FUNCTION_NAME` — checado em `spotify.ts:23` mas não existe no Edge Runtime; sempre cai no parser de `Deno.mainModule`.

---

## Avaliação por integração (foco legado)

| Integração | Foi supersedida? | Por | Ainda chamada? | Safe to remove? |
|---|---|---|---|---|
| Apify (`enrich-playlists`) | SIM | VPS observer bot (`observer-ingest-tracks`) | SIM (deprecationGate + circuit-breaker `apify_blocked`) | SIM quando Phase 1 ligar |
| `daily-collect` | SIM | `genre-autopilot` / `jobs-scheduler` | hits logados | SIM com Phase 1 |
| `collect-batch` | SIM | `bot-collect-queue` | hits logados | SIM com Phase 1 |
| `run-search` | SIM | `spotify-enrichment-worker` | hits logados | SIM com Phase 1 |
| `fetch-tracks-spotify` | SIM | `spotify-enrichment-worker` | hits logados | SIM com Phase 1 |
| `ops-agent-poll` | SIM | (feature removida) | SIM (legacy VPS agent polla) | SIM — stub seguro |
| `resolve-legacy-token` | Parcialmente | Tokens JWT do novo portal | SIM (links antigos circulam) | NÃO até os links expirarem |
| Spotify `/tracks` endpoint | Parcialmente | `/items` endpoint | SIM (mantido para compat em `spotify-items-audit`) | NÃO até Spotify deprecar |
| Anthropic direto em `analyze-performance` + `extract-replication-rules` | SIM (deveriam usar `ai_service.ts`) | `_shared/ai_service.ts` `chatClaude()` | SIM | Refatorar, não deletar |
| Env `SPOTIFY_CLIENT_ID/SECRET` | SIM | tabela `spotify_apps` | SIM (fallback) | Manter como fallback |

---

## Respostas (ITEM 9 — subset legado)

### Chamada desnecessária ao Spotify?
**SIM.** `bot-collect-queue/index.ts:20,451` faz `GET /v1/tracks/{id}` direto, **fora** do shared client. Sem circuit breaker, sem cache, sem telemetria. Dado disponível em `spotify_track_cache`. Impacto: risco de cascata de falhas e violação do orçamento de rate-limit Spotify.

### API antiga viva?
**SIM.**
- Apify (`enrich-playlists/index.ts:112–113`) — live mas circuit-broken.
- `ops-agent-poll` — stub deployado.
- 23 funções com `deprecationGate` deployadas, recebendo hits.

### Integração morta?
**SIM.**
- `ops-agent-poll` — tabela referenciada não existe; arquivo retorna 204 incondicional.
- Apify — parcialmente morto (`apify_blocked` + rate limit upstream).
- Browserless edge-side — só health probe; uso real é VPS.

### Dado vindo da fonte errada?
**PARCIAL.** `import-label-spreadsheet/index.ts:391–393`: quando `spotify_playlist_id` está ausente e o nome XLSX não casa com DB, o texto cru do usuário vira `playlist_name` canônico. Pode ser stale/typo/abrevia.

---

## Recomendações (não executadas nesta fase)

1. **Refatorar `analyze-performance` e `extract-replication-rules`** para usar `_shared/ai_service.ts` em vez de Anthropic direto — elimina divergência de `AI_PROVIDER`.
2. **Mover `bot-collect-queue`** `GET /v1/tracks/{id}` para o shared client (`_shared/spotify-client.ts`) — ganha CB, cache e telemetria.
3. **Consolidar 3 caminhos de followers** (`enrich-playlists`, `enrich-curator-playlists-spotify`, `enrich-playlist-covers`) em uma única função fan-out.
4. **Decidir se o XLSX pode sobrescrever `playlist_name`** quando não há match no DB. Hoje é o caminho silencioso de inconsistência.
5. **Ligar `DEPRECATED_PHASE1_ENABLED=true`** em janela controlada após validar que nenhum hit recente é legítimo (`SELECT function_name, COUNT(*) FROM deprecation_hits GROUP BY 1`).
6. **Remover `ops-agent-poll`** após confirmar que o binário legado da VPS foi desligado.
