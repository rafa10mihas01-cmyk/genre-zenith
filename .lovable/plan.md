
# Ajuste cirúrgico: Orçamento de audiência + posição inteligente

## O que NÃO muda
- Fórmula de projeção (`playlistCapAtPosition`, `calculateTrackDailyStreams`, multiplicadores, curva por posição) — permanece exatamente igual.
- `buildEcoPlan`, `campaignSnapshot`, relatórios, dashboards, histórico, KPIs, PDFs.
- Estrutura de `campaigns`, `campaign_eco_allocations`, `managed_playlists`.
- Fluxo Baseline S4A, bot, scheduler, monitoramento.

A projeção continua sendo a **fonte de verdade**. Estamos adicionando 2 filtros *antes* dela decidir, não substituindo nada.

## O que muda (apenas 2 coisas)

### 1. Orçamento de audiência por playlist (camada de proteção)

Nova função pura `getPlaylistAvailableCapacity(playlist_id, window)` que retorna:

```
saldoDisponível = capacidadeProjetada(playlist, posição_máx, janela)
                  − Σ planned_streams de allocations ATIVAS de OUTRAS campanhas
                    que se sobrepõem temporalmente nessa playlist
```

Considera ativa: `campaigns.status in ('active','approved')` AND janela `[started_at, started_at + days]` se sobrepõe à janela da campanha sendo planejada.

Onde aplicar (único ponto): no momento em que `buildEcoPlan` (ou `replan-campaign-eco`) **escolhe** quais playlists usar — antes do loop de alocação, filtra/ordena pela capacidade disponível em vez de pela capacidade teórica isolada. Se saldo ≤ 0 → playlist sai do pool dessa campanha. Se saldo < cap projetado → o teto efetivo daquela playlist nessa campanha vira o saldo.

A projeção em si (cap_dia, daily[]) continua calculada pela fórmula atual usando o cap efetivo resultante.

### 2. Posição proporcional à necessidade (substitui o 3-3-3 / 7-7-7)

Hoje `assignPositions` usa buckets fixos por tier (`PRIMARY_RANGES_BY_CHART`). Vamos trocar **apenas dentro do range já permitido pelo tier** a lógica de escolha:

- Calcular `needRatio = dailyNeedRestante / capacidadeTotalDisponívelDoPool`
- Para cada playlist (na ordem de followers desc), escolher a **posição mais rasa dentro do range do tier** cujo cap ≤ `dailyNeedRestante × (1 + tolerância 10%)`.
- Se `needRatio` for baixo (campanha pequena num pool grande) → naturalmente cai em posições mais profundas dentro do range → preserva audiência.
- Se `needRatio` for alto → naturalmente sobe pra posições mais rasas → extrai mais.
- Decrementa `dailyNeedRestante` após cada alocação.

Esse algoritmo já existe parcialmente como `distributeByDailyNeed` (linhas 152–188 do `computeEcoPlan.ts`) e é só ativá-lo como padrão no `buildEcoPlan` quando não há `position` persistida, **respeitando os ranges do tier atual como limite**.

Nenhuma posição nova é introduzida. Nenhum multiplicador muda. Só a regra de **escolha** dentro do range já existente.

## Arquivos tocados

- `supabase/functions/_shared/computeEcoPlan.ts`
  - Nova função `getPlaylistAvailableCapacity` (ou recebe via parâmetro).
  - `buildEcoPlan` recebe novo parâmetro opcional `reservedByPlaylist: Map<string, number>` (default: vazio = comportamento atual).
  - Quando `reservedByPlaylist` presente, ajusta cap efetivo por playlist antes do loop.
  - Substitui chamada de `assignPositions` (buckets) pela versão `distributeByDailyNeed` quando não há posição persistida, **clamping** o resultado dentro do range do tier original.

- `supabase/functions/replan-campaign-eco/index.ts` e `supabase/functions/approve-campaign-plan/index.ts`
  - Antes de chamar `buildEcoPlan`, consultam `campaign_eco_allocations` + `campaigns` pra montar `reservedByPlaylist` (somando `planned_streams` de outras campanhas ativas sobrepostas).
  - Passam o mapa pro `buildEcoPlan`.

- `src/hooks/useEcoRealCapacity.ts` e `src/hooks/useEcosystemCapacity.ts`
  - Mesma lógica de saldo, pra UI mostrar capacidade **disponível** (não teórica) durante o planejamento. Opcional nesta fase — pode ficar como follow-up se o usuário preferir.

## Compatibilidade / segurança

- Sem migração de banco. Sem novas tabelas. Sem novas colunas.
- Campanhas existentes com `position` já persistida em `campaign_eco_allocations` **não são afetadas** (o caminho `allPersisted` continua tendo prioridade — linha 405).
- Replans manuais antigos continuam funcionando.
- Feature flag opcional via env `ECO_BUDGET_ENABLED=true` pra permitir rollback instantâneo sem deploy.

## Validação

1. Rodar replan numa campanha pequena num gênero com muitas playlists → conferir que posições caem mais fundo que antes.
2. Rodar replan numa campanha grande → conferir que posições sobem.
3. Criar 2 campanhas simultâneas no mesmo gênero → a 2ª deve receber playlists diferentes ou posições mais profundas nas mesmas playlists.
4. Conferir que campanhas já aprovadas com plano antigo continuam idênticas (snapshot intacto).

## Não incluso (fora de escopo, conforme pedido)
- UI nova de override manual de posição.
- Mudança em fórmula, multiplicador, ou curva de posição.
- Mudança em relatórios, dashboards, ou histórico.
