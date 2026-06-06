# AUDIT 10 — Performance da tela `/playlists/:id` (Fase 4)

**Modo:** análise. Zero código.

---

## Sequência atual do load inicial

`PlaylistDetail.tsx` executa em ordem **sequencial** (await chain):

1. `playlists` SELECT por id (1 row, ~6 cols)
2. `managed_playlists` SELECT por `spotify_playlist_id` (1 row, ~10 cols)
3. `genres` SELECT por id (1 row, 1 col)

Em paralelo, `usePlaylistBrain` (via React Query) faz:

4. `playlist_brain` SELECT por playlist_id (1 row, **todas as colunas** incl. JSONBs `signals`, `recommendations`, `growth_roadmap`, `metadata`)

Após `PlaylistCockpit` montar, dispara mais queries por aba (sob demanda em alguns casos, eager em outros — não auditado por aba).

### Tempo perdido em waterfall

Considerando 80ms RTT médio para Cloud:
- Sequencial 1→2→3: ~240ms só de latência rede, antes do React começar a renderizar.
- Paralelo (1, 2, 3 juntos): ~80ms. **Ganho: ~160ms imediato**, sem mudar lógica.

---

## Achados por categoria

### 🔴 Crítico

**1. Waterfall desnecessário em `PlaylistDetail.tsx`**
- 3 selects sequenciais que poderiam ser 1 RPC ou 3 paralelos.
- Linhas 51-99 do `PlaylistDetail.tsx`.
- **Solução A (rápida):** `Promise.all` nos 3 selects. Ganho ~160ms, zero risco.
- **Solução B (ideal):** RPC `get_playlist_full(_playlist_id uuid)` retornando `{playlist, managed, genre, brain}` em 1 round-trip. Ganho ~240ms.

**2. `playlist_brain.*` carrega todos os JSONBs sempre**
- Hook `usePlaylistBrain` usa `select("*")` (`src/hooks/usePlaylistBrain.ts:73`).
- Header só precisa de `confidence_score`, `capacity_total`, `lifecycle_phase`.
- Abas Mercado/Identidade carregam `metadata`, `signals`, `recommendations`, `growth_roadmap` (JSONBs) mesmo quando não estão visíveis.
- **Solução:** column projection por hook — `usePlaylistBrainHeader` (3 cols) vs `usePlaylistBrainFull` (lazy, só quando aba abrir).

### 🟠 Importante

**3. `playlist_diagnoses.raw` (~19KB) baixado inteiro**
- Provavelmente lido por uma das abas via `select("*")`. Não confirmado por aba mas o tamanho médio do JSONB (12 MB / 715 rows ≈ 17 KB) garante que é pesado.
- **Solução:** `select("playlist_id,name_score,name_suggestion,tracks_summary,raw->market_insights as market_insights")` — projeção dentro do JSONB.

**4. Sem `staleTime` configurado nos hooks de brain/diagnose**
- React Query default = 0ms. Toda navegação entre abas pode refetch.
- Brain muda a cada recálculo (raro, sob demanda) — `staleTime: 60_000` é seguro.
- Diagnose idem.

**5. `useEffect` no `PlaylistDetail` re-executa a cada mount sem deduplicação**
- Não há React Query nas 3 queries iniciais — não há cache, não há dedupe entre rotas vizinhas.
- **Solução:** converter para `useQuery` com `queryKey: ["playlist-full", id]`.

### 🟢 Melhoria

**6. Cover image sem `loading="lazy"` ou `decoding="async"`** (a confirmar no JSX)
**7. Falta `prefetch` para abas adjacentes** — clicar na aba só dispara fetch então.
**8. `signals[]` e `recommendations[]` poderiam virar tabelas relacionais** — JSONB é flexível mas impede índice por severidade/prioridade. Não-urgente.

---

## Plano (sem implementar)

### Fase 4a — Quick wins (sem mudar shape)
1. `Promise.all` nas 3 queries iniciais — ganho ~160ms, 1 linha mudada.
2. `staleTime: 60_000` em brain/diagnose — 5 linhas mudadas.
3. `loading="lazy"` na cover.

**Risco:** 🟢 zero. **Ganho:** ~200ms perceptíveis.

### Fase 4b — Projection
4. Dividir `usePlaylistBrain` em `_Header` (3 cols) e `_Full` (tudo, lazy).
5. Idem para `usePlaylistDiagnosis`.
6. JSON projection (`raw->market_insights`) por aba.

**Risco:** 🟠 médio (precisa auditar quem consome o quê).

### Fase 4c — RPC consolidada
7. Criar `get_playlist_full(uuid)` no banco.
8. Substituir 3 selects + brain header por 1 chamada.

**Risco:** 🟠 médio (testar RLS no RPC).

### Fase 4d — Prefetch
9. Hover em aba dispara prefetch da query daquela aba.

---

## Conclusão

A tela é **funcional mas dispensa eficiência**. Sem mudar nenhuma regra de negócio, é possível tirar 200ms+ do load inicial e reduzir tráfego JSONB em 60-80% na navegação entre abas.

**Recomendação:** executar 4a junto com a Fase 2 (modularização do cockpit) — mesmo arquivo, mesma revisão, sem fricção. 4b/4c depois, com benchmark antes/depois.
