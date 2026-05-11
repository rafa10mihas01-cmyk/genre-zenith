# Reorganização Visual — Engine Next

Objetivo: transformar a UI atual (densa, técnica, com popups em cascata) em uma plataforma com leitura executiva tipo Stripe/Linear, **sem alterar nenhuma linha de backend, RPC, edge function, cron, contrato de bot, cálculo ou regra de negócio**. Apenas frontend, presentation e arquitetura visual.

---

## 1. Auditoria visual atual

**Tela `/playlist-deals` (PlaylistDeals.tsx, 354 linhas)**
- Lista de `CuratorDealCard` (628 linhas/card) — cada card carrega: capa, música, artista, curador, deal info, baseline, plays, snapshot, status, badges múltiplos, botões inline de print/histórico/abrir, alertas de fraude, progresso, score, previsão, atalhos. Tudo no mesmo nível visual.
- Abre `DealHistorySheet` (1.329 linhas) que internamente abre `LogPrintDialog`, `DealLogDetailDialog`, `CloseDealDialog` → **popup dentro de popup dentro de popup**.
- Painéis paralelos: `FraudAlertsPanel`, abas `Clientes/Curadores/Financeiro`, `CuradoresLibraryTab`, todos competindo por atenção.

**Sintomas concretos**
- Densidade: ~12 elementos informativos por card, todos com peso visual similar.
- Excesso de badges/pills coloridos (status, baseline, coleta, score, tendência, alerta) — paleta cromática briga entre si.
- Sem hierarquia tipográfica clara entre "decisão" (progresso/velocidade) e "técnico" (baseline/coleta/log).
- Detalhes operacionais (snapshots, prints, logs) visíveis na camada executiva.
- Modais em cascata quebram o fluxo de leitura.

---

## 2. Mapa de reorganização (3 camadas)

```text
┌─────────────────────────────────────────────────┐
│ CAMADA EXECUTIVA   /playlist-deals              │
│   - Lista compacta de campanhas (cockpit)       │
│   - Apenas: status, progresso, velocidade,      │
│     score, tendência, previsão                  │
└────────────────┬────────────────────────────────┘
                 │ clique no card
                 ▼
┌─────────────────────────────────────────────────┐
│ CAMADA OPERACIONAL  /playlist-deals/:id         │
│   (página dedicada OU side panel persistente)   │
│   Abas: Resumo · Curadores · Algoritmo ·        │
│         Histórico · Auditoria                   │
└────────────────┬────────────────────────────────┘
                 │ ação específica
                 ▼
┌─────────────────────────────────────────────────┐
│ CAMADA AUDITORIA  (drawer terciário)            │
│   - Prints, logs raw, snapshots, eventos bot    │
│   - Acessível só dentro da aba Auditoria        │
└─────────────────────────────────────────────────┘
```

**Regra de ouro**: cada nível só revela detalhes do próximo nível por intenção explícita do usuário (clique). Nunca empilhar modais.

---

## 3. Novo fluxo UX

1. Usuário entra em `/playlist-deals` → vê **lista cockpit** (1 linha por deal, alta densidade horizontal, baixa vertical).
2. Clica num deal → navega para `/playlist-deals/:id` (rota dedicada) com **abas internas**. Estado preservado na URL (`?tab=curadores`).
3. Dentro da aba Auditoria, ações como "ver print" abrem drawer lateral, não modal sobre modal.
4. Ações rápidas (enviar print, fechar deal) ficam num menu kebab no card, sem poluir a linha principal.

Vantagem: zero quebra de fluxo — todas as ações existentes continuam acessíveis, só mudam de camada.

---

## 4. Nova hierarquia visual

| Prioridade | Elementos | Tratamento |
|---|---|---|
| **Alta** | progresso, velocidade (plays/dia), score, tendência | Tipografia grande, números tabular, sem cor exceto sinal (verde/vermelho sutil) |
| **Média** | playlists detectadas, crescimento, previsão de fechamento | Texto secundário, ícone pequeno |
| **Baixa** | baseline, última coleta, status técnico, IDs | Tooltip ou aba Auditoria — nunca na camada executiva |

**Sistema de status unificado** (substitui ~8 variações de badge atuais):
- `success` (verde sutil) · `warning` (âmbar) · `danger` (vermelho sutil) · `neutral` (cinza)
- Componente único `<StatusDot variant="success" label="Saudável" />` — bola 6px + label, sem pill cheio de cor.

---

## 5. Card principal (novo)

Reduzir de ~280px de altura para **~72px** (linha tipo Linear/Stripe).

```text
┌──────────────────────────────────────────────────────────────────────┐
│ [capa 40px]  Música — Artista          ● Saudável                    │
│              Curador · 12 playlists                                  │
│ ─────────────────────────────────────────────────────────────────── │
│  1.240/dia    62%  ▓▓▓▓▓▓░░░░    Score 8.4    ↗ +12%   ETA 4d  ⋯   │
└──────────────────────────────────────────────────────────────────────┘
```

- 2 linhas visuais, números alinhados em grid tabular.
- Menu `⋯` consolida: abrir, histórico, enviar print, fechar.
- Sem badges coloridos múltiplos — só um `StatusDot`.

