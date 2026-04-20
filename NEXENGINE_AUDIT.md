# NexEngine — Auditoria Completa do Sistema
**Data:** 2026-04-20  
**Auditor:** Lovable AI  
**Versão analisada:** branch atual em produção

---

## SUMÁRIO EXECUTIVO

| Métrica | Valor |
|---|---|
| **Score Geral** | **64 / 100** |
| Gêneros cadastrados | 55 |
| Gêneros com dados reais | 2 (funk, k-pop) — **3,6%** |
| Modelos analisados | 43 (40 vazios, 2 reais, 1 parcial) |
| Playlists coletadas | 635 |
| Playlists com seguidores reais | 40 (6,3%) |
| Tracks coletadas | 3.604 |
| Edge functions ativas | 11 |
| Cron jobs configurados | 1 (daily-collect, 03:00 UTC) |

**Veredito:** O sistema tem fundação sólida (DB, auth, edge functions, integração Spotify funcionando), mas a cobertura de dados é mínima. O cron diário está quebrado e existem funções de teste poluindo logs. Com 4-6h de correções P0+P1 o sistema fica 100% utilizável.

---

## PARTE 1 — O QUE EXISTE E FUNCIONA

### 1.1 Banco de Dados (7 tabelas, todas com RLS)

| Tabela | Linhas | Propósito | RLS |
|---|---|---|---|
| `genres` | 55 | Catálogo de gêneros musicais | ✅ team_access |
| `search_terms` | 94 | Termos de busca por gênero | ✅ team_access |
| `search_results` | 635 | Playlists coletadas via Apify | ✅ team_access |
| `search_tracks` | 3.604 | Músicas dentro das playlists | ✅ team_access |
| `genre_models` | 43 | Modelo analítico por gênero | ✅ team_access |
| `collection_logs` | 93 | Auditoria de operações | ✅ team_access |
| `spotify_tokens` | 1 | Cache do token OAuth Spotify | ✅ team_access |

**Função SQL:** `has_team_access()` — `SECURITY DEFINER`, retorna `auth.uid() IS NOT NULL`.  
**Índices:** apenas PKs. **Faltam índices** em `search_results(genre_id) WHERE seguidores IS NULL`, `collection_logs(genre_id, created_at DESC)`, `search_tracks(genre_id)`.

### 1.2 Edge Functions (11)

| Função | Status | Função |
|---|---|---|
| `generate-terms` | ✅ funcional | Gera termos de busca via Lovable AI (Gemini) |
| `run-search` | ✅ funcional (3 erros históricos) | Executa Apify e popula `search_results` + `search_tracks` |
| `collect-batch` | ✅ funcional | Roda múltiplos termos em sequência |
| `enrich-playlists` | ✅ funcional | Spotify Web API → `seguidores` + `total_musicas` reais |
| `analyze-genre` | ✅ funcional | Constrói `genre_models` (palavras-chave, ranking, recorrências) |
| `genre-insights` | ✅ funcional | Insights via LLM (1 execução) |
| `spotify-auth` | ✅ funcional | Client Credentials OAuth, cache em DB |
| `daily-collect` | ❌ **quebrada** | Cron diário — payload incompleto |
| `test-apify` | 🟡 debug | Sandbox manual |
| `test-enrich` | ❌ **quebrada** | Referencia actor `epctex/spotify-scraper` (404) |

### 1.3 Frontend (8 rotas)

| Rota | Página | Status |
|---|---|---|
| `/login` | Login | ✅ |
| `/` | Dashboard (cards + charts) | ✅ |
| `/genres` | CRUD de gêneros | ✅ |
| `/collect` | Painel de coleta + enriquecimento | ✅ |
| `/models` | Lista de modelos | ✅ |
| `/models/:id` | Detalhe (palavras, playlists, tracks, insights) | ✅ |
| `/logs` | Feed de auditoria | 🟡 filtros desatualizados |
| `/settings` | Spotify API + cron + teste | ✅ |

### 1.4 Integrações

- **Apify:** `automation-lab~spotify-scraper` modo `search` (busca) e `urls` (tracks). ✅ funcionando.
- **Spotify Web API:** Client Credentials flow, token cacheado 1h. ✅ funcionando (testado em funk: 40 enriched, max 197k followers).
- **Lovable AI Gateway:** `google/gemini-2.5-flash` para `generate-terms` e `genre-insights`. ✅ funcionando.

### 1.5 Cron Jobs

