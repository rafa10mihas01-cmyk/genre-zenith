# Scale Hotspots — mapeamento (Fase 6)

Documento puramente descritivo. Nenhum código aqui está implementado — serve de referência para quando a escala exigir cache, multi-worker ou locks distribuídos.

## RPCs pesadas (candidatos a cache)

| RPC | Custo | Estratégia futura |
|---|---|---|
| `get_curator_deal_progress(deal_id)` | 4 CTEs aninhadas, scan em snapshots+playlists | Cache por `deal_id` com TTL 60s, invalidar ao inserir snapshot |
| `get_curator_deal_snapshot_history(deal_id)` | Group by minuto sobre snapshots | Cache idem |
| `match_curator_playlist(...)` (fuzzy) | `similarity()` full-scan no deal | Materializar `playlist_name_normalized` + index trigram |
| `record_curator_deal_capture(...)` | Loop de matching por snapshot | Sem cache (write-path); ver advisory locks abaixo |

## Queries críticas

- `bot-collect-queue` SELECT principal: `auto_collect=true` + join `curator_deals` + filtro state/token. Index atual `(auto_collect_status, next_auto_collect_at)` recomendado.
- `register-curator-playlist` carga de existing playlists: já restrita por `deal_id`.

## Race conditions atuais (já mitigadas)

- Importação concorrente do curador — in-memory lock por `deal_id|song_id` (60s TTL) + rate limit 5/min por token.
- Fila do bot — songs marcadas `queued` antes de retornar; recovery automático após 10min.
- Print batches — `recover_stuck_print_batches()` reprocessa `complete` sem `processed_at` após 5min.

## SKIP LOCKED (preparado, não ativado)

Quando rodar com >1 worker do bot:

```sql
-- bot-collect-queue futuro
SELECT * FROM curator_deal_songs
WHERE auto_collect = true
  AND auto_collect_status IN ('idle','error')
ORDER BY next_auto_collect_at NULLS FIRST
FOR UPDATE SKIP LOCKED
LIMIT 5;
```

## Advisory locks (preparado, não ativado)

`record_curator_deal_capture` por `(deal_id, song_id)` para evitar dois ingests concorrentes da mesma música:

```sql
PERFORM pg_advisory_xact_lock(hashtext(deal_id::text || ':' || coalesce(song_id::text,'')));
```

## Cache de meta de playlist do Spotify

`fetchPlaylistMeta` já tem retry com backoff. Próximo passo: KV cache (Deno.kv ou Redis) com TTL 5min — economiza ~80% das chamadas em re-importação.

## Storage growth a monitorar

View `v_storage_growth` — colunas:
- `curator_snapshots_ai_raw_bytes` (Gemini raw)
- `bot_print_batches_dom_payload_bytes`
- `bot_print_batches_print_paths_bytes`

Se passar de 500MB em qualquer uma, considerar truncar `ai_raw` para top-N campos ou mover para storage frio.

## Retenção atual

Ver `cleanup_operational_logs()` (cron diário 3am):
- bot_heartbeats: 7d
- collection_logs: 30d
- bot_events: 30d (90d para errors)
- ops_metrics: 30d

Snapshots, deal logs, fraud alerts e curator data NUNCA são tocados.
