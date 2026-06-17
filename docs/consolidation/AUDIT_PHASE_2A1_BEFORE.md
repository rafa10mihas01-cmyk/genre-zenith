# Fase 2.A.1 — Auditoria Forense da Família B (Delivery Legado)

> 100% leitura. Nenhuma alteração executada — nem migration, nem código, nem cron.
> Gerado em 2026-06-17.

## Escopo auditado

Família B = pilha legada do Delivery, composta por:

| Componente | Tipo |
|---|---|
| `recalc_campaign_progress(uuid)` | função SQL `SECURITY DEFINER` |
| `campaign_allocations.delivered_plays` | coluna cache |
| `v_playlist_delivery_history` | view |
| `recalc-campaign-progress-daily` | cron diário |

---

## Parte 1 — Responsabilidade

### `recalc_campaign_progress(uuid)`
- **Pergunta de negócio:** "quanto cada playlist alocada já entregou na campanha?" calculado como `MAX(plays) − MIN(plays)` em `curator_deal_snapshots` desde `campaigns.started_at`, e depois soma em `campaigns.total_delivered`.
- **Quem mais responde isso?** Família A — `fn_playlist_delivery_accumulated` → `fn_campaign_delivery_accumulated` → `recompute_campaign_total_delivered` — produz **o mesmo cache** (`campaigns.total_delivered`) usando **deltas positivos** de `campaign_playlist_collections`.
- **Se sumir hoje:** zero perda funcional — o cache continua sendo escrito pela Família A.

### `campaign_allocations.delivered_plays`
- **Pergunta de negócio:** "quantos plays foram entregues por cada alocação (playlist × campanha)?"
- **Quem mais responde isso?** `vw_campaign_playlist_growth` (view oficial Família A) já expõe `delta` por `(campaign_id, playlist_id, attributed_to)` — e o frontend já leu daí (ver Parte 3).
- **Se sumir hoje:** nenhum dado em produção depende disso — coluna está vazia (Parte 4).

### `v_playlist_delivery_history`
- **Pergunta de negócio:** "histórico agregado de entregas por playlist em todas as campanhas (target, delivered, fulfillment, avg/dia, restante)".
- **Quem mais responde isso?** Família A via `vw_campaign_playlist_growth` + `campaigns` produz o mesmo cálculo, mas a partir do crescimento real, não de `campaign_allocations`.
- **Se sumir hoje:** zero perda — não há consumidor vivo (Parte 5).

### Cron `recalc-campaign-progress-daily`
- **Pergunta de negócio:** "reconciliar diariamente os caches de delivery das campanhas ativas".
- **Quem mais responde isso?** A trigger `recompute_campaign_total_delivered` (Família A) já mantém o cache continuamente. A reconciliação periódica de payments curador é feita por `cron-reconcile-curator-deals` (família A, escopo deal).
- **Se sumir hoje:** zero perda — o cache continua sendo mantido pela trigger.

---

## Parte 2 — Quem escreve

| Componente | Escritor | Tipo |
|---|---|---|
| `campaign_allocations` (INSERT) | `src/components/campanhas/NewCampaignDialog.tsx:313` | Frontend |
| `campaign_allocations.status` (UPDATE) | `supabase/functions/bot-execution-complete/index.ts:207` | Edge function |
| `campaign_allocations` (DELETE) | `src/pages/CampanhaDetalhe.tsx:157` | Frontend |
| `campaign_allocations.delivered_plays` (UPDATE) | `recalc_campaign_progress` SQL function | SQL function |
| `campaigns.total_delivered` (UPDATE — fórmula MAX-MIN) | `recalc_campaign_progress` | SQL function |
| Chamada da função | `cron recalc-campaign-progress-daily` | Cron |
| Chamada da função | `src/hooks/useCampaigns.ts:219` (`recalcAll`) | Frontend (manual) |
| Chamada da função | `src/pages/CampanhaDetalhe.tsx:119` (botão "recalc") | Frontend (manual) |
| Triggers vivas em `campaign_allocations` | `trg_camp_alloc_updated`, `trg_sync_camp_alloc` | Trigger |
| `v_playlist_delivery_history` | — view derivada de `campaign_allocations` + `campaigns` | View |

> Observação: o cron grava `delivered_plays` e `total_delivered`, mas a trigger `recompute_campaign_total_delivered` (Família A) também grava `total_delivered`. **Existe sobreposição direta no mesmo campo.**

---