- `nexengine-daily-collect` — `0 3 * * *` (03:00 UTC diário) → chama `daily-collect`. **❌ quebrada** (ver Parte 3).

---

## PARTE 2 — MAPA DE FLUXO DE DADOS

```
  ┌─────────────────────────┐
  │ /genres → cria gênero   │
  └────────────┬────────────┘
               ▼
  ┌─────────────────────────┐
  │ generate-terms (LLM)    │ → search_terms (94)
  └────────────┬────────────┘
               ▼
  ┌─────────────────────────┐
  │ run-search → Apify      │ → search_results (635)
  │ (modo search)           │ → search_tracks (parcial)
  └────────────┬────────────┘
               ▼
  ┌─────────────────────────┐
  │ enrich-playlists        │ → atualiza seguidores +
  │ (Spotify API + Apify    │   total_musicas + tracks
  │  modo urls)             │
  └────────────┬────────────┘
               ▼
  ┌─────────────────────────┐
  │ analyze-genre           │ → genre_models (43)
  │ (tokenize + ranking)    │
  └────────────┬────────────┘
               ▼
  ┌─────────────────────────┐
  │ /models/:id (frontend)  │
  └─────────────────────────┘
```

### Elos quebrados na cadeia

1. **daily-collect → run-search:** envia apenas `{term_id}`; `run-search` exige `{genre_id, term_id, search_term}`. Cron diário **nunca executou com sucesso**.
2. **analyze-genre antes do enriquecimento:** 41 dos 43 modelos foram gerados com `seguidores=null`, então o ranking "playlists dominantes" desses modelos é fraco/aleatório.
3. **Enriquecimento manual:** sem trigger automático após `run-search`. Operador precisa lembrar de clicar "Enriquecer" em /collect.
4. **k-pop:** 5 playlists coletadas, **0 enriquecidas**, **0 tracks** — modelo gerado prematuramente.

---

## PARTE 3 — O QUE ESTÁ QUEBRADO OU INCOMPLETO

### 🔴 BUG #1 — Cron `daily-collect` não funciona
- **Funciona:** dispara no horário, busca gêneros ativos, chama `analyze-genre`.
- **Não funciona:** chamada a `run-search` falha porque envia `{term_id}` sem `genre_id` nem `search_term`.
- **Por quê:** select original em `daily-collect/index.ts:34` puxa só `id`.
- **Complexidade:** 🟢 **fácil** (5 linhas).

### 🔴 BUG #2 — `test-enrich` quebrada
- **Funciona:** estrutura/CORS.
- **Não funciona:** chama actor `epctex/spotify-scraper` que retorna 404 na Apify.
- **Por quê:** actor não existe (referenciado de plano antigo).
- **Complexidade:** 🟢 **fácil** (deletar a função).

### 🟡 BUG #3 — Stopwords insuficientes em `analyze-genre`
- **Funciona:** tokenização, contagem, top-N.
- **Não funciona:** o nome do próprio gênero domina o ranking. Em funk: top 1 = "funk" (460), top 2 = "2026" (227). Inútil como insight diferenciador.
- **Por quê:** STOPWORDS estática não inclui `genre.nome` nem anos.
- **Complexidade:** 🟢 **fácil** (10 linhas).

### 🟡 BUG #4 — Playlists editoriais Spotify retornam followers=null
- **Funciona:** API responde 200.
- **Não funciona:** playlists `37i9dQZF1...` (algoritmicas/editoriais) têm `followers.total = null` e poluem o ranking aparecendo em posições aleatórias.
- **Por quê:** restrição do Spotify para playlists oficiais.
- **Complexidade:** 🟢 **fácil** (filtrar prefixo).

### 🟡 BUG #5 — 41 modelos vazios "analisados"
- **Funciona:** linhas em `genre_models` existem.
- **Não funciona:** `palavras_chave=[]`, `playlists_dominantes=[]`, `musicas_recorrentes=[]`. Status `analisado` engana o operador.
- **Por quê:** `analyze-genre` foi executado para todos os gêneros sem checar se havia dados de coleta.
- **Complexidade:** 🟡 **média** (validar antes; reverter status para `pendente`).

### 🟡 BUG #6 — Filtros de log desatualizados
- **Funciona:** lista logs.
- **Não funciona:** dropdown de filtros em `/logs` não inclui `enrich-playlists`, `genre-insights`, `daily-collect`, `collect-batch`, `spotify-auth`.
- **Complexidade:** 🟢 **fácil** (uma constante).

