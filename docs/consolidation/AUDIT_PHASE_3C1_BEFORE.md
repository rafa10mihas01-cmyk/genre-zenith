# AUDIT PHASE 3.C.1 — BEFORE

**Escopo:** validar se os dois candidatos identificados em 3.C podem ser eliminados.
**Candidatos:** `delivery_proofs`, `observed_playlist_snapshots`.
**Regra aplicada:** `mem://preference/consolidation-rule` — nome ≠ responsabilidade.

---

## ALVO 1 — `delivery_proofs`

### Escritores
| Origem | Local | Observação |
|--------|-------|------------|
| Snapshot do BOT | `supabase/functions/bot-ingest-snapshot/index.ts:547` | Insere prova quando o DOM/print confirma plays |
| Importação de planilha | `supabase/functions/import-label-spreadsheet/index.ts:854` | Cria prova retroativa apenas para uploads incrementais (não cohort) |
| Backfill histórico | `supabase/migrations/20260525153922_*.sql:53` | One-off — não relevante |
| Trigger / RPC / Cron | — | Nenhum |

### Leitores
| Origem | Local | Uso |
|--------|-------|-----|
| Painel admin do hub | `src/pages/CampanhaExecucao.tsx:459, 876` | Aba "Prints" do Campaign Hub — lista miniatura + link |
| Portal público da campanha | `supabase/functions/get-shared-campaign-plan/index.ts:201` | Portal do cliente exibe provas auditáveis |
| Hooks | — | Nenhum hook isolado |
| PDFs | — | Não usa |

### Informação exclusiva
`delivery_proofs` carrega 5 campos que **NÃO existem em `curator_deal_snapshots`** nem em `campaign_playlist_collections`:

| Campo | Por que não é derivável |
|-------|------------------------|
| `screenshot_url` | A URL do print é o próprio objeto de prova. Não vive em snapshot nem em collection. |
| `playlist_name` (snapshot textual) | Captura o nome no momento da prova. Se o curador renomear a playlist, a prova histórica permanece fiel. |
| `track_name` (snapshot textual) | Idem — desacoplado de `catalog_tracks.name` e de mutações futuras. |
| `position_in_playlist` | Posição observada no print. Não é gravada em nenhuma outra tabela. |
| `bot_correlation_id` | Liga prova ↔ `bot_print_batches` para auditoria forense. Não existe nas demais. |

### Regra de negócio exclusiva
Sim. `delivery_proofs` é a **fonte oficial da aba "Prints"** do Campaign Hub e do **portal público do cliente**. É a evidência visual auditável que sustenta o contrato com o cliente — não é métrica derivada.

### Veredito ALVO 1
> **NÃO consolidar. NÃO dropar.**
> `delivery_proofs` responde uma pergunta de negócio única: *"qual é a prova visual auditável de que a entrega aconteceu?"*. `curator_deal_snapshots` responde *"quantos plays o deal entregou em cada captura?"*. Nomes parecidos, responsabilidades distintas. Aplicada a regra `mem://preference/consolidation-rule`.

---

## ALVO 2 — `observed_playlist_snapshots`

### Escritores
| Origem | Local | Status |
|--------|-------|--------|
| Backfill histórico | `supabase/migrations/20260613143823_*.sql:149` | One-off (6.450 linhas migradas de `organic_plays_snapshots`) |
| Ingest novo (DOM/OCR/BOT) | — | **NENHUM** — a migration declara explicitamente: *"ingest será patchado em PR separado pra rotear novas observações pra observed_* em vez de organic_plays_snapshots"*. Esse PR nunca foi mergeado. |
| Trigger / RPC / Cron | — | Nenhum escreve |

Verificação: `rg "observed_playlist_snapshots.*insert"` retorna apenas a própria migration. Nenhuma Edge Function ou helper grava na tabela hoje.

### Leitores
| Origem | Local |
|--------|-------|
| Frontend | **NENHUM** — não há `from("observed_playlist_snapshots")` em `src/` |
| Edge Function | **NENHUM** |
| Hooks | **NENHUM** |
| SQL Function / View | **NENHUM** |
| Trigger | `trg_ops_update_cache` lê `NEW` (não a tabela) para atualizar `observed_playlists` |
| Cron | Nenhum |

