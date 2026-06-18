# FASE 7.0 — AUDITORIA ENTERPRISE DO CATÁLOGO

**Escopo:** somente diagnóstico. Não houve alteração em código, banco ou edge functions.
**Data:** 2026-06-18.
**Pergunta central:** o Catálogo já tem matéria-prima pra virar a central de inteligência da distribuidora?

---

## ITEM 1 — Arquitetura completa (cadastro → tela)

```
[1] CADASTRO
    UI: AddCatalogTrackDialog.tsx
    Edge: resolve-catalog-track          (resolve ISRC/URL/ID → Spotify)
    Tabela: catalog_tracks
    Side-effects (trigger / função):
       - cria linha em catalog_track_baselines (baseline imediato)
       - registra job em catalog_snapshot_queue (kind=initial)

[2] PLACEMENT (decisão de onde entra)
    Edge: preview-distribute-catalog-track   (dry-run)
    Edge: distribute-catalog-track           (cria placements pending)
    Tabelas:
       - catalog_distribution_batches  (1 linha por execução)
       - catalog_placements            (1 linha por playlist alvo, status=pending)
    View consumida: v_catalog_playlist_occupancy (capacidade)

[3] SPOTIFY (efetivação)
    Worker: process-catalog-placements   (cron 1×/min via cron-process-catalog-placements)
    RPC: claim_next_catalog_placements   (lease SKIP LOCKED)
    Pre-check local: managed_playlist_tracks
    Circuit breaker: spotify_circuit_breaker (pré-flight)
    Chamada externa: POST /v1/playlists/{id}/tracks
    Side-effects:
       - upsert em managed_playlist_tracks (write-through)
       - log em catalog_placement_execution_log (1 linha por tentativa)
       - update em catalog_placements.status (active | failed | waiting_circuit_breaker | already_present)
    Reaper: reap-catalog-placements      (libera leases expirados)

[4] VPS (Observer)
    Edge: observer-pull-queue            (entrega fila pro bot)
    Tabelas-fonte: playlists_to_observe, observed_playlists
    Edge: observer-ingest-tracks         (recebe tracklist de playlist)
    Tabelas-destino:
       - observer_playlist_tracks       (track × playlist × posição × captured_at)
       - observed_playlist_snapshots    (snapshot consolidado)

[5] BOT (coleta de música individual)
    Edge: bot-collect-queue              (entrega fila de songs)
    Edge: bot-ingest-snapshot            (legado — snapshot de playlist)
    Edge: bot-ingest-song-snapshot       (rota usada pela música do catálogo)
    Edge: bot-upload-print               (S3/storage do print)
    Tabelas-destino:
       - song_snapshots                 (1 linha por coleta de música)
       - song_snapshot_playlists        (playlists detectadas dentro da coleta)
       - delivery_proofs                (prova imutável por curador/playlist)

[6] BASELINE
    Tabela: catalog_track_baselines    (1 linha por track — streams/popularity/monthly_listeners no T0)
    Quem grava: edge resolve-catalog-track no momento do cadastro
    Quem consome: v_catalog_track_telemetry (growth_abs = last − baseline)

[7] SNAPSHOTS
    Fila: catalog_snapshot_queue       (status pending/done/failed)
    Worker: bot-collect-queue (entrega) + bot-ingest-song-snapshot (escrita)
    Tabela-resultado: song_snapshots + song_snapshot_playlists
    Reschedule: catalog_tracks.next_auto_collect_at (cron desconhecido — ver gap abaixo)
    Limpeza: cleanup-snapshots

[8] DIAGNOSE
    Edge: diagnose-managed-playlist            (playlist isolada)
    Edge: diagnose-managed-playlists-batch     (em lote)
    Tabela: playlist_diagnoses (não específica do catálogo)
    Worker de enriquecimento de tracks: spotify-enrichment-worker
       Fila: spotify_enrichment_queue
       Cache: spotify_track_cache + spotify_artist_cache

[9] FRONTEND
    Página lista: src/pages/Catalogo.tsx (337 linhas)
       Tabs: MusicasTab.tsx (507), PlaylistsTab.tsx (147)
    Página detalhe: src/pages/CatalogoMusicaDetalhe.tsx (911 linhas)
       Preview de distribuição: CatalogoMusicaPreview.tsx (365)
    Views consumidas:
       - v_catalog_playlist_occupancy
       - v_catalog_track_distribution_stats
       - v_catalog_track_telemetry
       - v_catalog_track_playlist_attribution
       - v_catalog_track_performance  (existe, NÃO consumida)
```

