# Architecture

## Fluxo de dados

```
                    ┌─────────────────────┐
                    │   Spotify Web API   │
                    └──────────┬──────────┘
                               │ busca por gênero/termo
                               ▼
                    ┌─────────────────────┐
                    │    search_tracks    │  pool bruto de faixas
                    └──────────┬──────────┘
                               │ diagnose-managed-playlist
                               ▼
                    ┌─────────────────────┐
                    │  editorial_history  │  top-8 por gênero
                    └──────────┬──────────┘
                               │ apply-meta-plan / apply-playlist-plan
                               ▼
                    ┌─────────────────────┐
                    │  managed_playlists  │◄────┐
                    │ managed_playlist_   │     │ enrich-playlists
                    │       tracks        │     │ (cron semanal)
                    └──────────┬──────────┘     │
                               │                │
            ┌──────────────────┴──────────────┐ │
            │                                 │ │
            ▼                                 ▼ │
  ┌─────────────────┐               ┌─────────────────┐
  │   campaigns +   │               │  curator_deals  │
  │ eco_allocations │               │ curator_play... │
  └────────┬────────┘               └────────┬────────┘
           │                                 │
           └─────────────┬───────────────────┘
                         ▼
              ┌─────────────────────┐
              │  Bot VPS Playwright │
              │ (bot-collect-queue  │
              │  bot-ingest-snapshot│
              │  bot-ingest-dom)    │
              └──────────┬──────────┘
                         │
            ┌────────────┴────────────┐
            ▼                         ▼
  ┌─────────────────┐       ┌─────────────────┐
  │ delivery_proofs │       │ curator_deal_   │
  │   (imutável)    │       │   snapshots     │
  └─────────────────┘       └────────┬────────┘
                                     │ trigger
                                     ▼
                          ┌─────────────────────┐
                          │ campaigns.          │
                          │   total_delivered   │  (cache)
                          └──────────┬──────────┘
                                     │
                                     ▼
                          ┌─────────────────────┐
                          │   Portal Cliente    │
                          │   Portal Curador    │
                          └─────────────────────┘
```

## Os 4 modelos de playlist

| Tabela | Quando usar |
|---|---|
| `playlists` | **Legado.** Não usar em código novo — mantida só para compatibilidade. |
| `managed_playlists` | **Playlists próprias da plataforma.** Use esta para tudo que envolve inventário interno (alocações eco, dimensionamento de campanha, planos editoriais). |
| `curator_playlists` | Playlists de curadores **vinculadas a um deal específico**. Vivem dentro do escopo de uma transação (`curator_deals.id`). |
| `curator_playlist_library` | **Inventário** de playlists de um curador, independente de deal. Usado em prospecção e biblioteca do curador. |

## Colunas que são cache

Estas colunas existem para performance e **não devem ser editadas
manualmente** — são derivadas de outra fonte e podem ser recalculadas.

| Coluna | Fonte da verdade | Como é atualizada |
|---|---|---|
| `campaigns.total_delivered` | `fn_campaign_delivery_accumulated` (modelo **High-Water Mark** — ver `docs/DELIVERY_ENGINE.md`) | Triggers `sync_campaign_total_delivered*` em `curator_deal_snapshots` e `campaign_eco_snapshots`; também recalculado por `recompute_campaign_total_delivered` e `cron-reconcile-curator-deals`. |
| `curator_deals.reconciled_total_plays` | `fn_curator_delivery_accumulated` (HWM por curador) | `recompute_campaign_total_delivered`. |
| `managed_playlists.tracks_count` | `managed_playlist_tracks` | Recalculado quando o conjunto de tracks da playlist muda (add/remove/reorder). |
| `managed_playlists.followers` | Spotify Web API | Cron semanal `enrich-playlists` faz `GET /v1/playlists/{id}` e grava `followers.total`. |

## Modelo oficial de Delivery — High-Water Mark

