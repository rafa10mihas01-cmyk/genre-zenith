# Genre Brain — Plano de Implementação

Vou organizar os 12 blocos que você mandou em **6 fases sequenciais**, do alicerce até a inteligência cultural. Cada fase é entregável sozinha (gera valor imediato) e prepara a próxima. Nada de Spotify como verdade — Spotify vira só "sinal secundário".

---

## Princípio guia (vale pra todas as fases)

- **Fonte de verdade = comportamento do ecossistema NexEngine** (tracks recorrentes, playlists similares, performance real, SEO, estética).
- **Spotify = 1 sinal entre vários**, com peso pequeno (~10–15%).
- **Tudo ponderado por recência** (peso temporal já entra na Fase 1 como função utilitária reutilizável).
- **Nada destrutivo**: `genre_id` atual continua existindo como "primary genre" durante toda a migração. As novas tabelas convivem.

---

## FASE 1 — Fundação: Confidence + Peso Temporal
*Sem isso, nada do resto funciona.*

Cobre os blocos: **1 (Genre Confidence)** e **8 (Peso Temporal)**.

**Entregas:**
- Nova tabela `playlist_genres` (playlist_id, genre_id, confidence 0–1, source, evidence jsonb, updated_at). UNIQUE(playlist_id, genre_id).
- Função utilitária `recencyWeight(date)` em `_shared/` — curva: 30d=1.0, 90d=0.7, 180d=0.45, 365d=0.2, >365=0.05. Reusada por TODAS as fases seguintes.
- Edge function `genre-confidence-calc` que computa confidence multi-gênero por playlist a partir de:
  - search_terms que descobriram a playlist
  - tracks recorrentes (com peso temporal)
  - artistas dominantes
  - SEO do título
- Migração de dados: para cada playlist com `genre_id` atual, cria linha em `playlist_genres` com confidence inicial calculada.
- Painel admin em `/sistema?tab=aprendizado` mostrando "confidence por playlist" pra QA visual.

**Por que primeiro:** todas as fases seguintes leem `playlist_genres.confidence` em vez de `playlists.genre_id`.

---

## FASE 2 — Subgêneros + Search Terms Vivos
*Granularidade real do mercado BR.*

Cobre os blocos: **2 (Subgêneros)**, **4 (Search Terms Vivos)**, **5 (Score do Termo)**.

**Entregas:**
- Tabela `subgenres` (id, parent_genre_id, slug, nome, palavras-chave, ativo). Seed inicial: funk → mandelão, consciente, automotivo, putaria, rave, paulista, viral, trap-funk. Mesmo pra sertanejo, piseiro, trap, pagode, forró, agro, pop BR.
- Extensão de `search_terms`: adicionar `subgenre_id`, `trend_score`, `search_velocity`, `growth_rate`, `quality_score`, `last_evaluated_at`, `status` (emergente/ativo/saturado/morto).
- Edge function `search-terms-evaluator` (cron diário): pra cada termo, recalcula score com base em
  - nº de playlists válidas encontradas nos últimos 30d
  - follower médio dessas playlists
  - atividade (snapshots recentes)
  - recorrência útil das tracks
  - performance de campanhas no nicho
- Pruning automático: termos com `quality_score < threshold` por 30 dias → `status=morto` (não entram em novas coletas, mas histórico preserva).
- `generate-terms` (que já existe) ganha consciência de subgênero ao gerar novos termos via AI.

---

## FASE 3 — Clusterização + Playlists Líderes
*O ecossistema começa a se enxergar.*

Cobre os blocos: **6 (Clusters)** e **9 (Playlists Líderes)**.

**Entregas:**
- Tabela `playlist_clusters` (cluster_id, subgenre_id, strength, sample_size, centroid jsonb).
- Tabela `playlist_cluster_members` (playlist_id, cluster_id, similarity, joined_at).
- Edge function `cluster-playlists` (cron semanal): clusteriza por similaridade de
  - artistas em comum (Jaccard)
  - tracks em comum (Jaccard)
  - SEO do título (n-grams)
  - faixa de seguidores
- Tabela `playlist_leadership` (playlist_id, leadership_score, follower_rank, growth_rank, activity_rank, calculated_at).
- Edge function `compute-leadership` que combina followers + crescimento recente + presença em benchmarks + qualidade editorial.
- Líderes ganham peso 2x nas Fases 4–6.

---

## FASE 4 — Reclassificação + Drift Cultural
*A playlist deixa de ser "estática".*

Cobre o bloco: **3 (Reclassificação Automática)**.