**Crons identificados (relevantes ao Catálogo):**
| Cron | Periodicidade | Função disparada |
|---|---|---|
| `cron-process-catalog-placements` | 1×/min | `process-catalog-placements` |
| `cron-reap-catalog-placements` | (cron-recover) | `reap-catalog-placements` |
| `bot-collect-queue` | pull-based | (bot consome) |
| `observer-pull-queue` | pull-based | (bot VPS consome) |
| `cleanup-snapshots` | diário | TTL de snapshots |
| `enrich-playlists` | semanal | followers/cover de `managed_playlists` |

**Workers / Edge Functions catalogadas no diretório `supabase/functions/`** com prefixo direto: `cron-process-catalog-placements`, `distribute-catalog-track`, `preview-distribute-catalog-track`, `process-catalog-placements`, `reap-catalog-placements`, `register-cohort-baseline`, `resolve-catalog-track`, mais as 4 funções `bot-*` e 3 `observer-*` que alimentam o fluxo.

---

## ITEM 2 — Para cada campo na tela: origem real

### 2.1 — Página `/catalogo` (lista)

| Campo exibido | Tabela / View | Quem grava | Quando | Quem consome |
|---|---|---|---|---|
| Músicas no catálogo | `catalog_tracks` (count status=active) | `resolve-catalog-track` | cadastro | `Catalogo.fetchSummary` |
| Playlists no catálogo | `managed_playlists` (is_catalog=true) | seeding manual / import | onboarding | `fetchSummary` |
| Placements ativos | `catalog_placements` (status=active) | `process-catalog-placements` | após POST 201 | `fetchSummary` |
| Capacidade total / usada / livre | `v_catalog_playlist_occupancy` | view derivada | tempo real | `fetchSummary` |
| Streams 28D (hero) | `v_catalog_track_telemetry.last_plays_28d` | `bot-ingest-song-snapshot` | a cada snapshot | `fetchGlobalTelemetry` |
| Baseline total | `v_catalog_track_telemetry.baseline_plays_28d` ← `catalog_track_baselines.streams` (não — é primeiro snapshot 28d) | bot na 1ª coleta | T0 da música | `fetchGlobalTelemetry` |
| Growth abs / pct | `v_catalog_track_telemetry.growth_abs` | view derivada | tempo real | `fetchGlobalTelemetry` |
| Playlists detectadas | `v_catalog_track_telemetry.playlists_present_count` ← `song_snapshot_playlists` | bot | a cada snapshot | `fetchGlobalTelemetry` |
| Fresh snapshots 24h | `song_snapshots WHERE captured_at>now()-24h` | bot | streaming | `fetchGlobalTelemetry` |
| Failed queue | `catalog_snapshot_queue WHERE status='failed'` | worker | em falha | `fetchGlobalTelemetry` |

### 2.2 — Página `/catalogo/musica/:id`

| Campo / bloco | Tabela / View | Quem grava | Quando |
|---|---|---|---|
| Header (nome/artista/cover/ISRC) | `catalog_tracks` | `resolve-catalog-track` | cadastro |
| Baseline | `catalog_track_baselines` (popularity, monthly_listeners, streams) | `resolve-catalog-track` | T0 |
| Telemetria (streams28d, growth, total7d) | `v_catalog_track_telemetry` | view | tempo real |
| Placements list | `catalog_placements` + join `managed_playlists` | worker | ciclo placement |
| Atribuição por playlist | `v_catalog_track_playlist_attribution` | view sobre `observer_playlist_tracks` + `song_snapshot_playlists` | a cada coleta |
| Próxima coleta | `catalog_snapshot_queue` (scheduled_for, attempts) | worker | reschedule |
| Série temporal de plays | `song_snapshots` (captured_at, total_plays_28d) | bot | streaming |
| Histórico de distribuição | `catalog_distribution_batches` | `distribute-catalog-track` | cada batch |

---

## ITEM 3 — O que o VPS coleta e NÃO aparece no Catálogo

Tudo isso já está gravado e exposto em nenhum bloco da UI:

