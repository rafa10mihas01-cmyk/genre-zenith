
## Diagnóstico (evidência atual — deal `ae37e1d0` Pique Anos 80)

| Camada | Valor | Fonte |
|---|---|---|
| Bruto real (DOM Spotify for Artists) | **100 linhas / ~339.516 plays** | `bot_print_batches.dom_payload` (1 batch processado) |
| Persistido em `curator_playlists` | **14** (6 curator + 8 algorithmic + 0 organic) | `select count(*) group by match_status` |
| Snapshots baseline | curator: 1.406 / algorithmic: 162.625 | `curator_deal_snapshots` |
| Log baseline `total_plays` | **1.406** | `curator_deal_logs.total_plays` |

### Causa raiz (linha exata)
`extract-snapshot-from-print/index.ts`:

- L602–607: `if (whitelistActive && !isAlgo) { if (!preResolvedId || startsWith("algo:")) { filteredOut++; continue; } }` — descarta linhas Gemini fora da whitelist.
- L818–821 (loop DOM complementar): `if (whitelistActive && !whitelist.has(dom.id)) { filteredOut++; continue; }` — descarta as 86 linhas DOM "organic".
- L592 (`totalPlays += plays`) só é atingido pelas linhas que passaram do filtro acima → log baseline ficou em 1.406.

Conclusão: a captura bruta **não** está completa. Whitelist está filtrando ingestão, não apenas classificando. Isso viola a regra "nunca descartar linhas do DOM bruto".

---

## Princípio que vou aplicar

```text
DOM bruto  ──►  persistência 100% (curator_playlists + curator_deal_snapshots)
                         │
                         ├─► classificação por match_status:
                         │     curator      = whitelist do curador
                         │     editorial    = made_by Spotify (ex-algorithmic)
                         │     algorithmic  = Radio/Mixes/Daylist/Discover etc
                         │     organic      = restante (não whitelist, não Spotify)
                         │
                         └─► métricas:
                               bruto_total       = sum(snapshots WHERE batch=último)
                               curator_delivered = sum(snapshots WHERE match_status='curator')
                               progresso/meta    = curator_delivered (inalterado)
```

Whitelist deixa de ser **gate de ingestão** e passa a ser **etiqueta de origem**.

---

## Mudanças

### 1. `extract-snapshot-from-print/index.ts` — separar captura de classificação
- Remover `filteredOut++; continue` em L602–607 e L818–821.
- Para toda linha do DOM/Gemini que **não** seja algorítmica e **não** esteja na whitelist:
  - Inserir `curator_playlists` com `match_status='organic'`, `match_reason='ecosystem_capture'`.
  - Inserir snapshot normal (`source='spotify_for_artists'`, `match_method='ecosystem'`, `is_baseline` herdado).
- `totalPlays` (log) continua somando **todas** as linhas (já é o que faz hoje em L592) → vira `bruto_total`.
- Sem mudar `algorithmic`/`curator`/upsert por batch (idempotência preservada).

### 2. `get_curator_deal_progress` (RPC) — **não muda**
Já filtra `match_status='curator'`. Garante que progresso/ETA/meta continuem refletindo só whitelist.

### 3. `cron-reconcile-curator-deals` — **não muda**
Reconcile usa snapshots curator. Confirmado por `rg`.

### 4. `useCuratorDeals.ts` — exibição
- Manter map de `algorithmic → editorial` (como já está).
- Não filtrar nada por `match_status` — hook já traz tudo. UI decide.

### 5. Telas

| Tela | Comportamento após patch |
|---|---|
| `CuratorDealCard` (resumo do deal) | Continua **só whitelist** — agrupa por `match_status` (curator/editorial); organic vai pra "ecossistema" |
| `DealHistorySheet` | Mostra **ecossistema completo** (já agrupa por status) — passa a listar organic também |
| `DealLogDetailDialog` | Mostra ecossistema completo |
| `CuratorPage` (público) | **Só whitelist** (`match_status='curator'`), sem mudança |
| `get-curator-deal-public` / `get-client-campaign-public` | **Só whitelist**, sem mudança |
| `detect-curator-fraud` | Continua usando `streams_7d` por playlist; ganha mais sinal (organic) sem inflar curator |

### 6. Reparo retroativo
Script SQL único, idempotente, **sem duplicar**:

```text
Para cada batch processado em bot_print_batches:
  ler dom_payload (100 linhas)
  para cada linha não-algorítmica que NÃO existe em curator_playlists do deal:
    INSERT curator_playlists (match_status='organic', match_reason='retro_ecosystem')
    INSERT curator_deal_snapshots (batch_id=batch.id, plays=parse(plays_text), is_baseline=batch é o 1º?)
  recomputar curator_deal_logs.total_plays = SUM(snapshots do batch)
```

Garantias anti-duplicação:
- `INSERT ... WHERE NOT EXISTS (SELECT 1 FROM curator_playlists WHERE deal_id=$ AND spotify_playlist_id=$)`.
- Snapshot já tem upsert por `(batch_id, playlist_id)` — script reutiliza chamada equivalente.
- Log: `UPDATE` (não INSERT) do registro existente daquele batch.

### 7. Relatório (saída do script de reparo)
Para cada deal afetado imprime:
```
deal=<id> song=<name>
  bruto_total      : 339516
  whitelist (curator): 1406
  editorial        :   xxx
  algorithmic      : 162625
  organic          : 175485
  playlists novas inseridas: 86
  snapshots inseridos      : 86
  log atualizado: 1406 → 339516
```

### 8. Validação pós-patch
- `progress.delivered_curator` antes/depois → deve ser **igual** (ainda é 1.406).
- `target_plays`/`baseline_plays` → não mudam.
- Gráfico do curador (CuratorPage público) → não muda.
- Histórico interno (DealHistorySheet) → mostra 100 playlists.
- Sem inflação dupla: snapshot organic não entra em `get_curator_deal_progress`.

---

## Ordem de execução
1. Patch `extract-snapshot-from-print` (remove 2 filtros).
2. Deploy.
3. Rodar script de reparo retroativo (1 batch hoje: Pique Anos 80).
4. Imprimir relatório comparativo.
5. Validar `get_curator_deal_progress(deal)` → continua 1.406 entregues.
6. Confirmar visualmente as 100 playlists no DealHistorySheet.

Sem migração de schema. Sem mudança em RPC. Sem mudança nas telas públicas.
