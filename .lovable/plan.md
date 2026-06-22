# Evolução do Engine de Catálogo — Engine Único como Orquestrador das Playlists

Diretriz incorporada: **evoluir o engine existente, não criar paralelo**. Todo novo comportamento entra como módulo interno do `process-catalog-placements` + RPCs no schema atual, atrás de feature flags em `system_flags`. Nada que funciona hoje pode parar.

## Princípios arquiteturais (vinculantes em todas as fases)

1. **Um único Engine.** Proibido criar "Occupancy Engine", "Campaign Engine" ou qualquer cérebro paralelo. Novos comportamentos entram como **módulos internos** do Engine de Catálogo: Elegibilidade · Ocupação · Priorização · Reordenação · Inteligência Editorial · Aprendizado · Sincronização Spotify. Um único cérebro decide.
2. **Origem ≠ Controle.** `origin` (já criado na Fase 1) registra apenas como o placement nasceu. Quem o controla *agora* será o futuro `owner` (`CATALOG | CAMPAIGN`) — a ser introduzido na Fase 5. Ao fim da campanha, `owner` volta para `CATALOG` e `origin` permanece histórico.
3. **Campanhas não tocam playlists.** Campanha envia **intenção** ("priorizar esta música por N dias"); o Engine decide se entra, onde entra, quem desloca, quando sai.
4. **Engine é o único dono de posição.** Nenhum módulo externo (campanha, painel admin, worker, edge function) grava `position` diretamente — todos enviam intenções; só o Engine calcula posição, prioridade, elegibilidade, permanência, remoção e reorganização.
5. **Zonas editoriais, não posições fixas.** O Engine raciocina em zonas (`PREMIUM` = topo de impacto · `DISCOVERY` = crescimento/novidade · `CATALOG` = cobertura/diversidade). Posições absolutas são derivadas, não decididas pelo cliente.
6. **Campanha é fator do score**, não criadora de placement. Entra como um componente em `priority_score` ao lado de popularidade, performance, retenção, diversidade e aprendizado.

## Ajustes nas fases seguintes (em função das diretrizes acima)

- **Fase 3 (Priorização):** `compute_placement_priority()` inclui obrigatoriamente o componente `campaign_boost` (ativo enquanto houver intenção de campanha vigente para a música).
- **Fase 4 (Reordenação):** trabalha em **zonas editoriais** (`PREMIUM | DISCOVERY | CATALOG`) — posições absolutas são apenas o output final. Adicionar tabela `playlist_editorial_zones` (playlist_id, zone, start_pos, end_pos, rules jsonb) ou derivar de `playlist_blueprints`.
- **Fase 5 (Campanha como intenção):**
  - Nova tabela `campaign_priority_intents (id, track_id, playlist_id NULLABLE, weight, starts_at, ends_at, status, source_campaign_id)`.
  - Coluna `owner text` em `catalog_placements` (`CATALOG | CAMPAIGN`, default `CATALOG`). Ao expirar a intenção, `owner` retorna a `CATALOG` automaticamente via job.
  - Campanha **nunca** insere/remove/reordena diretamente. API atual da campanha é convertida em "registrar intenção" por dentro.
- **Fase 9 (Desativação do legado):** critério de sucesso reforçado — nenhum INSERT/UPDATE de `position` em `catalog_placements` pode partir de fora do Engine.

---

## Mapa de reuso obrigatório (proibido recriar)

| Responsabilidade | Componente existente reutilizado |
|---|---|
| Fila / inflight / lease / reaper | `catalog_snapshot_queue`, `catalog_inflight`, `process-catalog-placements` |
| Dedupe físico | `idx_catalog_placements_unique_alive` em `catalog_placements` |
| Vagas / elegibilidade já modelada | `v_catalog_playlist_occupancy`, filtros do worker atual |
| Escrita Spotify | `_shared/spotify-playlist.ts` + `pick_spotify_app` |
| Snapshots / baseline / aprendizado base | `catalog_track_snapshots`, `catalog_track_baselines`, `curator_deal_snapshots` |
| Observabilidade | `catalog_placement_execution_log`, `spotify_call_log`, `cron_run_log`, `system_alerts` |
| Cron | `pg_cron` já em uso (mesmo padrão dos jobs do catálogo) |
| Sync VPS / Observer | `bot-ingest*`, `observer_*` |

Nada disso ganha duplicata. Os módulos novos abaixo **chamam** esses componentes.

---

## Componentes NOVOS — apenas onde a responsabilidade é nova

1. **Score de prioridade** — não existe hoje.
   - Tabela `placement_priority_scores (placement_id PK, score numeric, components jsonb, computed_at timestamptz)`.
   - Função `compute_placement_priority()` consumindo dados já existentes (snapshots, charts, popularity, campanha ativa via `curator_deal_songs`, força do artista, ecosystem score).
2. **Reordenador editorial** — não existe hoje.
   - Tabela `playlist_reorder_proposals` (dry-run).
   - Módulo dentro do worker existente que, quando flag ON, aplica reorder via `_shared/spotify-playlist.ts` (reorder já implementado).
