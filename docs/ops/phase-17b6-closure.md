# Fase 17-B.6 — Encerramento oficial da investigação

**Data:** 2026-06-20
**Status:** **CONGELADA** (não cancelada). Nenhuma migração adicional será executada até a conclusão da revisão arquitetural (Fase 17-C, ver `phase-17c-architectural-review.md`).

## O que foi investigado

1. Pré-trabalho: matriz de compatibilidade Gateway CC × endpoints de playlists (`phase-17b6-compatibility-matrix.md`).
2. Política arquitetural preliminar (`phase-17b6-architectural-policy.md`).
3. Classificação inicial dos 4 workers candidatos a "cc-only" (`phase-17b6-worker-classification.md`).
4. Re-auditoria completa após descoberta de premissa incorreta: **nenhum dos 4 workers é cc-only**; todos leem `/playlists/{id}` direta ou indiretamente.
5. Tentativa de migração híbrida do `fetch-tracks-spotify` → bloqueada pela descoberta de que `/v1/playlists/{id}/tracks` agora retorna 403 no Gateway CC.
6. Auditoria de impacto do `revalidate-deliveries` em produção.
7. Investigação do suposto bug de lookup `managed_playlists`.

## Conclusões oficiais

### Sobre o roteamento do `revalidate-deliveries`

- O lookup `managed_playlists` está **correto**. Os formatos de `spotify_playlist_id` batem entre `managed_playlists` e `playlist_execution_jobs` (ambos IDs puros, sem URL).
- O patch da Fase 17-B.5.2 está **ativo e funcionando**. Após a propagação do deploy (~16:28 UTC de 2026-06-20), 100% das chamadas a playlists managed passaram a usar OAuth (`meta.operation = "managed_read"`).
- Os 4 HTTP 403 em `gateway-cc` registrados entre 15:13 e 16:00 UTC eram **resíduo pré-deploy**, não erro de roteamento.
- **Não há mais evidências de erro de roteamento no `revalidate-deliveries`.**

### Sobre a estratégia geral da Fase 17-B.6

- A hipótese original (existe uma "Onda 1 cc-only") foi **refutada empiricamente**.
- O Gateway CC está sendo progressivamente restringido pela Spotify (`/v1/tracks?ids=` e agora `/v1/playlists/{id}/tracks` retornam 403). A direção da migração foi invertida pela realidade: ao invés de mover workers *para* o CC, o desafio passa a ser decidir *o que ainda pode permanecer* no CC.

### Itens residuais (rastreados separadamente)

- `INT-001` — SPOTIFY_APP_USER_NOT_WHITELISTED (configuração de app no Spotify Dashboard, fora do escopo de migração).
- Janela móvel de 24h do painel `gateway-cc-health-panel.sql` ainda exibirá os 403 históricos até ~2026-06-21 16:00 UTC. Após isso, painel deve voltar a GREEN naturalmente.

## Estado dos workers (congelado até a revisão arquitetural)

| Worker | Estado atual | Próxima ação |
|---|---|---|
| `revalidate-deliveries` | Híbrido §2.3 em produção, validado | Nenhuma — manter |
| `fetch-tracks-spotify` | Híbrido §2.3 deployado mas **quebrado** (CC retorna 403 em `/tracks`) | Decisão na Fase 17-C: reverter para OAuth puro, ou rotear público → VPS |
| `refresh-search-results` | OAuth (não migrado) | Aguardar Fase 17-C |
| `hydrate-genre-reference-tracks` | OAuth (não migrado) | Aguardar Fase 17-C |
| `genre-spotify-discover` | Já em CC (pré-existente, sem regressão atual) | Avaliar hardening na Fase 17-C |

## Próximo passo

Abrir Fase 17-C — Revisão Arquitetural (ver `phase-17c-architectural-review.md`).
