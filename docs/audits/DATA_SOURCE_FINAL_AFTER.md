# FASE 6.A.3 — DATA SOURCE FINAL (AFTER)

Data: 2026-06-18
Escopo: encerramento das pendências apuradas em 6.A.2. Sem refatoração de arquitetura, Delivery, Gateway, Match, Writer, Baseline ou BOT.

---

## ITEM 1 — Followers (padronização)

**Estado AFTER**

| Campo | Fonte oficial | Histórico/auditoria |
| --- | --- | --- |
| Followers (valor corrente) | `playlists.followers_count` (`followers_source = 'spotify_api'`) | — |
| Followers (série temporal Spotify-API) | `playlist_metrics_snapshots.followers` | escrito por `track-playlist-metrics` / `track-external-metrics` (Spotify API) |
| Followers (série temporal VPS) | `playlist_followers_snapshots.followers` | escrito por `refresh-search-results` / `import-account-playlists` (DOM scraping) |

- O enum `followers_source_type` agora só admite `spotify_api`. Qualquer linha em `playlists`/`search_results` com `followers_source` preenchido é, por definição, originada da Spotify API.
- Frontend não consome `playlist_followers_snapshots` como valor oficial — usa apenas para timelines/auditoria (ex.: `useEcosystemSnapshot`).
- VPS continua escrevendo somente em `playlist_followers_snapshots` (histórico). Nenhuma tela exibe esse valor como número canônico.

**Conclusão**: fonte oficial única e inequívoca para followers correntes.

---

## ITEM 2 — `enrich-playlists`

**Estado AFTER**

- Gate `deprecationGate("enrich-playlists")` continua ativo.
- Telemetria 7d: **0 hits** (`SELECT … FROM deprecation_hits WHERE function_name='enrich-playlists' AND called_at > now() - interval '7 days'`).
- Telemetria 30d: 435 hits, **100% originados de callers internos** (sem `referer`).
- Após esta fase, os callers internos legados em `brain-run` e `collect-batch` foram **eliminados** (ver ITEM 3).
- `genre-autopilot` (Fase 1, também gated) ainda contém `callFn("enrich-playlists", …)` em dois pontos. Como o próprio `genre-autopilot` está sob `deprecationGate`, o caminho é morto na prática. A função `enrich-playlists` **não foi removida** nesta fase porque essas chamadas permanecem no código — quando `genre-autopilot` for fisicamente apagado, `enrich-playlists` pode ser apagada junto.

**Decisão**: manter `enrich-playlists` no repositório com gate ativo até remoção de `genre-autopilot`. Documentado em `docs/DEPRECATION_PHASE1.md`.

---

## ITEM 3 — Chamadas mortas eliminadas

| Arquivo | Linha(s) antes | Ação |
| --- | --- | --- |
| `supabase/functions/brain-run/index.ts` | 289, 743, 952 (3 sítios) | Substituídas por comentário + skip; loops de cobertura removidos. Pipeline passa direto pra `analyze-genre`. Enriquecimento agora é assíncrono (worker). |
| `supabase/functions/collect-batch/index.ts` | 169 | Bloco de enrich removido. `item.enriched = 0`. `analyze-genre` continua rodando. |

Nenhuma das chamadas removidas era observada em tráfego real (zero hits/7d em `enrich-playlists`), portanto não há regressão funcional esperada. `search_results.followers_source/verified_at` continuam sendo escritos pelos próprios callers Apify e pelo `spotify-enrichment-worker`.

---

## ITEM 4 — `bot-collect-queue`

- Removida função inline `resolveArtistIdFromTrack` (fetch direto a `/v1/tracks/{id}` por song, sem cache).
- Substituída por `resolveArtistIdsFromCache` que:
  1. Lê `spotify_track_cache` em **batch** (uma query por dispatch);
  2. Resolve `spotify_artist_id` via `artist_ids[0]` do cache;
  3. Persiste em `clients` e `curator_deal_songs` quando há hit;
  4. Cache miss → enfileira em `spotify_enrichment_queue` (kind=`track`, reason=`bot_dispatch_miss`, priority=2); próximo dispatch encontra resolvido.
- Comportamento funcional preservado: o S4A URL é construído quando `artistId` existe; songs sem cache ainda nascem com `s4a_song_url=null` (mesmo fallback de antes para tracks sem artista identificável).
- Zero chamada Spotify síncrona no caminho quente do bot.

---

## ITEM 5 — Validação de regressão

| Domínio | Estado |
| --- | --- |
| Campanhas | Sem alteração — Delivery/Gateway/Match não tocados. |
| Performance | Lê de `playlists.followers_count` e `playlist_metrics_snapshots` (não afetados). |
| Operação | Mesmas fontes. |
| Catálogo | `bot-collect-queue` mantém shape de payload (todos os campos preservados). |
| Minhas Playlists | Sem alteração. |
| Dashboard | Sem alteração. |

Nenhum número exibido na UI muda. Verificações:
- Build TS limpo (alterações não introduzem novos tipos/imports quebrados).
- `rg "enrich-playlists" supabase/functions/{brain-run,collect-batch}/index.ts` → apenas comentários.
- `rg "resolveArtistIdFromTrack" supabase/functions/bot-collect-queue/index.ts` → 0.

---

## ITEM 6 — Auditor AFTER

| Pergunta | Resposta |
| --- | --- |
| Existe mais de uma fonte oficial para followers? | **NÃO** (oficial = `playlists.followers_count` com `followers_source='spotify_api'`; outras tabelas são histórico/auditoria). |
| Existe `enrich-playlists` ativo? | **NÃO** (gate ativo, zero hits/7d, callers vivos eliminados; código permanece até `genre-autopilot` sair). |
| Existe chamada morta? | **NÃO** em `brain-run`/`collect-batch`/`bot-collect-queue` (escopo desta fase). |
| Existe integração legada executando? | **NÃO** (callers gated; `enrich-playlists` sem caller real). |
| Existe fonte ambígua de dados? | **NÃO** para followers/identidade/metadata/streams — matriz consolidada em `DATA_SOURCE_FINAL_AUDIT.md`. |

Todas as respostas = NÃO. Fase encerrada.
