# Plano — Separação Curador↔Ecossistema + Observabilidade Fase A

Dois blocos independentes, entregues em ordem. Cada bloco é validável isoladamente.

---

## BLOCO 1 — Separação estrutural Curador / Orgânico / Ecossistema

### Princípio
- **Ingestão** continua salvando 100% do DOM bruto (já corrigido na rodada anterior).
- **Classificação** acontece via `curator_playlists.match_status` (`curator | editorial | algorithmic | organic | suspicious | baseline`).
- **Apresentação** passa a ter 3 visões explícitas, nunca misturadas no mesmo número.

### Mudança de dados (uma migration pequena)

Nova RPC `get_curator_deal_breakdown(p_deal_id uuid)` retornando 3 blocos a partir de `curator_deal_snapshots` + `curator_playlists` mais recente por playlist:

```
{
  curator:    { playlists, plays, delivered_vs_baseline },
  ecosystem: {
    editorial:   { playlists, plays },
    algorithmic: { playlists, plays },
    organic:     { playlists, plays }
  },
  total:      { playlists, plays }
}
```

Regra anti-duplicação: para cada `playlist_id` pega-se o snapshot mais recente (`DISTINCT ON (playlist_id) ORDER BY captured_at DESC`). Soma por bucket. Baseline (`is_baseline=true`) é excluída de todos os totais. Isso garante: `total = curator + editorial + algorithmic + organic`, sem somar duas vezes a mesma playlist.

### Mudança de UI

| Tela | Hoje mostra | Passa a mostrar |
|---|---|---|
| `CuratorDealCard` (lista) | KPI único misturado | KPI principal **"Entrega do curador"** (whitelist) + linha secundária "+ X playlists ecossistema" |
| `DealHistorySheet` | Tudo junto | 3 abas: **Curador** / **Ecossistema** / **Bruto** |
| `DealLogDetailDialog` | Tudo | Mesma separação visual com badges por `match_status` |
| `CuratorPage` (público do curador) | só whitelist | **inalterado** — só whitelist |
| `ClientCampaignPage` (público do cliente) | só whitelist | **inalterado** — só whitelist |
| PDF de fechamento | whitelist | **inalterado** |

### Regras intocadas (sem regressão)
- `get_curator_deal_progress` continua filtrando `match_status='curator'` → progress/ETA/baseline/financeiro idênticos.
- `cron-reconcile-curator-deals` continua usando snapshots curator → reconciled_total_plays inalterado.
- `daily_goal`, `target_plays`, `cost`, CPP → inalterados.
- Score de fraude continua recebendo organic/editorial como sinal (já implementado).

### Prova de não-duplicação
Antes do deploy: query de validação retroativa no deal `ae37e1d0`:
```
soma_breakdown(curator+editorial+algorithmic+organic) ?= soma_distinct_on_playlist
```
Se bater, não há dupla contagem.

---

## BLOCO 2 — Observabilidade Fase A (endpoint-side apenas)

**Sem alterar comportamento do worker da VPS.** Apenas instrumentação no lado Lovable + spec escrita pra VPS implementar depois.

### Migration
- `bot_events`: adicionar `correlation_id uuid`, `lifecycle_state text` (enum check: `FETCHED|ACCEPTED|QUEUED_LOCAL|STARTED|PRINT_UPLOADED|SNAPSHOT_SENT|FINISHED|FAILED|DISCARDED`), `discard_reason text`. Index em `correlation_id`.
- `bot_print_batches`: adicionar `correlation_id uuid` + index.
- `curator_deal_snapshots`: adicionar `correlation_id uuid` + index.
- View `v_dispatch_trace`: join correlation_id → ordem cronológica de todos os eventos/batches/snapshots para um único dispatch.

### Edge functions
- **`bot-collect-queue`** — gera `correlation_id = crypto.randomUUID()` por song dispatchada, devolve no payload (`queue[i].correlation_id`), grava `bot_events` com `lifecycle_state='FETCHED'`.
- **`bot-event-ingest`** — aceita `correlation_id` + `lifecycle_state` + `discard_reason` opcionais, valida enum, persiste.
- **`bot-upload-print`** — lê `correlation_id` do body, propaga pra `bot_print_batches`, grava evento `PRINT_UPLOADED`.
- **`extract-snapshot-from-print`** — propaga `correlation_id` do batch pros snapshots inseridos, grava `SNAPSHOT_SENT` e `FINISHED`.
- **`bot-heartbeat`** — aceita campo opcional `processing_correlation_ids: string[]` no metadata (não força, só registra).

### Spec escrita pra VPS (arquivo `docs/BOT_VPS_CONTRACT.md`)
Documenta exatamente:
- Headers obrigatórios
- Fields obrigatórios em cada POST
- Ordem dos lifecycle events
- `discard_reason` obrigatório quando `DISCARDED`
- Nunca silent return

**Não toca em timeout/retry/recovery** — fica pra fase B só depois que a prova determinística estiver fechada.

### View de debug
`v_dispatch_trace`:
```
correlation_id, deal_id, song_id,
fetched_at, accepted_at, started_at,
print_uploaded_at, snapshot_sent_at, finished_at,
discarded_at, discard_reason,
batch_id, snapshot_count, total_plays_extracted
```

Permite query única: "cadê o dispatch X?" → mostra exatamente em que estado parou.

---

## Ordem de execução
1. Migration Bloco 2 (correlation_id em 3 tabelas + view) — não-quebrante.
2. Edge functions Bloco 2 — propagação de correlation_id.
3. Spec VPS escrita.
4. Migration Bloco 1 (RPC `get_curator_deal_breakdown`).
5. Hook `useCuratorDealBreakdown` + UI nos 3 componentes.
6. Validação anti-duplicação no deal `ae37e1d0`.

## O que NÃO vai mudar nesta rodada
- Comportamento do worker VPS (só recebe spec).
- Cálculo de progress/baseline/financeiro/PDF/reconcile.
- Telas públicas (curador + cliente).
- Regras de timeout/retry/recovery do `bot-collect-queue`.

Confirma que pode prosseguir com os dois blocos nessa ordem?
