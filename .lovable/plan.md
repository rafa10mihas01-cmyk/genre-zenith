## Objetivo

Camada **visual e read-only** de "Histórico Prévio" usando o campo já existente `baseline_plays > 0` da `vw_campaign_playlist_growth`. Zero alteração em cálculo, KPI, atribuição, faturamento ou status `matched`.

---

## Escopo (4 superfícies)

### 1. Lista de playlists na execução da campanha (interno)
**Arquivo:** `src/components/campaign-hub/tabs/OperacaoTab.tsx`

- Estender `Row` com `baseline_plays?: number`.
- Buscar `baseline_plays` da view por `playlist_id` e enriquecer `internal` + `external`.
- Em cada linha (`OperacaoRow`): badge âmbar **"HISTÓRICO PRÉVIO"** + microcopy `Recomendação: promover posição da faixa` quando `baseline_plays > 0`.
- Tooltip no badge: *"Esta música já possuía atividade nesta playlist antes da campanha."*

### 2. Lista de curadores (já feita parcialmente)
**Arquivo:** `src/components/campanhas/ExternalPackageEditor.tsx`

- Já tem `HistoricoPrevioBadge` no `CuratorCard`.
- Adicionar linha de recomendação abaixo do badge: *"Subir posição da música para validar ganho incremental."*
- Trocar tom do badge de neutro pra **âmbar** (`bg-warning/10 text-warning border-warning/30`) conforme pedido.

### 3. Portal do Curador
**Arquivos:**
- `src/pages/CuratorPortal*.tsx` (localizar via rg) — tela onde o curador vê as playlists vinculadas a um deal/campanha.
- Buscar playlists com `baseline_plays > 0` para o `curator_id` logado dentro da campanha.

Adicionar:
- **Alerta no topo da playlist** (quando `baseline_plays > 0`):
  *"ATENÇÃO: a música já estava presente nesta playlist antes da campanha. Para maximizar a entrega, recomendamos promover a faixa para uma posição superior dentro da playlist."*
- **Contador no dashboard do curador:** `Playlists com histórico prévio: X` — botão/link expande lista filtrada.

### 4. Resumo na campanha
**Já existe** o `DeliveryTransparencyBanner` em `ExternalPackageEditor.tsx`:
```
Entrega total
├─ Limpa
└─ Histórico prévio
```
Sem trabalho adicional aqui.

---

## Fonte de dados (sem migração)

Tudo derivado de `vw_campaign_playlist_growth`:
- `baseline_plays > 0` → marca histórico prévio
- `attributed_curator_id` → escopo do curador
- `delta` → continua somando normal (não muda nada)

Para o portal do curador: nova query por `attributed_curator_id = <curator>` AND `campaign_id IN (deals ativos do curador)`.

---

## O que NÃO muda

- `total_delivered`, `recalc_campaign_progress`, `is_baseline_conflict`
- Atribuição (`curator:*` / `ecosystem` / `organic` continuam iguais)
- Status `matched`, faturamento, deal state
- KPI principal do header (266k continua sendo 266k)

---

## Componentes novos / reusados

- Reusar `HistoricoPrevioBadge` (já existe em `ExternalPackageEditor.tsx`) → mover pra `src/components/campanhas/HistoricoPrevioBadge.tsx` pra ser compartilhado entre Curador (interno), Operação e Portal.
- Novo: `HistoricoPrevioRecommendation` (linha de texto pequena cinza com ícone Sparkles).
- Novo: `HistoricoPrevioCounter` (card de dashboard no portal do curador).

---

## Validação

- Header continua 266.225 (curador + eco)
- Carnívoro: 34 playlists com `baseline_plays > 0` recebem badge
- Nenhum recalc de view rodado
- Build limpo (tsc)

Aprovado? Implemento as 4 superfícies em paralelo.