**Entregas:**
- Campos novos em `playlist_genres`: `previous_confidence`, `drift_score`, `migration_score`, `trend_shift`.
- Edge function `detect-genre-drift` (cron semanal): compara confidence atual vs 30d atrás. Quando drift > threshold:
  - reclassifica primary genre (atualiza `playlists.genre_id`)
  - emite sinal em `playlist_brain.signals` ("migrou de trap → funk viral, 80% das adds recentes")
  - registra em `playlist_genre_history` (audit trail)
- Detector cruza 4 sinais: mudança de repertório, mudança de SEO no título, mudança visual (capa nova → cores novas), mudança de artistas recorrentes.

---

## FASE 5 — SEO Semântico + Estética do Nicho
*Genre Brain começa a "ver" e "falar" como o nicho.*

Cobre os blocos: **10 (SEO Semântico)** e **11 (Estética)**.

**Entregas:**
- Tabela `genre_seo_lexicon` (subgenre_id, token, type [palavra/emoji/estrutura/numero], strength, status [forte/morto/viral], last_seen). Alimentada por análise dos títulos das playlists líderes do nicho com peso temporal.
- Tabela `genre_visual_signature` (subgenre_id, dominant_colors jsonb, contrast_avg, has_face_pct, style_tags, aggressiveness_score, sample_size, calculated_at). Alimentada por análise das capas das playlists líderes (palette extraction + classificação via Lovable AI vision).
- Edge function `learn-genre-lexicon` (cron semanal).
- Edge function `learn-genre-aesthetics` (cron semanal).
- Tudo refeito a cada ciclo com peso temporal — o lexicon de hoje ≠ lexicon de 6 meses atrás.
- Integração: `diagnose-managed-playlist` passa a usar lexicon pra sugerir SEO, e a curadoria visual (refactor anterior) passa a usar a visual signature como filtro de "aderência estética".

---

## FASE 6 — Genre Brain Central
*A camada que une tudo.*

Cobre o bloco: **7 (Genre Brain)** e fecha o **12 (objetivo final)**.

**Entregas:**
- Tabela `genre_brain` (1 linha por subgenre):
  - playlists_dominantes (top N por leadership)
  - artistas_dominantes (top N com peso temporal)
  - tracks_dominantes (top N com peso temporal)
  - estetica (FK pra `genre_visual_signature`)
  - seo (FK pra `genre_seo_lexicon`)
  - cluster_principal_id
  - sazonalidade (jsonb, padrões mensais)
  - growth_curve (jsonb, snapshot followers totais do nicho)
  - status (emergente/crescendo/estável/declinando/morto)
  - confidence_score
  - last_calculated_at
- Edge function `genre-brain-calc` (cron diário): roda em batch pra todos os subgêneros ativos, agrega resultados das Fases 1–5.
- Página nova em `/sistema` ou aba dentro de `/curadores`: **"Genre Brain"** — dashboard ao vivo mostrando, por subgênero: status, top playlists/artistas/tracks AGORA, paleta dominante, lexicon SEO ativo, curva de crescimento. UI seguindo PageHeader + design system.
- API interna que outros módulos (cockpit, diagnose, recomendações de capa, campaign engine) podem consultar pra perguntar: *"como é o nicho HOJE?"*

---

## Detalhes técnicos transversais

- **Tudo via Lovable Cloud** (Supabase). RLS em todas as tabelas novas com `has_role(auth.uid(), 'admin')` ou `team_access` conforme o caso.
- **Crons** novos: `search-terms-evaluator` (diário), `cluster-playlists` (semanal), `compute-leadership` (diário), `detect-genre-drift` (semanal), `learn-genre-lexicon` (semanal), `learn-genre-aesthetics` (semanal), `genre-brain-calc` (diário).
- **AI**: Fases 5–6 usam Lovable AI Gateway (`google/gemini-3-flash-preview` pra texto, `google/gemini-2.5-flash` pra vision em capas).
- **Backward compatibility**: `playlists.genre_id` continua existindo como "primary" e é atualizado pela Fase 4. Nenhum código antigo quebra.
- **Observabilidade**: cada cron loga em tabela `engine_runs` (que já existe no padrão do projeto) com nº processado, erros, duração.

---

## Ordem sugerida de execução

```text
Fase 1 (Fundação)        → 1 sprint
Fase 2 (Subgêneros+Terms) → 1 sprint
Fase 3 (Clusters+Líderes) → 1 sprint
Fase 4 (Drift)            → 0.5 sprint
Fase 5 (SEO+Estética)     → 1 sprint
Fase 6 (Genre Brain)      → 1 sprint
```

Total: **~5.5 sprints**. Cada fase ship-able sozinha, sem big bang.

---

**Confirma esse desenho e a ordem das 6 fases?** Se sim, começo pela Fase 1 (Fundação) — tabela `playlist_genres` + função de peso temporal + edge function de confidence. Se quiser ajustar ordem, escopo de alguma fase, ou cortar/fundir blocos, me diz antes de eu começar a codar.