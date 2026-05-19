# AUDIT 05 — Frontend & Design System (Executivo)

**Escopo:** 36 páginas, 15 hooks, 4 contexts, componentes em `src/components`, conformidade com o Design System.

---

## 🔴 CRÍTICO

### C1. Página `Curadores.tsx` órfã
- Existia em `src/pages/Curadores.tsx` mas **não tinha import em lugar nenhum**. A rota `/curadores` no `App.tsx` aponta para `Prospecao` (correto pela memory: CRM único).
- **Ação:** ✅ **REMOVIDA**.

---

## 🟠 ALTO

### A1. 38 violações de design tokens (cores hard-coded)
Top arquivos com `text-white`, `bg-black`, `text-gray-*`, `bg-red-*` etc. (proibido pela Core Memory — só pode usar tokens semânticos):

| Arquivo | Motivo provável |
|---|---|
| `src/pages/Landing.tsx` | Página pública pré-token-system |
| `src/pages/Privacy.tsx` | Página estática pública |
| `src/pages/SpotifyCallback.tsx` | Página técnica fora do shell |
| `src/pages/ComunidadeAdmin.tsx` | Página interna — **deveria respeitar** |
| `src/pages/ClientCampaignPage.tsx` | Página pública compartilhada com cliente |
| `src/pages/comunidade/Pontos.tsx`, `JoinInvite.tsx` | Sub-rotas comunidade |
| `src/components/ui/drawer.tsx`, `toast.tsx`, `dialog.tsx` | shadcn original — **MANTER** (são primitivos do shadcn) |

- **Recomendação:** **REFATORAR (Fase 6)** — converter para tokens semânticos em batch, exceto os 3 primitivos shadcn. **MÉDIO risco** (mudanças visuais possíveis).

### A2. 4 hooks com 0–1 referências
| Hook | Refs | Veredito |
|---|---|---|
| `use-mobile` | 1 (`sidebar.tsx`) | **MANTER** — usado pelo shadcn sidebar |
| `useActiveCooldowns` | 1 (`MinhasPlaylists.tsx`) | Considerar inline ou manter (legítimo, 1 consumidor real) |
| `useDealTodayPlaylistBreakdown` | 1 (`DealHistorySheet.tsx`) | **MANTER** (lógica suficiente pra justificar hook) |
| `usePlaylistBrain` | 1 (`PlaylistDetail.tsx`) | **MANTER** (encapsula query) |

→ Nenhum hook morto. Falsos positivos da Fase 1.

---

## 🟡 MÉDIO

### M1. `LoadingContext` e `ThemeContext` com baixíssimo uso
- `LoadingContext` → 4 refs. Investigar se é realmente necessário ou se virou cerimônia.
- `ThemeContext` → 3 refs. App é fixo dark mode (memory). Possivelmente morto — **REMOVER** após confirmar.

### M2. Pages órfãs no inventário mas usadas via lazy/string
Lista anterior mostrou 14 páginas com "1 ref" (a si mesmas + App.tsx). Falso alarme: cada uma tem rota declarada em `App.tsx`, foram contadas pela substring do nome. **Nenhuma ação.**

### M3. `Skeleton` heavy usage em poucas páginas
`Operacao` (7), `Analytics` (5), `Valuation` (4), `Infraestrutura` (4). Verificar se algum desses skeletons aparece "para sempre" porque a query nunca dispara (loading state falso). Não consegui detectar via grep — precisa runtime.

---

## 🟢 BAIXO — APLICADO NESTA FASE

| # | Ação | Resultado |
|---|---|---|
| 1 | Removida página órfã `src/pages/Curadores.tsx` | ✅ Confirmado 0 imports; rota `/curadores` continua via `Prospecao` |

**Não aplicado (deixado pra Fase 6):**
- Migração das 38 hard-coded colors para tokens (precisa varredura visual)
- Investigar/remover `ThemeContext` (app é dark-only mas precisa ver se algo depende)
- Auditar skeletons falsamente "loading" (precisa runtime check)

---

## ✅ Pontos positivos

- **0** `console.log` deixados em produção
- **4** TODO/FIXME no projeto inteiro (muito limpo)
- **AuthContext** com 20 refs — saudavelmente centralizado
- **15 hooks** — todos com ao menos 1 consumidor real
- Estrutura de páginas coerente com sidebar canônico (Cockpit · Operação · Inteligência · Admin)

---

## Resumo numérico

| Severidade | Achados |
|---|---|
| 🔴 Crítico | 1 (página órfã — removida) |
| 🟠 Alto | 2 (38 hard-coded colors, 4 hooks 1-ref) |
| 🟡 Médio | 3 (ThemeContext suspeito, LoadingContext, skeletons) |
| 🟢 Baixo aplicado | 1 (Curadores.tsx removida) |

## Próxima fase

**Fase 6 — Mapa Operacional & Plano de Execução Consolidado.** Vai juntar tudo: dependências, ordem de execução, riscos cruzados, e produzir o plano final de limpeza (REMOVER · REFATORAR · UNIFICAR · MIGRAR · MANTER) com sequência segura.