## Parte 3 — Quem ainda lê

Busca em `src/` + `supabase/functions/` (ignorando migrations e `types.ts`):

| Leitor | Arquivo | O que lê |
|---|---|---|
| Frontend | `src/pages/CampanhaDetalhe.tsx:71` | `campaign_allocations` (lista de playlists da campanha) — porém `total_delivered` já vem de `vw_campaign_playlist_growth` no mesmo handler (linha 76-90), Família A |
| Edge function | `supabase/functions/execution-planner/index.ts:153` | `campaign_allocations` (legacy path, executado em paralelo com `campaign_eco_allocations` — comentário no código admite que é "fonte antiga") |
| `v_playlist_delivery_history` | **NENHUM consumidor vivo em código** | só usada por migrations antigas e re-DDLs |
| `recalc_campaign_progress` | `useCampaigns.ts:219`, `CampanhaDetalhe.tsx:119`, cron | RPC |

`src/pages/Analytics.tsx:3-4` documenta explicitamente: *"Aposentou: campaigns.total_delivered, campaign_allocations, v_playlist_delivery_history, v_campaign_velocity, RPC get_campaign_analytics_overview."* — sinal claro de que o módulo de Analytics **já considerou esta família morta**.

---

## Parte 4 — Dados em `campaign_allocations.delivered_plays`

```sql
SELECT count(*) total,
       count(*) FILTER (WHERE delivered_plays>0) gt_zero,
       max(updated_at) last_update
  FROM campaign_allocations;

 total | gt_zero | last_update
-------+---------+-------------
     0 |       0 | (null)
```

**Tabela inteiramente vazia.** Zero linhas, zero `delivered_plays>0`, nunca atualizada.
A coluna não armazena nada em produção hoje.

Cross-check em `campaigns`:

```
  status   | count | total_delivered>0
-----------+-------+-------------------
 cancelled |     1 |   0
 active    |     7 |   3
```

3 campanhas ativas têm `total_delivered>0` **sem nenhuma linha em `campaign_allocations`** —
prova direta de que o cache `campaigns.total_delivered` está sendo escrito **exclusivamente pela Família A** hoje (a Família B somaria 0 e zeraria o cache se estivesse vencendo).

---

## Parte 5 — `v_playlist_delivery_history`

Definição:

```sql
SELECT playlist_id,
       count(DISTINCT campaign_id) campaigns_count,
       sum(target_plays) total_promised,
       sum(delivered_plays) total_delivered,
       fulfillment_rate,
       avg_daily_delivery,
       remaining
  FROM campaign_allocations ca JOIN campaigns c ...
 WHERE c.status IN ('active','paused','completed')
```

Como `campaign_allocations` está vazia, a view retorna **0 linhas** em qualquer consulta.

Busca de consumidores em código vivo:

```
rg "v_playlist_delivery_history" src supabase/functions
→ nenhum resultado fora de migrations.
```

**Conclusão:** view existe apenas no schema. Zero consumidores vivos.

---

## Parte 6 — Cron `recalc-campaign-progress-daily`

- **O que faz:** invoca `recalc_campaign_progress(NULL)` → varre todas campanhas `status='active'` e:
  1. recalcula `campaign_allocations.delivered_plays = MAX(plays) − MIN(plays)` em `curator_deal_snapshots` (fórmula legada de delivery por janela);
  2. soma e grava `campaigns.total_delivered`.
- **Sobreposição:** **100% do output já é produzido pela Família A** (trigger `recompute_campaign_total_delivered` mantém `campaigns.total_delivered` em tempo real, usando deltas positivos sobre `campaign_playlist_collections`).
- **Diferença de fórmula:** `MAX − MIN` em snapshots por deal × deltas positivos em coleções — duas matemáticas diferentes sobre **o mesmo campo** (`campaigns.total_delivered`). Race condition silenciosa: quem grava por último vence (hoje a Família A vence porque a Família B soma 0 sobre tabela vazia).
- **Campos alterados pelo cron:**
  - `campaign_allocations.delivered_plays` (cache morto)
  - `campaigns.total_delivered` (em conflito direto com Família A)

---

## Parte 7 — Comparação Família A vs Família B

