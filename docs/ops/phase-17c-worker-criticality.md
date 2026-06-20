# Fase 17-C — Frente 2: Classificação de Criticidade dos Workers Spotify

**Universo:** 26 workers que efetivamente chamaram a Spotify nos últimos 7 dias (apuração via `spotify_call_log`).
**Demais workers** (~180) não consomem a Spotify diretamente e estão fora do escopo desta fase.

## Critério de classificação

| Nível | Definição operacional | Pergunta de teste |
|---|---|---|
| **A — Crítico** | Erro causa dano direto a cliente, finanças ou contrato. Não pode estar desatualizado nem incorreto. | "Se este worker falhar silenciosamente por 24h, algum cliente recebe valor errado, vê dado errado ou recebe fatura errada?" → SIM = A |
| **B — Operacional** | Erro impacta operação interna mas é detectável e re-executável. Sem impacto direto em cliente. | "Falha por 24h gera retrabalho interno mas nada vaza pra fora?" → SIM = B |
| **C — Auxiliar** | Erro é tolerável sem ação imediata. Cache, descoberta, sugestão. | "Falha por uma semana sem ninguém notar?" → SIM = C |

## Tabela de classificação

### Nível A — Crítico (não tolera Gateway CC abaixo de 99.5%)

| Worker | Endpoint(s) usado(s) | Por que é A | Confiab. atual |
|---|---|---|---:|
| `revalidate-deliveries` | `/v1/playlists/:id/items` | Valida se música contratada está na playlist. Erro = cliente vê "entregue" quando não foi, ou vice-versa. Base de cálculo de cumprimento contratual. | 86.8% ❌ |
| `process-catalog-placements` | `/v1/playlists/:id/items` (POST/GET) | Executa a inserção de tracks contratadas. Erro = entrega não acontece. | 99.9% ✅ |
| `sync-managed-playlist-tracks` | `/v1/playlists/:id/items` | Espelho local das tracks reais das playlists managed. Base pra atribuição de plays e dedupe de inserção. | 96.7% ⚠️ |
| `bot-execution-queue` | `/v1/playlists/:id/items` | Fila de execução de jobs em playlists. Erro silencioso = trava de pipeline. | **0.9%** ❌❌ |
| `distribute-catalog-track` | (orquestrador) | Decide quem recebe a música. Decisão errada = entrega errada. | n/d |
| `resolve-catalog-track` | `/v1/tracks/:id` | Resolve a música canônica do catálogo. Erro = catálogo aponta pro track errado. | 100% ✅ |

### Nível B — Operacional (tolera ≥98%, com reconciliação)

| Worker | Endpoint(s) usado(s) | Por que é B | Confiab. atual |
|---|---|---|---:|
| `sync-managed-playlists` | `/v1/playlists/:id` | Atualiza metadados (nome, capa, followers) das playlists managed. Falha = dado interno desatualizado. | 92.9% ⚠️ |
| `spotify-enrichment-worker` | `/v1/tracks/:id`, `/v1/artists/:id` | Enriquece metadados de tracks/artistas. Falha = fica sem gênero/popularity, mas recuperável. | 100% / 88.9% |
| `backfill-curator-playlist-meta` | `/v1/playlists/:id` | Backfill de metadados de playlists de curadores. Reexecutável. | 100% ✅ |
| `backfill-playlist-tracks-count` | `/v1/playlists/:id` | Recontagem. Reexecutável. | n/d |
| `register-curator-playlist` | `/v1/playlists/:id`, `/v1/tracks/:id`, `/items` | Registro novo de playlist. Reexecutável; erro detectável na hora. | 100% / 0% / 0% ❌ |
| `recheck-archived-followers` | `/v1/playlists/:id` | Revisa contagem de followers de playlists arquivadas. | n/d |
| `enrich-client-spotify` | `/v1/playlists/:id`, `/v1/tracks/:id` | Enriquecimento de catálogo do cliente. | n/d |
| `fetch-spotify-meta` | variado | Endpoint genérico de metadados. Usado por jobs assíncronos. | n/d |
| `fetch-tracks-spotify` | `/v1/tracks/:id`, `/v1/playlists/:id` | Fetch sob demanda de tracks; usado por UI e jobs. | n/d |
| `sync-spotify-editorial-charts` | `/v1/tracks/:id` | Sincroniza charts editoriais para inteligência. | 100% ✅ |
| `playlist-tracks-list` | `/v1/playlists/:id/items` | Listagem sob demanda (curadores/admin). | n/d |
| `link-managed-playlist-accounts` | `/api/token` | Vincula conta OAuth a playlist managed. Crítico no momento da vinculação, B porque é setup raro. | 100% ✅ |
| `apply-managed-cover` | `/v1/playlists/:id/images` (PUT) | Atualiza capa. Falha visível e re-tentável. | n/d |
| `diag-observer-extract` | `/v1/playlists/:id/items` | Extração diagnóstica de observação. | 59.5% ⚠️ |