A NexEngine define delivery como:
`SUM por playlist de GREATEST(0, MAX(plays_7d desde baseline) − baseline_plays)`.
`plays_7d` é janela móvel do Spotify, não contador acumulado — quedas da
janela **não** reduzem delivery e recuperações abaixo do recorde **não**
geram nova entrega. Detalhes e validação em `docs/DELIVERY_ENGINE.md` e
`docs/audits/HWM_VALIDATION.md`.

## Edge functions com `verify_jwt = false`

12 funções rodam sem validação automática de JWT pelo runtime. Cada uma valida
o caller por outro mecanismo (token público, assinatura HMAC, ou é endpoint
admin chamado por cron). Lista canônica em `supabase/config.toml`:

| Função | Motivo |
|---|---|
| `bot-event-ingest` | Webhook do bot VPS — autentica via segredo compartilhado (`BOT_SECRET`). |
| `bot-heartbeat` | Webhook do bot VPS — mesma autenticação por segredo. |
| `bot-ingest-dom` | Webhook do bot VPS para piggyback de DOM — segredo compartilhado. |
| `sync-kworb-charts` | Cron interno que baixa charts do Kworb — sem usuário associado. |
| `sync-spotify-editorial-charts` | Cron interno que baixa editoriais do Spotify — sem usuário associado. |
| `preview-transactional-email` | Preview de templates de email — endpoint utilitário público read-only. |
| `handle-email-unsubscribe` | Link público de unsubscribe enviado em emails — não há usuário logado. |
| `handle-email-suppression` | Webhook de bounce/spam do provedor de email — autentica por assinatura. |
| `detect-curator-fraud` | Cron interno de detecção — sem usuário associado. |
| `get-shared-campaign-plan` | Portal público da campanha — autentica via `public_plan_token`. |
| `campaign-plan-api` | API pública do plano consumida pelo portal — autentica via token. |
| `campaign-daily-plan` | Plano diário lido pelo portal público — autentica via token. |

> As funções `get-client-campaign-public`, `client-approve-campaign` e
> `client-request-adjustment` também são públicas (portal do cliente), mas usam
> o default de runtime e validam o `client_token` em código, com rate limit de
> 120 req/min por IP via `_shared/rate-limit.ts`.

## Decisões arquiteturais

### ADR — `followers` como proxy de saves
A API do Spotify **não expõe o número de saves de uma playlist**, apenas
followers. Como saves e followers crescem proporcionalmente em playlists
editoriais (a UI do Spotify trata os dois como a mesma ação), o engine usa
`managed_playlists.followers × multiplicador_de_engajamento` como proxy de
capacidade. O multiplicador (default 30) representa quantos plays/mês cada
save gera em média, e é configurável por instalação. Trade-off: erra para
playlists muito antigas (followers ≫ saves ativos) ou muito novas (followers
pequenos mas engajamento alto) — compensado pela trava defensiva no insert de
`campaign_eco_allocations` que limita `planned_streams` pela capacidade real.

### ADR — `total_delivered` é cache, não calculado em tempo real
Recalcular a soma de plays por campanha em toda leitura exigiria agregar
milhares de linhas de `curator_deal_snapshots` por request, o que tornaria o
portal lento. A trigger no insert/update de snapshots mantém o cache
atualizado, e `cron-reconcile-curator-deals` corrige eventuais drifts. O custo
de inconsistência temporária é baixo (segundos), o ganho de latência no portal
é grande.

### ADR — `delivery_proofs` é imutável
Cada coleta do bot gera uma linha em `delivery_proofs` que **nunca é
atualizada ou deletada**. Isso garante:
1. Auditoria completa — sempre é possível reconstruir o estado histórico.
2. Disputa com curadores — o cliente pode questionar uma cobrança e o
   registro original (com timestamp, screenshot e DOM bruto) está preservado.
3. Backfill — agregações como `curator_deal_snapshots` e
   `campaigns.total_delivered` podem ser recomputadas do zero a partir das
   provas se um bug for descoberto.

Atualizações de status (ex.: "esta prova foi invalidada") vivem em colunas
adicionais (`invalidated_at`, `invalidation_reason`), nunca apagando o
registro original.
