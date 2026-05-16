# Reorganização da Sidebar — Plano em 3 Fases

Objetivo: sidebar que se entende batendo o olho, sem quebrar nada, sem expor arquitetura antiga, e com decisão de remoção baseada em uso real.

Princípios não-negociáveis das 3 fases:
- Zero quebra de URL. Tudo que existe hoje continua acessível por rota direta.
- Zero remoção de código nesta etapa. Só reorganização e ocultação.
- Cada fase é independente, mergeável sozinha, reversível em 1 commit.
- Nada de telemetria → nada de remoção. Fase C só roda depois de dados reais.

---

## Fase A — Reorganização visual segura (sem destruir nada)

Entrega: nova estrutura de sidebar em 4 grupos, submenus contextuais, rodapé com Configurações. Todas as rotas antigas continuam funcionando como alias.

### Nova estrutura visível

```text
COCKPIT
  Início                  /                      (Hoje + Executivo como abas internas)

OPERAÇÃO
  Campanhas               /campanhas
  Playlist Deals          /deals
    └ Deals               /deals
    └ Curadores           /curadores
    └ Comparar            /deals/comparar
  Playlists               /playlists             (alias: /catalogo, /operacao)

INTELIGÊNCIA
  Inteligência            /inteligencia          (alias: /cerebro)
  Analytics               /analytics
    └ Performance         /analytics/performance
    └ Valuation           /analytics/valuation
    └ Benchmarks          /benchmarks
    └ Matriz              /matriz
    └ Heatmap             /heatmap

ADMIN (só admin)
  Infra                   /infra                 (Sistema + Infraestrutura + Aposentadoria como abas)
  Comunidade              /comunidade

RODAPÉ (ícone discreto, ao lado do logout)
  Configurações           /configuracoes         (alias: /settings)
```

De 13 itens visíveis → 5 itens base + 2 admin. Submenus só abrem quando o grupo está ativo.

### Checklist Fase A

1. Atualizar `src/components/AppSidebar.tsx` com a nova hierarquia (grupos + submenus colapsáveis).
2. Mover Configurações pro `SidebarFooter` (ícone gear ao lado do logout).
3. Adicionar rotas alias em `src/App.tsx`:
   - `/catalogo` → renderiza Playlists
   - `/operacao` → renderiza Playlists
   - `/cerebro` → renderiza Inteligência (ainda é a página antiga nesta fase)
   - `/settings` → renderiza Configurações
4. Consolidar tabs internas em **Início** (Hoje + Executivo) e em **Infra** (Sistema + Infraestrutura + Aposentadoria).
5. Corrigir `SidebarSmartPanel.tsx`: remover atalhos quebrados (`?tab=coleta|insights|replicacao`, `?tab=cover-queue`). Substituir por atalhos vivos (ex.: "Ver deals ativos", "Playlists em queda").
6. Highlight do item ativo + grupo pai expandido automaticamente via `useLocation`.

### Impacto esperado

- Carga visual da sidebar cai ~60%.
- Zero links quebrados (todos os alias resolvem).
- Nenhum dado/funcionalidade removida.

### Rollback

- Reverter o commit da `AppSidebar.tsx` e do `App.tsx`. Páginas continuam intactas.

### Validação pós-deploy

- Clicar em cada item e cada submenu → tela carrega.
- Acessar cada URL antiga direto pelo browser → resolve.
- `SidebarSmartPanel` sem `onClick` apontando pra tab inexistente (grep por `?tab=`).

---

## Fase B — Fusão conceitual Cérebro → Inteligência

Entrega: uma única página de Inteligência que absorve o que sobrou do Cérebro pós-Fase 1, sem perder nenhum widget útil.

Pré-requisito: Fase A em produção há pelo menos 3 dias sem reclamação.

### O que sobrou útil em /cerebro pós-Fase 1

- Painel de recomendações (sugestões de troca de playlist)
- Visão por gênero (`/cerebro/:genero`)
- Sinais agregados de S4A

### O que já está em /inteligencia hoje

(verificar no momento da execução; provavelmente: scoring, ranking, leituras)

### Checklist Fase B

1. Inventário lado a lado: listar cada widget de `Cerebro.tsx` e `Inteligencia.tsx` e marcar: **manter / fundir / descartar**.
2. Criar `src/pages/Inteligencia.tsx` v2 com layout em abas:
   - **Visão geral** (recomendações + sinais)
   - **Por gênero** (substitui `/cerebro/:genero`)
   - **Histórico de decisões** (o que foi sugerido e o que foi feito)
