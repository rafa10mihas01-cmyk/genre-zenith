# AUDIT — FASE 3.C BEFORE · Snapshots (Responsabilidade Única)

> Auditoria forense. Nenhum DROP / RENAME / migration. Apenas evidência.
> Regra permanente aplicada (`mem://preference/consolidation-rule`):
> **nome ≠ responsabilidade**. Antes de qualquer consolidação,
> identificar a pergunta de negócio que cada estrutura responde.

---

## 1. Universo auditado

Levantamento de TODAS as tabelas do schema `public` cujo nome ou função
sugere "snapshot / captura / estado em um instante". Linhas medidas em
2026-06-17.

| # | Estrutura                       | Linhas hoje | Grão                                              |
|---|---------------------------------|------------:|---------------------------------------------------|
| 1 | `bot_ingest_raw`                | 3.016       | 1 payload bruto recebido pelo Gateway             |
| 2 | `campaign_playlist_collections` | 24.456      | (campaign_id, playlist_id, captured_at)           |
| 3 | `curator_deal_snapshots`        | 1.125       | (deal_id, song_id, playlist_id, captured_at)      |
| 4 | `delivery_proofs`               | 382         | (deal_id, song_id, playlist_id, captured_at)      |
| 5 | `organic_plays_snapshots`       | 249         | (deal_id, song_id, spotify_playlist_id, captured_at, kind) |
| 6 | `campaign_eco_snapshots`        | 2           | (campaign_id, managed_playlist_id, captured_at)   |
| 7 | `observed_playlist_snapshots`   | 3           | (observed_playlist_id, song_id, captured_at)      |
| 8 | `song_snapshots`                | 451         | (catalog_track_id | song_id, captured_at)         |
| 9 | `song_snapshot_playlists`       | 32.453      | filhote 1‑N de `song_snapshots`                   |
|10 | `curator_deal_logs`             | 328         | evento manual/anotação no deal                    |
|11 | `label_spreadsheet_uploads`     | 16          | 1 planilha de gravadora importada                 |
|12 | `playlist_metrics_snapshots`    | 4.993       | (template_id, spotify_playlist_id, collected_at)  |
|13 | `playlist_followers_snapshots`  | 2.464       | (spotify_playlist_id, captured_at)                |
|14 | `playlist_track_snapshots`      | 978         | (spotify_playlist_id, captured_at) + hash top‑50  |
|15 | `playlist_drift_snapshots`      | 0           | (playlist_id, captured_at) genre_mix              |
|16 | `catalog_track_snapshots`       | 0           | (catalog_track_id, snapshot_date) métricas Spotify|
|17 | `catalog_track_baselines`       | 3           | 1ª captura por catalog_track                      |
|18 | `learning_snapshots`            | 298         | (genre_id, snapshot_at) heurísticas               |
|19 | `plan_execution_snapshots`      | 1           | (playlist_id, executed_at) plano vs medido        |

---

## 2. Ficha individual — 19 estruturas

> Para cada uma: pergunta de negócio · responsabilidade exclusiva ·
> escritores · leitores · é fonte de verdade · pode ser derivada ·
> é apenas cache · é apenas histórico · pode desaparecer.

### 2.1 — Eixo COLETA (deal/curator/campanha)

#### `bot_ingest_raw`
- **Pergunta:** "Qual foi o payload exato que o Gateway recebeu?"
- **Responsabilidade exclusiva:** SIM — único log auditável da ingestão (Fase 3.A).
- **Escreve:** `_shared/raw-ingest.ts` chamado por *toda* Edge Function de ingestão
  (`bot-ingest-dom`, `bot-ingest-snapshot`, `extract-snapshot-from-print`,
  `import-label-spreadsheet`, `register-cohort-baseline`).
- **Lê:** `engine-health`, debug humano. Nenhum hook frontend.
- **Fonte de verdade?** SIM, para *auditoria do payload*.
- **Pode ser derivada?** NÃO (é o raw).
- **Apenas cache?** NÃO. **Apenas histórico?** SIM (forense/legal).
- **Pode desaparecer sem quebrar negócio?** NÃO — quebra a regra "todo ingest tem raw" (Fase 3.A).

