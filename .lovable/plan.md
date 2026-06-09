# Fase 2 — Zero Loading Experience

Objetivo: nenhuma tela operacional pode ficar branca, com spinner full-page ou perder conteúdo ao voltar. Padrão de referência: Linear / Notion / Stripe.

Nada de regra de negócio, banco, planner, queries de cálculo. Só camada de cache e UI de carregamento.

---

## Auditoria — estado atual

Páginas/hook ainda no padrão antigo (`useState + useEffect + setLoading`):

| Arquivo | Sintoma visual hoje |
|---|---|
| `src/pages/CampanhaExecucao.tsx` | `<PageLoader />` full-page a cada visita |
| `src/pages/CampanhaDetalhe.tsx` | `Skeleton h-64` + reset total ao voltar |
| `src/pages/Analytics.tsx` | spinner/empty na entrada |
| `src/pages/Performance.tsx` | idem |
| `src/pages/Valuation.tsx` | idem |
| `src/hooks/useClients.ts` | refetch full ao voltar pra `/clientes` e `/clientes/:id` |
| `src/hooks/useCuratorDealsList.ts` | reload do `/deals` e `/financeiro` |
| `src/hooks/useCuratorDealDetail.ts` | spinner no `/deals/:id` |
| `src/hooks/useRadioCollected.ts` | flicker dentro do hub de campanha |
| `src/pages/ClienteDetalhe.tsx` | `useEffect` próprio carrega `clientCampaigns` (skeleton "Carregando cliente…") |

Páginas já saudáveis (React Query): Home, Sistema, Catálogo, Prospecao (curadores), Campanhas (lista), PlaylistDeals (lista) — preservar.

---

## Plano de implementação

### 1. Defaults globais do QueryClient (`src/App.tsx`)

```ts
defaultOptions: {
  queries: {
    staleTime: 5 * 60_000,           // antes 2min — reduz refetch ao voltar
    gcTime: 30 * 60_000,             // antes 10min — mantém cache por sessão
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    refetchOnMount: false,           // se há cache fresco, não pisca
    retry: 1,
    placeholderData: keepPreviousData, // troca de parâmetro mantém dado anterior
  },
}
```

Impacto: ao voltar de qualquer detalhe → lista, a tela aparece com dados em cache e revalida silenciosamente. Hooks que precisam de refetch real (notificações, financeiro on-demand) já sobrescrevem localmente.

### 2. Migrar hooks legados para React Query

Cada hook abaixo vira `useQuery` mantendo a mesma assinatura externa (zero breaking change nos consumidores):

- `useClients` → `useQuery(['clients'])` + `useMutation` para create/update/archive/delete (mantém `clients`, `loading`, `reload`, etc.).
- `useCuratorDealsList` → `useQuery(['curator_deals_list'])`.
- `useCuratorDealDetail` → `useQuery(['curator_deal_detail', dealId])` com `placeholderData: keepPreviousData`.
- `useRadioCollected` → `useQuery(['radio_collected', campaignId])`.

Mutations invalidam só a key afetada (não derruba o cache geral).

### 3. Páginas — eliminar `setLoading` + spinner full-page

- **`CampanhaDetalhe.tsx`**: trocar `useState`/`useEffect` por dois `useQuery` (`campaign` e `allocations`). Manter render parcial: header/KPIs aparecem com `placeholderData`; só Allocations mostra skeleton local se vazio.
- **`CampanhaExecucao.tsx`**: hoje retorna `<PageLoader />` global em `loading`. Refatorar para:
  - Hub/CampaignKpis renderizam com `data ?? lastKnown` (via React Query cache).
  - Substituir `<PageLoader />` por skeleton **interno** ao hub (header da campanha permanece visível). Manter todas as queries de banco como estão — só envelopar o fetch atual num `useQuery(['campaign_execucao', id])`.
