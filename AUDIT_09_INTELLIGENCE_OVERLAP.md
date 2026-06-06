# AUDIT 09 — Sobreposição Diagnose × Brain (Fase 3)

**Modo:** análise. Zero código, zero migration.

Objetivo: mapear onde os dois motores se sobrepõem antes de propor a fonte única **Playlist Intelligence**.

---

## Os dois motores hoje

| Motor | Edge function | Tabela principal | Frequência | Disparado por |
|---|---|---|---|---|
| **Brain** | `playlist-brain-calc` | `playlist_brain` (+ `_history`) | sob demanda + cron | botão "Recalcular", após diagnose, cron de housekeeping |
| **Diagnose** | `diagnose-managed-playlist` | `playlist_diagnoses` | sob demanda + batch | botão "Diagnosticar", `diagnose-managed-playlists-batch` (cron diário) |

## O que cada um produz

### Brain (`playlist_brain`)
| Coluna | Significado |
|---|---|
| `capacity_total`, `capacity_per_slot`, `capacity_ceiling`, `headroom_pct` | Capacidade quantitativa |
| `health_trend` | `crescendo/estavel/encolhendo/novo/sem_dados` |
| `signals` | Array de alertas estruturados (severidade) |
| `recommendations` | Array `{priority, action, reason}` |
| `confidence_score` | Score 0-100 de confiabilidade do cálculo |
| `lifecycle_phase` | `seed/growth/mature/bloated/decline` |
| `benchmark_tracks`, `ratio_to_benchmark` | Comparação com benchmark de gênero |
| `growth_roadmap` | Array de steps `{cycle, delta, total, action, phase}` |
| `identity.nicho`, `identity.keywords_matched` | Identidade derivada |
| `personality.total_tracks`, `freq_update_dias` | Personalidade derivada |

### Diagnose (`playlist_diagnoses`)
| Coluna | Significado |
|---|---|
| `name_score`, `name_current`, `name_suggestion`, `name_reasons` | Diagnóstico de nome (SEO) |
| `tracks_suggestions` | Sugestões de faixas (add/remove/promote) — usa IA |
| `tracks_analysis`, `tracks_summary` | Análise por faixa (keep/remove/promote + reasons) |
| `cover_suggestion` | Sugestão de capa |
| `competitors` | Playlists concorrentes mapeadas |
| `raw` (JSONB ~19KB) | Payload completo da chamada IA incluindo market_insights, niche adjacency |
| `applied_changes`, `applied_at`, `applied_by` | Tracking do "apply plan" |

---

## Onde se sobrepõem

### 🔴 Sobreposição direta

| Conceito | Em Brain | Em Diagnose | Conflito |
|---|---|---|---|
| **Score geral** | `confidence_score` (0-100) | `name_score` (0-100) + score implícito no `raw.health` | **2 scores diferentes mostrados como "score" na UI** |
| **Recomendações** | `recommendations[]` (action plan macro) | `tracks_suggestions[]` + `name_suggestion` (ações específicas) | **Operador vê 2 listas, pode haver contradição** |
| **Identidade / nicho** | `identity.nicho`, `keywords_matched` | `raw.niche_adjacency`, `name_reasons` | **Mesmo conceito calculado 2 vezes com lógicas diferentes** |
| **Sinais / problemas** | `signals[]` (estruturado, severity) | Implícito em `name_reasons` + `tracks_suggestions[].reason` | Sobrepõe parcialmente |
| **Lifecycle / saúde** | `lifecycle_phase`, `health_trend` | `raw.market_insights.lifecycle` | Brain é fonte de verdade; diagnose tem cópia stale |

### 🟠 Sobreposição operacional

- **Ambos rodam após apply_plan**: `apply-playlist-plan` chama `playlist-brain-calc` para refletir mudança. Ok, mas significa que o brain é dependente do diagnose para estar fresco.
- **Hook `useDiagnoseManagedPlaylist` dispara brain-calc no `onSuccess`** — acoplamento implícito.
- **Batch diagnose** dispara via fila `DIAGNOSE_ENGINE`, brain-calc não tem batch equivalente — brain fica defasado em massa.

---

## Onde **não** se sobrepõem (boa modularidade)

- **Brain não usa IA** — é determinístico (lê snapshots, calcula capacidade, infere fase). Rápido, barato, idempotente.
- **Diagnose usa IA (Gemini/Lovable AI)** — gera linguagem natural, sugestões qualitativas. Caro, lento, não-determinístico.
- **Brain mantém histórico** (`playlist_brain_history`); diagnose mantém versões (cada linha é um snapshot completo).
- **Editor manual** lê só brain (capacity, headroom) para validar adições; não lê diagnose.

