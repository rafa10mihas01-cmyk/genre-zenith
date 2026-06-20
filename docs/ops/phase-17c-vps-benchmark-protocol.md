# Fase 17-C — Protocolo de Benchmark Comparativo
**Gateway CC × OAuth × VPS**

Status: **Aguardando acesso à VPS para execução.**
Última atualização: 2026-06-20
Responsável: Engenharia / Arquitetura Spotify
Origem: decisão oficial pós-INC-002 (Fase 17-C, item 3 e 4)

---

## 1. Objetivo

Produzir evidência reprodutível, comparável e auditável sobre o comportamento de três componentes de consumo da Spotify Web API — **Gateway Client Credentials (CC)**, **OAuth de usuário** e **VPS proxy** — para alimentar a matriz arquitetural definitiva da Fase 17-C.

O benchmark **não escolhe componentes por preferência**. A decisão arquitetural será derivada exclusivamente das métricas coletadas neste protocolo, cruzadas com a criticidade documentada em `phase-17c-worker-criticality.md`.

---

## 2. Restrições

- **Nenhum endpoint ou credencial de VPS deve ser inventado.** Enquanto o acesso oficial à VPS não estiver disponível, este protocolo permanece como especificação. Execução parcial é proibida.
- Nenhum worker será migrado antes da conclusão deste benchmark e da matriz final.
- A amostra desta fase **não pode ser substituída**. Ampliações são permitidas apenas por adição.

---

## 3. Amostra oficial

A amostra foi definida a partir do incidente INC-002. Apesar da menção a "10 playlists" no plano operacional, a inspeção em `playlist_execution_jobs` confirma que se trata dos **mesmos 5 spotify_playlist_ids** reaparecendo em dois batches distintos de jobs (5 jobs originais cancelados pela mitigação + 5 novos jobs re-spawnados em 2026-06-20 17:27 UTC). Para fins de benchmark, a amostra é **5 playlists distintas, exercitadas com 2 corridas independentes cada (T0 e T1)**, totalizando 10 execuções por componente.

| # | spotify_playlist_id      | Job track (referência) | Histórico INC-002 |
|---|--------------------------|------------------------|-------------------|
| 1 | `3xahW0MZvHpK2afozhqTe3` | `4scixfOOff83kvnCw0TCvq` | 403 reproduzível |
| 2 | `4fxjF1C0lGgRyv4bZsqkvL` | `4scixfOOff83kvnCw0TCvq` | 403 reproduzível |
| 3 | `1dSOLHIW6tauAyBuOxjbIX` | `65aH3l8LEmRp3HuH5XpKoH` | 403 reproduzível |
| 4 | `4G2NKOWwnf7Tabta8Y3H46` | `4scixfOOff83kvnCw0TCvq` | 403 reproduzível |
| 5 | `4ocOKyPe51UAFuqPgmWPMM` | `4scixfOOff83kvnCw0TCvq` | 403 reproduzível (745 attempts) |

Vantagens:
- Já apresentaram falha reproduzível em produção;
- Já possuem histórico de chamadas em `spotify_call_log`;
- Permitem comparar o **mesmo conjunto** entre os três componentes;
- Cobrem managed playlists com diferentes owners.

---

## 4. Endpoints sob teste

Esta tabela define o **escopo do benchmark**. Cada endpoint deve ser exercitado, na mesma amostra, pelos três componentes — exceto quando o componente comprovadamente não suporta a operação, caso em que isso é registrado como evidência negativa.

| Categoria   | Endpoint                                    | Gateway CC | OAuth | VPS |
|-------------|---------------------------------------------|-----------|-------|-----|
| Catálogo    | `GET /v1/tracks/{id}`                       | ✓ | ✓ | ✓ |
| Catálogo    | `GET /v1/tracks?ids=…` (batch)              | ✓ | ✓ | ✓ |
| Catálogo    | `GET /v1/artists/{id}`                      | ✓ | ✓ | ✓ |
| Busca       | `GET /v1/search?q=…&type=…`                 | ✓ | ✓ | ✓ |
| Playlist    | `GET /v1/playlists/{id}` (metadata)         | ✓ | ✓ | ✓ |
| Playlist    | `GET /v1/playlists/{id}/tracks` (paginada)  | ✓ | ✓ | ✓ |
| Playlist    | `GET /v1/playlists/{id}/tracks?fields=…`    | ✓ | ✓ | ✓ |
| Escrita     | `POST /v1/playlists/{id}/tracks`            | — | ✓ | ✓ |
| Escrita     | `DELETE /v1/playlists/{id}/tracks`          | — | ✓ | ✓ |
| Escrita     | `PUT /v1/playlists/{id}/tracks` (reorder)   | — | ✓ | ✓ |

> Operações de escrita usam o `spotify_track_id` da amostra. Em ambiente de benchmark elas **devem ser executadas contra uma playlist sandbox por componente** (a definir no momento da execução) — nunca contra a amostra de produção. O objetivo é medir comportamento de escrita, não modificar playlists reais.

---

## 5. Métricas coletadas

Para cada `(componente, endpoint, playlist, corrida)`:

1. **Taxa de sucesso** — HTTP 2xx / total. Reportada com intervalo de confiança 95% (Wilson).
2. **Latência** — p50, p95, p99 em ms, medidos do início do request até o último byte.
3. **Consistência dos dados** — diff estrutural entre payloads dos três componentes para o mesmo recurso e timestamp ±5min. Campos comparados: `id`, `name`, `tracks.total`, `snapshot_id`, `owner.id`, `public`, `collaborative`. Divergências catalogadas.
4. **Suporte a playlists públicas** — booleano por componente, com classe de erro quando falso.
5. **Suporte a playlists managed** (owner próprio do projeto) — booleano por componente, com classe de erro quando falso.
6. **Suporte a paginação** — capacidade de seguir `next` até o fim sem perda de itens. Validada por contagem reconciliada com `tracks.total`.
7. **Comportamento sob carga** — corrida controlada a 1, 5, 10 RPS por 60s. Coleta-se sucesso, latência p95, e ocorrência de 429 / 5xx.
8. **Comportamento em falhas** — categorização de erros: `401`, `403`, `404`, `429`, `5xx`, `timeout`, `network`. Para cada categoria: contagem, exemplo de payload, header `Retry-After` quando presente.
9. **Custo de quota** — chamadas consumidas por operação completa (relevante para paginação e batch).