| Aspecto | Família A (oficial) | Família B (legada) |
|---|---|---|
| Fonte da entrega | `campaign_playlist_collections` (deltas positivos via `fn_playlist_delivery_accumulated`) | `curator_deal_snapshots` (`MAX − MIN` por janela em `recalc_campaign_progress`) |
| Pipeline | `fn_playlist_delivery_accumulated` → `fn_campaign_delivery_accumulated` → `recompute_campaign_total_delivered` (trigger) | `recalc_campaign_progress` (RPC + cron diário) |
| Cache final | `campaigns.total_delivered` | `campaigns.total_delivered` (mesmo campo) + `campaign_allocations.delivered_plays` |
| Atualização | contínua (trigger) | uma vez por dia (cron) |
| View pública | `vw_campaign_playlist_growth` (consumida por `CampanhaDetalhe`) | `v_playlist_delivery_history` (zero consumidores) |
| Dados em produção | escrita ativa, 3/7 campanhas com `total_delivered>0` | tabela base vazia (0 linhas) |

**Respondem a mesma pergunta de negócio?**
Sim — ambas calculam "quanto a campanha entregou". O *output* final (`campaigns.total_delivered`) é literalmente o mesmo campo.
A única diferença é a **matemática** (deltas positivos vs MAX-MIN) e a **fonte** (coleções vs snapshots), o que é classificável como divergência de implementação, não de responsabilidade.

---

## Parte 8 — Critério oficial NexEngine

Aplicando a regra de consolidação (`mem://preference/consolidation-rule`):

1. **Responsabilidade igual?** ✅ Sim — ambas escrevem `campaigns.total_delivered` com a intenção de responder "quanto a campanha entregou".
2. **Nomenclatura ambígua?** Não — os nomes já refletem a duplicação (`recalc_campaign_progress` vs `recompute_campaign_total_delivered`).
3. **Família A é a fonte oficial?** ✅ Sim — pipeline canônico, atualização em tempo real, dados reais em produção, view pública consumida.

→ **Família B é candidata legítima à consolidação (DROP)** segundo a regra oficial.

---

## Parte 9 — Relatório final

| # | Pergunta | Resposta |
|---|---|---|
| 1 | A Família B ainda possui responsabilidade própria? | **Não.** Toda a sua responsabilidade está duplicada pela Família A. |
| 2 | Apenas duplica o Growth Engine? | **Sim** — com fórmula diferente e dados zerados, mas mesmo campo de saída. |
| 3 | Existe consumidor real? | **Quase nenhum.** `v_playlist_delivery_history`: zero. `campaign_allocations`: leituras vivas em `CampanhaDetalhe.tsx` e `execution-planner` (caminho legacy), mas a tabela está vazia — leituras retornam vazio. Botões manuais `recalc` existem em `useCampaigns` e `CampanhaDetalhe`. |
| 4 | Alguma regra de negócio depende? | **Não.** `CampanhaDetalhe` já deriva `total_delivered` de `vw_campaign_playlist_growth` (Família A). Nenhum PDF/portal/cron de pagamento depende de `delivered_plays`. |
| 5 | Se sumir hoje, perde funcionalidade? | **Não no negócio.** Perde apenas: (a) botão "recalc" sem efeito útil, (b) leitura legacy do `execution-planner` (já tem caminho oficial via `campaign_eco_allocations`), (c) listagem de alocações em `CampanhaDetalhe` (tabela vazia hoje — mas precisa migração para `campaign_eco_allocations` antes do DROP). |
| 6 | É legado? | **Sim, oficialmente.** Confirmado por dado vazio + comentário em `Analytics.tsx` + sobreposição direta com Família A. |
| 7 | Pode entrar na Fase 2.A.2? | **Sim, com plano de migração de leitores.** O DROP precisa ser precedido por: (i) remover botões `recalc`, (ii) migrar `CampanhaDetalhe.tsx` para listar via `campaign_eco_allocations` + `vw_campaign_playlist_growth`, (iii) remover branch `legacyRes` em `execution-planner`, (iv) remover INSERT em `NewCampaignDialog`, (v) remover UPDATE em `bot-execution-complete`. Só então: drop view → drop column → drop function → drop cron → drop table. |

---

## Recomendação (sem executar nada)

Iniciar **Fase 2.A.2** em duas sub-fases sequenciais:

- **2.A.2.a — Limpeza de leitores/escritores vivos** (somente código, sem tocar schema): remover ou migrar os 5 pontos listados na pergunta 7.
- **2.A.2.b — DROP definitivo** após Auditor AFTER confirmar zero dependências em código e zero leituras vivas em SQL.

A regra oficial continua valendo: o DROP só ocorre quando o Auditor AFTER reportar **0 dependências**.
