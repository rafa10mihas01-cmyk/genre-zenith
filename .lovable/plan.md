## Refator: Central Viva da Campanha

O usuário quer transformar **dois ambientes** que hoje vivem separados em uma experiência única, premium e modular:

- **Interno** → `/campanhas/:id/execucao` (CampanhaExecucao.tsx)
- **Cliente** → `/p/plano/:token` (PlanoCampanhaPublico.tsx)

Mesma arquitetura visual, mesmos componentes, **filtros de dados diferentes**. Cliente nunca vê custo/margem/CPP/eco real.

---

### Arquitetura (sem quebrar nada)

Tudo novo vai em `src/components/campaign-hub/`. As páginas atuais viram **cascas finas** que montam os blocos. Nada de lógica de negócio nova — só remontagem visual sobre os dados que já existem (`campaigns`, `campaign_eco_allocations`, `campaign_print_logs`, `campaign_daily_progress`).

```text
src/components/campaign-hub/
├── CampaignHub.tsx              ← shell: hero sticky + tabs sticky + outlet
├── CampaignHero.tsx             ← capa + faixa + artista + progresso + status + CTA
│                                  modo="internal" mostra "Compartilhar/Abrir portal"
│                                  modo="client"   mostra "Aprovar" (se pendente)
├── tabs/
│   ├── OverviewTab.tsx          ← KPIs grandes + curva grande + últimas provas
│   ├── PlaylistsTab.tsx         ← grid operacional: Ativas | Pendentes | Pausadas
│   ├── ProofsTab.tsx            ← timeline visual de prints (preview grande, delta, posição)
│   ├── CurveTab.tsx             ← curva como protagonista (full width)
│   ├── FinanceTab.tsx           ← SÓ interno (custo, margem, CPP, eco)
│   └── LogsTab.tsx              ← SÓ interno (auditoria)
├── PlaylistCard.tsx             ← card operacional (posição, plays, crescimento, último print)
├── ProofTimelineItem.tsx        ← item premium da timeline de provas
└── types.ts                     ← CampaignHubData + modo "internal" | "client"
```

### Hero sticky (topo)

```text
┌──────────────────────────────────────────────────────────────┐
│ [capa] Faixa — Artista                    [Compartilhar] [↗] │
│         ●● Ativa · D7 de 21 · faltam 14d                     │
│         ▓▓▓▓▓▓▓▓▓░░░░░░░  43%   12.400 / 28.500 streams      │
│         última atualização há 2h                             │
└──────────────────────────────────────────────────────────────┘
```

Sticky no scroll (`sticky top-0 z-20 backdrop-blur`), encolhe quando rola (altura 140→64px). No modo cliente, **antes da aprovação** mostra investimento + botão "Aprovar plano"; **depois** vira hero live com progresso.

### Tabs sticky (logo abaixo do hero)

Interno: Visão Geral · Playlists · Provas · Curva · Financeiro · Logs
Cliente: Visão Geral · Playlists · Provas · Curva (sem Financeiro/Logs)

Mesmo componente `<CampaignHub mode="internal" | "client" />`, controla quais tabs renderiza.

### Playlists (grid operacional)

Substitui a tabela atual por **grid de cards** agrupado por status:

- **Ativas** (no ar) — destaque, ordenadas por plays entregues
- **Pendentes** (aguardando) — colapsada por padrão se >5
- **Pausadas** — colapsada por padrão

Cada card mostra: capa, nome, **posição atual** (#3), plays entregues / planejado com barra, **delta de crescimento 24h**, thumb do último print clicável, dot de status. Esconde ruído de "aguardando primeiro print" — agrupa em "+12 ainda não dispararam".

Cliente vê o mesmo grid **sem** posição interna, sem distinção próprio/externo (só "Playlists da campanha").

### Provas (timeline premium)

Hoje prints estão enterrados dentro de `CampaignMonitoring`. Vira **timeline vertical full-width**, cada entrada parece um "post" da campanha:

```text
○─ há 2h · Playlist X
│   ┌────────────────────────────────┐
│   │  [preview grande do print]      │
│   └────────────────────────────────┘
│   +420 plays  ·  posição #4 → #2  ·  3 playlists afetadas
│
○─ ontem 18:30 · ...
```

Sem cara de tabela. Preview do print em destaque (clique → lightbox).

### Curva (protagonista)

Sobe pra largura total, eixos legíveis, marca onde estamos hoje (linha vertical), zona de "abaixo do plano" / "acima". Tooltip rico. Reusa dados de `snapshot.curva` + `campaign_daily_progress`.

### Fluxo do cliente

Mesmo link `/p/plano/:token` antes e depois da aprovação:

- **Antes**: Hero mostra "Plano da campanha" + investimento (sem 70/30) + botão **Aprovar/Solicitar ajuste**. Tabs limitadas (Visão Geral + Curva). Já é o `<CampaignHub mode="client" stage="approval" />`.
- **Depois**: mesmo componente, `stage="live"`. Card de aprovação some, Hero vira live, tabs completas do cliente (+ Playlists + Provas).

Detecta stage por `client_approved_at != null`. Não precisa redirect — a página detecta sozinha.

### Separação visão interna × cliente (regra dura)

Tudo passa por um `filterForClient(data)` no hub. Cliente **nunca** recebe: `custoTotal`, `custoPorStream`, `splitEcoPct`, `streamsEco`, `streamsExt`, margem, CPP, nome de playlist própria vs externa. Já existe `ClientInvestmentCard` — reaproveitar.

---

### Detalhes técnicos

- **Sticky correto**: hero + tabs num wrapper `sticky top-0`, conteúdo das tabs com `scroll-margin-top` pra âncoras não ficarem atrás.
- **Sem quebrar rotas**: `/campanhas/:id/execucao` continua existindo, só troca o conteúdo. `/p/plano/:token` idem.
- **Reuso**: `CampaignDailyPlan`, `CampaignMonitoring`, `CampaignFullPlanCard`, `ExternalPackageEditor` continuam existindo — viram **filhos** das novas tabs (Curve usa o gráfico de DailyPlan, Logs usa Monitoring, etc). Nada é deletado nessa primeira passada.
- **Dados**: nenhum schema novo. Só leitura. Edge function `get-shared-campaign-plan` já devolve o que precisa; só adicionar prints/progresso se faltarem (a edge já é a fonte do cliente).
- **Design tokens**: tudo via tokens existentes (`--background`, `--card`, `--primary`, domain `campaigns`). Sem cor crua.

### Entregas faseadas (pra eu não quebrar nada de uma vez)

1. **Fase 1** — `CampaignHub` shell + `CampaignHero` sticky + tabs sticky, plugando os componentes que já existem dentro de cada tab. Visualmente já vira premium, código existente intacto.
2. **Fase 2** — `PlaylistsTab` grid + `ProofsTab` timeline (novos componentes substituindo a tabela + bloco de prints atual).
3. **Fase 3** — Modo `client` no mesmo hub, `PlanoCampanhaPublico` passa a renderizar `<CampaignHub mode="client" />` com filtro de dados.

Cada fase é um deploy seguro e testável.

### Fora de escopo

- Não toco em `Campanhas.tsx` (lista) nem em `CampanhaDetalhe.tsx` (detalhe operacional antigo).
- Não mexo em business logic (engine, snapshot, eco dispatch).
- Não crio tabela nova nem migration.
