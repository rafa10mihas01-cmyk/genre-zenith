# ADR-001 — Exceção Arquitetural: Callbacks OAuth Spotify Pré-Pool

**Status:** Aceito
**Data:** 2026-06-18
**Fases relacionadas:** 9.8A, 10.3A, 10.3A.1, 10.3C, 10.3D

## Contexto

A governança do módulo Spotify (Fase 10.3) determina que **toda chamada à
Spotify Web API após o token estar no pool gerenciado** deve passar
obrigatoriamente pelo helper oficial `spotifyFetch` (`_shared/spotify-client.ts`),
que aplica:

- registro em `spotify_call_log`;
- `spotify_circuit_breaker`;
- atribuição de `appHint` / `app_id`;
- política de retry e observabilidade.

Os três callbacks OAuth abaixo executam **antes** do token entrar no pool:

| Arquivo | Linha | Endpoint |
|---|---|---|
| `supabase/functions/spotify-auth/index.ts` | 316 | `GET /v1/me` |
| `supabase/functions/spotify-public-auth/index.ts` | 181 | `GET /v1/me` |
| `supabase/functions/spotify-invite/index.ts` | 321 | `GET /v1/me` |

Nesses pontos o `access_token` acabou de ser emitido pelo
`code → token exchange` e ainda **não foi persistido** em
`spotify_user_tokens` / `spotify_accounts`. O helper `spotifyFetch` atual
não aceita `bearerToken` arbitrário — ele resolve o token via pool.

## Decisão

Os três callbacks OAuth ficam **oficialmente isentos** da regra de uso
obrigatório do `spotifyFetch`. Eles podem usar `fetch` direto à
Spotify Web API **exclusivamente** para a chamada de identificação
(`/v1/me`) que antecede a persistência do token.

## Restrições

1. A exceção vale **somente** para a chamada `/v1/me` imediatamente
   após o code exchange.
2. Qualquer chamada subsequente naquele mesmo handler (após persistência
   do token) **deve** usar `spotifyFetch`.
3. Nenhuma outra edge function pode invocar `fetch` direto à Spotify
   Web API. Tentativas devem ser rejeitadas em code review.
4. A criação de qualquer nova edge function que precise contornar o
   pipeline exige novo ADR.

## Caminho de evolução (opcional)

Estender `spotifyFetch` para aceitar `bearerToken` explícito como
parâmetro de `SpotifyFetchOptions`. Quando isso for feito, os três
callbacks devem migrar e este ADR pode ser arquivado.

## Consequências

- Hardening do módulo Spotify pode ser certificado como
  **🟡 Concluído com Exceções Documentadas**.
- Os 3 callers acima ficam fora do `spotify_call_log` / breaker — perda
  de observabilidade aceita pela natureza one-shot da chamada.
- Architecture Freeze (10.6) pode prosseguir sem bypass operacional
  pendente.
