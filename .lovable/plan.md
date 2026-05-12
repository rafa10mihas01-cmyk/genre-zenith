
# Fase 5 — Analytics + Learning

Fechar o loop: comparar o que foi **prometido** (alocações de campanha) com o que foi **entregue** (plays reais) e usar isso para refinar o sistema. Camada de leitura e refinamento — nenhuma quebra de contrato existente.

---

## 1. Banco de dados (migration única)

### 1.1. View `v_playlist_delivery_history` (materializada lógica via view normal)
Agrega histórico por playlist canônica:

```text
playlist_id
campaigns_count          -- nº de campanhas em que participou
total_promised           -- soma dos target_plays
total_delivered          -- soma dos delivered_plays
fulfillment_rate         -- delivered / promised (0-1, NULL se promised=0)
avg_daily_delivery       -- delivered / dias ativos
last_campaign_at         -- max(campaigns.created_at)
```

Origem: `campaign_allocations` JOIN `campaigns` (apenas campanhas com status `active`, `completed`, `paused`).

### 1.2. View `v_campaign_velocity`
Por campanha: `delivered_per_day = total_delivered / dias_decorridos`, `on_pace = delivered / (goal * dias_decorridos / dias_totais)`.

### 1.3. Atualizar `recalc_playlist_scores()` — incorporar delivery real
Hoje o `delivery_score` usa apenas `curator_deal_snapshots`. Vai passar a usar uma média ponderada:

```text
delivery_real      = fulfillment_rate de v_playlist_delivery_history (0-1)
delivery_observed  = score atual via snapshots (0-1)

new_delivery_score = clamp(
  100 * (0.6 * delivery_real + 0.4 * delivery_observed),  -- quando há histórico (campaigns_count >= 1)
  0, 100
)
```

Se a playlist ainda não participou de nenhuma campanha, mantém a lógica antiga (só snapshots). O `metadata` ganha `{fulfillment_rate, campaigns_count, source: 'history+snapshots' | 'snapshots'}`.

### 1.4. Atualizar `suggest_campaign_playlists()` — ranking ajustado
Composite passa de:
```text
0.5*capacity + 0.3*health + 0.2*(100-risk)
```
para:
```text
0.40*capacity + 0.25*health + 0.20*delivery + 0.15*(100-risk)
```
Onde `delivery` agora reflete a entrega real (porque o `delivery_score` foi atualizado).

Também adiciona ao retorno: `campaigns_count`, `fulfillment_rate`, `historical_avg_delivery` (vindos da view), para exibição no wizard.

### 1.5. Função RPC `get_campaign_analytics_overview()`
Retorna em um único call os KPIs do dashboard:

```text
- total_campaigns, active_campaigns, completed_campaigns
- total_promised, total_delivered (acumulado lifetime)
- avg_fulfillment_rate (média ponderada)
- top_performers: 10 playlists com maior fulfillment_rate (min 1 campanha)
- bottom_performers: 10 playlists com menor fulfillment_rate (min 1 campanha)
- cost_per_play: SUM(curator_purchases.amount) / SUM(curator_deal_snapshots delta) — só se houver dados financeiros, senão NULL
- campaigns_by_status_over_time: array {month, status, count} dos últimos 12 meses
```

Tudo `SECURITY DEFINER`, `STABLE`, `GRANT EXECUTE TO authenticated`.

### 1.6. Sem novas tabelas, sem alteração de schema existente
Tudo é função/view derivada. Zero risco de quebrar bot, edge functions ou contratos.

---

## 2. Frontend

### 2.1. Nova página `/analytics` (item no sidebar "Analytics", ícone `LineChart`)
Componentes:

**Top KPIs (4 cards)**
- Campanhas totais / ativas
- Plays prometidos vs entregues (com %)
- Cumprimento médio
- Custo por play (ou "—" se sem dados)

**Seção "Performance por playlist"**
- Tabela ordenável: Playlist | Campanhas | Prometido | Entregue | % Cumprimento | Velocidade média
- Filtro: top 10 / bottom 10 / todas
- Cor verde para >100%, amarelo 70-100%, vermelho <70%

**Seção "Campanhas ao longo do tempo"**
- Gráfico de barras empilhadas (Recharts) — campanhas por status por mês.

**Seção "Velocidade real vs ideal"**
- Lista de campanhas ativas com badge on-pace / lento / adiantado, baseado em `v_campaign_velocity`.

### 2.2. Wizard de nova campanha — mostrar histórico
No passo 2 (`CampaignSuggestionTable`), adicionar duas colunas:
- **Histórico**: `campaigns_count` ("3 camp.") + tooltip com fulfillment rate
- **Cumpre**: badge colorido com `fulfillment_rate` (— se sem histórico)

Esse é o sinal visual de "aprendizado" para o operador.

### 2.3. Componentes novos
- `src/pages/Analytics.tsx`
- `src/components/analytics/PlaylistPerformanceTable.tsx`
- `src/components/analytics/CampaignsOverTimeChart.tsx`
- `src/components/analytics/VelocityList.tsx`

### 2.4. Atualizações pequenas
- `App.tsx`: rota `/analytics`.
- `AppSidebar.tsx`: item "Analytics".
- `NewCampaignDialog.tsx`: novas colunas no step 2.

---

## 3. O que NÃO muda

- Nenhuma alteração de schema em tabelas existentes.
- `curator_deals`, `curator_deal_snapshots`, `bot_events`, edge functions: zero impacto.
- `recalc_playlist_scores` ganha lógica nova mas mesma assinatura, mesma tabela destino, mesmo cron.
- Comportamento atual sem histórico: idêntico ao de hoje (fallback automático).

---

## 4. Verificações pós-deploy

1. Rodar `recalc_playlist_scores()` manualmente e conferir que `metadata.source` aparece como `'snapshots'` (ainda não há campanhas finalizadas) ou `'history+snapshots'` se já tiver.
2. Abrir `/analytics` e confirmar que os KPIs zerados/parciais renderizam sem erro.
3. Verificar com o linter que nenhuma policy quebrou.

---

## 5. Entregáveis

- 1 migration (2 views + 2 functions atualizadas + 1 função nova).
- 4 arquivos React novos.
- 3 edits leves (`App.tsx`, `AppSidebar.tsx`, `NewCampaignDialog.tsx`).

Aprova?