Todas as medições devem ser registradas com `timestamp_utc`, `correlation_id`, `component`, `endpoint`, `playlist_id`, `attempt_index`.

---

## 6. Procedimento de execução

Quando o acesso à VPS estiver liberado, executar **na ordem**:

1. **T0 — baseline frio.** Limpar cache local relevante. Executar a matriz endpoint × playlist uma vez por componente, sequencial, 1 RPS. Registrar resultados em `spotify_call_log` com tag `bench=17c-vps T0`.
2. **T1 — repetição.** Aguardar 15 min e repetir o passo 1. Permite separar variância de instabilidade real.
3. **T2 — carga.** Executar perfil de carga (passo 7 da seção 5) por componente, isolado, com 5 min de cooldown entre componentes.
4. **T3 — escrita.** Executar operações de escrita contra playlist sandbox dedicada por componente. CC deve registrar a falha esperada (evidência negativa).
5. **Coleta.** Exportar `spotify_call_log` filtrado por `bench=17c-vps`, gerar o relatório (seção 7).

Cada execução completa deve durar < 60 min e ser repetível sem efeito colateral sobre playlists de produção.

---

## 7. Formato do relatório

Arquivo: `docs/ops/phase-17c-vps-benchmark-results.md` (a criar após execução).

Estrutura mínima:

```
1. Sumário executivo (1 página): vencedor por categoria de dado.
2. Tabela mestre componente × endpoint:
   sucesso% | p50 | p95 | p99 | 429 rate | 5xx rate | consistência
3. Evidências por categoria de falha (com exemplos de payload).
4. Comportamento sob carga (gráficos ou tabela 1/5/10 RPS).
5. Anexos: queries SQL, scripts, raw logs, hashes dos payloads.
6. Recomendação preliminar (não-vinculante) para cada endpoint.
```

O relatório alimenta a matriz arquitetural final, mas **não a substitui** — a matriz é uma decisão separada, tomada com base nestes resultados cruzados com criticidade.

---

## 8. Critérios de aprovação

Um componente é **aprovado para uma categoria de dado** se, na amostra:

| Critério                       | Nível A (crítico) | Nível B (relevante) | Nível C (auxiliar) |
|--------------------------------|-------------------|---------------------|---------------------|
| Taxa de sucesso ≥              | 99,5%             | 98,0%               | 95,0%               |
| p95 latência ≤                 | 800 ms            | 1500 ms             | 3000 ms             |
| Consistência (sem divergência) | obrigatória       | obrigatória         | tolerada com nota   |
| 429 rate ≤                     | 0,5%              | 2%                  | 5%                  |
| 5xx rate ≤                     | 0,1%              | 1%                  | 2%                  |
| Paginação completa             | obrigatória       | obrigatória         | opcional            |

Um componente que **falhar em qualquer critério de Nível A** não pode ser eleito responsável oficial por endpoints que alimentam Nível A, ainda que seja aceitável para B ou C.

---

## 9. Pré-requisitos para execução

Antes de iniciar a execução real, o operador deve confirmar:

- [ ] Acesso à VPS provisionado (host, porta, autenticação documentados em local seguro — fora deste arquivo).
- [ ] Endpoints expostos pela VPS mapeados 1:1 com os da seção 4. Endpoints não suportados devem ser declarados antes da execução.
- [ ] Token OAuth válido para o owner das playlists managed da amostra.
- [ ] Credencial Gateway CC ativa e não bloqueada em `spotify_app_access_blocks`.
- [ ] Playlists sandbox criadas, uma por componente, e seus IDs registrados.
- [ ] `spotify_call_log` aceitando a tag `bench=17c-vps` (sem alteração de schema — uso do campo `metadata`/`correlation_id`).

Nenhum desses pré-requisitos pode ser improvisado durante a execução. Faltando qualquer item, o benchmark é abortado e o estado é registrado.

---

## 10. Pendências conhecidas

- **Acesso à VPS.** Sem isso, somente Gateway CC e OAuth podem ser exercitados — o que invalida a comparação. Aguardar liberação oficial antes de qualquer execução.
- **Guard `max_attempts` (INC-002 residual).** Os 5 novos jobs com `attempts ≥ 5` em `status=claimed` indicam que o guard atual roda apenas no início do worker e não intercepta jobs já claimed por outro tick. Tratar em BUG separado (não bloqueia este protocolo, mas deve ser registrado antes da execução para evitar interferência nas métricas).
- **BUG-003 (`status='manual'` rejeitado pela CHECK constraint).** Não afeta este benchmark, mas deve estar resolvido antes da retomada de migrações.

---

## 11. Encerramento

Este protocolo é considerado **executado** quando:

1. As cinco corridas (T0, T1, T2, T3 e coleta) tiverem sido completadas para os três componentes;
2. O relatório `phase-17c-vps-benchmark-results.md` existir e estiver revisado;
3. Cada endpoint da seção 4 tiver uma recomendação preliminar com evidência;
4. A matriz arquitetural final (`phase-17c-architectural-review.md`) tiver sido atualizada com base nos resultados.

Até lá, **nenhuma nova migração de worker é permitida**.
