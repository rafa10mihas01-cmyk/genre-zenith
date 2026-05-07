# Sistema Inteligente de Navegação, Cache e Restore

Objetivo: padronizar como o app lembra (ou esquece) estado entre navegações, com comportamento previsível tipo Spotify/YouTube/Notion.

## Arquitetura

Criar 4 peças centrais em `src/lib/screen-state/`:

### 1. `screenStateStore.ts` — store global
- Map em memória `screenId → { state, scrollY, updatedAt, ttlMs }`
- Espelha em `sessionStorage` (chave `nx:screen-state`) com debounce
- API: `getScreenState(id)`, `setScreenState(id, patch)`, `resetScreenState(id)`, `purgeExpired()`
- TTLs default: dashboards 5min, listas 2min, formulários = sessão, fluxos = 0 (sempre reset)

### 2. `useScreenState.ts` — hook principal para telas de CONTEXTO
```ts
const [tab, setTab] = useScreenField("operacao", "tab", "playlists");
const [filters, setFilters] = useScreenField("performance", "filters", {});
```
- Lê do store no mount, persiste em mudança
- Substitui `usePersistedState` aos poucos, mas mantém compatibilidade (mesma chave de sessionStorage não quebra)

### 3. `useFlowState.ts` — hook para telas de FLUXO (reset ao reabrir)
- Onboarding, wizards, success screens
- No mount: se a navegação é "entrada nova" (PUSH/REPLACE) → `resetScreenState(id)`
- Em POP (voltar) mantém só se ainda dentro do mesmo fluxo

### 4. `ScreenStateManager` (component) — montado no `App.tsx`
- Escuta navegação (já existe `ScrollManager`, vamos estendê-lo)
- Em PUSH para rota classificada como "flow" → reseta state daquela rota
- `purgeExpired()` a cada 60s
- Salva scroll já é feito pelo `ScrollManager` — vamos integrar a leitura no mesmo storage

### 5. `screenRegistry.ts` — classificação por rota
```ts
{
  "/": { kind: "context", ttl: 5*60_000 },
  "/operacao": { kind: "context", ttl: 2*60_000 },
  "/performance": { kind: "context", ttl: 2*60_000 },
  "/playlist-deals": { kind: "context", ttl: 2*60_000 },
  "/curadores": { kind: "context", ttl: 2*60_000 },
  "/cerebro": { kind: "context", ttl: 5*60_000 },
  "/sistema": { kind: "context", ttl: 60_000 },
  "/comunidade-admin": { kind: "context", ttl: 2*60_000 },
  "/comunidade/onboarding": { kind: "flow", ttl: 0 },
  "/comunidade/join/*": { kind: "flow", ttl: 0 },
}
```

## Migração das telas existentes

Substituir `usePersistedState` nas telas de CONTEXTO sem quebrar storage atual:
- `Operacao.tsx` (tab + filtros)
- `Performance.tsx` (filtros)
- `PlaylistDeals.tsx` (tabs)
- `ComunidadeAdmin.tsx` (tab)
- `Cerebro.tsx`, `Sistema.tsx`, `Curadores.tsx` (tabs/filtros)

Aplicar reset em FLUXOS:
- `comunidade/Onboarding.tsx` — sempre Step 1 ao reabrir
- `JoinInvite.tsx` — limpa state ao desmontar

## Cache leve de dados

Já temos React Query (`QueryClient`). Configurar defaults globais em `App.tsx`:
- `staleTime`: 60s (dados frescos)
- `gcTime`: 5min (cache em memória)
- `refetchOnWindowFocus`: true
- `refetchOnReconnect`: true
- `placeholderData: keepPreviousData` recomendado nas listas
Isso já dá sensação de "navegação instantânea" sem mexer página por página.

## Scroll restoration

`ScrollManager` atual já faz POP→restaura, PUSH→topo. Adicionar:
- Em rotas `kind: "flow"` → sempre topo, mesmo em POP
- Salvar scroll dentro do mesmo store (chave única por rota)

## Modais / Drawers
- Padrão: `useFlowState` — fecha = limpa state interno
- Não reabrir automaticamente (já é o comportamento atual; documentar)

## Loading UX
- Já temos `SplashLoader`, `TopProgressBar`, `PageLoader`. Não mexer nisso.
- Garantir que React Query com `keepPreviousData` evite skeleton em retorno.

## Helpers públicos
Exportar de `src/lib/screen-state/index.ts`:
- `useScreenField(screenId, field, initial)`
- `useFlowField(screenId, field, initial)`
- `resetScreenState(screenId)`
- `persistScreenState(screenId, partial)`
- `restoreScreenState<T>(screenId): T | null`

## Arquivos novos
- `src/lib/screen-state/store.ts`
- `src/lib/screen-state/registry.ts`
- `src/lib/screen-state/hooks.ts`
- `src/lib/screen-state/index.ts`
- `src/components/ScreenStateManager.tsx`

## Arquivos editados
- `src/App.tsx` (montar manager, configurar QueryClient defaults)
- `src/components/ScrollManager.tsx` (consultar registry para flow)
- `src/pages/Operacao.tsx`, `Performance.tsx`, `PlaylistDeals.tsx`, `ComunidadeAdmin.tsx`, `Cerebro.tsx`, `Sistema.tsx`, `Curadores.tsx` — trocar `usePersistedState` por `useScreenField` (mantendo chaves para não perder estado atual)
- `src/pages/comunidade/Onboarding.tsx` — usar `useFlowField`
- `src/hooks/usePersistedState.ts` — manter como está (compat)

## Resultado
- Volta numa lista → mesma tab, mesmo filtro, mesmo scroll
- Reabre Onboarding → começa do Step 1
- Cache React Query → navegação sem reload visual
- `purgeExpired` evita state fantasma e memory leak
