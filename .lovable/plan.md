
# Motor Editorial Vivo — Lifecycle, Bloated Mode & Roadmap

Conecta o que já existe (pipeline, net-positive, genre affinity) e adiciona o que falta: **redução acima do benchmark** e **roadmap multi-ciclo visível no cockpit**.

## O que já existe (apenas confirmar/ligar)

- `genre_affinities` + `getGenreNeighbors()` / `expandGenrePool()` — pronto em `_shared/genre-affinity.ts`
- `playlist-brain-calc` calcula capacity, headroom, sinais
- `diagnose-managed-playlist` gera plano de adições/substituições com boost de Top 200 BR
- `apply-playlist-plan` aplica o ciclo
- `genre_benchmarks` (tabela existente) já guarda mediana de tracks por nicho
- `lifecycle_stage` em `managed_playlists` já existe (`onboarding | testing | mature`) — vamos adicionar uma coluna **separada** `lifecycle_phase` para a fase editorial dinâmica (seed/growth/mature/bloated/decline), sem mexer no stage de onboarding

## O que é NOVO

### 1. Schema (migration)

```sql
ALTER TABLE managed_playlists
  ADD COLUMN lifecycle_phase text NOT NULL DEFAULT 'seed'
    CHECK (lifecycle_phase IN ('seed','growth','mature','bloated','decline')),
  ADD COLUMN lifecycle_phase_updated_at timestamptz;

ALTER TABLE playlist_brain
  ADD COLUMN lifecycle_phase text,
  ADD COLUMN benchmark_tracks integer,
  ADD COLUMN ratio_to_benchmark numeric(5,2),
  ADD COLUMN growth_roadmap jsonb NOT NULL DEFAULT '[]'::jsonb;
```

### 2. `playlist-brain-calc` — fase + benchmark

Lê `genre_benchmarks` para o `genre_id` (mediana de track_count das playlists do mesmo nicho). Calcula `ratio = tracks_count / benchmark` e deriva fase:

```
seed     ratio < 0.30
growth   0.30 ≤ ratio < 0.80
mature   0.80 ≤ ratio ≤ 1.20
bloated  ratio > 1.20
decline  followers OU saves_rate caíram em 2+ snapshots consecutivos
         (sobrescreve qualquer fase)
```

Persiste em `managed_playlists.lifecycle_phase` + `playlist_brain.lifecycle_phase / benchmark_tracks / ratio_to_benchmark`.

### 3. `diagnose-managed-playlist` — bloated mode + roadmap

**Bloated** (novo bloco):
- `max_removals_per_cycle = min(ceil(excess * 0.25), 50)`
- `additions_per_cycle = 0` (exceto faixas excepcionais — score > P95 do pool)
- Ordem de remoção:
  1. menor `niche_adherence`
  2. menor recorrência em playlists do nicho
  3. menor popularidade contextual (vs mediana do nicho)
  4. maior saturação de artista (>1 faixa do mesmo artista)
  5. mais antiga com menor contribuição editorial
- `max_per_day = ceil(max_removals_per_cycle / 5)` (espalha por 5 dias)

**Roadmap** (todas as fases construtivas/redutoras):

```ts
function buildRoadmap(current, benchmark, phase) {
  const out = []; let t = current, c = 1;
  while (c <= 20) {
    const r = t / benchmark;
    if (phase === 'seed' || phase === 'growth') {
      const gap = benchmark - t; if (gap <= 0) break;
      const add = phase === 'seed' ? Math.min(gap, 80) : Math.min(gap, Math.ceil(benchmark*0.25));
      out.push({ cycle: c, delta: +add, total: t+add, action: 'build', phase });
      t += add;
    } else if (phase === 'bloated') {
      const exc = t - benchmark; if (exc <= 0) break;
      const rem = Math.min(Math.ceil(exc*0.25), 50);
      out.push({ cycle: c, delta: -rem, total: t-rem, action: 'trim', phase });
      t -= rem;
    } else break;
    const nr = t/benchmark; if (nr >= 0.80 && nr <= 1.20) break;
    c++;
  }
  return out;
}
```

Salva em `playlist_brain.growth_roadmap`.

### 4. `apply-playlist-plan` — net-positive enforcement

Adicionar guarda:

```ts
const phase = managed.lifecycle_phase;
const net = additions.length - removals.length;
if (phase !== 'bloated' && net < 0) {
  throw new Error('BLOCKED: net negative cycle only allowed in bloated phase');
}
```

### 5. `generate-deal-plan` — expansão por afinidade (confirmar)

Verifica se já chama `expandGenrePool`; se não, adiciona o gatilho quando capacidade < 80% do alvo. Retorna `genres_used` no payload.

### 6. Pipeline pós-import (confirmar)

Confirma que `import-account-playlists` enfileira `classify-genre → snapshot → brain-calc → diagnose → cover-suggestion`. Se faltar etapa, completa via `enqueue-playlist-job`.

### 7. Cockpit — Timeline do Roadmap (NOVO componente)

Arquivo: `src/components/playlists/cockpit/LifecycleRoadmapCard.tsx`

- Lê `playlist_brain.growth_roadmap` + `lifecycle_phase`
- Renderiza timeline (usa `Timeline` de `@/components/ui/timeline.tsx`)
- Cores:
  - seed/growth → verde (primary)
  - bloated → âmbar/laranja (warning)
  - decline → vermelho (destructive)
  - mature → check com mensagem "modo refinamento"
- Mostra `Gêneros usados: X · Y (afinidade 0.85)` quando `metadata.genres_used` existe
- Estados:
  - BUILDING: `● Ciclo 1 (agora) +80 → 110` etc
  - TRIMMING: `● Ciclo 1 (agora) -70 → 250` etc
  - STABLE: ✅ Benchmark atingido — modo refinamento
- Inserir no `PlaylistCockpit` logo abaixo do `PlaylistTracksAnalysisCard`

### 8. Hook

`src/hooks/usePlaylistBrain.ts` — estender tipo `PlaylistBrain` com `lifecycle_phase`, `benchmark_tracks`, `ratio_to_benchmark`, `growth_roadmap`.

## Arquivos tocados

**Migração:** 1 nova

**Edge functions editadas:**
- `playlist-brain-calc/index.ts` (fase + benchmark)
- `diagnose-managed-playlist/index.ts` (bloated + roadmap)
- `apply-playlist-plan/index.ts` (enforce net-positive)
- `generate-deal-plan/index.ts` (confirmar expandGenrePool)
- `import-account-playlists/index.ts` (confirmar pipeline)

**Frontend:**
- `src/components/playlists/cockpit/LifecycleRoadmapCard.tsx` (novo)
- `src/components/playlists/cockpit/PlaylistCockpit.tsx` (inserir card)
- `src/hooks/usePlaylistBrain.ts` (tipo)

## Verificação final

Após deploy, rodo `diagnose-managed-playlist` em 3 playlists representativas e retorno phase + roadmap JSON para cada cenário (seed / bloated / decline).

## Fora de escopo

- Reescrever pipeline existente
- Mexer em `lifecycle_stage` (onboarding/testing/mature) — fica intacto, é outro eixo
- Recriar genre affinity (já está em produção)
