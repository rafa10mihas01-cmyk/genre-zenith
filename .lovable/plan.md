
# Refatoração da Engine — ECO como motor único

## Princípio

> **A operação gera a curva. A curva não gera a operação.**

Hoje a Calculadora (`campaignEngine.ts`) impõe uma curva gaussiana com pico tardio. ECO entrega platô natural. Externo segue a gaussiana. Bot ignora cronograma. Vamos eliminar essa divergência sem tocar UI.

---

## Etapas

### Fase 1 — Criar o motor único `playlistGrowthEngine`

Novo arquivo: `src/lib/playlistGrowthEngine.ts`

Função principal:
```
buildDailyPlateau({
  totalStreams, days, source: "eco" | "external",
  rampDays?, weekdayVariation?, reportingDelay?, startDay?
}): DailyPoint[]
```

Características fixas (assinatura ECO):
- **Ramp inicial**: 3-5 dias (curva log/sqrt), começa em ~20% e sobe até 100% do platô
- **Platô diário**: `totalStreams / days_efetivos` (sem pico)
- **Weekday variation**: ±10-15% (seg-qui ligeiramente acima, sex-dom abaixo)
- **Reporting delay**: 2 dias para externo, 0 para eco
- **Sem decay teatral**: cauda mantém ~85% do platô (queda só por fim de cronograma)

Esse arquivo vira a **única fonte matemática** de distribuição temporal.

### Fase 2 — Refatorar `campaignEngine.ts` (Calculadora)

Remover `playlistFactor()` (gaussiana). Substituir `buildCurve()` por:

```
1. Simular eco: para cada playlist alocada, chamar buildDailyPlateau(source="eco")
2. Simular externo: para cada curador alocado, chamar buildDailyPlateau(source="external")
3. Somar dia-a-dia → curva final
```

A Calculadora **não inventa mais curva** — ela soma o que a operação real vai entregar. Mantém a mesma interface pública (`calcCampaign`, `CampaignResult`, `CurvaPonto`) para não quebrar UI.

Pico, média, inércia continuam sendo retornados, mas derivados do agregado real.

### Fase 3 — Refatorar Externo (`buildExternalPlan`)

Hoje usa `playlistFactor`. Trocar por `buildDailyPlateau(source="external")`:
- ramp 3-5 dias
- platô estável
- weekday variation
- delay 2 dias mantido

Cada curador vira fonte contínua, não pico explosivo.

### Fase 4 — Unificar ECO (`buildEcoPlaylistPlan` em `campaignOperationalPlan.ts`)

O modelo eco atual já está correto na forma, mas tem lógica própria. Vamos:
- Manter `POSITION_PCT` e tier-based allocation (capacity por playlist é decisão correta dele)
- Substituir o ramp interno e weekday flat por chamada ao mesmo `buildDailyPlateau(source="eco")` para a distribuição temporal por playlist

Resultado: eco e externo usam a **mesma assinatura temporal**, mudando apenas parâmetros.

### Fase 5 — Bot respeita cronograma

`bot-execution-queue/index.ts` e `execution-planner/index.ts` hoje adicionam tudo. Mudanças:

1. `execution-planner` passa a filtrar allocations por `start_day` (não enfileira o que ainda não chegou)
2. Adicionar coluna `start_day` no filtro de candidates:
   ```
   campaign_started_at + start_day_days <= now()
   ```
3. Respeitar `daily_cap` por playlist (se existir na allocation) — não enfileirar mais ADDs do que o cap permite por dia

Sem nova UI, sem nova tabela — só usa campos já existentes (`start_day`, `daily_cap`).

### Fase 6 — Snapshot e Monitoring convergem

- `campaignSnapshot.ts` já congela a `curva` retornada pela Calculadora — automaticamente passa a ter assinatura ECO sem mudança extra
- `CampaignMonitoring` continua comparando real vs snapshot — agora os dois falam a mesma língua

---

## Arquivos tocados

**Novos:**
- `src/lib/playlistGrowthEngine.ts` — motor único

**Modificados (lógica, não UI):**
- `src/lib/campaignEngine.ts` — remove gaussiana, deriva da operação
- `src/lib/campaignOperationalPlan.ts` — eco usa motor único
- `supabase/functions/execution-planner/index.ts` — respeita start_day + daily_cap
- (se houver) função que monta `buildExternalPlan` — usa motor único

**Intocados:**
- Todos os componentes em `src/components/**`
- Todas as páginas
- `campaignSnapshot.ts` (só consome o resultado novo)
- Schema do banco

---

## Validação

1. Rodar `calcCampaign` com inputs típicos antes/depois — confirmar que:
   - sem pico tardio
   - ramp 3-5 dias visível
   - platô estável
   - cauda sem decay agressivo
2. Comparar curva projetada vs real de uma campanha ativa — divergência deve cair
3. Spot-check no bot: jobs respeitam `start_day`

---

## Fora de escopo (não fazemos agora)

- Redesign visual da Calculadora ou Monitoring
- Mudança no fluxo de fechamento de campanha
- Novas tabelas, novas migrations de schema
- Mudança em RLS, auth, ou contratos do bot VPS
- Refatorar os 7 motores de score (fica pra fase futura, já está no AUDIT_04)

---

## Resultado

Uma única assinatura matemática (ECO) propaga por: Calculadora → Snapshot → Eco → Externo → Bot → Monitoring. O cliente vê o que vai acontecer. A operação entrega o que foi mostrado. Sem picos artificiais, sem divergência.