3. **Auditoria de origem do placement** — não existe hoje.
   - Coluna `origin` em `catalog_placements` (`CATALOG|CAMPAIGN|MANUAL|IMPORT`), default `CATALOG`.
   - Trigger AFTER INSERT → `placement_origin_log` (append-only).
4. **Sinais de aprendizado** — não existe hoje.
   - Tabela `placement_learning_signals` alimentada por job que consolida snapshots + posição histórica; entra como `components` no score.

Tudo o mais é evolução de função/RPC existente.

---

## Fases (incrementais, todas reversíveis via flag)

### Fase 1 — Instrumentação (zero mudança de regra)
- `catalog_placements.origin` + backfill heurístico.
- `placement_origin_log` + trigger AFTER INSERT (não bloqueia).
- Flags em `system_flags`, todas OFF: `engine.priority_active`, `engine.reorder_active`, `engine.occupancy_autofill`, `engine.campaign_promotes`, `engine.editorial_weights`.
- Atualizar todos os call sites de INSERT em `catalog_placements` para preencher `origin` explicitamente.

**Aceite:** comportamento idêntico, log popula, flags existem.

### Fase 2 — Ocupação como RPC interna do engine
Sem novo worker. Nova RPC `enqueue_catalog_autofill(playlist_id uuid)` que:
- lê `v_catalog_playlist_occupancy` para detectar vagas reais;
- aplica filtros já existentes (gênero, cooldown via `playlist_cooldowns`, limite por artista, diversidade);
- enfileira em `catalog_snapshot_queue` com `origin='CATALOG'`.

Consumo continua sendo `process-catalog-placements` sem alteração de núcleo. Novo cron `cron-catalog-autofill` criado mas **desligado por flag**.

### Fase 3 — Cálculo de prioridade (shadow)
- `placement_priority_scores` + `compute_placement_priority()`.
- Cron de 1h calcula scores. Nenhuma posição muda. Flag `engine.priority_active=ON` apenas habilita gravação.

### Fase 4 — Reordenador (dry-run → cohort)
- Módulo `reorderer` interno ao worker, consome scores + inventário → `playlist_reorder_proposals`.
- Quando `engine.reorder_active=ON` para um cohort específico, aplica reorder real via helper Spotify existente.

### Fase 5 — Campanhas viram promotoras (camada de compat)
Atrás de `engine.campaign_promotes`:
```text
start_campaign(track, playlist):
  if alive_placement existe → bump_priority + recompute_position
  else → enqueue_catalog_autofill(hint: track, playlist, origin='CAMPAIGN', priority=HIGH)
         após persistLocal → bump_priority
```
API pública das campanhas não muda — roteamento interno.

### Fase 6 — Autofill total (cohort piloto)
`engine.occupancy_autofill=ON` para um conjunto pequeno de playlists. Meta: `alive_count == capacity` sempre que houver candidatos elegíveis. Métricas via logs existentes.

### Fase 7 — Inteligência editorial nas posições
Estender reordenador com perfil topo/meio/fundo a partir de `playlist_blueprints` (tabela já existe). Pesos atrás de `engine.editorial_weights`.

### Fase 8 — Aprendizado contínuo
`placement_learning_signals` populado por cron a partir de snapshots + posição histórica. Entra como `components` em `compute_placement_priority()`. Sem nova fila.

### Fase 9 — Desativação do caminho legado
Após cohort 100% estável por N dias:
- INSERTs diretos em `catalog_placements` originados por campanha são substituídos por `enqueue_catalog_autofill`.
- Campanhas passam a ser **apenas** modificador de prioridade.
- Tabelas legadas permanecem (congelar escrita, manter leitura). Rollback = flag OFF.

---

## Pré-requisitos (já mapeados em auditorias anteriores, devem vir antes da Fase 6)

- Corrigir race POST↔persistLocal no `process-catalog-placements`.
- Remover allowlist hardcoded do Catalog Gateway.

---

## Detalhes técnicos

**Mudanças mínimas no que existe:**
- `catalog_placements`: +`origin`.
- `process-catalog-placements`: ordena leitura da fila por `priority_score` quando `engine.priority_active=ON` (mudança pequena, atrás de flag).
- Helpers Spotify, fila, lease, reaper, dedupe: intocados.

**Reversibilidade:** flag OFF restaura comportamento anterior em todas as fases. Sem DROP, sem trigger BEFORE, sem mudança de contrato em RPC pública.

**Critério de sucesso (alinhado à diretriz):** quando a Fase 9 puder ser ativada sem regressão funcional, a migração está concluída — campanhas viraram modificadores de prioridade e o catálogo é o administrador permanente das playlists.

---

## Próximo passo

Aprovar e iniciar **Fase 1** (coluna `origin` + `placement_origin_log` + flags). Sem mudança de comportamento, dá base de evidência para tudo que vem depois.