#### `campaign_playlist_collections`
- **Pergunta:** "Quais playlists foram coletadas para uma campanha, e quanto traziam de plays no instante T?"
- **Responsabilidade exclusiva:** SIM — único produto do **Collection Writer** (Fase 3.A).
- **Escreve:** `_shared/collection-writer.ts` (via RPC `ingest_campaign_collection_batch`). Nenhum outro caminho.
- **Lê:** `ExecucaoView`, `MonitoramentoTab`, `PlaylistHistoryDrawer`,
  `get-curator-deal-public`, `register-curator-playlist`.
- **Fonte de verdade?** SIM para a *grade de coleta da campanha*.
- **Pode ser derivada?** NÃO (cada linha = uma observação real).
- **Apenas cache?** NÃO. **Apenas histórico?** NÃO (é também o estado vigente).
- **Pode desaparecer?** NÃO — Delivery e Portal Cliente leem direto dela.

#### `curator_deal_snapshots`
- **Pergunta:** "Numa data T, quantos plays a música X tinha na playlist Y do deal Z?"
- **Responsabilidade exclusiva:** SIM — pivô do Match Engine (Fase 3.B). Tem
  `match_method`, `batch_id`, `correlation_id`, `is_initial_capture` (baseline do deal).
- **Escreve:** `_shared/ingest-dom.ts`, `bot-ingest-snapshot`,
  `extract-snapshot-from-print`, `import-label-spreadsheet`,
  `register-cohort-baseline`.
- **Lê:** `useCuratorDeals`, `useCuratorDealDetail`, `CampanhaExecucao`,
  `Analytics`, `audit-campaign`, `calculate-*-ecosystem-score`,
  `cleanup-snapshots`, `cron-reconcile-curator-deals`, `curator-deal-followup`,
  `get-client-campaign-public`, `get-curator-deal-public`, `PlaylistTracksTab`.
- **Fonte de verdade?** SIM para *plays por (deal, song, playlist, T)*.
- **Pode ser derivada?** NÃO (cada linha = uma captura real).
- **Apenas histórico?** NÃO — também alimenta o último valor vigente.
- **Pode desaparecer?** NÃO — quebraria Delivery, Financeiro e Cockpit do curador.

#### `delivery_proofs`
- **Pergunta:** "Qual é a *prova auditável* (print + plays) que evidencia a entrega de uma música numa playlist de deal?"
- **Responsabilidade exclusiva:** PARCIAL — mesma chave-de-negócio que
  `curator_deal_snapshots` (deal+song+playlist+captured_at), mas com
  vocação **probatória** (`screenshot_url`, `bot_correlation_id`,
  `position_in_playlist`, `track_name`, `playlist_name` desnormalizados).
  Aparentemente derivado da última captura do snapshot.
- **Escreve:** `bot-ingest-snapshot`, `import-label-spreadsheet`.
- **Lê:** `CampanhaExecucao`, `get-shared-campaign-plan`,
  cards de "provas" no portal cliente.
- **Fonte de verdade?** NÃO — é uma *vista probatória* derivável da última captura
  por (deal,song,playlist).
- **Pode ser derivada?** SIM — de `curator_deal_snapshots` + assets de print.
- **Apenas cache?** Funcionalmente SIM. **Apenas histórico?** NÃO.
- **Pode desaparecer?** SIM, se a vista probatória for reescrita como
  view materializada sobre `curator_deal_snapshots`. **Candidata real à consolidação.**

#### `organic_plays_snapshots`
- **Pergunta:** "Numa data T, quantos plays a música teve fora das playlists do deal (radio/algoritmo) e/ou em playlists *observadas mas não contratadas*?"
- **Responsabilidade exclusiva:** SIM — escopo `kind` (`radio`, `observed`, etc.).
  É o *complemento orgânico* de `curator_deal_snapshots` (que cobre apenas as
  playlists contratadas do deal).
- **Escreve:** `_shared/ingest-dom.ts`, `bot-ingest-snapshot`, `extract-snapshot-from-print`.
- **Lê:** `CampanhaExecucao` (`OrganicCollectedSection`), `get-campaign-roadmap-public`, `get-shared-campaign-plan`.
- **Fonte de verdade?** SIM para *plays orgânicos por (deal, song, T)*.
- **Pode ser derivada?** NÃO (origem distinta).
- **Pode desaparecer?** NÃO — quebraria Roadmap Público e seção "orgânico" do detalhe.