- **`Analytics.tsx`, `Performance.tsx`, `Valuation.tsx`**: trocar `useState({data, loading})` por `useQuery`. Conteúdo renderiza com `placeholderData`; KPIs mostram esqueleto fino em vez de spinner central.
- **`ClienteDetalhe.tsx`**: matar `useEffect` que busca `clientCampaigns` — virar `useQuery(['client_campaigns', id])`. Header e KPIs continuam imediatos pela `useClients` (já cacheado).

### 4. Skeletons consistentes (`src/components/skeletons/`)

Criar 4 skeletons reutilizáveis, todos com o **mesmo tamanho do conteúdo real** (sem layout shift):

- `KpiRowSkeleton` (4 cards 90px altura).
- `TableRowsSkeleton` (n linhas h-12).
- `HeroCardSkeleton` (altura do hero do deal/campanha).
- `ChartSkeleton` (200px com shimmer suave).

Substituir todos os `Loading...`, `Spinner...`, `Loader2 animate-spin` em página por skeletons posicionais.

### 5. Preload adicional em hover dentro das listas

Estender `route-preload.ts` para detalhes:
- Hover em linha de `Campanhas` → `import('@/pages/CampanhaDetalhe')` + `import('@/pages/CampanhaExecucao')`.
- Hover em linha de `Clientes` → `import('@/pages/ClienteDetalhe')`.
- Hover em row de `Deals` → `import('@/pages/DealDetail')`.

Sem efeito visual; chunk já vem cacheado no clique.

### 6. CampanhaExecucao — caso especial

A página tem 1.500+ linhas com 20+ `useState`. Não vou reescrevê-la inteira (alto risco). Mudança mínima e segura:
1. Envelopar a `loadCampaign` numa `useQuery(['campaign_execucao', id], loader, { staleTime: 60_000, placeholderData: keepPreviousData })`.
2. Setar estados locais (`camp`, `allocs`, `snaps`, `proofs`) a partir do `data` da query, mantendo `setX` apenas para mutações otimistas locais.
3. Remover `if (loading) return <PageLoader/>` → mostrar Hub com dado anterior (ou skeleton hero quando absolutamente vazio na 1ª visita).

### 7. Validação

Para cada rota da tabela acima:

1. Visitar pela 1ª vez → skeleton local aparece (não spinner full-page).
2. Sair e voltar em < 5 min → tela aparece **instantânea**, com revalidação em background (sem flicker).
3. Trocar de ID (ex.: outro curador, outra campanha) → dado anterior fica enquanto o novo carrega (keepPreviousData).

---

## Detalhes técnicos

- **Compat**: hooks mantêm exatamente os mesmos campos (`loading`, `reload`, etc.) pra não tocar consumidores. `loading` passa a ser `isLoading && !data`.
- **Mutations**: usam `queryClient.invalidateQueries({ queryKey: [...] })` em vez de `reload()` manual; expomos `reload()` como `() => qc.invalidateQueries(...)` por compatibilidade.
- **Edge**: `CampanhaExecucao` tem subscriptions/realtime (canal `campaign-progress`) — manter intacto; só substituímos a função de fetch inicial.
- **Erro fica visível**: query com `isError` mostra inline (não derruba shell).
- **Sem mexer**: planner, edge functions, regras de cálculo (CPP, baseline, dominância), Spotify helpers.

---

## Fora desta fase (pra Fase 3 se quiser)

- Suspense queries (React 19) — exigiria upgrade de patterns.
- Optimistic UI em mutations financeiras (risco operacional).
- Streaming SSR / prefetch via Link prefetch (precisa de roteador novo).

---

## Critérios de aceite

- Nenhuma rota protegida usa `<PageLoader />` como fallback de página inteira.
- Voltar da detalhe pra lista é instantâneo (cache hit visível).
- Trocar de `/curadores/:id` ou `/deals/:id` mantém o conteúdo anterior até o novo chegar.
- Build limpo; nenhum hook quebra consumidores existentes.

Posso prosseguir com a implementação?