### Comparação com `organic_plays_snapshots(kind='observed')`
- `organic_plays_snapshots` **não possui coluna `kind`**. A premissa da pergunta da Fase 3.C estava errada.
- A diferença real é estrutural:
  - `organic_plays_snapshots` referencia `spotify_playlist_id` direto (string).
  - `observed_playlist_snapshots` referencia `observed_playlists(id)` via FK (catálogo paralelo).
- O ingest ativo (bot-ingest-snapshot, extract-snapshot-from-print, ingest-dom) escreve **somente** em `organic_plays_snapshots`. `observed_playlist_snapshots` está dormente.

### Dependências bloqueadoras de DROP
| Dep | Onde |
|-----|------|
| FK `observed_playlist_id → observed_playlists(id)` | tabela `observed_playlists` é viva (usada por `observer-pull-queue`, `observer-ingest-tracks`, `promote-search-to-observer`) |
| Trigger `trg_ops_update_cache` | mantém cache em `observed_playlists` |
| Função `update_observed_playlist_cache()` | usada apenas pelo trigger acima |
| Índices | 3 índices — caem junto com o DROP |
| Dados | 6.450 linhas históricas (backfill) — perda permanente de série temporal observada antes de 13/06/2026 |

### Veredito ALVO 2
> **NÃO dropar nesta fase.**
> A tabela está operacionalmente dormente (0 escritores ativos, 0 leitores), mas o DROP implica:
> 1. Decidir o destino do catálogo `observed_playlists` (vivo, usado pelo módulo Observer);
> 2. Migrar o cache `observation_count`/`total_plays_observed`/`last_observed_at` para outra origem;
> 3. Apagar 6.450 linhas históricas que ninguém lê hoje mas podem ser reusadas pelo módulo Observer/Inteligência.
>
> Esse trabalho é escopo do módulo Observer (futura Fase 4), não da consolidação de Coleta (Fase 3). **Marcar como `dormant — quarentena`**, monitorar e revisitar.

---

## DECISÃO FINAL DA FASE 3.C.1

| Candidato | Decisão | Motivo |
|-----------|---------|--------|
| `delivery_proofs` | **MANTER como fonte oficial** | Responsabilidade única — prova visual auditável. Regra `mem://preference/consolidation-rule`. |
| `observed_playlist_snapshots` | **MANTER em quarentena** | Dormente, mas DROP exige reescopo do módulo Observer (fora da Fase 3). |

**Nenhum DROP será executado.** Logo, **AUDITOR AFTER e ARQUIVO FINAL não geram alteração de schema** — apenas registram a decisão.

A Fase 3.C foi auditada de ponta a ponta:
- Fase 3.A — Gateway único ✅ (`AUDIT_PHASE_3A_AFTER.md`)
- Fase 3.B — Match único ✅ (`AUDIT_PHASE_3B_AFTER.md`)
- Fase 3.C — Snapshots auditados ✅ (`AUDIT_PHASE_3C_BEFORE.md`)
- Fase 3.C.1 — Candidatos validados, **zero DROP justificado** ✅ (este documento)

---

## PRONTIDÃO PARA FASE 3.F (Auditoria Final)

**SIM.** A arquitetura de Coleta está consolidada:

```
Frontend / BOT / Planilha / Print
        ↓
  Gateway único (raw_ingest)
        ↓
  Parser (DOM / OCR / Spreadsheet)
        ↓
  match_curator_playlist (RPC oficial — único Match Engine)
        ↓
  Collection Writer (_shared/collection-writer.ts)
        ↓
  campaign_playlist_collections + curator_deal_snapshots + delivery_proofs (prova visual)
        ↓
  Delivery Engine
```

Todas as 19 estruturas de snapshot foram classificadas. Nenhuma duplicação de responsabilidade resta. Pronto para `AUDIT_PHASE_3_FINAL.md` (Fase 3.F).
