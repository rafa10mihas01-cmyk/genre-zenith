# Plano — Centralizar custos e preços por stream

## Objetivo
Tirar `COST_PER_STREAM` do código, colocar numa tabela de configuração editável pela UI, e adicionar "preço de venda sugerido" + "margem alvo". Tudo retrocompatível — se a tabela estiver vazia, usa os defaults atuais (0,028 / 0,040).

## 1. Banco — nova tabela `pricing_settings` (singleton por user)

```sql
CREATE TABLE public.pricing_settings (
  id uuid PK default gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,           -- 1 linha por usuário
  cost_per_stream_eco numeric NOT NULL default 0.028,   -- R$/stream interno
  cost_per_stream_ext numeric NOT NULL default 0.040,   -- R$/stream externo
  price_per_stream_sell numeric NOT NULL default 0.080, -- preço de venda sugerido
  target_margin_pct numeric NOT NULL default 50,        -- margem alvo %
  created_at, updated_at
);
-- RLS: owner-only
```

Trigger de upsert: na primeira leitura do user, cria a linha com defaults.

## 2. Hook `usePricingSettings`

`src/hooks/usePricingSettings.ts` — lê/atualiza a linha. Cache via React Query.

```ts
const { settings, update } = usePricingSettings();
// settings.cost_per_stream_eco etc.
```

## 3. Refatorar engine (sem quebrar)

`src/lib/campaignEngine.ts`: `COST_PER_STREAM` vira **default fallback**. A função `calculate(input, costs?)` aceita override opcional:

```ts
export function calculateCampaign(input, costs = COST_PER_STREAM) {
  ...
  const custoEco = streamsEco * costs.eco;
  const custoExt = streamsExt * costs.ext;
}
```

Quem chama (calculadora, NewCampaignDialog) passa os custos vindos do hook. Onde não passar, segue usando o default → **zero quebra**.

`src/lib/externalPackage.ts`: `DEFAULT_COST_PER_STREAM` também recebe override.

## 4. UI — página de configuração

Nova aba em **/sistema** chamada **"Pricing"** (ou dentro de `/financeiro` como botão "⚙ Configurar custos"):

```
┌─ Custos por stream ────────────────┐
│ Ecossistema interno  R$ [0,028]   │
│ Curadores externos   R$ [0,040]   │
│                                    │
│ Preço de venda       R$ [0,080]   │
│ Margem alvo            [ 50 ] %   │
└────────────────────────────────────┘
```

Salvar = upsert na tabela.

## 5. Sugestão de preço no NewCampaignDialog

No diálogo de Nova Campanha, ao lado de "Valor cobrado", mostrar:
- *"Sugerido: R$ X (custo R$Y + margem 50%)"*
- Botão "Aplicar sugerido" preenche `valor_cobrado`

Custo Y = `streamsEco × costEco + streamsExt × costExt` do snapshot.

## 6. Financeiro — coluna margem alvo vs real

Em `FinanceiroTab`, adicionar coluna "Margem" mostrando real vs alvo (verde se ≥ alvo, âmbar se abaixo).

## Arquivos tocados

- ✨ migration: `pricing_settings` + RLS + trigger upsert default
- ✨ `src/hooks/usePricingSettings.ts`
- ✨ `src/components/sistema/PricingSettingsPanel.tsx`
- ✏️ `src/lib/campaignEngine.ts` — aceita override opcional
- ✏️ `src/lib/externalPackage.ts` — aceita override opcional
- ✏️ `src/components/campanhas/NewCampaignDialog.tsx` — usa hook + sugestão de preço
- ✏️ `src/pages/Sistema.tsx` — registra nova aba "Pricing"
- ✏️ `src/components/playlist-deals/FinanceiroTab.tsx` — coluna margem vs alvo
- ✏️ `src/content/pageManuals.ts` — manual da aba Pricing

## Garantias de "não quebrar"

1. Engine continua exportando `COST_PER_STREAM` como default — qualquer chamador antigo segue funcionando.
2. Tabela tem defaults idênticos aos hardcoded → comportamento idêntico até você editar.
3. Sem migration destrutiva, sem alterar tabelas existentes.
4. RLS owner-only — nada vaza entre users.

## Fora do escopo (deixar pra depois)

- Histórico de mudanças de preço (auditoria)
- Preços por gênero ou por cliente VIP
- Repasse parcial / split entre múltiplos parceiros
