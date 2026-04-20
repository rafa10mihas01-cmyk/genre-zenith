

## Priorização por tamanho de playlist na análise

Objetivo: o cérebro só usa playlists de alto impacto como referência principal, dentro de cada cluster, sem misturar subgêneros.

### Como vai funcionar

1. **Filtro por seguidores (dentro de cada cluster)**
   - Tier 1: `seguidores >= 500.000` (preferencial)
   - Tier 2: `seguidores >= 100.000` (fallback)
   - Tier 3: maiores disponíveis do cluster (fallback fraco)
   - Mínimo desejado por análise: 8 playlists. Se Tier 1 não atinge, agrega Tier 2; se ainda não atinge, agrega Tier 3.

2. **Confiança da análise (nível do briefing)**
   - `alta`: ≥ 8 playlists em Tier 1
   - `media`: ≥ 8 playlists somando Tier 1 + Tier 2
   - `baixa`: precisou usar Tier 3 ou total < 8
   - Esse selo aparece no metadata do briefing e influencia o badge já existente.

3. **Peso por popularidade no score**
   - Cada playlist contribui com peso = `log10(max(seguidores, 1000))`.
   - Frequência de keywords, padrões de nome, músicas e artistas passam a ser somas ponderadas por esse peso (em vez de contagem simples).
   - Resultado: padrões de playlists grandes dominam o ranking, sem eliminar totalmente as menores.

4. **Sem misturar clusters**
   - O filtro roda depois da seleção de cluster. "Todos" continua existindo, mas também aplica os mesmos tiers sobre o conjunto completo.

5. **Marcação visual mínima (sem mudar layout)**
   - Reaproveitar o badge de confiança existente em cada briefing.
   - Adicionar uma linha pequena no metadata mostrando: tier usado, total Tier 1/2/3, e se foi fallback.

### Onde mexe (técnico)

- `supabase/functions/generate-playlists-briefing/index.ts`
  - Após carregar playlists do cluster (ou todas), aplicar os tiers.
  - Calcular peso `log10(seguidores)` por playlist.
  - Trocar contagens por somas ponderadas em: keywords, padrões de nome, músicas recorrentes, artistas.
  - Ajustar cálculo de `confidence` por briefing usando peso acumulado em vez de contagem bruta.
  - Gravar em `metadata`: `tier_principal`, `counts: { tier1, tier2, tier3 }`, `fallback: boolean`, `min_followers_aplicado`.

- `supabase/functions/cluster-playlists/index.ts`
  - Sem mudança de regra de cluster.
  - Apenas garantir que retorna `seguidores` por playlist (já retorna) para o filtro funcionar.

- Frontend: nenhuma mudança de layout.
  - `BrainDetail.tsx` já mostra confidence por briefing — passa a refletir a nova lógica automaticamente.
  - `useBriefings.ts` não precisa mudar; o metadata novo vem junto.

### Parâmetros (ajustáveis)

- `TIER1_MIN = 500_000`
- `TIER2_MIN = 100_000`
- `MIN_PLAYLISTS_DESEJADO = 8`
- `PESO = log10(max(seguidores, 1000))`

### Fora de escopo

- Não muda design, navegação, tema, nem cria telas novas.
- Não altera coleta nem clusterização.
- Não toca em filtros globais (`genre_filters.min_followers`) — esse filtro é da coleta; aqui é só análise.