#### `campaign_eco_snapshots`
- **Pergunta:** "Numa data T, quantos plays trouxeram as playlists do **ecossistema interno** (managed) alocadas a uma campanha?"
- **Responsabilidade exclusiva:** SIM — chave por `managed_playlist_id`
  (não por `playlist_id` externo) e janelas 24h/7d/28d agregadas.
- **Escreve:** `_shared/ingest-dom.ts`, `bot-ingest-snapshot`, `extract-snapshot-from-print`.
- **Lê:** `BotCollectionStatus`, `CampanhaExecucao`, `campaignClosurePdf`,
  `get-campaign-roadmap-public`, `get-shared-campaign-plan`.
- **Fonte de verdade?** SIM para *ECO interno por campanha*.
- **Pode ser derivada?** NÃO (granularidade managed‑playlist específica).
- **Pode desaparecer?** NÃO — quebraria PDF de fechamento e Roadmap.

#### `observed_playlist_snapshots`
- **Pergunta:** "Numa data T, quantos plays uma música tinha em uma playlist que apenas *observamos* (não é deal, não é ECO)?"
- **Responsabilidade exclusiva:** PARCIAL — mesma intenção semântica que
  `organic_plays_snapshots(kind='observed')`. Diferença: vincula a
  `observed_playlists` (registro de playlist observada). Apenas **3 linhas**.
- **Escreve:** apenas `_shared/observed-playlist.ts` historicamente; hoje a maior
  parte da ingestão "observed" cai em `organic_plays_snapshots`.
- **Lê:** nenhum hook ativo localizado; tabela quase órfã.
- **Fonte de verdade?** NÃO. **Pode ser derivada?** SIM (de `organic_plays_snapshots`).
- **Pode desaparecer?** PROVAVELMENTE SIM — **candidata real à consolidação** com `organic_plays_snapshots`.

#### `curator_deal_logs`
- **Pergunta:** "Que *evento manual / anotação humana* aconteceu nesse deal?"
- **Responsabilidade exclusiva:** SIM — é log de evento (note + total_plays declarado + prints), não snapshot de plays por playlist.
- **Escreve:** ações manuais do operador.
- **Lê:** `useCuratorDealDetail`, `DealLogDetailDialog`.
- **Fonte de verdade?** SIM para *eventos manuais do deal*.
- **Pode ser derivada?** NÃO.
- **Pode desaparecer?** NÃO — perde-se histórico humano.

#### `label_spreadsheet_uploads` (+ `label_spreadsheet_rows`)
- **Pergunta:** "Que planilha de gravadora foi importada e qual seu conteúdo bruto?"
- **Responsabilidade exclusiva:** SIM — *raw + metadados* da fonte XLSX. As linhas
  são depois normalizadas em `curator_deal_snapshots` + `delivery_proofs`.
- **Escreve:** `import-label-spreadsheet`.
- **Lê:** UI de importação, auditoria de origem.
- **Fonte de verdade?** SIM para *o arquivo recebido*. NÃO para os plays (esses ficam no snapshot).
- **Pode ser derivada?** NÃO. **Pode desaparecer?** NÃO.

---

### 2.2 — Eixo MÚSICA (catálogo, descoberta)

#### `song_snapshots` + `song_snapshot_playlists`
- **Pergunta:** "Para uma música do **catálogo** (não necessariamente em deal), qual foi o total de plays observado num instante T e em quais playlists ela apareceu?"
- **Responsabilidade exclusiva:** SIM — escopo *song-centric / catalog-centric*,
  não deal-centric. Tem `time_window`, `total_plays_28d`, `bot_metadata`,
  e o filho `song_snapshot_playlists` lista TODAS as playlists em que aquela
  música apareceu naquela captura (inclui *fora* dos deals).
- **Escreve:** `bot-ingest-song-snapshot` (dedicado).
- **Lê:** `Catalogo`, `CatalogoMusicaDetalhe`, `useRecentSnapshots`.
- **Fonte de verdade?** SIM para *presença da música no Spotify ao longo do tempo*,
  independente de deal.
- **Pode ser derivada?** NÃO — origem é varredura do `/song` no Spotify, não a tela do curador.
- **Apenas cache?** NÃO. **Apenas histórico?** NÃO (alimenta diagnóstico do catálogo).
- **Pode desaparecer?** NÃO — quebraria o módulo Catálogo.

