# AUDIT 04 — Playlist Engine / Matemática (Executivo)

**Escopo:** todas as fórmulas de scoring, distribuição, capacity, multiplier, position curve, saturação, winner score e ecosystem score.

---

## 🔴 CRÍTICO

### C1. `POSITION_PCT` duplicada em 2 lugares com tipos diferentes
| Local | Forma | Valores | Comentário do código |
|---|---|---|---|
| `src/lib/campaignOperationalPlan.ts:63` | `number[]` (canônica) | 0.12 … 0.008 + residual 0.003 | "VERDADE ÚNICA do sistema. Não criar fatores alternativos." |
| `src/components/operacao/PlanejadorMeta.tsx:50` | `Record<number, number>` | **valores idênticos** | sem aviso, fácil de divergir no futuro |

- **Por que existe:** o Planejador foi escrito antes da curva ser extraída pra lib.
- **Impacto atual:** zero hoje (números batem), MAS qualquer ajuste futuro na curva canônica vai deixar o Planejador desincronizado silenciosamente.
- **Recomendação:** ✅ **APLICADO** — `PlanejadorMeta.tsx` agora importa `getPositionPct` de `@/lib/campaignOperationalPlan`. Verdade única restaurada.

### C2. Engine **não tem uma "verdade matemática" central documentada**
Cada peça tem sua fórmula isolada:
| Engine | Arquivo | Métrica produzida |
|---|---|---|
| Capacity / streams projetados | `src/lib/campaignOperationalPlan.ts` | `saves × mult/30 × POSITION_PCT[pos]` |
| Playlist Brain | `supabase/functions/playlist-brain-calc/index.ts` | `health_score` + `capacity_score` + recomendações |
| Curator Brain | `supabase/functions/curator-brain-calc/index.ts` | `trust_score`, `roi_score`, `confidence_score` |
| Winner Score v2 | `supabase/functions/compute-winner-scores/index.ts` | `gate_score` (separado dos outros) |
| Track Ecosystem Score | `supabase/functions/calculate-track-ecosystem-score/index.ts` | `frequency_score` + `confidence` + thresholds em `TH.*` |
| Playlist Ecosystem Score | `supabase/functions/calculate-playlist-ecosystem-score/index.ts` | fórmula própria `(subindo+forte)×2 + estavel×1`, `efficiency_score = streams_28d/track_count/5000` |
| Track ↔ Playlist Fit | `supabase/functions/calculate-track-playlist-fit/index.ts` | score separado |

- **Problema estrutural:** 7 motores de score, todos chamando-se "score" no banco, sem dicionário central. Cada um define seus próprios pesos, normalizações (`Math.min(1, x/threshold)`) e cutoffs mágicos (5000 streams, 70% saturation, percentil 0.75, etc.).
- **Recomendação:** **REFATORAR (Fase 6)** — criar `supabase/functions/_shared/scoring.ts` com:
  - Normalizadores reutilizáveis (`clamp01`, `percentile`, `confidence`)
  - Constantes centralizadas (`SATURATION_HIGH = 70`, `EFFICIENCY_BASE = 5000`, etc.)
  - Documentação de cada score (input, output, range, decay).
  - **ALTO risco** se feito de uma vez. Migrar 1 motor por vez.

---

## 🟠 ALTO

### A1. Track Ecosystem Score com 2 fontes paralelas
Cron 1 (`tes-daily-recalc` 07:00) e cron 2 (`wave-track-ecosystem-score-daily` 07:00) chamam **a mesma função** com **o mesmo payload** (já reportado na Fase 3). Resultado: a tabela `track_ecosystem_score` tem só **4 linhas** (tabela praticamente morta), apesar de 2 crons diários.

### A2. Tabelas de output da engine vazias
| Tabela | Função que escreve | Linhas |
|---|---|---|
| `track_ecosystem_score` | `calculate-track-ecosystem-score` (2 crons) | 4 |
| `track_playlist_fit` | `calculate-track-playlist-fit` (cron diário) | 16 |
| `recommendation_outcome` | `detect-recommendation-outcomes` (cron diário) | 0 |
| `recommendation_feedback` | (nenhuma writer ativa) | 0 |
| `playlist_adjustment_impacts` | `evaluate-adjustment-impacts` (cron diário) | 0 |

→ 5 motores rodando 1×/dia há semanas/meses e produzindo entre 0 e 16 linhas. Ou estão silenciosamente quebrados, ou o threshold de entrada é impossível.

### A3. `health_score < 40` é hard-coded como gatilho de alerta
`playlist-brain-calc:233` decide "playlist em risco" se `health_score < 40`. Esse 40 não está em config, não está documentado e aparece também em outros lugares com valores diferentes (`60` para "saudável" no `EcosystemScorePanel`). Sem fonte única de bands.

---

## 🟡 MÉDIO

### M1. "Magic numbers" espalhados
Numbers sem nome encontrados nas engines (amostra):
- `5000` — divisor de efficiency_score (playlist ecosystem)
- `70` — % de saturação que vira alerta
- `pos >= 20` — limite duro de "cauda" em alguns lugares, `POSITION_PCT.length` (20) em outros
- `30` — denominador do multiplier (`mult/30`)
- `0.75` — percentil de HIGH_PRESENCE
- `MIN_SNAPSHOTS_CONFIDENT` está num `TH.*` (bom), mas nem todos os engines usam esse padrão

Recomendação: **UNIFICAR** num `engine.constants.ts` único.

### M2. `compute-winner-scores` separado do scoring central
A função roda hourly e cria um `gate_score` próprio, mas o resultado não alimenta `playlist_scores` nem `playlist_brain`. É um silo paralelo. Decidir: integra ou aposenta.

---

## 🟢 BAIXO — APLICADO NESTA FASE

| # | Ação | Resultado |
|---|---|---|
| 1 | Removida duplicação de `POSITION_PCT` em `PlanejadorMeta.tsx` | ✅ Componente agora importa `getPositionPct` de `@/lib/campaignOperationalPlan`. Verdade única restaurada. |

**Não aplicado (deixado pra Fase 6):**
- Criação do `_shared/scoring.ts` (refator grande, ALTO risco se mal feito)
- Resolver duplicata `tes-daily-recalc` vs `wave-track-ecosystem-score-daily` (precisa decisão humana sobre qual cron é a verdade)
- Unificação de magic numbers num `engine.constants.ts`

---

## Resumo numérico

| Severidade | Achados |
|---|---|
| 🔴 Crítico | 2 (POSITION_PCT duplicada, ausência de scoring central) |
| 🟠 Alto | 3 (TES com 2 crons, 5 tabelas de engine vazias, magic numbers de bands) |
| 🟡 Médio | 2 (magic numbers globais, winner-score isolado) |
| 🟢 Baixo aplicado | 1 (POSITION_PCT unificada) |

## Próxima fase

**Fase 5 — Frontend & Design System.** Páginas abandonadas, hooks duplicados, contextos não usados, tokens fora do padrão, skeletons inúteis, loading states falsos.