### 🟢 INCOMPLETO #7 — Sem re-enriquecimento periódico
- Não há coluna `ultima_enrich` em `search_results`.
- Followers reais ficam congelados na primeira coleta (sem acompanhar crescimento).
- **Complexidade:** 🟡 **média**.

---

## PARTE 4 — FEATURES PLANEJADAS NÃO ENTREGUES

| Feature | Status | Observação |
|---|---|---|
| Spotify API (followers) | ✅ **entregue** | Funciona — testado em funk |
| Track enrichment via automation-lab modo `urls` | ✅ **entregue** | 3.604 tracks salvas |
| Tab Músicas recorrentes | ✅ **entregue** | Funciona em funk; vazia em gêneros sem coleta |
| Ranking por followers | ✅ **entregue** | `analyze-genre` ordena por `seguidores DESC` |
| **Re-enriquecimento periódico** | ❌ não entregue | Falta `ultima_enrich` + lógica no cron |
| **Filtro de playlists editoriais** | ❌ não entregue | Spotify editorial polui rankings |
| **Auto-enrich pós run-search** | ❌ não entregue | Operador precisa clicar manualmente |
| **Bulk collect dos 53 gêneros restantes** | ❌ não entregue | Apenas funk + k-pop coletados |

---

## PARTE 5 — QUALIDADE DOS DADOS

### Cobertura
- **55 gêneros cadastrados** → apenas **2 com dados reais** (funk: 630 playlists; k-pop: 5 playlists). Cobertura: **3,6%**.
- **635 search_results** → **40 com seguidores reais** (6,3%), **595 com `seguidores IS NULL`** (93,7%).
- **3.604 tracks** → 100% concentradas em funk.
- **43 genre_models** → **40 vazios**, 2 com dados reais (funk completo, k-pop parcial).

### Qualidade dos termos
- 94 termos gerados, 33 executados (35%). 61 termos pendentes.

### Qualidade do modelo analítico (funk)
- Top palavras: `funk` (460), `2026` (227), `phonk` (89), `viral` (37), `tiktok` (28).
- ⚠️ Top 1 = nome do gênero (ruído). Top 2 = ano (ruído).
- ✅ Sinais reais aparecem do top 3 em diante (`phonk`, `viral`, `tiktok`, `treino`, `academia`, `baile`).
- 50 músicas recorrentes detectadas (max playlist: 197k seguidores).

### Logs
- 93 logs totais, **5 erros** (5,4%) — taxa saudável.
- Erros: 3× run-search, 1× test-enrich, 1× daily-collect.

---

## PARTE 6 — AVALIAÇÃO DE ARQUITETURA

| Componente | Nota | Justificativa |
|---|---|---|
| **Database design** | 8/10 | Schema normalizado, RLS em tudo, função `has_team_access` correta. **−2:** sem índices de performance, sem FKs declaradas (apesar de aparecerem em types.ts). |
| **Edge function reliability** | 7/10 | 11 funções, CORS correto, logging consistente. **−3:** daily-collect quebrada, test-enrich morta, sem retry policy. |
| **Frontend UX** | 7/10 | Sidebar + páginas funcionais, badges coloridos, modais. **−3:** filtros de log desatualizados, sem feedback de progresso em coletas longas, sem indicador de "modelo vazio". |
| **Data pipeline robustness** | 5/10 | Funciona ponta a ponta para 1 gênero (funk). **−5:** sem orquestração automática, enriquecimento manual, sem dedup, sem auto-rerun de analyze após enrich. |
| **Error handling** | 7/10 | Try/catch em todas funções, status `200` em erros (graceful), log em `collection_logs`. **−3:** sem alertas, sem deadletter, status `analisado` mesmo com 0 dados. |
| **Logging & observability** | 7/10 | Tabela dedicada, duração ms, mensagem, status, ação. **−3:** sem dashboard de erros, filtros desatualizados, sem retenção/rotação. |

**Média ponderada:** 6,8/10 → **68/100** (ajustada para 64 considerando cobertura de dados).

---

## PARTE 7 — ROADMAP PRIORIZADO

### 🔴 P0 — Bloqueadores (fazer hoje)

#### P0.1 — Conserte daily-collect e remova test-enrich
> "Em supabase/functions/daily-collect/index.ts, atualize o select de search_terms para incluir `id, termo, genre_id` e passe `{genre_id: t.genre_id, term_id: t.id, search_term: t.termo}` no body do fetch para run-search. Depois delete a edge function test-enrich (referencia actor inexistente epctex/spotify-scraper). Teste manualmente em /settings → 'Executar coleta agora' e confirme em /logs que aparece `daily-collect: sucesso`."

