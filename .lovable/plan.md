## FASE 3 — Financeiro Operacional da Curadoria

### Diagnóstico (varredura real)

- **Bug crítico confirmado**: `curator_deals.cost` é gravado como `null` em `NewDealDialog.tsx:718`, mas o PDF e várias visões ainda leem esse campo. Os 100% dos deals atuais (1/1) estão sem `cost`. O custo real vai todo para `curators.total_cost` via "saldo de compra" (linha 602 — soma incremental).
- **Ledger inexistente**: `curators.total_cost` e `purchased_plays` são acumulados por UPDATE direto, sem histórico. Impossível auditar quanto/quando foi comprado.
- **Sem CPP global**, sem alertas financeiros, sem ranking.

---

### O que vou fazer

**1. Ledger operacional (nova tabela `curator_purchases`)**

Tabela imutável de compras (append-only):
- `curator_id`, `user_id`, `plays_purchased`, `amount`, `cpp` (gerado), `purchased_at`, `note`, `deal_id` (opcional, vincula à compra-no-deal)

`curators.total_cost` e `purchased_plays` continuam existindo como **agregado derivado** mantido por trigger (somando o ledger). Zero quebra de UI atual.

**2. Backfill consciente**

Para cada curador existente com `total_cost > 0` ou `purchased_plays > 0`, criar **1 linha de baseline** no ledger com `note='backfill'`. O snapshot fica preservado. Compras novas viram linhas adicionais.

**3. Corrigir o bug do `cost` no deal**

Em `NewDealDialog`, ao criar deal:
- Se houver `costRaw > 0` no formulário, salvar em `curator_deals.cost` E criar 1 linha no ledger (`amount=costRaw, plays=playsRaw, deal_id=...`).
- Atualmente já existe `costRaw` via `currencyDigitsToNumber(newCuratorCostDigits)` — basta passar adiante em vez de hardcoded `cost: null`.

**4. CPP global + individual**

Hook novo `useCuratorFinance()`:
- `globalCpp` = sum(amount) / sum(plays_purchased) do ledger
- `globalSpent`, `globalCommitted` (sum target_plays * globalCpp dos deals abertos), `globalSaldoVirtual`
- Por curador: `cpp`, `eficiencia` (reconciled/contracted), `velocidade` (plays/dia), `overbookingPct`

**5. Alertas financeiros (em `ops-alerts-cron`)**

- `fin_deal_sem_custo`: deal aberto há >24h sem `cost` nem ledger vinculado
- `fin_curador_caro`: CPP do curador > 2x mediana global
- `fin_overbooking_alto`: já existe (FASE 2C) — manter
- `fin_divergencia`: `curators.total_cost` ≠ soma do ledger (sanity check)

**6. Ranking + Dashboard**

Nova aba **"Financeiro"** dentro de `/playlist-deals` (ou enriquecer `CuradoresTab`):
- 4 cards no topo: Total comprado · Total comprometido · Saldo derivado · CPP médio
- Tabela ranking: Curador · CPP · Plays comprados · Eficiência · Atraso médio · Score
- Lista das últimas 10 compras (ledger view)

**7. Lógica operacional preservada**

- Saldo = `target_plays` somado dos deals abertos × CPP. **Não consome por entrega real.**
- Atraso é apenas métrica de eficiência, nunca cancela commitment.
- `cost` vira derivado (mantém coluna pra compatibilidade do PDF).

---

### Arquivos a tocar

**Migration (1)**:
- Cria `curator_purchases` + RLS por `auth.uid() = user_id`
- Trigger que atualiza `curators.total_cost`/`purchased_plays` a cada insert
- Backfill 1 linha por curador existente
- View `v_curator_finance` (CPP por curador + eficiência)

**Frontend**:
- `src/hooks/useCuratorFinance.ts` (novo)
- `src/components/playlist-deals/FinanceiroTab.tsx` (nova aba)
- `src/components/playlist-deals/NewDealDialog.tsx` (corrigir cost null + criar ledger entry)
- `src/components/playlist-deals/CuradoresTab.tsx` (apontar leituras de `total_cost` para a view derivada)
- `src/pages/Curadores.tsx` ou onde fizer sentido — só inserir aba

**Backend**:
- `supabase/functions/ops-alerts-cron` — adicionar 3 alertas financeiros novos

---

### Não vou tocar em

- Lógica de tracking, snapshots, reconcile, queue, robô.
- Estrutura de `curator_deals` (apenas garantir que `cost` volte a ser gravado).
- PDF — continua lendo `cost` (que agora terá valor).
- Não vou criar DRE, contas a pagar/receber, faturamento, ou qualquer ERP.

---

### Resultado esperado

- Histórico imutável de compras auditável.
- CPP global e por curador disponíveis em tempo real.
- 3 alertas financeiros novos no sino.
- Aba Financeiro com ranking operacional.
- Bug do `cost null` corrigido.
- UI atual continua funcionando (compatibilidade total via agregados).

Confirma? Posso já executar a migration + backfill + tab nova.