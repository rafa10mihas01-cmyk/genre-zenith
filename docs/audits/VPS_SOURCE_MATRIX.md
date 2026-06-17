# VPS — MATRIZ DE FONTES (FINAL)

**Fase:** 6.A.2 · Read-only.

## Visão geral

A NexEngine **não inicia chamadas para o VPS**. O fluxo é unidirecional: o bot rodando no VPS (`nexengine-bot-02`, IP `178.156.161.146`) assina com `x-bot-key` / `x-bot-token` e bate em edge functions específicas.

**Nó ativo:** 1 (`72e99514-fff2-45e9-9dc4-ea9283299032`), last heartbeat 2026-06-17 23:48Z.

**Auth shared:** todos os edges de ingestão exigem `BOT_API_KEY` ou `BOT_INGEST_TOKEN` via header. JWT desabilitado.

---

## Endpoints recebidos do VPS (últimos 7 dias)

| Edge function | Método | Payload | Resposta | Tabelas escritas | Consumidores downstream | Volume 7d |
|---|---|---|---|---|---|---|
| `bot-heartbeat` | POST | `{ hostname, status, session_id, browser_version, cpu_pct, mem_pct, queue_size, ... }` | `{ ok, next_poll_ms, work_available? }` | `bot_heartbeats`, `vps_nodes.last_heartbeat_at` | `engine-health`, `ops-alerts-cron-every-5min`, dashboard "Saúde" | **60.479** |
| `bot-event-ingest` | POST | `{ event_type, severity, payload, session_id }` | `{ ok }` | `bot_events`, dispara `system_alerts` (severity≥warn) | "Alertas" page, `monitor-critical-crons` | **8.198** |
| `bot-ingest-snapshot` | POST | `{ song_id, deal_id, total_plays, snapshots:[{playlist_name, spotify_url, plays, source?}], note?, print_urls? }` | `{ ok, snapshot_id, deal_status }` | `curator_deal_snapshots`, `song_snapshot_playlists`, `delivery_proofs`, via RPC `record_curator_deal_capture` | `fn_campaign_delivery_accumulated`, `CampanhaExecucao` | rastreado em `bot_ingest_raw` |
| `bot-ingest-song-snapshot` | POST | `{ song_id, total_plays, source, observed_at }` | `{ ok, snapshot_id }` | `song_snapshots` | `Performance.tsx`, agregações de catálogo | **155 raw** |
| `bot-ingest-dom` | POST | DOM HTML cru de playlist | `{ ok, parsed:{tracks:[…]} }` | `observed_playlist_snapshots`, `observer_playlist_tracks` | observer pipeline, `diag-observer-extract` | sob demanda |
| `bot-upload-print` | POST (multipart) | `{ file: screenshot.png, deal_id, song_id, batch_id, ... }` | `{ ok, batch_id, url }` | `bot_print_batches`, Storage `bot-prints/`, dispara `extract-snapshot-from-print` | OCR → ingestão de plays | **1.010 raw** |
| `bot-collect-queue` | GET `?limit=N` | header `x-bot-key` | `{ items:[{ deal_id, song_id, spotify_track_id, ... }] }` | leitura (fila de campanhas com `auto_collect=true`) | bot decide o que coletar; **raro fallback Spotify API** pra resolver artist_id ausente | 13 calls Spotify/14d |
| `bot-execution-queue` | GET `?limit=N` | header bot | `{ jobs:[{ id, action, playlist_id, tracks, ... }] }` | leitura de `playlist_execution_jobs`/`playlist_operation_queue` | bot aplica via `_shared/spotify-playlist.ts` | 277 calls Spotify/14d |
| `bot-execution-complete` | POST | `{ job_id, status, result, error? }` | `{ ok }` | `playlist_operation_log`, `playlist_operation_queue` (marca done) | `auto-adjust-playlists`, brain | linkado |
| `observer-pull-queue` | GET | header bot | `{ playlists:[…] }` | leitura `playlists_to_observe` | observer | sob demanda |
| `observer-ingest-tracks` | POST | `{ playlist_id, tracks:[…], snapshot_at }` | `{ ok }` | `observed_playlists`, `observer_playlist_tracks`, `observer_runs` | brain de observação | sob demanda |
| `observer-upload-failure` | POST | `{ playlist_id, reason, screenshot? }` | `{ ok }` | `observer_runs.failure`, `system_alerts` | dashboard | sob demanda |
| `import-label-spreadsheet` | POST (multipart) | XLSX do cliente | `{ ok, upload_id, rows_imported, rows_skipped }` | `label_spreadsheet_uploads`, `label_spreadsheet_rows`, dispara `enrich-curator-playlists-spotify` inline | `fn_campaign_delivery_accumulated`, `CampanhaExecucao` | **6 raw / 17 uploads** |