### 🟠 P1 — Importante (esta semana)

#### P1.1 — Filtre editoriais Spotify e melhore stopwords
> "Em supabase/functions/analyze-genre/index.ts: (1) ao calcular `playlists_dominantes`, exclua URLs que começam com `https://open.spotify.com/playlist/37i9dQZF1` (playlists editoriais que retornam followers=null). (2) Adicione ao Set STOPWORDS o nome do gênero (split em palavras) recebido via `genre.nome` e os anos 2020-2030. (3) Re-rode analyze-genre para todos os 43 modelos existentes via loop em /settings."

#### P1.2 — Auto-enrich e validação pós run-search
> "Após run-search inserir search_results com sucesso, dispare automaticamente enrich-playlists para o genre_id processado (limit=50, fetch_tracks=true). Em seguida dispare analyze-genre. Em analyze-genre, se search_results=0 OU search_tracks=0, NÃO marque genre.status como 'analisado' — mantenha 'pendente' e logue 'sem dados suficientes'."

#### P1.3 — Bulk collect dos 53 gêneros restantes
> "Crie um botão 'Coletar todos os gêneros pendentes' em /collect que itera sobre genres com status='pendente' e chama collect-batch para cada um (rate limit: 1 a cada 30s). Mostre progresso live via realtime na tabela collection_logs."

### 🟡 P2 — Qualidade (próxima semana)

#### P2.1 — Índices de performance + atualização de filtros de log
> "Crie migração com: CREATE INDEX idx_sr_pending_enrich ON search_results(genre_id) WHERE seguidores IS NULL AND spotify_url IS NOT NULL; CREATE INDEX idx_logs_genre_created ON collection_logs(genre_id, created_at DESC); CREATE INDEX idx_st_genre ON search_tracks(genre_id); CREATE INDEX idx_terms_pending ON search_terms(genre_id, executado). Atualize a constante ACTIONS em src/pages/Logs.tsx para incluir: enrich-playlists, genre-insights, daily-collect, collect-batch, spotify-auth, test-apify."

#### P2.2 — Re-enriquecimento periódico
> "Adicione coluna `ultima_enrich timestamptz` em search_results via migração. Em enrich-playlists, atualize esse campo a cada playlist processada. Modifique o select inicial para também incluir playlists com `ultima_enrich < now() - interval '30 days'`. No cron daily-collect, adicione ao final uma chamada a enrich-playlists com limit=100."

### 🟢 P3 — Backlog

#### P3.1 — Dashboard de saúde do sistema
> "Crie um card 'Saúde do Sistema' no /Dashboard mostrando: % de gêneros com modelo válido, % de search_results enriquecidas, taxa de erro últimas 24h, idade média do enriquecimento, tokens Spotify expirados."

#### P3.2 — Comparação entre gêneros
> "Crie /compare que recebe ?genres=funk,sertanejo e mostra side-by-side: top palavras, top artistas, médias de seguidores, sobreposição de tracks."

#### P3.3 — Export de modelos
> "Adicione botão 'Exportar modelo' em /models/:id que baixa JSON+CSV com palavras-chave, playlists dominantes e músicas recorrentes."

---

## PARTE 8 — SCORE FINAL

| Categoria | Peso | Nota | Pontos |
|---|---|---|---|
| Database design | 15% | 8/10 | 12,0 |
| Edge function reliability | 15% | 7/10 | 10,5 |
| Frontend UX | 15% | 7/10 | 10,5 |
| Data pipeline robustness | 20% | 5/10 | 10,0 |
| Error handling | 10% | 7/10 | 7,0 |
| Observability | 10% | 7/10 | 7,0 |
| Cobertura de dados | 15% | 4/10 | 6,0 |
| **TOTAL** | **100%** | — | **64,0 / 100** |

**Interpretação:**
- **0–40:** protótipo, não usável
- **41–60:** funciona em casos isolados
- **61–80:** ✅ **NexEngine está aqui** — usável com correções P0+P1
- **81–95:** produção pronta
- **96–100:** classe mundial

**Caminho para 85+:** entregar P0 (cron) + P1 (auto-enrich + bulk collect 53 gêneros + filtro editoriais).

---
*Relatório gerado automaticamente. Atualize executando nova auditoria após mudanças significativas.*