---

## Onde a UI consome cada um (mapeamento real)

| Aba do Cockpit | Brain | Diagnose |
|---|---|---|
| Mercado | `lifecycle_phase`, `benchmark_tracks` | `raw.market_insights`, `competitors` |
| Identidade | `identity.*`, `personality.*` | `name_*`, `cover_suggestion` |
| Plano de Ação | `recommendations[]`, `growth_roadmap[]` | `tracks_suggestions[]`, `applied_changes` |
| Estratégia | `confidence_score`, `headroom_pct`, `signals[]` | `raw.strategy_*` |
| Editor | `capacity_*` (read-only) | nada |
| Header (score) | `confidence_score` | `name_score` (em alguns lugares) |

**Operador vê 2 "scores" diferentes** dependendo da aba — é a queixa recorrente.

---

## Proposta: arquitetura **Playlist Intelligence** (futuro)

### Conceito

Uma tabela única `playlist_intelligence` (1 linha por playlist canônica) que **agrega** o resultado dos dois motores em campos semânticos claros, mantendo as engines internas separadas mas escondendo isso da UI/cliente.

```text
                    ┌─────────────────────────────────┐
                    │  playlist-intelligence-orchestrator │
                    │  (edge function)                │
                    └────────┬────────────────────────┘
                             │
                ┌────────────┴───────────────┐
                ▼                            ▼
       ┌────────────────┐         ┌────────────────────┐
       │ brain-step     │         │ diagnose-step      │
       │ (determinístico│         │ (IA, qualitativo)  │
       │  capacidade,   │         │  nome, faixas,     │
       │  lifecycle)    │         │  competitors)      │
       └───────┬────────┘         └──────────┬─────────┘
               │                             │
               └──────────────┬──────────────┘
                              ▼
                ┌──────────────────────────────┐
                │ playlist_intelligence (1 row)│
                │  - score_overall (único)     │
                │  - score_components{}        │
                │  - capacity{}                │
                │  - identity{}                │
                │  - market{}                  │
                │  - action_plan[]             │
                │  - lifecycle_phase           │
                │  - confidence                │
                │  - calculated_at             │
                │  - sources{brain_at,         │
                │            diagnose_at}      │
                └──────────────────────────────┘
                              │
                              ▼
                ┌──────────────────────────────┐
                │ playlist_intelligence_history│
                │ (retention: last 30 by pl)   │
                └──────────────────────────────┘
```

### Mudanças necessárias

1. **Tabela nova `playlist_intelligence`** + history com retenção.
2. **Orquestrador** chama brain-step e diagnose-step (ambos passam a ser internos, sem tabela própria persistida — escrevem direto na agregadora).
3. **Score unificado** = função explícita combinando subscores (peso definido em config).
4. **Migration de leitura**: hooks `usePlaylistBrain` e `usePlaylistDiagnosis` viram facades sobre `usePlaylistIntelligence` — mantém UI igual.
5. **Migration de escrita**: editor manual continua igual; ele dispara recálculo via orquestrador.
6. **Deprecate** `playlist_brain`, `playlist_brain_history`, `playlist_diagnoses` em janela de 60 dias (read-only, depois drop).

### Riscos

| Risco | Mitigação |
|---|---|
| Quebrar UI que lê campos específicos | Facades nos hooks mantêm shape antigo durante migração |
| Perder histórico durante migração | Backfill incremental de `_history` antes do cutover |
| Score "mudar" para o operador | Manter score antigo + novo lado-a-lado por 30 dias com label |
| Custo IA dobrar | Cache + dedupe em diagnose-step (rodar IA só se inputs mudaram) |

### Esforço

- Arquitetura: ~3-5 dias de design + revisão
- Implementação: ~2 semanas (incluindo backfill e cutover)
- Estabilização: ~30 dias de observação

---

## Conclusão

A sobreposição é **real e dolorosa** (2 scores, 2 listas de recomendação) mas **não é bug** — é dívida arquitetural de fases diferentes do produto. A unificação proposta é **alto valor / médio risco** e deve ser próxima grande iniciativa após a estabilização das fases 1 e 2.

**Não iniciar antes de:** Fase 1.1 estar concluída (limpeza de órfãos) e Fase 2 estar mergeada (cockpit modular).
