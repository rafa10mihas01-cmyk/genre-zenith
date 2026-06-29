
## Objetivo

Quando uma música do catálogo vira campanha, o planner ECO precisa **partir do estado real** da faixa nas playlists do pool, decidindo entre três ações por playlist:

| Ação | Quando |
|---|---|
| **KEEP** (manter) | Faixa já está em posição ≥ que a posição-alvo planejada |
| **REPOSITION** (promover) | Faixa já está, mas em posição pior que o alvo |
| **INSERT** (inserir) | Faixa não está na playlist e é necessária pra meta |

O Campaign Engine, ECO, Curadores, Rádio e cálculos de capacidade **não mudam**. A única diferença é a etapa de leitura do estado atual antes de aplicar o algoritmo já existente.

## Estado atual do código

- **Backend (`approve-campaign-plan`)** já lê `managed_playlist_tracks` e passa `currentPositionById` para `distributeByDailyNeed`, que usa a posição atual como teto (nunca rebaixa) e dá leve preferência em empates. Funciona, mas é invisível para o operador.
- **Frontend (`useEcoRealCapacity` + `CapacidadeRealCard`)** ignora completamente a presença atual. O preview monta o plano "do zero", então o operador vê 17 inserções quando na verdade 12 já estão lá.
- **Edge `replan-campaign-eco`** também não usa presença no preview de capacidade, só na hora de aprovar.

O gap é só de **leitura + classificação de ação**, não de cálculo.

## Mudanças

### 1. `src/lib/campaignOperationalPlan.ts` — `planRealCapacity` aceita posições atuais

Adiciona parâmetro opcional `currentPositionById: Map<string, number>` e, para cada playlist:

- Se a faixa já está em posição **melhor ou igual** ao alvo greedy → cria allocation com `action: "keep"`, `position = currentPosition`, `cap_dia` recalculado pela posição atual. Não consome `remaining`.
- Se a faixa está em posição **pior** que o alvo → allocation com `action: "reposition"`, `position = alvo`, `previousPosition = currentPosition`.
- Se a faixa **não está** → allocation com `action: "insert"`, comportamento atual.

Tipo `RealCapacityAlloc` ganha:
```ts
action: "keep" | "reposition" | "insert";
previousPosition?: number; // só em reposition/keep
```

### 2. `src/hooks/useEcoRealCapacity.ts` — busca presença

Passa a aceitar `spotifyTrackId?: string`. Quando presente:

1. Faz um `select playlist_id, position from managed_playlist_tracks where spotify_track_id = ? and playlist_id in (pool)`.
2. Monta `currentPositionById` e repassa pra `planRealCapacity`.

Sem `spotifyTrackId` (campanha sem faixa do catálogo) o comportamento é idêntico ao atual.

### 3. `src/components/operacao/calculadora/CapacidadeRealCard.tsx` — surface das ações

- Resumo no topo: "**12 manter · 3 reposicionar · 2 inserir** · 17 playlists no plano"
- Cada linha da lista expandida ganha badge da ação:
  - 🟢 `Manter #3`
  - 🟡 `Reposicionar #18 → #5`
  - 🔵 `Inserir #5`

### 4. `src/components/operacao/calculadora/Calculadora.tsx`

Passa `active.track?.id` (spotify_track_id) para o hook `useEcoRealCapacity`.

### 5. Edge `replan-campaign-eco` (opcional, só pra paridade)

Adiciona o mesmo `currentPositionById` que `approve-campaign-plan` já faz, pra que o preview de replan reflita a presença. Sem mudar nenhuma fórmula.

## O que NÃO muda

- `campaignEngine.ts` — intocado
- Splits ECO / Curadores / Rádio — intocados
- Fórmula de capacidade (`saves × mult/30 × POSITION_PCT`) — intocada
- `planEcoAllocations`, `distributeByDailyNeed`, `distributeEcoPositions` — intocados
- Motor de Catálogo (`catalog-executor`, `process-catalog-placements`) — intocado
- Banco — nenhuma migration

## Resultado esperado

No card de capacidade, antes de aprovar:

```
17 playlists · Forró +16 vizinhos
12 manter · 3 reposicionar · 2 inserir

Playlist A    Reposicionar #18 → #5    2.1k/dia
Playlist B    Manter #3                3.4k/dia
Playlist C    Inserir #5               1.8k/dia
…
```

Ao aprovar, o backend (`approve-campaign-plan`) já faz exatamente isso hoje — só estamos refletindo no preview o que o approve já decide. Nenhum re-trabalho de catálogo, nenhuma posição rebaixada.
