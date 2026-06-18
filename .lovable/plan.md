# FASE 8.1 — Consolidação Financeiro

Base: auditoria 8.0. PIX = opção B (sem Vault). Princípio: simplicidade é a arquitetura oficial.

## Decisões assumidas (avisar se quiser mudar)

- **Saldo virtual (Item 7):** **remover** do hero da aba Custo. Substituir por KPIs já oficiais (Total investido, CPP, Curadores). Sem fórmula proprietária no JS.
- **Compras órfãs (Item 4):** criar FK `ON DELETE SET NULL`. Manter as 5 compras atuais como "não alocado" (já aparecem no alerta amarelo). Sem perda de dados.

## Fontes oficiais (Item 1) — congeladas

| Métrica | Fonte única |
|---|---|
| Receita | `campaigns.valor_cobrado / valor_recebido` |
| Custo por campanha | `v_financial_summary.total_pago_curadores` |
| Custo caixa total | `v_curator_global_finance.total_spent` (nova consulta) |
| Margem | `v_financial_summary.margem_bruta / margem_pct` |
| CPP por curador | `v_curator_finance.cpp` |
| CPP global | `v_curator_global_finance.global_cpp` |
| Não alocado | `v_financial_unallocated_cost` |

Frontend nunca recalcula. Apenas exibe.

## Migração SQL (única)

```text
1. ALTER curator_purchases ADD CONSTRAINT fk_deal
   FOREIGN KEY (deal_id) REFERENCES curator_deals(id) ON DELETE SET NULL
   NOT VALID;  -- compras com deal_id apontando para deal inexistente viram NULL
   Limpar primeiro: UPDATE curator_purchases SET deal_id=NULL
     WHERE deal_id NOT IN (SELECT id FROM curator_deals);
   VALIDATE CONSTRAINT fk_deal.

2. DROP TABLE curator_deal_payments CASCADE  (0 linhas, deprecada).

3. DROP FUNCTION admin_get_curator_payment(uuid);
   DROP FUNCTION admin_set_curator_payment(uuid, text, text, text);

4. CREATE TRIGGER trg_audit_curator_purchases
   AFTER INSERT OR UPDATE OR DELETE ON curator_purchases
   FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
```

## Refactor frontend

### Hook único (Item 2)
Consolidar `useCuratorFinance` → dentro de `useFinancialOverview`. Resultado: **1 hook, 1 canal realtime, 1 cache tree**.

`useFinancialOverview` passa a expor:
- `summary` (v_financial_summary)
- `byCurator` (v_curator_finance)
- `globalTotals` (v_curator_global_finance) — substitui o sum-em-JS de `custoTotalCaixa`
- `unallocated` (v_financial_unallocated_cost)
- `purchases` (lista) + `dealsFinance` (deals com total_paid agregado)
- `totals` derivados **apenas de views**, sem somatórios paralelos
- `addPurchase / updatePurchase / deletePurchase / registerPayment`

Realtime: 1 canal `financial-live-{user.id}` escutando `curator_purchases` + `curator_deals` (já existe — só removemos o canal duplicado do `useCuratorFinance`).

### Eliminar cálculos JS duplicados (Item 3)
- `useFinancialOverview.totals.custoTotalCaixa` (sum purchases) → `globalTotals.total_spent`
- `useCuratorFinance.totals.globalCpp` (sum÷sum) → `globalTotals.global_cpp`
- `useCuratorFinance.totals.totalSpent/totalPlays` → `globalTotals.*`
- `useFinancialOverview.totals.margem` (recebido−pago em JS) → mantém receita da view e custo da view, sem recalcular margem agregada inventada

### Limpeza (Item 5)
- Remover `SummaryCard` morto (linhas 239-268 de `FinancialOverview.tsx`).
- Remover subscrição realtime de `curator_deal_payments` em `useCuratorDeals.ts:478`.
- Remover hook `useCuratorFinance.ts` inteiro (arquivo) — consumidores migram pra `useFinancialOverview`.
- Remover imports/exports não usados resultantes.

### Hero da aba Custo (Item 7)
Em `FinanceiroTab.tsx`: remover bloco hero (saldo virtual + barra "uso do comprado" + sparkline com fórmula inventada). Manter pódio + ranking + timeline. KPIs compactos (`hideHero=true`) já existem e viram o padrão único: Total investido / CPP / Curadores — todos vindos de `globalTotals` da view.

## PIX (Item 6 — opção B)
- Não criar vault.
- Manter `curators.pix_type / pix_key` como hoje.
- Drop das RPCs `admin_get_curator_payment` / `admin_set_curator_payment` (migração acima).
- Sem mudança no frontend de curadores.

## Validação final (Item 9)
Após execução, todas as respostas serão **NÃO**:
- ❌ Mais de uma fonte para receita/custo/margem/CPP
- ❌ Mais de um hook financeiro
- ❌ Mais de um canal realtime financeiro
- ❌ Cálculo JS duplicado de métrica que tem view
- ❌ Código morto (`curator_deal_payments`, RPCs admin_*, SummaryCard)
- ❌ Regra de negócio duplicada

## Fora do escopo (intencionalmente)
- Vault PIX.
- Ledger de receita (campaigns.valor_recebido continua sendo campo manual — já é a fonte única).
- Comissão/repasse (não existem hoje, não criar).
- Cofre, criptografia, RPCs extras de segurança.

## Ordem de execução
1. Migração SQL (drop tabela, drop RPCs, FK, audit trigger) — uma única chamada.
2. Após aprovação: refactor `useFinancialOverview` + delete `useCuratorFinance` + ajustes em `FinanceiroTab`, `FinancialOverview`, `useCuratorDeals`.
3. Validação read-only no banco confirmando estado final.
