# AUDIT 08 — Índices do schema `public` (Fase 1.3)

**Modo:** read-only. Nenhum DROP executado.

Fonte: `pg_stat_user_indexes` + `pg_indexes`. Snapshot tirado em 2026-06-06.

---

## Resumo

| Categoria | Qtd | Tamanho total |
|---|---|---|
| Índices nunca usados (`idx_scan = 0`), ≥ 200 KB, não-PK | **20** | **~23 MB** |
| Suspeitos de duplicação semântica | **2 pares** | — |
| Em uso pesado (manter sempre) | 8+ | — |

Banco saudável o suficiente para não exigir DROP urgente. Mas há 23 MB de índice morto e 2 duplicações claras a sanear.

---

## 🔴 Críticos — DROP recomendado (índices nunca usados desde reset, > 1 MB)

| Tabela | Índice | Tamanho | Definição |
|---|---|---|---|
| `bot_heartbeats` | `idx_bot_heartbeats_worker` | 4.9 MB | `(worker_id, created_at DESC) WHERE worker_id IS NOT NULL` |
| `bot_heartbeats` | `idx_bot_heartbeats_hostname` | 4.9 MB | `(hostname, created_at DESC) WHERE hostname IS NOT NULL` |
| `spotify_call_log` | `idx_spotify_call_log_endpoint_created` | 2.2 MB | `(endpoint, created_at DESC)` |
| `spotify_call_log` | `idx_spotify_call_log_function_created` | 1.8 MB | `(function_name, created_at DESC)` |
| `spotify_call_log` | `idx_spotify_call_log_app_created` | 1.3 MB | `(app_id, created_at DESC)` |
| `spotify_call_log` | `idx_spotify_call_log_status_created` | 1.1 MB | `(status, created_at DESC) WHERE status <> 'ok'` |

→ **Ganho: ~16 MB.** Tabelas de log/observabilidade que ninguém consulta por essas dimensões na prática.

## 🟠 Importantes — DROP recomendado (200 KB – 1 MB, nunca usados)

| Tabela | Índice | Tamanho |
|---|---|---|
| `bot_events` | `idx_bot_events_status` | 880 KB |
| `bot_events` | `idx_bot_events_song_corr` | 824 KB |
| `bot_events` | `idx_bot_events_correlation_id` | 432 KB |
| `bot_events` | `idx_bot_events_worker` | 304 KB |
| `bot_events` | `idx_bot_events_lifecycle_state` | 224 KB |
| `bot_events` | `idx_bot_events_deal_id` | 216 KB |
| `search_tracks` | `idx_search_tracks_result` | 720 KB |
| `search_results` | `idx_search_results_owner_nome_norm` | 696 KB |
| `search_results` | `idx_search_results_priority` | 544 KB |
| `search_results` | `idx_search_results_winner_score` | 416 KB |
| `playlist_metrics_snapshots` | `idx_pms_template_collected_desc` | 360 KB |
| `playlist_metrics_snapshots` | `idx_pms_template` | 360 KB |
| `raw_chart_daily` | `idx_raw_chart_daily_chartname_date` | 240 KB |
| `collection_logs` | `idx_collection_logs_genre` | 232 KB |

→ **Ganho: ~6 MB.**

## 🟠 Duplicações semânticas (DROP de um dos dois)

### `playlist_metrics_snapshots`
- `idx_pms_template` → `(template_id, collected_at DESC)`
- `idx_pms_template_collected_desc` → `(template_id, collected_at DESC)`

São **idênticos**. DROP em um basta.

### `managed_playlist_tracks` — investigar (sobreposição parcial)
- `managed_playlist_tracks_playlist_track_uniq` — 1.8 MB, 11 scans, é UNIQUE
- `managed_playlist_tracks_pl_pos_idx` — 1.8 MB, 676 scans
- `managed_playlist_tracks_pkey` — 1.2 MB

3 índices grandes na mesma tabela. Pode haver redundância entre `playlist_track_uniq` e `pl_pos_idx` dependendo do prefixo. **Não dropar sem revisar** — `_uniq` é constraint e tem semântica, não só performance.

---

## 🟢 Saudáveis — manter

| Índice | Scans | Observação |
|---|---|---|
| `idx_bot_heartbeats_created` | 1.114 | hot read path |
| `idx_cron_health_job_ran` | 41.959 | dashboard de saúde |
| `curator_deal_snapshots_playlist_captured_unique` | 12.649 | hot, é UNIQUE |
| `idx_curator_deal_snapshots_deal_captured` | 129 | uso médio mas crítico |
| `idx_pbh_playlist_calc` | 1.774 | playlist_brain_history — usado |
| `idx_cds_deal_song_captured` | 758 | uso bom |
| `idx_collection_logs_created` | 660 | uso bom |
| `managed_playlist_tracks_pl_pos_idx` | 676 | hot path do editor |

---

## Plano de execução (quando aprovado)

1. **Snapshot CSV** dos DDLs antes de dropar (rollback fácil):
   ```bash
   psql -c "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public'" \
     > /mnt/documents/indexes_pre_drop.csv
   ```
2. **Migration única** com `DROP INDEX CONCURRENTLY` para cada item da lista crítica + importantes (20 índices).
3. **Aguardar 7 dias** com monitoramento. Se nenhuma query lenta aparecer, manter.
4. **Reset de estatísticas** após DROP: `SELECT pg_stat_reset();` para baseline limpa.

### Risco

🟢 Baixo. Índices com `idx_scan = 0` por dias/semanas indicam zero uso. DROP é reversível (CREATE INDEX volta). Único risco real: query nova que dependa deles e ainda não rodou em produção. Mitigação: 7 dias de observação.

### Estimativa de ganho

- **Storage:** ~23 MB liberados.
- **Write performance:** cada INSERT/UPDATE em `bot_heartbeats`, `bot_events`, `spotify_call_log`, `search_results` fica marginalmente mais rápido (menos índices para manter). Tabelas de alta frequência → ganho real, ainda que pequeno.
- **VACUUM:** mais rápido por iteração.

---

## Decisão pendente

Aprovar lista para DROP em batch único. Recomendo manter as 2 duplicações (`pms_template*`) e os 6 críticos como **primeiro batch** (16 MB, risco quase zero), e revisar os de `bot_events`/`search_*` num segundo batch após confirmar com quem mexe nesses módulos.