#### `catalog_track_baselines`
- **Pergunta:** "Qual era o estado da música no Spotify (streams totais, popularity, monthly_listeners) no *exato momento do onboarding do catálogo*?"
- **Responsabilidade exclusiva:** SIM — é a *baseline ZERO* do catálogo (1 linha por música). Comparável ao `is_initial_capture` em `curator_deal_snapshots`, mas no eixo Catálogo, não Deal.
- **Escreve:** onboarding de catálogo.
- **Lê:** comparativos "before/after" de catálogo.
- **Fonte de verdade?** SIM para *baseline de catálogo*.
- **Pode desaparecer?** NÃO.

#### `catalog_track_snapshots`
- **Pergunta:** "Qual o histórico de popularity / monthly_listeners / followers da música no Spotify?"
- **Responsabilidade exclusiva:** SIM em tese, mas **0 linhas hoje**. Tabela
  provisionada para crescimento futuro (telemetria diária Spotify).
- **Escreve:** nenhum cron ativo localizado (vazio).
- **Lê:** nenhum.
- **Fonte de verdade?** Em potencial. **Pode desaparecer?** SIM hoje, sem
  impacto (0 linhas, 0 leitores) — mas tem semântica distinta de
  `catalog_track_baselines` (histórico vs ponto zero). Marcar como
  **legado vazio** para decisão futura, não consolidar com baselines.

---

### 2.3 — Eixo PLAYLIST (catálogo de playlists / observação técnica)

#### `playlist_metrics_snapshots`
- **Pergunta:** "Para um *template* de playlist (curador interno), quais eram seus seguidores/tracks num instante T?"
- **Responsabilidade exclusiva:** SIM — chave por `template_id`. Diferente dos demais.
- **Escreve:** `track-playlist-metrics`.
- **Lê:** módulos de performance/operação.
- **Pode desaparecer?** NÃO.

#### `playlist_followers_snapshots`
- **Pergunta:** "Como evoluíram os seguidores de uma playlist do Spotify (qualquer playlist, externa ou managed)?"
- **Responsabilidade exclusiva:** SIM — escopo *spotify_playlist_id global*, não template.
- **Escreve:** crons de tracking.
- **Lê:** `FollowersTimeline`, gráficos de performance.
- **Pode desaparecer?** NÃO.

> Coexistência com `playlist_metrics_snapshots` é justificada:
> uma é por *template interno*, outra é por *playlist Spotify*. Mesmo
> sinal (followers/tracks) mas eixos distintos.

#### `playlist_track_snapshots`
- **Pergunta:** "A playlist mudou seu top‑50 entre T₀ e T₁?"
- **Responsabilidade exclusiva:** SIM — guarda **hash + IDs** das tracks, não plays.
- **Escreve:** cron `snapshot-playlist-tracks`.
- **Lê:** `compute-trend-velocity`, `compute-leadership`, `learn-from-winners`.
- **Pode desaparecer?** NÃO.

#### `playlist_drift_snapshots`
- **Pergunta:** "Como o gênero dominante da playlist mudou ao longo do tempo?"
- **Responsabilidade exclusiva:** SIM — guarda `genre_mix` (jsonb), não plays.
  **0 linhas hoje**, mas pipeline existe (`snapshot-playlist-mix`).
- **Pode desaparecer?** Não recomendado — semântica única (drift de gênero).

---

### 2.4 — Eixo APRENDIZADO / EXECUÇÃO

#### `learning_snapshots`
- **Pergunta:** "Quais foram os *winners / keywords / artists* aprendidos para um gênero num instante T?"
- **Responsabilidade exclusiva:** SIM — saída do `learn-from-winners`.
- **Escreve:** `learn-from-winners`, `learning-governance`.
- **Lê:** `learning-audit`, `DriftVisualTab`, `Aprendizado`.
- **TTL:** `null` (nunca expira, política em `_shared/snapshot-ttl.ts`).
- **Pode desaparecer?** NÃO — perde-se trilha de aprendizado.

#### `plan_execution_snapshots`
- **Pergunta:** "Para uma execução de plano de playlist, qual era a previsão e qual foi o resultado medido depois?"
- **Responsabilidade exclusiva:** SIM — guarda baseline + projetado + medido + accuracy.
  Estrutura única no schema.
- **Escreve:** `apply-playlist-plan`.
- **Lê:** `evaluate-plan-snapshots`, `useLastPlanResult`, `PlanResultCard`.
- **Pode desaparecer?** NÃO — quebra avaliação de acurácia do motor.

---