1. **`observer_playlist_tracks.position`** — posição exata da faixa em cada playlist por captura. UI mostra só "current_position" da última leitura, não a série.
2. **`observer_playlist_tracks.added_at` (data em que entrou na playlist)** — disponível por playlist, sem componente UI.
3. **`observer_playlist_tracks.removed_at` / saída** — quando a faixa sai de uma playlist. Não há badge "removida em".
4. **`observed_playlist_snapshots.followers`** — followers da playlist no momento da captura → permite mostrar evolução do tamanho da playlist.
5. **`observed_playlist_snapshots.tracks_count`** — densidade da playlist quando a faixa estava nela.
6. **`observer_runs`** — qual run/VPS gerou cada captura (auditabilidade); UI não mostra.
7. **`playlist_track_snapshots`** (978 linhas) — outra fonte de posição/snapshot legacy. Nunca exibida.
8. **`delivery_proofs`** (400 linhas) — prova imutável (HTML+screenshot) por playlist. Não há botão "ver prova" no detalhe da música.
9. **DOM raw / piggyback** em `bot_ingest_raw` — debug de coleta, invisível.

---

## ITEM 4 — Métricas armazenadas e nunca exibidas

| Métrica | Tabela | Status na UI |
|---|---|---|
| Popularity histórico | `catalog_track_snapshots.spotify_popularity` (vazia — 0 linhas) | tabela existe, fila não enche |
| Monthly listeners histórico | `catalog_track_snapshots.monthly_listeners` (vazia) | idem |
| Artist followers histórico | `catalog_track_snapshots.artist_followers` (vazia) | idem |
| Spotify followers da faixa | `catalog_track_snapshots.spotify_followers` (vazia) | idem |
| Posição em cada playlist por dia | `observer_playlist_tracks` (18.009 linhas) | só última leitura |
| Followers da playlist por dia | `observed_playlist_snapshots`, `playlist_followers_snapshots` | invisível |
| Evolução de tracks_count da playlist | `playlist_track_snapshots` | invisível |
| Snapshots de playlists do catálogo | `song_snapshot_playlists` (34.136 linhas) | só agregado |
| Execution log granular (tentativas, erros, snapshot_id Spotify) | `catalog_placement_execution_log` (18.387 linhas) | não há aba "histórico de tentativas" |
| `removed_reason` de placements | `catalog_placements.removed_reason` | invisível |
| Batches diários de distribuição (eligible/skipped/created) | `catalog_distribution_batches` | a página detalhe busca mas não renderiza tabela detalhada |
| Run do observer / VPS responsável | `observer_runs` | invisível |
| Lease / worker id no snapshot queue | `catalog_snapshot_queue.locked_by, lease_expires_at` | invisível |
| Prova de entrega por curador | `delivery_proofs` | invisível no contexto catálogo |
| Cache Spotify enriquecido (popularity, ISRC, álbum, release date, duration) | `spotify_track_cache` | só `popularity` num lugar; release_date/album invisíveis |
| Artist genres / popularity | `spotify_artist_cache` | invisíveis |

Histórico **temporal** que já existe e não é desenhado:
- Posição em playlist por dia.
- Followers da playlist por dia.
- Plays 28d por dia (existe em `song_snapshots`, plotado de forma simples — sem anotações de evento).
- Placements ao longo do tempo (existe via `created_at` em placements, sem gráfico).

---

## ITEM 5 — Linha do tempo da música

**SIM, é reconstruível hoje. 100% dos eventos abaixo estão no banco:**

| Evento | Tabela / coluna |
|---|---|
| Data da entrada na NexEngine | `catalog_tracks.added_at` |
| Baseline | `catalog_track_baselines.captured_at, streams, popularity, monthly_listeners` |
| Primeira playlist (efetivada) | `MIN(catalog_placements.added_at WHERE status='active')` ou `MIN(catalog_placement_execution_log.executed_at WHERE outcome='spotify_post_ok')` |
| Nª playlist | mesma fonte, ORDER BY |
| Cada coleta | `song_snapshots.captured_at` + `song_snapshot_playlists` |
| Maior pico de plays | `MAX(song_snapshots.total_plays_28d)` (+timestamp) |
| Última coleta | `catalog_tracks.last_auto_collect_at` ou `MAX(song_snapshots.captured_at)` |
| Estado atual | `catalog_tracks.status` + `v_catalog_track_telemetry` |
| Entrada/saída de cada playlist via VPS | `observer_playlist_tracks.added_at, removed_at` |