3. Manter `/cerebro` e `/cerebro/:genero` como **redirect 301 client-side** pra `/inteligencia` e `/inteligencia/genero/:genero`.
4. Remover label "Cérebro" da sidebar (já feito na Fase A; aqui só confirma).
5. Atualizar links internos do app que ainda apontam pra `/cerebro` (grep + replace).

### Impacto esperado

- Some um conceito duplicado. Operador para de perguntar "Cérebro ou Inteligência?".
- Zero perda funcional.

### Rollback

- Reverter o redirect e o componente novo. Páginas antigas voltam intactas (não foram deletadas).

### Validação pós-deploy

- `/cerebro` redireciona pra `/inteligencia` sem flash.
- Todos os widgets úteis aparecem na nova página.
- Nenhum erro 404 nos logs (`function_edge_logs` + console).

---

## Fase C — Limpeza definitiva baseada em telemetria

Entrega: remoção de código morto e rotas órfãs. Só roda depois de dados reais.

Pré-requisito: 14 dias de telemetria de `page_hits` rodando após Fase B.

### Setup de telemetria (executar no início da Fase B, não no fim)

Tabela mínima:

```sql
create table public.page_hits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  path text not null,
  referrer text,
  hit_at timestamptz not null default now()
);
create index on page_hits (path, hit_at desc);
```

Hook global `usePageHit()` em `App.tsx` que dispara um insert a cada mudança de rota (debounce 500ms, ignora bots/admin se quiser).

### Candidatos a remoção (avaliar com dados, não com achismo)

| Rota | Critério de remoção |
|---|---|
| `/benchmarks` | < 5 hits/semana por 2 semanas |
| `/matriz` | idem |
| `/heatmap` | idem |
| `/curadoria-preview` | idem |
| `/executivo` (se virou aba de Início) | rota direta com < 5 hits |
| Componentes deprecados visualmente em Fase 1 | já ocultos, agora apaga arquivo |

### Checklist Fase C

1. Rodar query: `select path, count(*) from page_hits where hit_at > now() - interval '14 days' group by 1 order by 2`.
2. Para cada rota abaixo do threshold:
   - Remover do `App.tsx`
   - Deletar a página
   - Deletar componentes filhos só usados ali
   - `rg` no projeto pra confirmar zero imports órfãos
3. Rodar `depcheck` (ou `bunx knip`) → listar dependências npm sem uso → remover.
4. Auditar edge functions já marcadas como deprecated na Fase 1 (`410 Gone`):
   - Se 14 dias sem nenhum hit em `deprecation_hits` → deletar a função.
   - Se ainda tem hit de caller ≠ "ui"/"cron" → investigar antes de deletar.
5. Revisar quotas/custos: comparar gasto de edge functions e DB do mês corrente vs. mês pré-Fase 1.

### Impacto esperado

- Redução real de superfície de código e de custo.
- Decisão defensável (baseada em uso, não em opinião).

### Rollback

- Cada remoção vira um commit separado. Reverter individualmente se algo aparecer.

### Validação pós-deploy

- Build passa, smoke test das rotas que sobraram.
- Custos Cloud caem na semana seguinte (verificar dashboard).

---

## Detalhes técnicos relevantes (apêndice)

- A nova `AppSidebar` usa o padrão shadcn `Sidebar` + `SidebarGroup` + `SidebarMenuSub` para submenus contextuais. `collapsible="icon"` mantém a versão estreita com ícones.
- Submenu só renderiza expandido quando a rota ativa pertence ao grupo (via `useLocation` + `isActive`).
- Alias de rota = `<Route path="/catalogo" element={<Playlists />} />`. Sem redirect, sem flash, sem mudança de URL na barra do browser.
- Redirect Fase B = `<Route path="/cerebro" element={<Navigate to="/inteligencia" replace />} />`.
- Telemetria não depende de Lovable Cloud externo: insert direto na tabela `page_hits` com RLS `auth.uid() = user_id`.
- Nenhuma mudança em edge functions, deals, autopilot ou Spotify nesta reorganização. É puramente camada de navegação e apresentação.

---

Próximo passo: aprovar este plano e eu começo pela Fase A.
