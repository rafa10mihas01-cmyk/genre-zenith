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

Decisão = quem maximiza (1) e (3) sem violar (2).

## Entregáveis desta fase

1. **Matriz de responsabilidade preenchida e congelada** (atualizar este documento, mover linhas de "Decidir" para "Decidido em YYYY-MM-DD").
2. **Política arquitetural definitiva** substituindo `phase-17b6-architectural-policy.md`.
3. **Re-classificação completa de todos os workers** existentes (não só os 4 de Onda 1) por categoria de endpoint que utilizam.
4. **Plano de execução priorizado** — quais workers migram primeiro com base na matriz definitiva (não mais na hipótese cc-only).
5. **Critérios de regressão** — quando uma migração deve ser revertida automaticamente.

## Regras desta fase

- **Não escrever código de migração.** Só investigação, medição e documentação.
- **Não tomar decisões parciais.** A matriz inteira precisa estar fechada antes de retomar implementação.
- **Toda decisão precisa de evidência numérica** (consultas em `spotify_call_log`, testes controlados em sandbox).
- **`INT-001` é independente** desta fase — não bloqueia, não acelera.

## Próximo passo concreto

Coletar o baseline de 7 dias do `spotify_call_log` agregado por (endpoint, http_status), para alimentar a coluna "Confiabilidade do Gateway CC" da matriz. Esta é a primeira tarefa quando a Fase 17-C for oficialmente iniciada.