---

## 6. Página de detalhe da campanha

Rota nova: `/playlist-deals/:dealId` (substitui o Sheet). Layout:

```text
┌─ Header: música · artista · curador · StatusDot · ações ──────────┐
│ Tabs: Resumo | Curadores | Algoritmo | Histórico | Auditoria      │
├───────────────────────────────────────────────────────────────────┤
│ [conteúdo da aba ativa]                                           │
└───────────────────────────────────────────────────────────────────┘
```

**Resumo** — 4 KPIs grandes (velocidade, progresso, score, previsão) + 1 gráfico de tendência. Nada técnico.

**Curadores** — tabela de playlists do curador: nome, plays, crescimento, entrega, saúde. Sem IDs, sem timestamps de coleta.

**Algoritmo** — mesma tabela mas para playlists algorítmicas, peso visual menor (cards menores, opacidade levemente reduzida).

**Histórico** — timeline compacta, 1 linha por evento: `data · plays · Δ · n playlists`. Sem cards grandes.

**Auditoria** — única aba onde aparecem: baseline, snapshots, prints, logs, eventos do bot, JSON cru. Power-user mode.

---

## 7. Componentes sugeridos (novos, todos UI-only)

- `DealRow` — substitui visual do `CuratorDealCard` (mesmas props, novo layout)
- `StatusDot` — substitui ~8 variações de badge
- `MetricCell` — número + label + delta opcional, tipografia tabular
- `KpiTile` — versão grande para aba Resumo
- `Timeline` — componente histórico compacto
- `DetailTabs` — wrapper de Tabs já existentes do shadcn
- `SidePanel` (opcional) — alternativa à rota dedicada

**Reuso**: 100% das chamadas a hooks/queries/RPCs existentes permanecem. Só muda a apresentação.

---

## 8. Grid, densidade e espaçamento

- Container: `max-w-[1400px]` centralizado, padding lateral 24px (já é o padrão do projeto via memória).
- Lista de deals: grid de 1 coluna, gap 8px (linhas compactas).
- Página de detalhe: grid de 12 colunas, KPIs ocupam 3 cada.
- Tipografia: títulos 14px semibold, números 24px tabular, secundário 12px muted.
- Cores: manter design system atual (#050505 bg, #171717 card, #1DB954 accent) — apenas reduzir uso do verde a CTAs e tendências positivas. Resto em tons de cinza.

---

## 9. Navegação

- Sidebar atual mantida.
- Adicionar breadcrumb no topo da página de detalhe: `Campanhas / [música]`.
- URL passa a refletir estado: `?tab=auditoria&log=123` (deep-linking).

---

## 10. Plano de implementação seguro (sem quebrar nada)

**Fase A — Fundação visual (1 PR)**
1. Criar `StatusDot`, `MetricCell`, `KpiTile`, `Timeline` em `src/components/ui/`.
2. Não tocar em nada existente. Apenas adicionar.

**Fase B — Card cockpit (1 PR)**
1. Criar `DealRow.tsx` ao lado do `CuratorDealCard.tsx` (não substituir).
2. Em `PlaylistDeals.tsx`, trocar render do card pelo `DealRow` mantendo todas as props e callbacks atuais.
3. `CuratorDealCard.tsx` fica no repo como fallback até validação.

**Fase C — Página de detalhe (1 PR)**
1. Criar rota `/playlist-deals/:dealId` apontando para nova página `DealDetail.tsx`.
2. Mover o conteúdo do `DealHistorySheet` para abas dessa página, **sem alterar nenhuma query/RPC**.
3. Manter o Sheet acessível por feature flag local (`?legacy=1`) durante validação.
4. Subdrawers (LogPrintDialog, DealLogDetailDialog) viram drawer lateral único e só abrem dentro da aba Auditoria.

**Fase D — Limpeza de badges (1 PR)**
1. Substituir badges múltiplos por `StatusDot` em toda a árvore `playlist-deals/`.
2. Remover cores não-semânticas.

**Fase E — Polimento (1 PR)**
1. Ajuste fino de espaçamento, tipografia tabular, animações de transição entre abas (framer-motion).
2. Acessibilidade: foco visível, navegação por teclado nas abas.

**Cada fase é independente, reversível, e não toca**: `supabase/`, `_shared/`, hooks de dados, RPCs, cron, edge functions, contratos do bot, cálculos de score/baseline/pacing.

---

## 11. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Quebrar fluxo de print/log | Manter `DealHistorySheet` no repo + feature flag `?legacy=1` |
| Perder ações no card compacto | Menu `⋯` consolida 100% das ações atuais |
| Usuário power perder densidade | Aba Auditoria preserva visão técnica completa |
| Regressão visual em outras telas | Componentes novos isolados em `src/components/ui/`, sem alterar tokens globais |

---

## 12. Próximo passo

Aprovar este plano e indicar:
- **(a)** Começar pela Fase A+B (fundação + card cockpit) — entrega visual rápida, baixíssimo risco.
- **(b)** Ir direto para Fase C (página de detalhe) — maior impacto percebido, risco médio.
- **(c)** Ajustar algo neste plano antes de iniciar.

Nenhum código foi alterado até aqui.