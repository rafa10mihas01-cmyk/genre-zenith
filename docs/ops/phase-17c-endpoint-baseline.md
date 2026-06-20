# Fase 17-C — Frente 1: Baseline de Confiabilidade dos Endpoints Spotify

**Janela:** 7 dias rolantes, encerrada em 2026-06-20.
**Fonte:** `spotify_call_log`.
**Total de chamadas registradas:** ~38.000 (após exclusão de `circuit_open` da base de cálculo de confiabilidade).

## Metodologia

- **`circuit_open` é excluído do denominador** de confiabilidade. Não é resposta da Spotify, é auto-proteção do nosso breaker. Conta separadamente como sinal de saúde do sistema.
- **`source = "gateway-cc"`** identifica chamadas via pool Client Credentials. Demais chamadas (label `oauth-or-unknown`) usam OAuth do usuário ou tokens da pool legada — ainda não há tag explícita pra todas.
- **Taxa de sucesso = `2xx / (total - circuit_open)`**. Erros 401/403/404/429/5xx e exceptions contam contra.

## Tabela A — Confiabilidade por endpoint × source (7d)

| Endpoint | Method | Source | OK | 401 | 403 | 404 | Exc | Total | **% OK** |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| `accounts.spotify.com/api/token` | POST | oauth-or-unknown | 3.207 | 0 | 0 | 0 | 0 | 3.217 | **99.69%** |
| `/v1/tracks/:id` | GET | **gateway-cc** | 252 | 0 | 0 | 0 | 0 | 252 | **100.00%** |
| `/v1/tracks/:id` | GET | oauth-or-unknown | 2.914 | 0 | 0 | 0 | 0 | 2.925 | **99.62%** |
| `/v1/artists/:id` | GET | oauth-or-unknown | 2.254 | 0 | 276 | 0 | 0 | 2.530 | **89.09%** ⚠️ |
| `/v1/search` | GET | oauth-or-unknown | 68 | 0 | 0 | 0 | 0 | 68 | **100.00%** |
| `/v1/playlists/:id` | GET | oauth-or-unknown | 796 | 10 | 0 | 34 | 0 | 840 | **94.76%** |
| `/v1/playlists/:id/items` | GET | oauth-or-unknown | 3.882 | 117 | 2.528 | 0 | 0 | 6.527 | **59.48%** ❌ |
| `/v1/playlists/:id/items` | POST | oauth-or-unknown | 877 | 0 | 1 | 0 | 0 | 881 | **99.55%** |
| `/v1/playlists/:id/tracks` | GET | **gateway-cc** | 0 | 0 | 10 | 0 | 4 | 14 | **0.00%** ❌ |
| `/v1/playlists/:id/tracks` | GET | oauth-or-unknown | 0 | 0 | 6 | 0 | 4 | 10 | **0.00%** ❌ |

## Tabela B — Sinais de saúde (circuit_open) por endpoint

| Endpoint | circuit_open events | Interpretação |
|---|---:|---|
| `/v1/playlists/:id/items` | **18.592** | Breaker disparou em massa. Endpoint instável crônico. |
| `/v1/playlists/:id` | 546 | Disparos pontuais. |
| `/v1/tracks/:id` | 159 | Disparos esporádicos. |
| `/v1/search` | 118 | Quase sempre proveniente de runs em rajada. |
| `/v1/artists/:id` | 50 | Disparos esporádicos. |
| `/v1/playlists/:id/images` | 2 | Volume desprezível. |

`circuit_open` em volume alto não é falha da Spotify — é o nosso sistema rejeitando preventivamente após detectar instabilidade. Em `/v1/playlists/:id/items` o volume é tão alto que confirma a tese: o endpoint é o mais frágil de todos.

## Tabela C — Latência (p50/p95) dos endpoints saudáveis

| Endpoint | avg ms | p95 ms |
|---|---:|---:|
| `accounts.spotify.com/api/token` | 106 | 181 |
| `/v1/tracks/:id` | 218 | 358 |
| `/v1/artists/:id` | 201 | 344 |
| `/v1/search` | 889 | 1.149 |
| `/v1/playlists/:id` | 372 | 662 |
| `/v1/playlists/:id/items` (2xx) | 386 | 641 |

Latência é uniforme e aceitável. Não é fator de decisão arquitetural — confiabilidade é.

