# Backlog: Unificação da métrica de capacidade dos Apps Spotify

Status: 📋 Aberto — não executar agora
Criado: 2026-06-21
Origem: Etapa de recalibração de caps (NE 05/07/10 → max_accounts=25, max_playlists=500)

## Contexto

Durante a validação da migration de caps, foi observada divergência entre duas fontes
que medem "playlists por App":

| Fonte | NE 05 | NE 07 | NE 10 | Usada por |
|---|---:|---:|---:|---|
| `playlists` (via `spotify_app_overview.active_playlists`) | 7 | 31 | 0 | `pick_spotify_app`, `SpotifyBalancerOverviewPanel`, balanceador |
| `managed_playlists` (cruzado por `owner_spotify_user_id` → token → app) | 27 | 258 | 0 | Operação real, plano de migração OAuth, relatórios de catálogo |

Ambas têm justificativa:
- `playlists` = playlists ativamente operadas via OAuth daquele App (escopo write).
- `managed_playlists` = catálogo completo de playlists gerenciadas (898 totais), incluindo entradas que podem ter sido importadas/observadas sem registro espelhado em `playlists`.

A diferença não invalida o balanceador hoje (que opera com folga: 7/500, 31/500, 0/500), mas
torna difícil interpretar "capacidade real" sem cruzar manualmente as duas tabelas.

## Objetivo

Decidir qual é a **fonte canônica** para medir capacidade de playlists por App e
alinhar `spotify_app_overview`, `pick_spotify_app` e os painéis a essa fonte —
**sem alterar o comportamento atual do balanceador** durante a transição.

## Perguntas a responder

1. **Fonte canônica:** `managed_playlists` (catálogo) ou `playlists` (operação write OAuth)?
   - Hipótese inicial: `managed_playlists` reflete a realidade operacional, mas só faz
     sentido se *toda* playlist gerenciada efetivamente consome quota do App dono.
   - Validar: existem `managed_playlists` que **não** geram chamadas Spotify pelo App do owner?
     (ex.: playlists só observadas, congeladas, em processo de migração de owner)

2. **Por que `playlists` < `managed_playlists`?**
   - Mapear: quantas `managed_playlists` não têm contraparte em `playlists`?
   - Esse delta é dívida técnica (espelho desatualizado) ou design intencional
     (`playlists` é só o subset operável agora)?

3. **Componentes impactados** se a fonte mudar para `managed_playlists`:
   - View `spotify_app_overview` (campo `active_playlists`)
   - RPC `pick_spotify_app` (filtro `active_playlists < max_playlists` e ordenação por capacity_score)
   - Componente `SpotifyBalancerOverviewPanel`
   - Página `Operacao.tsx` (cálculo `capacity_max`)
   - Edge function `get-sistema-stats`
   - Possivelmente: `create-spotify-playlist` (checa `current_playlists < max_playlists` na tabela `accounts`, que é fonte ainda mais antiga)

4. **Tabela `accounts` (legado):** ainda tem 20 linhas com `sum_max=300`.
   Faz parte do mesmo problema — terceira fonte de verdade. Avaliar deprecação no mesmo trabalho.

## Plano de migração proposto (a refinar quando executar)

Fase 1 — Observação (sem mudar comportamento)
- Criar view paralela `spotify_app_overview_v2` usando `managed_playlists` como fonte
- Logar ambos os valores em `cron_health` ou painel admin por 7 dias para comparar
- Documentar o delta e identificar `managed_playlists` "fantasmas" sem owner ativo

Fase 2 — Decisão
- Confirmar fonte canônica com base nos dados observados
- Se for `managed_playlists`: revisar caps (500 pode ficar apertado — NE07 já tem 258 reais)

Fase 3 — Cutover
- Substituir definição de `active_playlists` na view canônica
- Atualizar `pick_spotify_app` (se mudar a fórmula de capacity_score)
- Migrar painéis para a nova view
- Deprecar tabela `accounts` se confirmada redundante

Fase 4 — Limpeza
- Remover view antiga
- Atualizar memória do projeto com a fonte canônica decidida

## Critério de "não executar agora"

- Balanceador opera com folga confortável (maior uso real: NE07 = 258/500 = 52%)
- Plano de reconexão OAuth dos 9 usuários é prioridade
- Mudança requer janela de observação de ~7 dias antes do cutover

## Quando reabrir

Reabrir quando ocorrer qualquer um:
- Algum App ativo passar de 70% em `managed_playlists` / `max_playlists`
- Balanceador começar a alocar de forma visivelmente desbalanceada
- Após conclusão da reconexão dos 9 usuários (próxima etapa operacional)
- Pedido explícito do usuário
