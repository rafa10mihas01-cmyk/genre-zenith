
# Refino editorial via IA — diagnose-managed-playlist

## Objetivo

Trocar a geração **mecânica** de `name_suggestion` e `suggested_description` por uma camada **editorial inteligente** (Lovable AI / Gemini Flash), mantendo todo o resto (score, keywords, benchmark, cooldowns, justificativas, caps) intacto. O algoritmo atual vira **baseline + fallback automático**.

## Escopo

**Único arquivo alterado:** `supabase/functions/diagnose-managed-playlist/index.ts`

**Nada muda em:**
- Frontend (`PlaylistCockpit`, painéis de diagnóstico) — continua lendo `name_suggestion` e `raw.suggested_description` como hoje
- Schema do banco — nada de migration
- Cooldowns, score, keywords, modos, justificativas
- Lógica de faixas, substituições, capa

## Como funciona

```text
┌────────────────────────────────────────────────────────┐
│ Algoritmo atual (linhas 844-885)                       │
│  → calcula keywords presentes/faltando                 │
│  → gera nameSuggestion (concat MAIÚSCULO)              │
│  → gera suggestedDescription (template do nicho)       │
│  Esses viram BASELINE / FALLBACK                       │
└────────────────────┬───────────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────┐
│ NOVA camada: generateEditorialCopy()                   │
│  → monta contexto rico (nome atual, nicho, keywords,   │
│    artistas, top recorrentes, benchmark, descrição)    │
│  → chama Lovable AI Gateway (gemini-3-flash-preview)   │
│  → structured output: { titles[3], descriptions[2],    │
│    reasoning }                                         │
│  → timeout 12s, try/catch silencioso                   │
└────────────────────┬───────────────────────────────────┘
                     │
            ┌────────┴────────┐
            ▼                 ▼
        SUCESSO            FALHA (timeout, 402, 429, parse)
            │                 │
            ▼                 ▼
   name_suggestion =     name_suggestion =
   ai.titles[0]          nameSuggestion (algoritmo)
   raw.ai_titles =       raw.ai_used = false
   ai.titles             raw.ai_error = motivo
   raw.ai_reasoning
   raw.ai_used = true
```

## Detalhe técnico

### 1. Novo helper (topo do arquivo, após `uniq`)

```ts
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

async function generateEditorialCopy(ctx: {
  currentName: string;
  currentDescription: string | null;
  genreName: string | null;
  topKeywords: string[];
  missingKeywords: string[];
  topArtists: string[];
  topRecurringTracks: { title: string; artist: string }[];
  benchmarkSize: number | null;
  currentSize: number;
  competitors: { name: string }[];
}): Promise<{
  titles: string[];
  descriptions: string[];
  reasoning: string;
} | null> {
  if (!LOVABLE_API_KEY) return null;
  // monta system + user prompt
  // POST https://ai.gateway.lovable.dev/v1/chat/completions
  // model: google/gemini-3-flash-preview
  // response_format: { type: "json_object" }
  // AbortController com timeout 12s
  // retorna null em qualquer erro
}
```

**Prompt (resumo):**
- **System:** "Você é um editor musical sênior do Spotify especializado no nicho {genreName}. Escreva como um curador humano: natural, contextual, com identidade. NÃO faça SEO agressivo, NÃO use MAIÚSCULAS artificiais, NÃO use emojis, NÃO use linguagem motivacional. Distribua keywords naturalmente. Soe como playlist editorial real do Spotify."
- **User:** contexto estruturado (nome, nicho, keywords prioritárias, artistas dominantes, top faixas recorrentes, benchmark de tamanho, concorrentes top, descrição atual)
- **Output esperado (JSON):**
  ```json
  {
    "titles": ["...", "...", "..."],
    "descriptions": ["...", "..."],
    "reasoning": "curto, 1-2 frases: como cobre as keywords + aproxima do padrão do nicho"
  }
  ```

### 2. Chamada (entre linhas 885 e 1067)

Após o cálculo do algoritmo (`nameSuggestion`, `suggestedDescription`), antes dos cooldowns:

