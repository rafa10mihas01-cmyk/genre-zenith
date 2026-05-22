## Objetivo
Plugar o motor `buildEcoPlan` no fluxo dos `curator_deals` e ligar um cron diário que compara entrega real vs planejado, marcando deals atrasados/com spike.

## 1. Nova tabela `curator_deal_plan` (migration)

Guarda a meta diária por playlist de cada deal — espelha o que `campaign_eco_allocations` faz para campanhas.

Colunas:
- `id`, `deal_id` (FK curator_deals), `curator_playlist_id` (FK curator_playlists), `playlist_name`, `followers`
- `position` (3–20, vinda do `distributeEcoPositions`)
- `start_day` (dia 1..N)
- `cap_dia` (teto diário sustentável da playlist)
- `daily` (jsonb com array de metas por dia)
- `total_streams` (soma do daily)
- `generated_at`, `engagement_mult`
- Unique (deal_id, curator_playlist_id)

Tabela adicional `curator_deal_delivery_status`:
- `deal_id` PK, `last_checked_at`, `expected_to_date`, `actual_to_date`, `delta_pct`, `status` (`on_track` | `lagging` | `spiking` | `paused`), `reason`, `spike_playlist_ids` (jsonb)

RLS: dono do deal lê via `user_id` do deal pai (security definer helper já existente).

## 2. Nova edge function `build-deal-plan`

Inputs: `{ deal_id }`. Service role.

Fluxo:
1. Carrega `curator_deals` (started_at, ends_at, target_plays, ramp_up_days, duration_days).
2. Carrega `curator_playlists` do deal onde `match_status in ('curator','baseline')` e `followers > 0`.
3. Monta `Alloc[]` mapeando cada playlist como `{ id, planned_streams, start_day, managed_playlists: { followers, name, ... } }`. `planned_streams` distribui `target_plays` proporcional aos followers (com piso).
4. Snapshot sintético: `{ days: duration_days, modo: 'simultaneo', curva: [{streamsDay: daily_goal}] * days }`.
5. Chama `buildEcoPlan` (já existe em `_shared/computeEcoPlan.ts`).
6. Upsert em `curator_deal_plan` (apaga linhas órfãs).

Chamado em:
- `enrich-curator-paste` (após salvar curator_playlists, dispara `build-deal-plan` em background)
- `register-curator-playlist` (mesmo)

## 3. Novo cron `cron-deal-delivery-check` (1x/dia, 09:00 UTC)

Para cada `curator_deals` ativo (state='active'):
1. Lê plano (`curator_deal_plan`) e soma `daily` até hoje → `expected_to_date`.
2. Lê `curator_deal_snapshots` mais recente → `actual_to_date` (reconciled_total_plays - baseline).
3. `delta_pct = (actual / expected) - 1`.
4. Status:
   - `< -25%` → `lagging`
   - `> +50%` em <48h → `spiking`
   - se 3+ playlists ganharam streams_7d > 2× cap_dia no mesmo dia → marca em `spike_playlist_ids` (anti-spam)
   - senão `on_track`
5. Upsert em `curator_deal_delivery_status`.

## 4. UI mínima (sem expandir escopo)

Em `/playlist-deals` (lista de Ativos) e na página do deal, mostrar badge de status (`on_track`/`lagging`/`spiking`) lendo `curator_deal_delivery_status`. Sem nova rota, sem novo módulo.

## 5. Cron schedule

`pg_cron` chamando `cron-deal-delivery-check` 1x/dia às 09:00 UTC.

## Detalhes técnicos
- Plano é regenerado idempotente — sempre recomputado a partir das curator_playlists atuais. Sem migração de dados antigos.
- `engagement_mult` default 30 (mesmo do sistema novo).
- `build-deal-plan` é fire-and-forget no paste; falha não bloqueia import.
- Cron grava log em `system_health_logs` se já existir, senão só console.
