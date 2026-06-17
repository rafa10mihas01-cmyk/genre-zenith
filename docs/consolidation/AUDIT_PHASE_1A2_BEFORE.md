# Auditor BEFORE — Fase 1.A.2
**Alvo:** `curator_deal_snapshots.is_baseline`
**Gerado:** 2026-06-17

---

## 🚨 Achado crítico

A coluna `curator_deal_snapshots.is_baseline` **NÃO é redundante** com `campaign_playlist_collections`. Ela representa um **conceito de negócio diferente**, ainda ativo e essencial pro cálculo de entrega.

### Semântica das duas estruturas

| Estrutura | O que armazena | Granularidade |
|---|---|---|
| `campaign_playlist_collections` (Fase 1.A.1) | **QUAIS playlists** existiam quando a campaign foi capturada (lista de playlists baseline) | 1 linha por (campaign, playlist) |
| `curator_deal_snapshots.is_baseline = true` | **QUANTOS plays** cada playlist tinha no momento inicial do deal/song (snapshot de contador) | 1 linha por (deal, song, playlist) marcando o snapshot inicial |

São camadas complementares, não duplicadas. Uma diz "esta playlist fazia parte do plano"; a outra diz "esta playlist tinha N plays quando começamos a medir".

### Dados em produção
- 24 snapshots com `is_baseline = true` (snapshots iniciais)
- 1.055 snapshots com `is_baseline = false` (coletas subsequentes)
- Ratio coerente: ~1 baseline por (deal, song, playlist), múltiplas coletas ao longo do tempo

---

## Respostas obrigatórias às 5 perguntas

### 1. A coluna ainda é utilizada por Edge Function, trigger, função SQL, RPC, cron, worker ou frontend?

**SIM — uso ativo e crítico:**

- **Funções SQL (7):**
  - `fn_deal_delivery_accumulated` — usa `is_baseline` pra calcular `delivered = latest_plays − baseline_plays` por (song, playlist). Núcleo do cálculo de entrega.
  - `record_curator_deal_capture` — escreve `is_baseline = true` quando registra o primeiro snapshot.
  - `get_curator_deal_progress`, `get_curator_deal_breakdown`, `get_curator_deal_snapshot_history`, `recompute_curator_deal_state`, `get_campaign_analytics_overview` — todos leem `is_baseline` pra separar snapshot inicial de coletas.
- **Triggers (3 reais, ignorando duplicidade no relatório):**
  - `trg_reject_snapshot_regression` — rejeita coletas com regressão de plays, **exceto** quando `is_baseline = true` (baseline pode redefinir o zero).
  - `trg_curator_snapshots_recompute` — recomputa estado do deal após cada snapshot.
  - `trg_sync_curator_playlist_streams` — propaga plays do snapshot pra `curator_playlists.streams_current`.
- **Edge Functions (escrevem `is_baseline = true`):**
  - `bot-ingest-snapshot`, `_shared/ingest-dom.ts`, `extract-snapshot-from-print` — marcam o primeiro snapshot por (song, playlist) como baseline.
- **Edge Functions (leem):**
  - `cleanup-snapshots` — preserva baselines do TTL de 90 dias.
  - `cron-reconcile-curator-deals` — busca baseline pra reconciliar deal.
  - `curator-deal-followup`, `get-curator-deal-public` — separam baseline de coletas em relatórios públicos.

### 2. A coluna ainda influencia decisão de negócio?

**SIM.** Define o "ponto zero" do cálculo de entrega. Sem ela, `fn_deal_delivery_accumulated` não consegue distinguir plays pré-existentes de plays atribuíveis ao deal. Toda métrica de entrega (delivered, CPP realizado, % de plano cumprido) depende dela.

### 3. É usada só pra retenção/auditoria ou ainda participa do fluxo operacional?

**Participa do fluxo operacional ativo.** A retenção (`cleanup-snapshots` preservando baselines) é consequência da regra de negócio, não o motivo da existência da coluna.

### 4. Existe lógica de negócio que dependa exclusivamente dela?

**SIM** — `fn_deal_delivery_accumulated` (CTE `baseline_pp`) usa `is_baseline = true` como fonte primária do play count inicial. Fallback existe ("se não houver baseline, pega o snapshot mais antigo"), mas o fluxo oficial captura `is_baseline = true` explicitamente.

### 5. Existe dado nessa coluna que ainda não foi consolidado em `campaign_playlist_collections`?

**Não aplicável.** As duas estruturas armazenam coisas diferentes:
- `campaign_playlist_collections` não tem coluna `plays`, `plays_24h`, `plays_7d`, `plays_28d` — não armazena contagens.
- `curator_deal_snapshots` é histórico de medições por (deal, song, playlist, captured_at) — outro grão.

Não há dado a migrar porque não há sobreposição semântica.

---

## Conclusão arquitetural

`curator_deal_snapshots.is_baseline` **não é legado**. É a marca do primeiro snapshot de contagem por (deal, song, playlist), usada pra calcular delivered.

O escopo original da Fase 1.A.2 (eliminar essa coluna porque a baseline agora vive em `campaign_playlist_collections`) **está baseado em premissa incorreta**. As duas estruturas representam camadas complementares:

- **Camada A (resolvida em 1.A.1):** "Quais playlists fazem parte do plano?" → `campaign_playlist_collections`
- **Camada B (esta fase):** "Quanto cada playlist já tinha quando começamos a medir?" → `curator_deal_snapshots.is_baseline`

---

## Decisão necessária do usuário

Três caminhos possíveis:

### Opção A — Reescopo da Fase 1.A.2 (recomendado)
Aceitar que `curator_deal_snapshots.is_baseline` é arquitetura oficial e **encerrar a Fase 1.A.2 sem DROP**. Avançar direto pra Fase 1.A.3 (`curator_deal_logs.is_baseline` + `curator_playlists.is_baseline`), onde a investigação de legado faz mais sentido.

### Opção B — Renomear a coluna
Renomear `is_baseline` → `is_initial_capture` (ou similar) só nessa tabela pra eliminar confusão semântica com a baseline de playlist. **Não muda nenhuma regra de negócio**, só clareza de nome. Custo: refatoração de 162 ocorrências em código por troca de nome.

### Opção C — Substituir a flag por uma view derivada
Calcular "qual snapshot é o baseline" dinamicamente (`ORDER BY captured_at ASC LIMIT 1` por grão). Elimina a coluna mas **muda o contrato**: hoje o sistema marca explicitamente o snapshot como baseline; passaria a inferir. Risco: regressão de plays no primeiro snapshot deixa de ser tratada como "redefine baseline", vira "rejeita coleta".

**Aguardo aprovação antes de qualquer mudança.**
