# Plano: Desbloquear `campaign_eco_snapshots`

Corrigir os 3 bugs estruturais identificados na investigação. Sem isso, nenhum dado de campanha entra na tabela e Gap 17 (lift orgânico) fica sem fundação.

## Bug A — Shadow deal sem `source='campaign_internal'`

**Onde:** edge function `approve-campaign-plan` (e qualquer caminho que crie `curator_deals` a partir de allocation de campanha — Carnívoro tem 2 deals com `source=NULL` provando o bug).

**Fix:** ao criar o shadow deal de campanha interna, setar explicitamente:
- `source = 'campaign_internal'`
- `collection_mode = 'bot'`
- `state = 'collecting'` (não `awaiting_playlists`)
- `campaign_id = <id>` (já existe)

**Backfill:** UPDATE nos 2 deals da Carnívoro + 1 da "Eu Já Era Trap" pra alinhar com o modelo correto. Migration manual via `supabase--insert` (data only, sem schema).

## Bug B — Seed de `curator_playlists` como baseline

**Onde:** mesma edge function (`approve-campaign-plan` / `simulate-campaign-flow`).

**Problema:** o gate em `bot-collect-queue` (linha ~158) só dispatcha songs cujo deal tem rows em `curator_playlists` com `match_status IN ('curator','baseline')` e `spotify_playlist_id` real. Allocations existem em `campaign_eco_allocations` mas não viram baseline no deal.

**Fix:** quando aprovar plano de campanha, pra cada `(deal, song)` shadow, fazer upsert das 86 managed_playlists allocadas como rows em `curator_playlists`:
```
{ deal_id, song_id, spotify_playlist_id, playlist_name, match_status: 'baseline' }
```
Com `onConflict: 'deal_id,song_id,spotify_playlist_id', ignoreDuplicates: true`.

**Backfill:** rodar o mesmo seed pros 3 deals existentes via insert tool.

## Bug C — Promoção automática de state

**Onde:** mesma function. Deals de campanha entram em `awaiting_playlists` e ficam travados (bot-collect-queue exclui esse state).

**Fix:** após seed do Bug B ter rodado com sucesso (≥1 baseline inserido), promover deal para `state='collecting'` no mesmo fluxo. Idempotente — se já estiver collecting, no-op.

**Backfill:** UPDATE no deal "Eu Já Era Trap" pra `state='collecting'` após Bug A+B aplicados.

## Ordem de execução

1. Editar `supabase/functions/approve-campaign-plan/index.ts` (e/ou `simulate-campaign-flow`) aplicando A+B+C — deploy automático.
2. Insert tool: backfill dos 3 deals existentes (UPDATE source/mode/state + INSERT baseline playlists).
3. Aguardar 1 ciclo do bot (~5min) e validar: `SELECT count(*) FROM campaign_eco_snapshots WHERE created_at > now() - interval '10 min'`.

## Riscos

- Carnívoro tem 86 playlists × N songs = potencialmente centenas de rows novas em `curator_playlists`. Tudo com `match_status='baseline'`, isolado do fluxo de curador manual.
- Se `approve-campaign-plan` for chamada de novo numa campanha já ativa, o upsert é idempotente — sem duplicação.
- Não toca em `match_curator_playlist` RPC nem em `ingest-dom.ts` (já estão corretos).

## Fora de escopo

- Gap 17 (lift orgânico) — só faz sentido depois desse fix popular dados.
- Gap 8 (já tem 86 rows, não estava vazio).
- Reescrita do modelo curator_deals/campaigns — fix cirúrgico no fluxo de criação.

Confirma pra eu aplicar?