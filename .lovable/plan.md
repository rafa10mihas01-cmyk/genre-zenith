## Diagnóstico

Olhei a página `/deals/:id` (DealDetail + DealHistorySheet) no mobile e tem 4 problemas claros que tiram o ar premium:

1. **Valores cortados nos KPIs do topo** — "R$ 62.3…", "317 di…", "82/100" estourando. O grid usa `grid-cols-2` no mobile com fonte hero, mas o card é estreito demais pra esse tamanho.
2. **Duplicação de dados** — os 6 KPIs do topo (Entrega · Velocidade · Previsão · Score · Investido · Status) repetem quase tudo que aparece logo abaixo no card "Performance na janela" + "Plays entregues · Velocidade · Previsão · Score de qualidade". O usuário lê a mesma informação 2x.
3. **Hierarquia visual sem comando** — todos os 6 KPIs no topo têm o mesmo peso, então o olho não sabe pra onde ir. Falta um KPI dominante (entrega %) e os outros como apoio.
4. **Tabs com contador inline** ("Curador 18", "Algoritmo 95") competem com o nome da aba, ficam tortas no mobile.

## Plano

### 1. Hero do topo (DealDetail.tsx)

Trocar o grid de 6 KPIs por um **bloco hero + chips de apoio**:

```text
┌─────────────────────────────────────────┐
│  ENTREGA                  ●  Ativo      │
│  2%   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  26.4k de 1.2M · faltam 1.17M           │
│                                         │
│  3.7k/dia · 317d p/ meta · R$ 62.300   │
│  Score 82/100 · 100% legítimo           │
└─────────────────────────────────────────┘
```

- 1 número grande (entrega %) + barra de progresso visível
- Linha 1 de meta: subtítulo com fração + restante
- Linha 2: velocidade · ETA · investido como texto inline tabular
- Linha 3: score + legitimidade
- Status (Ativo / Concluído) vira chip no canto superior direito

Resultado: zero truncamento, hierarquia clara, ocupa menos altura.

### 2. Performance na janela (DealHistorySheet → aba Resumo)

Esse card permanece, mas:
- Remover a duplicação de "Plays entregues / Velocidade / Previsão / Score" que repete o hero — passa a mostrar **só o que muda por janela** (7d/28d): Total · Curador · Algoritmo · Δ hoje
- Aumentar contraste do toggle 7d/28d (pílula segmented control)

### 3. Tabs (Resumo · Curador · Algoritmo · Histórico)

- Contador vira **bolinha discreta** após o nome (mesmo padrão das tabs de /deals que acabamos de ajustar)
- No mobile, `flex-1` distribuindo igual, ícone + label, número como pill pequeno

### 4. Polimento geral

- Padding interno dos cards: 16px no mobile, 20px no desktop (hoje tá 20px fixo, fica apertado)
- Tipografia tabular pra todos os números
- Remover bordas duplicadas (card dentro de card no Resumo)

## Arquivos que vou tocar

- `src/pages/DealDetail.tsx` — substituir o grid de 6 KPIs pelo hero bloco
- `src/components/playlist-deals/DealHistorySheet.tsx` — limpar duplicação no Resumo + tabs mobile

## Fora de escopo

- Lógica de cálculo (Score, ETA, velocidade) fica intacta
- Aba Curador/Algoritmo/Histórico só recebem o ajuste das pills nas tabs, conteúdo não muda agora

Posso começar pelo hero do topo (que é onde tá o pior estrago visual) e seguir nessa ordem. Confirma que pode tocar?