## 3. Matriz Final

| # | Estrutura                       | Pergunta de negócio                                    | Responsabilidade               | Fonte oficial?  | Pode consolidar? |
|---|---------------------------------|--------------------------------------------------------|--------------------------------|-----------------|------------------|
| 1 | `bot_ingest_raw`                | "Qual foi o payload bruto?"                            | Auditoria de ingest            | SIM (raw)       | NÃO              |
| 2 | `campaign_playlist_collections` | "Quais playlists, quanto, em T, na campanha?"          | Grade de coleta da campanha    | SIM             | NÃO              |
| 3 | `curator_deal_snapshots`        | "Plays por (deal, song, playlist, T)"                  | Pivô do Match                  | SIM             | NÃO              |
| 4 | `delivery_proofs`               | "Prova auditável da entrega"                           | Vista probatória derivada      | NÃO             | **SIM**          |
| 5 | `organic_plays_snapshots`       | "Plays fora das playlists contratadas"                 | Complemento orgânico           | SIM             | NÃO              |
| 6 | `campaign_eco_snapshots`        | "Plays do ecossistema interno na campanha"             | ECO interno                    | SIM             | NÃO              |
| 7 | `observed_playlist_snapshots`   | "Plays em playlist apenas observada"                   | Sobreposta a `organic(observed)` | NÃO          | **SIM**          |
| 8 | `song_snapshots` (+ filhote)    | "Onde a música apareceu no Spotify em T?"              | Song‑centric                   | SIM             | NÃO              |
| 9 | `curator_deal_logs`             | "Eventos manuais do deal"                              | Log humano                     | SIM             | NÃO              |
|10 | `label_spreadsheet_uploads`     | "Planilha recebida da gravadora"                       | Raw XLSX                       | SIM (raw)       | NÃO              |
|11 | `playlist_metrics_snapshots`    | "Histórico de followers por *template*"                | Template-centric               | SIM             | NÃO              |
|12 | `playlist_followers_snapshots`  | "Histórico de followers por *playlist Spotify*"        | Spotify-centric                | SIM             | NÃO              |
|13 | `playlist_track_snapshots`      | "Top‑50 mudou?"                                        | Tracks-hash                    | SIM             | NÃO              |
|14 | `playlist_drift_snapshots`      | "Gênero dominante mudou?"                              | Drift de gênero                | SIM             | NÃO              |
|15 | `catalog_track_baselines`       | "Ponto zero da música no catálogo"                     | Baseline catálogo              | SIM             | NÃO              |
|16 | `catalog_track_snapshots`       | "Histórico Spotify da música do catálogo"              | Telemetria catálogo            | (vazia)         | NÃO (legado)     |
|17 | `learning_snapshots`            | "Aprendizado do gênero em T"                           | Aprendizado                    | SIM             | NÃO              |
|18 | `plan_execution_snapshots`      | "Previsão × medido do plano de playlist"               | Avaliação de plano             | SIM             | NÃO              |
|19 | `bot_ingest_raw` (já listado)   | —                                                      | —                              | —               | —                |

---

## 4. Classificação por categoria

- **A — Fonte Oficial:**
  `campaign_playlist_collections`, `curator_deal_snapshots`,
  `organic_plays_snapshots`, `campaign_eco_snapshots`,
  `song_snapshots` (+`song_snapshot_playlists`),
  `playlist_metrics_snapshots`, `playlist_followers_snapshots`,
  `playlist_track_snapshots`, `playlist_drift_snapshots`,
  `catalog_track_baselines`, `learning_snapshots`,
  `plan_execution_snapshots`.

- **B — Histórico / Raw auditável:**
  `bot_ingest_raw`, `label_spreadsheet_uploads` (+ `_rows`),
  `curator_deal_logs`.

- **C — Cache puro:** *(nenhuma das auditadas é cache puro — caches
  Spotify vivem em `spotify_*_cache`, fora do escopo desta fase.)*

- **D — Snapshot Operacional (derivado / desnormalizado):**
  `delivery_proofs` (vista probatória de `curator_deal_snapshots`).

- **E — Snapshot Analítico:**
  `learning_snapshots`, `plan_execution_snapshots`,
  `playlist_drift_snapshots`.

- **F — Legado / vazio:**
  `catalog_track_snapshots` (0 linhas, 0 leitores hoje — mas semântica
  distinta de `catalog_track_baselines`; **não** consolidar por nome).
  `observed_playlist_snapshots` (3 linhas, sobreposta a
  `organic_plays_snapshots(kind='observed')`).