### Nível C — Auxiliar (tolera ≥95%, silent fail aceitável)

| Worker | Endpoint(s) usado(s) | Por que é C | Confiab. atual |
|---|---|---|---:|
| `run-search` | `/v1/search` | Busca sob demanda. Falha = usuário re-tenta. | 100% ✅ |
| `refresh-search-results` | `/v1/playlists/:id` | Refresh de cache de busca. Falha = resultado velho. | 100% ✅ |
| `genre-spotify-discover` | `/v1/search`, `/v1/playlists/:id` | Descoberta de gêneros. Aspirador exploratório. | n/d |
| `bot-collect-queue` | (gerenciamento) | Coleta auxiliar de filas. | n/d |
| `engine-health` | health check | Diagnóstico interno. | n/d |
| `spotify-token-watchdog` | `/api/token` | Watchdog de tokens. Falha = renovação pega depois. | 100% ✅ |

## Resumo por nível

| Nível | Qtde | Workers em estado saudável (≥SLA) | Workers em risco |
|---|---:|---:|---:|
| A (≥99.5%) | 6 | 2 (`process-catalog-placements`, `resolve-catalog-track`) | **4** (`revalidate-deliveries` 86.8%, `sync-managed-playlist-tracks` 96.7%, `bot-execution-queue` 0.9%, `distribute-catalog-track` n/d) |
| B (≥98%) | 15 | poucos comprovados | maioria sem dados ou abaixo do SLA |
| C (≥95%) | 5 | 4 confirmados | 0 |

## Achados estruturais (independentes da matriz)

1. **4 dos 6 workers Nível A estão abaixo do SLA.** Não é problema de migração — é problema operacional ATUAL. `bot-execution-queue` com 0.9% OK precisa de intervenção emergencial; não pode esperar a matriz arquitetural.
2. **`revalidate-deliveries` (Nível A, 86.8% OK)** tem confiabilidade abaixo do mínimo aceitável para o nível, mesmo após o patch da 17-B.5.2. A causa não é mais roteamento (auditoria já confirmou) — é o próprio endpoint `/v1/playlists/:id/items` estar degradado. **Sinaliza que a decisão arquitetural pra este endpoint precisa ser VPS, não OAuth nem CC.**
3. **Nenhum worker Nível A toca `/v1/search`, `/v1/tracks/:id` ou `/v1/artists/:id` puros.** Esses endpoints podem ser movidos pra CC sem risco contratual.
4. **Workers Nível C já estão majoritariamente em endpoints estáveis.** Migração deles é baixa prioridade — não muda o problema.
5. **Workers sem dado no `spotify_call_log` em 7d** (ex: `distribute-catalog-track`, `fetch-spotify-meta`, `apply-managed-cover`) precisam de coleta ativa antes da matriz fechar. Pode ser que estejam dormentes ou que não loguem corretamente.

## Frente 2 — Status

✅ 26 workers classificados.
❌ Falta validar (com o time) a classificação dos workers Nível A — qualquer reclassificação muda a tolerância.
❌ Falta instrumentar workers sem amostra para garantir que `spotify_call_log` cubra 100% das chamadas.
⚠️ **Recomendação fora do escopo da matriz**: `bot-execution-queue` (0.9% OK, Nível A) precisa de intervenção emergencial antes de qualquer outra coisa. Isso não é parte da arquitetura — é falha aguda em produção que a auditoria revelou.
