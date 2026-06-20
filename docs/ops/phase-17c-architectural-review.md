# Fase 17-C — Revisão Arquitetural de Acesso à API Spotify

**Status:** Aberta — bloqueia qualquer nova migração de worker.
**Pré-requisitos concluídos:** Fase 17-B.5.2 (revalidate-deliveries estável), Fase 17-B.6 (encerrada e congelada, ver `phase-17b6-closure.md`).

## Pergunta-mestre (decisão obrigatória antes de qualquer novo desenvolvimento)

> **Qual componente é o responsável oficial por cada categoria de endpoint do Spotify?**

Nenhum worker poderá ser criado, migrado ou refatorado sem que sua categoria de endpoint tenha resposta definitiva nesta tabela. Decisões ad hoc estão **proibidas**.

## Matriz de responsabilidade — a ser preenchida e congelada nesta fase

| Categoria de endpoint | Endpoint(s) representativos | Componente oficial | Justificativa | Status atual |
|---|---|---|---|---|
| Leitura de track individual | `GET /v1/tracks/{id}` | **Gateway CC** (proposto) | Estável no CC, sem 403 registrado, baixo custo | A confirmar |
| Leitura de artista individual | `GET /v1/artists/{id}` | **Gateway CC** (proposto) | Estável no CC, sem 403 registrado | A confirmar |
| Busca | `GET /v1/search` | **Gateway CC** (proposto) | Estável no CC, único caminho viável (não há equivalente OAuth útil) | A confirmar |
| Leitura batch de tracks | `GET /v1/tracks?ids=` | **?** | CC retorna 403 (regressão Spotify). Alternativas: N×`/tracks/{id}` via CC, ou batch via VPS | **Decidir** |
| Leitura de metadados de playlist | `GET /v1/playlists/{id}` (com `fields`) | **?** | CC retorna 200 com dados parciais/silencioso para managed (matriz de compatibilidade #2/#3/#5) | **Decidir entre roteamento híbrido (público→CC, managed→OAuth) ou VPS unificada** |
| Leitura de tracks de playlist | `GET /v1/playlists/{id}/tracks` ou `/items` | **?** | CC retorna 403 (regressão recente). OAuth funciona apenas se owner está whitelistado | **Decidir entre VPS ou OAuth (com pool de allowlist saneado)** |
| Operações de escrita em playlist | `POST/PUT/DELETE /v1/playlists/{id}/tracks` | **OAuth** (consolidado) | Exige autenticação do dono; sem alternativa | Já é OAuth |
| Operações de conta do usuário | `/v1/me/*` | **OAuth** (consolidado) | Exige token do usuário | Já é OAuth |
| Catálogos editoriais e descoberta | `/v1/browse/*`, `/v1/recommendations` | **?** | Não testado recentemente | **Decidir** |

## Critérios objetivos para preencher cada linha

Para cada categoria com status "Decidir", a fase deve produzir evidência empírica em 3 dimensões:

1. **Confiabilidade do Gateway CC** — taxa de 403/200 nas últimas 7 dias em `spotify_call_log` para o endpoint exato.
2. **Risco de silent fail** — o endpoint pode retornar 200 com dados incompletos? (consultar `phase-17b6-compatibility-matrix.md`)
3. **Custo operacional** — OAuth exige whitelist manual (ver `INT-001`); VPS exige infra dedicada; CC é o mais barato quando funciona.

Decisão preliminar = quem maximiza (1) e (3) sem violar (2). **A decisão final só é tomada cruzando com a criticidade do dado consumidor (próxima seção).**

## Segunda dimensão obrigatória — Criticidade do dado

A decisão `endpoint → componente` é insuficiente sozinha. O mesmo endpoint pode ser **aceitável** para um consumidor e **inaceitável** para outro, dependendo do que o dado alimenta. Toda migração desta fase em diante deve cruzar a matriz de endpoints com a classificação abaixo.

### Níveis de criticidade

| Nível | Definição | Exemplos de domínio | SLA mínimo de confiabilidade da fonte |
|---|---|---|---|
| **A — Crítico** | Não pode estar errado nem desatualizado. Impacta cliente, financeiro ou compromisso contratual. | Delivery, provas de entrega, validação de campanhas, financeiro, CPC/CPP, snapshots de execução | **≥ 99.5%** + zero risco de silent fail |
| **B — Operacional** | Erros toleráveis se detectáveis e re-executáveis. Impacta operação interna, não cliente direto. | Catálogo, enriquecimento de metadados, métricas agregadas, hidratação de referências, observação de playlists | **≥ 98%** + silent fail aceitável se houver reconciliação |
| **C — Auxiliar** | Erros toleráveis sem ação corretiva imediata. Não impacta decisão de negócio. | Busca, descoberta de gêneros, sugestões, cache, lexicon, prospecção | **≥ 95%**, silent fail tolerado |

### Regra de cruzamento

Para cada worker a ser migrado:

```
componente_oficial = matriz_endpoint[endpoint]
nivel              = criticidade[dado_alimentado]

SE confiabilidade(componente_oficial, endpoint) < SLA_mínimo(nivel):
    componente_oficial é PROIBIDO para este worker
    → escalar para o próximo componente que atende o SLA
SENÃO:
    componente_oficial é AUTORIZADO
```

### Consequência prática

Um endpoint com 98% de confiabilidade no Gateway CC:

- ✅ Autorizado para busca, descoberta, sugestões (Nível C).
- ✅ Autorizado para enriquecimento e métricas (Nível B), com reconciliação.
- ❌ **Proibido** para delivery, provas, financeiro (Nível A) — mesmo que o endpoint esteja "tecnicamente disponível" no CC.

Isso significa que a matriz de endpoints **não tem um único responsável por linha** — tem um responsável *padrão* e exceções obrigatórias quando o consumidor é Nível A.

## Entregáveis desta fase

1. **Matriz de responsabilidade preenchida e congelada** (atualizar este documento, mover linhas de "Decidir" para "Decidido em YYYY-MM-DD").
2. **Classificação de criticidade de todos os workers existentes** (Nível A/B/C), documentada em `phase-17c-worker-criticality.md` (a criar).
3. **Política arquitetural definitiva** substituindo `phase-17b6-architectural-policy.md`, incluindo a regra de cruzamento endpoint × criticidade.
4. **Re-classificação completa de todos os workers** existentes por (categoria de endpoint, nível de criticidade) — saída combinada de #1 e #2.
5. **Plano de execução priorizado** — workers Nível A primeiro (maior risco), depois B, depois C.
6. **Critérios de regressão** — quando uma migração deve ser revertida automaticamente, com limiar diferenciado por nível.

## Regras desta fase

- **Não escrever código de migração.** Só investigação, medição e documentação.
- **Não tomar decisões parciais.** A matriz inteira precisa estar fechada antes de retomar implementação.
- **Toda decisão precisa de evidência numérica** (consultas em `spotify_call_log`, testes controlados em sandbox).
- **Toda migração precisa declarar o nível de criticidade** do dado consumidor antes de escolher o componente.
- **`INT-001` é independente** desta fase — não bloqueia, não acelera.

## Próximo passo concreto

Duas tarefas em paralelo quando a Fase 17-C for oficialmente iniciada:

1. **Dimensão endpoint** — coletar o baseline de 7 dias do `spotify_call_log` agregado por (endpoint, http_status) para alimentar a coluna "Confiabilidade do Gateway CC" da matriz.
2. **Dimensão criticidade** — classificar todos os workers existentes por nível A/B/C em `phase-17c-worker-criticality.md`.

O cruzamento dessas duas saídas é o que produz a decisão arquitetural final.