---

## 5. Respostas obrigatórias do Auditor

**1) Existem snapshots duplicados?**
SIM — dois casos reais (e apenas dois):
- `delivery_proofs` ⊂ `curator_deal_snapshots` (vista probatória derivável).
- `observed_playlist_snapshots` ⊂ `organic_plays_snapshots(kind='observed')`.

**2) Existem snapshots com responsabilidades diferentes apesar de nomes parecidos?**
SIM — e devem ser **preservados**:
- `playlist_metrics_snapshots` (por *template*) × `playlist_followers_snapshots` (por *spotify_playlist_id*).
- `catalog_track_baselines` (ponto zero) × `catalog_track_snapshots` (série temporal).
- `curator_deal_snapshots` (playlists *contratadas* do deal) × `organic_plays_snapshots` (plays *fora* do deal) × `campaign_eco_snapshots` (managed da campanha) × `song_snapshots` (eixo música/catálogo). **Eixos de negócio distintos — não consolidar.**

**3) Existem snapshots derivados?**
SIM — `delivery_proofs` é derivável da última captura de
`curator_deal_snapshots` por (deal,song,playlist) somada aos prints.

**4) Existem snapshots apenas para histórico?**
SIM — `bot_ingest_raw`, `label_spreadsheet_uploads`/`_rows`,
`curator_deal_logs`, `learning_snapshots`, `plan_execution_snapshots`.

**5) Existem snapshots apenas para cache?**
NÃO entre os auditados. Os caches Spotify (`spotify_*_cache`) estão fora deste escopo.

**6) Existe alguma tabela que parece duplicada mas responde a outra pergunta?**
SIM — três pares clássicos:
- `playlist_metrics_snapshots` ≠ `playlist_followers_snapshots` (template vs spotify_id).
- `catalog_track_baselines` ≠ `catalog_track_snapshots` (ponto zero vs série).
- `song_snapshots` ≠ `curator_deal_snapshots` (catálogo/Spotify vs deal/curador).

Nenhum desses pode ser dropado por similaridade de nome (regra `mem://preference/consolidation-rule`).

**7) Qual deve ser preservada como Fonte Oficial?**
- Coleta de campanha → `campaign_playlist_collections`.
- Pivô do match/deal → `curator_deal_snapshots`.
- Orgânico do deal → `organic_plays_snapshots`.
- ECO da campanha → `campaign_eco_snapshots`.
- Catálogo / música → `song_snapshots` (+ `song_snapshot_playlists`) e `catalog_track_baselines`.
- Playlist Spotify → `playlist_followers_snapshots` + `playlist_track_snapshots`.
- Playlist interna (template) → `playlist_metrics_snapshots`.
- Aprendizado → `learning_snapshots`. Plano → `plan_execution_snapshots`.
- Raw → `bot_ingest_raw`. Planilha → `label_spreadsheet_uploads`.

**8) Quais são candidatas reais à consolidação na próxima fase (3.C.1)?**
Apenas duas — e só após Auditor AFTER provar dependência zero:
1. **`delivery_proofs`** → reescrever como *vista probatória* sobre
   `curator_deal_snapshots` (+ assets de print). Hoje os escritores são apenas
   `bot-ingest-snapshot` e `import-label-spreadsheet`; os leitores
   (`CampanhaExecucao`, `get-shared-campaign-plan`, portal cliente) podem
   passar a consultar a vista derivada.
2. **`observed_playlist_snapshots`** → migrar os poucos casos restantes
   para `organic_plays_snapshots(kind='observed')`, que já é o caminho oficial.
   Tabela tem apenas 3 linhas e nenhum hook ativo.

Nenhuma outra estrutura é candidata. Todas as demais respondem perguntas
de negócio exclusivas.

---

## 6. Próximo passo (proposto, não executado)

`docs/consolidation/AUDIT_PHASE_3C_BEFORE_PLAN_3C1.md` (a abrir só após
aprovação): definir Auditor BEFORE focado nos dois alvos acima
(`delivery_proofs`, `observed_playlist_snapshots`), listar 100% dos
escritores/leitores/RPCs/PDFs que tocam essas duas tabelas, e só então
propor o caminho de consolidação. Nenhum DROP/RENAME nesta fase.