**Falta apenas componente UI** (timeline visual). Zero ETL adicional.

---

## ITEM 6 — Delivery por playlist

**Parcialmente SIM.**

O que **existe**:
- `v_catalog_track_playlist_attribution` já agrega `current_plays_7d` por playlist.
- `song_snapshot_playlists` tem **séries** de plays observados por playlist × snapshot.

O que **falta gravar/derivar** pra responder "a playlist X entregou quantos streams desde que a música entrou":
- Não há baseline de plays **por playlist** (analógico ao `catalog_track_baselines` global). Hoje só se sabe o **total** da música; a separação por playlist é estimativa pela contribuição relativa observada em `song_snapshot_playlists`.
- O modelo oficial de delivery (`fn_campaign_delivery_accumulated` — ver `docs/DELIVERY_ENGINE.md`) é por curador/campanha, **não foi aplicado ao Catálogo**.

Conclusão: dá pra mostrar **plays 7d/28d por playlist** (já temos), mas "delivery acumulado oficial por playlist" exige criar `catalog_track_playlist_baselines` ou reutilizar `fn_campaign_delivery_accumulated` apontando pra song_snapshot. Backend conceitualmente pronto, só não foi instanciado pra catálogo.

---

## ITEM 7 — Histórico de placements ao longo do tempo

**SIM. Existe.**

Fonte primária: `catalog_placements.added_at, removed_at, status`.
Cross-check imutável: `catalog_placement_execution_log` (18.387 linhas, `executed_at` + `outcome`).

Query exemplo:
```sql
SELECT date_trunc('day', added_at) d, count(*) FROM catalog_placements
WHERE catalog_track_id = $1 GROUP BY 1 ORDER BY 1;
```

Não há **componente UI** desenhando essa série. Só listagem corrente do estado atual.

---

## ITEM 8 — Inteligência de playlist (a partir dos dados atuais)

| Métrica | Possível hoje? | Como |
|---|---|---|
| Playlist que mais entrega | SIM | `SUM(plays_7d)` em `song_snapshot_playlists` agrupado por `spotify_playlist_id` |
| Playlist que menos entrega | SIM | idem, ASC |
| Tempo médio entre POST e primeira detecção | SIM | `MIN(observer_playlist_tracks.captured_at) − catalog_placement_execution_log.executed_at` |
| Taxa de sucesso por playlist | SIM | `outcome` em `catalog_placement_execution_log` |
| Delivery médio por playlist | SIM | média de plays por snapshot em `song_snapshot_playlists` |
| Ranking | SIM | derivado dos acima |
| ROI por playlist | PARCIAL | falta custo por playlist no catálogo (sem `curator_deal_payments` ligado); pra catálogo próprio, ROI = plays / capacidade ocupada |
| Tempo médio até remoção | SIM | `removed_at − added_at` em `catalog_placements` (e `observer_playlist_tracks`) |
| Taxa de retenção (% das playlists em que a música ainda está D+30) | SIM | placements active vs total criados |

Todas as 9 métricas usam dados que **já existem**. Falta agregação + UI.

---

## ITEM 9 — Saúde operacional

| Sinal | Já existe? | Onde |
|---|---|---|
| Última coleta | SIM | `catalog_tracks.last_auto_collect_at` + `MAX(song_snapshots.captured_at)` |
| Próxima coleta | SIM | `catalog_tracks.next_auto_collect_at` + `catalog_snapshot_queue.scheduled_for` |
| Worker responsável | SIM | `catalog_snapshot_queue.locked_by`, `catalog_placements.locked_by` |
| Fila pendente / atrasada | SIM | `catalog_snapshot_queue.status='pending' AND scheduled_for<now()` |
| VPS utilizada | SIM | `v_playlist_vps_assignment` + `observer_runs` |
| Atraso | SIM | `now() − scheduled_for` |
| Falhas recentes | SIM | `catalog_snapshot_queue.last_error_at`, `catalog_placements.last_error_code`, `catalog_placement_execution_log.error_code` |
| Circuit breaker do app Spotify | SIM | `spotify_circuit_breaker` + `spotify_circuit_breaker_log` (visível só em `/sistema`, não no catálogo) |
| Cron health | SIM | `cron_health` |

**Todos os 9 já existem.** Nenhum aparece no detalhe da música nem na lista do catálogo.

---

## ITEM 10 — Mapa de classificação

