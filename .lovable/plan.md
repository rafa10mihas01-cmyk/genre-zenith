
# Fase 4 — Campaign Engine

Motor interno para criar campanhas próprias do tipo "quero X plays em N dias", com sugestão automática de playlists (baseada em scores da Fase 2), cálculo de pacing e acompanhamento de progresso.

**Princípio fundamental:** isto é uma camada paralela. `curator_deals` (campanhas para clientes externos) continua intocado. As novas tabelas vivem ao lado, sem conflito.

---

## 1. Banco de dados (migration)

### Tabela `campaigns`
Campanha interna ligada a uma música.

- `id` uuid PK
- `track_name` text NOT NULL
- `artist` text
- `spotify_track_id` text — opcional, se o usuário colar URL
- `spotify_track_url` text
- `cover_url` text
- `goal_plays` bigint NOT NULL CHECK (> 0)
- `deadline` date NOT NULL
- `started_at` timestamptz DEFAULT now()
- `status` text — `draft | active | paused | completed | cancelled` (default `draft`)
- `total_allocated` bigint DEFAULT 0 — soma das allocations
- `total_delivered` bigint DEFAULT 0 — soma de plays reais entregues (cache)
- `notes` text
- `created_by` uuid (auth.uid())
- `created_at`, `updated_at` timestamptz
- RLS: `has_team_access()` em todas as operações.

### Tabela `campaign_allocations`
Quanto de uma campanha cada playlist própria deve entregar.

- `id` uuid PK
- `campaign_id` uuid FK → `campaigns(id)` ON DELETE CASCADE
- `playlist_id` uuid FK → `playlists(id)` — canonical layer da Fase 1
- `target_plays` bigint NOT NULL CHECK (>= 0)
- `weight` numeric NOT NULL DEFAULT 1 — peso usado no rateio
- `delivered_plays` bigint DEFAULT 0
- `status` text — `suggested | approved | active | paused | completed` (default `suggested`)
- `position` smallint — ordem de prioridade
- `notes` text
- `created_at`, `updated_at`
- UNIQUE (`campaign_id`, `playlist_id`)
- RLS: `has_team_access()`.

### Índices
- `campaigns(status, deadline)`
- `campaign_allocations(campaign_id)`, `(playlist_id, status)`

### Função: `suggest_campaign_playlists(goal bigint, deadline_date date, exclude_active boolean default true)`
Retorna até 20 playlists próprias ranqueadas para atender a meta.

Lógica:
1. Pega `playlists` com `ownership = 'own'` (vindos da Fase 1) que tenham `playlist_scores` recente.
2. Se `exclude_active`, remove playlists que já estão em `campaign_allocations` com status `approved|active`.
3. Calcula `weekly_capacity = capacity_score` traduzido para plays/semana (usando `metadata->>'avg_weekly_plays'` do `playlist_scores` quando disponível; senão fallback proporcional ao capacity_score).
4. `expected_delivery = weekly_capacity * (semanas até deadline)`.
5. Ranqueia por score composto: `0.5 * capacity + 0.3 * health + 0.2 * (100 - risk)`.
6. Retorna: `playlist_id, name, capacity_score, health_score, risk_score, expected_delivery, suggested_target, suggested_weight`.

A função distribui `goal_plays` proporcionalmente ao `expected_delivery` das top playlists até cobrir a meta (ou usar todas se a capacidade total for menor que a meta — nesse caso a UI mostra aviso).

### Função: `recalc_campaign_progress(p_campaign_id uuid)`
Atualiza `total_delivered` no `campaigns` e `delivered_plays` em cada `campaign_allocations` com base nos plays observados em `curator_deal_snapshots` ligados às mesmas playlists no período da campanha. Chamada via RPC pelo frontend e por cron diário.

### Cron
Job pg_cron diário (03:30 UTC) chama `recalc_campaign_progress` para todas as campanhas com status `active`.

---

## 2. Frontend

### Nova página `/campanhas` (e item no sidebar "Campanhas internas")
- Lista de campanhas em cards usando o design system (`PageHeader`, cards padrão).
- Status filtros: Todas / Ativas / Concluídas / Rascunho.
- KPIs no topo: total ativas, plays prometidos, plays entregues, % médio de cumprimento.
- Botão "Nova campanha" abre wizard.

### Wizard "Nova campanha" (dialog em 3 passos)
**Passo 1 — Música & meta**
- Inputs: nome da música, artista, URL Spotify (opcional, faz lookup do cover), meta de plays, prazo (date picker).

**Passo 2 — Sugestão de playlists**
- Chama RPC `suggest_campaign_playlists(goal, deadline)`.
- Mostra tabela: playlist, capacity, health, risk, plays sugeridos, peso.
- Permite ajustar target manualmente por linha, remover, ou adicionar outra playlist própria.
- Resumo lateral: soma allocada vs meta (badge verde/amarelo/vermelho).

**Passo 3 — Revisão**
- Resumo final, status inicial: salvar como `draft` ou ativar (`active`).
- Cria registros em `campaigns` + `campaign_allocations`.

### Página de detalhe `/campanhas/:id`
- Header: música, cover, meta vs entregue (barra de progresso), dias restantes.
- Tabela de allocations: playlist, target, entregue, %, status, ações (pausar, ajustar, remover).
- Gráfico simples de pacing (linha real vs linha ideal) — Recharts.
- Botão "Recalcular progresso" → RPC.

### Componentes novos
- `src/pages/Campanhas.tsx`
- `src/pages/CampanhaDetalhe.tsx`
- `src/components/campanhas/NewCampaignDialog.tsx`
- `src/components/campanhas/CampaignSuggestionTable.tsx`
- `src/components/campanhas/CampaignProgressChart.tsx`
- `src/components/campanhas/CampaignCard.tsx`

### Roteamento e sidebar
- Adicionar rota em `App.tsx` protegida por `has_team_access`.
- Adicionar item "Campanhas" no `AppSidebar.tsx` (ícone `Target` ou `Rocket`), na seção Operação.

---

## 3. O que NÃO muda

- `curator_deals`, `curator_deal_songs`, `curator_deal_snapshots`, `curator_playlists`, `curator_playlist_library`: nenhuma alteração de schema ou contrato.
- `managed_playlists`, `playlists`, `playlist_scores`, `accounts`, `spotify_accounts`, `vps_nodes`: nenhuma alteração.
- Bot e edge functions: nenhuma mudança. As campanhas internas hoje são camada de planejamento/atribuição; a execução real continua passando por `curator_deal_snapshots` (que já mede plays por playlist), e o motor lê dali para atualizar progresso.

---

## 4. Verificações pós-deploy

1. Criar campanha de teste (5k plays, 14 dias) e validar sugestão.
2. Confirmar que `total_allocated` ≈ `goal_plays`.
3. Conferir que nenhuma RLS de `curator_*` foi tocada (linter).
4. Rodar `recalc_campaign_progress` manualmente e confirmar atualização.

---

## 5. Entregáveis

- 1 migration SQL (tabelas + funções + cron + RLS).
- 6 componentes/páginas novos React.
- 2 edits: `App.tsx`, `AppSidebar.tsx`.
- Atualização de `.lovable/plan.md` marcando Fase 4 concluída.

Aprova para eu começar a executar?