## Tabela D — Comparação direta CC vs OAuth (mesma janela, mesmo endpoint)

| Endpoint | CC % OK | OAuth % OK | CC viável? |
|---|---:|---:|---|
| `/v1/tracks/:id` | **100.00%** (n=252) | 99.62% (n=2.925) | ✅ Sim, equivalente |
| `/v1/playlists/:id/tracks` | **0.00%** (n=14) | 0.00% (n=10) | ❌ Não — endpoint quebrado em **ambos** os caminhos |
| `/v1/playlists/:id/items` | sem amostra CC | 59.48% (n=6.527) | ⚠️ Não testado em CC; OAuth já é ruim |
| `/v1/playlists/:id` | sem amostra CC | 94.76% (n=840) | ⚠️ Risco conhecido de silent fail (matriz 17-B.6) |
| `/v1/artists/:id` | sem amostra CC | 89.09% (n=2.530) | Hipótese: CC viável (testar) |
| `/v1/search` | sem amostra CC | 100.00% (n=68) | Hipótese: CC viável (testar) |
| `/v1/tracks?ids=` | n/d | n/d | ❌ Conhecido como bloqueado em CC (fase 17-B) |

## Top callers por endpoint (sinal de impacto de blast radius)

| Worker | Endpoint | Calls | % OK |
|---|---|---:|---:|
| `process-catalog-placements` | `/v1/playlists/:id/items` | 20.235 | 99.9% |
| `spotify-token-watchdog` | `/api/token` | 3.008 | 100.0% |
| `spotify-enrichment-worker` | `/v1/tracks/:id` | 2.874 | 100.0% |
| `spotify-enrichment-worker` | `/v1/artists/:id` | 2.547 | 88.9% |
| `bot-execution-queue` | `/v1/playlists/:id/items` | 2.495 | **0.9%** ❌ |
| `revalidate-deliveries` | `/v1/playlists/:id/items` | 1.671 | 86.8% |
| `sync-managed-playlist-tracks` | `/v1/playlists/:id/items` | 1.415 | 96.7% |
| `sync-managed-playlists` | `/v1/playlists/:id` | 783 | 92.9% |
| `refresh-search-results` | `/v1/playlists/:id` | 410 | 100.0% |
| `sync-spotify-editorial-charts` | `/v1/tracks/:id` | 250 | 100.0% |
| `run-search` | `/v1/search` | 95 | 100.0% |

**Observação crítica:** `bot-execution-queue` está sendo censurado pelo breaker (99% das chamadas viram `circuit_open`); quando passa, tem 0.9% OK. É um worker em estado terminal pro caminho que ele tenta usar — precisa de revisão urgente, independente da 17-C.

## Achados estruturais (independentes da matriz)

1. **`/v1/playlists/:id/items` está degradado para todos.** 59% OK no OAuth + 18.592 circuit_open. Não há caminho confiável hoje. Decisão arquitetural não vai resolver — é necessário medir VPS contra esse endpoint antes de qualquer migração de Nível A.
2. **`/v1/playlists/:id/tracks` está 100% quebrado em ambos os caminhos.** Endpoint deve ser oficialmente descontinuado do código — qualquer worker que ainda usa precisa ser refatorado pra `/items` ou VPS.
3. **`/v1/tracks/:id`, `/v1/search` e `/api/token` são estáveis** (≥99.6%). Candidatos sólidos a Gateway CC oficial.
4. **`/v1/artists/:id` tem 11% de 403** concentrados no `spotify-enrichment-worker`. Investigar se são artistas removidos do catálogo (404 mascarado de 403?) ou block real.
5. **CC ainda não foi testado em escala** para `artists`, `search`, `playlists/:id`. A coluna "CC % OK" dessas linhas é hipótese, não evidência.

## Frente 1 — Status

✅ Baseline coletado e tabulado.
❌ Faltam testes controlados de Gateway CC para `/v1/artists/:id`, `/v1/search`, `/v1/playlists/:id` (sem amostra suficiente).
❌ Falta benchmark da VPS para `/v1/playlists/:id/items` e `/v1/playlists/:id` (precisa rodar suite de teste contra a VPS).

Esses três gaps precisam ser fechados antes da matriz oficial poder marcar uma decisão como "Decidido".