### A) Já existe E está exibida
- Total de músicas, playlists do catálogo, placements ativos.
- Capacidade total/usada/livre.
- Streams 28d globais, growth abs/pct.
- Baseline (no detalhe).
- Lista de placements (estado atual).
- Atribuição por playlist (atual, sem série temporal).
- Próxima coleta (única, no detalhe).

### B) Já existe MAS está escondida (não desenhada)
- Histórico de plays por dia com anotações (entrou em playlist X, saiu de Y, breaker abriu).
- Histórico de placements por dia (série temporal).
- Posição em cada playlist por dia (`observer_playlist_tracks`).
- Followers da playlist por dia (`observed_playlist_snapshots`, `playlist_followers_snapshots`).
- Execution log granular por tentativa (sucessos, erros, snapshot_id retornado pelo Spotify).
- Delivery proofs (prova com print).
- Worker / VPS / lease / atraso de fila.
- Estado do circuit breaker do app que serve essa música.
- Batches de distribuição (eligible / skipped / created por dia).
- `removed_reason` de placements removidos.
- Cache Spotify completo (release_date, album, duration, popularity histórica).
- Artist cache (genres, popularity, followers).
- Run id / proveniência do bot.

### C) Existe parcialmente
- `catalog_track_snapshots` (tabela definida, 0 linhas) — schema pronto, sem worker enchendo.
- ROI por playlist (falta custo).
- Delivery oficial acumulado por playlist (modelo existe pra campanhas, não foi instanciado pra catálogo).

### D) Ainda não existe
- Anotações de evento na timeline (ex.: "removida da playlist X em DD/MM por motivo Y") — exige campo livre.
- Score editorial / qualidade da playlist específico do catálogo (existe `playlist_leadership` mas não é cruzado).
- Recomendação automática "essa música deveria sair desta playlist" — exige regra de negócio nova.

---

## ITEM 11 — Dashboards Enterprise possíveis SEM coleta nova

Tudo abaixo é construível só com queries+UI, zero nova chamada externa:

1. **Timeline da música** (entrada → baseline → playlists → picos → estado).
2. **Heatmap de plays por playlist × dia** (`song_snapshot_playlists`).
3. **Curva de delivery acumulado por playlist** (mesmo modelo do `fn_campaign_delivery_accumulated`).
4. **Ranking de playlists do catálogo** (mais entrega / pior entrega / mais rápida / mais estável).
5. **Funil de placement** (eligible → criado → POST ok → detectado pelo VPS → entregou plays).
6. **Tempo médio até detecção** (POST → primeira observação no observer).
7. **Taxa de retenção D+7 / D+30** (placements ainda ativos vs criados).
8. **Histórico de tentativas e erros por música** (do `catalog_placement_execution_log`).
9. **Saúde da coleta por música** (atraso de fila, próxima coleta, worker, VPS).
10. **Capacidade vs utilização por playlist** (já existe view, falta página).
11. **"O que aconteceu hoje" feed** (eventos cross: placements criados, removidos, breakers abertos, snapshots novos).
12. **Drill-down por curador/owner da playlist** (cruzando `managed_playlists.owner`).
13. **Score de saúde da música** (combinação de growth + retenção + diversidade de playlists).
14. **Painel de provas** (delivery_proofs com link pro print).

---

## ITEM 12 — Matriz