---

## Tabelas alimentadas exclusivamente pelo VPS

| Tabela | Conteúdo | Lida por |
|---|---|---|
| `bot_heartbeats` | sinais de vida do bot | `engine-health`, "Saúde" |
| `bot_events` | eventos estruturados (info/warn/error) | "Alertas", `monitor-critical-crons` |
| `bot_ingest_raw` | payload bruto de toda ingestão (auditoria) | forensics |
| `bot_print_batches` | screenshots + metadata | OCR pipeline, "Prints" |
| `song_snapshots` | plays totais por música (24h window) | `Performance`, `Catalogo` |
| `curator_deal_snapshots` | plays por (deal, playlist, dia) | `fn_campaign_delivery_accumulated`, `CampanhaExecucao` |
| `song_snapshot_playlists` | breakdown por playlist dentro do snapshot | `CampanhaExecucao` |
| `delivery_proofs` | provas de presença (track em playlist) | `revalidate-deliveries` |
| `label_spreadsheet_uploads/rows` | dados crus do XLSX | `fn_campaign_delivery_accumulated` |
| `observed_playlist_snapshots` / `observer_playlist_tracks` | observação de playlists não-gerenciadas | brain de observação |
| `playlist_followers_snapshots` (parcial) | followers via DOM (observacional, arredondado) | dashboards de capacidade (deve ser secundário) |

---

## Dados que **NÃO** vêm do VPS

- Followers exatos (Spotify API)
- Nome / capa / owner de playlist (Spotify API)
- Items de playlist em ordem real (Spotify API)
- Metadata de track / artista (Spotify API)
- Paradas editoriais (Spotify Charts)
- OAuth tokens (accounts.spotify.com)

---

## Inconsistências detectadas no fluxo VPS

| Fluxo | Sintoma | Causa | Status |
|---|---|---|---|
| `bot-ingest-snapshot` antes de 2026-06-12 | 1.974 linhas órfãs sem `upload_id` / `reference_date` | bug histórico — **corrigido na Fase 5.B.3** (migration 20260617231020) | ✅ Resolvido |
| `playlist_followers_snapshots` vs `playlists.followers_count` | UI mostra número diferente do Spotify | DOM arredonda >1k; valor Spotify API é exato | ⚠ Documentado — UI deve filtrar por `followers_source` |
| `import-label-spreadsheet` deixa `playlist_name` cru | nome do XLSX persiste se faltar `spotify_playlist_id` | importer não bloqueia row sem ID | ⚠ Transiente — `enrich-curator-playlists-spotify` corrige inline |
| `bot-collect-queue` cai no Spotify pra resolver `artist_id` | acopla fila do bot ao breaker | cliente sem `spotify_artist_id` cadastrado | ⚠ Raro (13/14d) — candidato a mover pro worker |

---

## Recomendações (NÃO executar nesta fase)

1. Tornar `spotify_playlist_id` **obrigatório** em `label_spreadsheet_rows` antes de entrar na agregação; sem ID → row vai pra `quarantine` (já implementado parcialmente na Fase 5.B.3).
2. Mover resolução de `artist_id` de `bot-collect-queue` pro `spotify-enrichment-worker` (fila + cache).
3. Adicionar coluna `source` em `playlist_followers_snapshots` (`vps_dom` | `spotify_api`) pra desambiguar leitura.
4. Considerar enviar `followers_exact` do VPS quando disponível (Spotify mostra exato em alguns DOM contexts).

---

**Auditoria concluída. Nenhuma alteração de código ou banco realizada.**