```ts
let aiCopy: Awaited<ReturnType<typeof generateEditorialCopy>> = null;
let aiError: string | null = null;
try {
  aiCopy = await generateEditorialCopy({
    currentName: pl.name,
    currentDescription: pl.description ?? null,
    genreName: model?.insights?.nicho_nome ?? null,
    topKeywords,
    missingKeywords: missing,
    topArtists: genreArtistsTop.slice(0, 8).map(a => a.artist),
    topRecurringTracks: topRecurringRaw.slice(0, 8).map(t => ({
      title: t.title ?? "",
      artist: t.artist ?? "",
    })),
    benchmarkSize: benchmark?.tracks_p50 ?? null,
    currentSize: totalTracks,
    competitors: competitors.slice(0, 6).map(c => ({ name: c.name })),
  });
} catch (e) {
  aiError = String((e as Error).message);
}
```

### 3. Aplicação respeitando cooldowns

```ts
const algoName = nameSuggestion;            // baseline existente
const algoDesc = suggestedDescription;      // baseline existente

const editorialName = aiCopy?.titles?.[0] ?? algoName;
const editorialDesc = aiCopy?.descriptions?.[0] ?? algoDesc;

const finalNameSuggestion = hasCooldown("structural") ? null : editorialName;
const finalDescriptionSuggestion = hasCooldown("description") ? null : editorialDesc;
```

### 4. Persistência no `raw`

Adicionar ao bloco `raw: { ... }` (linha 1104):

```ts
ai_used: !!aiCopy,
ai_error: aiError,
ai_titles: aiCopy?.titles ?? null,           // 3 opções alternativas
ai_descriptions: aiCopy?.descriptions ?? null, // 2 opções alternativas
ai_reasoning: aiCopy?.reasoning ?? null,
algo_name_baseline: algoName,                // pra debug/comparação
algo_description_baseline: algoDesc,
```

## Regras de qualidade do prompt

1. **Manter keywords** — mas distribuídas naturalmente, sem MAIÚSCULO, sem concatenação
2. **Soar editorial** — referência mental: "RapCaviar", "Esquenta Sertanejo", "Fluxo das Quebradas"
3. **Sem template** — proibir "as N mais tocadas", "atualizada toda semana", "playlist com as melhores"
4. **Sem IAzice** — proibir emoji, "🎵", "Descubra o melhor de", "Embarque numa jornada"
5. **Descrição curta** — máx ~180 chars (limite real do Spotify é 300, mas curador bom escreve enxuto)
6. **PT-BR** sempre

## Erros tratados (fallback automático)

| Erro | Comportamento |
|---|---|
| `LOVABLE_API_KEY` ausente | Usa algoritmo |
| Timeout (12s) | Usa algoritmo |
| 429 (rate limit) | Usa algoritmo, log no `raw.ai_error` |
| 402 (créditos) | Usa algoritmo, log no `raw.ai_error` |
| JSON inválido | Usa algoritmo |
| `titles[]` vazio | Usa algoritmo só pra título |

Diagnóstico **nunca falha** por causa da IA.

## Custo

~1 chamada Gemini Flash por diagnóstico (~500-800 tokens input, ~200 output). Diagnóstico não é frequente (sob demanda + cron). Custo desprezível.

## Verificação

1. Após deploy, abrir uma playlist em `/playlists/:id`
2. Clicar "Diagnóstico"
3. Verificar:
   - `name_suggestion` não tem MAIÚSCULAS no meio
   - Descrição não começa com "As N mais tocadas"
   - `raw.ai_used = true` no console (debug)
4. Testar fallback: temporariamente desligar key → diagnóstico continua funcionando com texto antigo

## Fora de escopo

- Mudar UI pra mostrar 3 opções de título (`ai_titles[]` fica disponível em `raw` pra próximo passo, se quiser depois)
- Mudar tabela `playlist_diagnoses` (alternativas vivem em `raw` JSONB)
- Aplicar IA em capa, faixas, ou outros campos