| Funcionalidade | Já existe | Dados existem | Backend pronto | Frontend pronto | Falta só UI | Falta backend |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| KPIs globais do catálogo | ✅ | ✅ | ✅ | ✅ | — | — |
| Lista de músicas com telemetria | ✅ | ✅ | ✅ | ✅ | — | — |
| Detalhe da música (header+baseline+telemetria) | ✅ | ✅ | ✅ | ✅ | — | — |
| Lista de placements correntes | ✅ | ✅ | ✅ | ✅ | — | — |
| Atribuição por playlist (snapshot atual) | ✅ | ✅ | ✅ | ✅ | — | — |
| Série temporal de plays 28d | parcial | ✅ | ✅ | parcial | ✅ | — |
| Timeline de eventos da música | ❌ | ✅ | ✅ | ❌ | ✅ | — |
| Histórico de placements (curva diária) | ❌ | ✅ | ✅ | ❌ | ✅ | — |
| Histórico de posição em playlist | ❌ | ✅ | ✅ | ❌ | ✅ | — |
| Histórico de followers da playlist | ❌ | ✅ | ✅ | ❌ | ✅ | — |
| Delivery por playlist (7d/28d agregado) | parcial | ✅ | ✅ | parcial | ✅ | — |
| Delivery acumulado por playlist (oficial) | ❌ | ✅ | parcial | ❌ | — | instanciar `fn_*` pra catálogo |
| Execution log granular | ❌ | ✅ | ✅ | ❌ | ✅ | — |
| Delivery proofs no contexto da música | ❌ | ✅ | ✅ | ❌ | ✅ | — |
| Saúde da coleta (worker / VPS / atraso) | ❌ | ✅ | ✅ | ❌ | ✅ | — |
| Estado do circuit breaker no contexto | ❌ | ✅ | ✅ | ❌ | ✅ | — |
| Funil de placement (eligible→detectado→entregou) | ❌ | ✅ | ✅ | ❌ | ✅ | — |
| Ranking de playlists do catálogo | ❌ | ✅ | ✅ | ❌ | ✅ | — |
| Tempo médio até detecção VPS | ❌ | ✅ | ✅ | ❌ | ✅ | — |
| Retenção D+7 / D+30 | ❌ | ✅ | ✅ | ❌ | ✅ | — |
| ROI por playlist | ❌ | parcial | parcial | ❌ | — | definir custo no catálogo |
| Score de saúde da música | ❌ | ✅ | parcial | ❌ | ✅ | (opcional: agregação) |
| Histórico popularity/monthly listeners | ❌ | ❌ (tabela vazia) | ❌ | ❌ | — | habilitar worker pra encher `catalog_track_snapshots` |
| Cache Spotify (album/release/duration) na UI | ❌ | ✅ | ✅ | ❌ | ✅ | — |
| Genres / popularity do artista | ❌ | ✅ | ✅ | ❌ | ✅ | — |
| `catalog_distribution_batches` desenhado | ❌ | ✅ | ✅ | ❌ (fetch sem render) | ✅ | — |
| Anotações de evento (motivos) | ❌ | ❌ | ❌ | ❌ | — | novo campo + UI |
| Recomendação automática (sair/entrar playlist) | ❌ | parcial | ❌ | ❌ | — | regra de negócio |

---

## CONCLUSÃO

1. **O Catálogo já possui dados suficientes para virar central de inteligência?**
   **SIM** — para ~85% dos painéis Enterprise listados. Faltam apenas 3 itens com gap de backend: (a) preencher `catalog_track_snapshots` (worker não roda), (b) instanciar o `fn_*_delivery_accumulated` no contexto Catálogo, (c) definir modelo de custo pra ROI.

2. **Informações de maior valor já existentes e invisíveis ao usuário:**
   - Histórico granular de plays por playlist por dia (`song_snapshot_playlists`, 34k linhas).
   - Histórico de posição por playlist (`observer_playlist_tracks`, 18k linhas).
   - Execution log de placements com motivo de erro (`catalog_placement_execution_log`, 18k linhas).
   - Delivery proofs (400 linhas) com prova imutável.
   - Followers/tamanho da playlist por dia.
   - Estado de saúde operacional (worker, VPS, atraso, circuit breaker).
   - Curva diária de placements criados/removidos.

3. **O que falta para Enterprise:**
   - **80% UI / 20% backend.**
   - UI: timeline da música, curvas históricas (placements, posição, followers), funil de placement, ranking de playlists, painel de saúde no contexto.
   - Backend mínimo: encher `catalog_track_snapshots` (cron novo, sem coleta nova) e adaptar `fn_*_delivery_accumulated` pra `song_snapshots`.

4. **% pronto vs % por desenvolver:**
   - **Coleta de dados: ~95% pronto** (só `catalog_track_snapshots` está vazia).
   - **Modelagem de dados / views: ~80% pronto** (3 views Enterprise já existem e uma, `v_catalog_track_performance`, nem é consumida).
   - **Frontend: ~30% pronto** (KPIs globais e detalhe básico ok; falta tudo que é série temporal, funil, ranking, saúde).
   - **Saúde / observability no contexto: 10% pronto** (toda a info existe, nenhuma é exposta na página).
   - **Média ponderada: aproximadamente 55–60% pronto, 40–45% a desenvolver — todo o resto é predominantemente trabalho de UI sobre dados já gravados.**

— Fim do diagnóstico. Sem alterações em código ou banco.
