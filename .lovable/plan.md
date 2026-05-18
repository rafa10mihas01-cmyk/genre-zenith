# Plano — Tornar a curva de campanha realista

Quatro correções no motor matemático (`src/lib/campaignEngine.ts` + `src/lib/campaignOperationalPlan.ts` + `src/lib/campaignSnapshot.ts`) e um aviso visual no `CampaignDailyPlan`. Tudo continua sendo snapshot imutável — só muda **como** a curva é gerada na hora de fechar a campanha. Campanhas já fechadas não mudam.

---

## 1. Achatar a curva (pico ≤ 1.8× média)

**Arquivo:** `src/lib/campaignEngine.ts` → função `buildCurve`

- Aumentar `sigma`:
  - Simultâneo: `days / 1.8` (era `days / 2.4`)
  - Sequencial: `days / 2.2` (era `days / 3.2`)
- Adicionar **clamp pós-distribuição**: se `pico > 1.8 × média`, achatar topo e redistribuir excedente pros vales (algoritmo simples: itera tirando 5% do pico e somando na cauda até `pico/média ≤ 1.8`).
- Resultado esperado pra campanha de 7,8M em 44d: pico cai de ~255k/dia pra ~**195k/dia**, platô largo entre D15-D32.

---

## 2. Cap diário por playlist eco (`followers × 0.6`)

**Arquivo:** `src/lib/campaignOperationalPlan.ts` → `buildEcoPlaylistPlan` + `distributeByCurve`

- Calcular `capDia = Math.round(followers × 0.6)` por playlist.
- Em `distributeByCurve`, após distribuir, clampar cada dia ao cap. Sobra de cada dia → empurra pro próximo dia disponível dentro do range.
- Se mesmo redistribuindo sobrar (playlist não comporta o total alocado), **retornar `overflow` por playlist**.
- Agregar overflow no plano diário e redistribuir entre as outras playlists eco com capacidade livre. O que não couber em ninguém vira `unmetEco` → flag de alerta.

---

## 3. Suavizar entrada de eco no sequencial (ramp de 5 dias)

**Arquivo:** `src/lib/campaignOperationalPlan.ts` → `buildEcoPlaylistPlan`

- Manter `ecoFloorDay = curveThresholdDay(curva, 0.25)` (dia em que externo bate 25%).
- Em vez de eco entrar 100% no `ecoFloorDay`, aplicar **multiplicador de ramp** nos primeiros 5 dias de cada playlist eco:
  - Dia +0: 20% · +1: 40% · +2: 60% · +3: 80% · +4 em diante: 100%
- O multiplicador é aplicado **depois** do `distributeByCurve` e **antes** do clamp de capacidade. Sobra entra na redistribuição da pilha eco.

---

## 4. Delay de 2 dias na contabilização

**Arquivo:** `src/lib/campaignOperationalPlan.ts` → `distributeByCurve` (assinatura ganha `delay = 2`)

- Cada playlist eco e cada curador externo: shift de **+2 dias** em todo o vetor `daily`.
  - Dia 1-2 da playlist = 0 plays reportados
  - O que seria D1 vira D3, etc.
- Os streams que cairiam **depois do último dia da campanha** se acumulam no último dia (não some). Mostrar como "cauda de reporte" no aviso.
- Tornar configurável: constante `REPORTING_DELAY_DAYS = 2` no topo do arquivo, fácil de virar input do usuário depois.

---

## 5. Aviso visual quando a meta fica inviável

**Arquivo:** `src/components/campanhas/CampaignDailyPlan.tsx`

- Se `unmetEco > 0` ou se algum dia tem `total < meta_do_dia`, mostrar banner vermelho no topo:
  > "Inventário insuficiente: faltam X streams eco para bater a curva. Adicione playlists ou aumente o pacote externo."
- Nos cards diários, se aquele dia teve overflow redistribuído, badge sutil "Capacidade redistribuída".

---

## Ordem de execução (uma só leva)

1. `campaignEngine.ts` — novo `buildCurve` com sigma maior + clamp pico/média.
2. `campaignOperationalPlan.ts` — `distributeByCurve(total, curva, startDay, capDia?, delay=2)` retornando `{ daily, overflow }`; `buildEcoPlaylistPlan` aplicando ramp de 5 dias + cap; loop de redistribuição de overflow entre playlists eco; mesma mudança no `buildExternalPlan` (cap = `purchased_plays / days × 1.5` como proxy, e delay).
3. `CampaignDailyPlan.tsx` — banner de inviabilidade + badge de redistribuição.

## Detalhes técnicos

- Nada disso muda schema do banco — é tudo cálculo runtime sobre o snapshot existente.
- Campanhas já fechadas (com `simulation_snapshot` gravado): a curva no snapshot continua a antiga, mas o **plano diário** (que é derivado em runtime via `buildDailyCampaignPlan`) já refletirá as 4 correções. Se você quiser preservar o comportamento antigo nas existentes, adicionamos um flag `engineVersion: 2` no snapshot e bifurcamos — mas o ideal é tudo recalcular pra ficar realista.
- Custo: o snapshot já tem `streamsEco` e `streamsExt` fixos; nenhuma das mudanças altera totais, só **distribuição temporal**.

## O que NÃO está no plano (pra confirmar depois)

- Tornar `REPORTING_DELAY_DAYS`, fator `0.6` de cap, e ramp de 5 dias configuráveis na UI da calculadora.
- Recalcular campanhas já ativas com `engineVersion: 1` (manter antigo por padrão vs forçar v2).