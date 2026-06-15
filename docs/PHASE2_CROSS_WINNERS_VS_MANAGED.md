# Fase 2 — Cross Winners vs Managed

## Objetivo
Cruzar as tracks observadas em playlists vencedoras (não-gerenciadas) com as
tracks atualmente nas nossas playlists gerenciadas, para gerar recomendações
acionáveis de adição/remoção/manutenção.

## Pré-requisito
≥ 14 dias contínuos de coleta em `observer_playlist_tracks` para estabilizar
o sinal antes de gerar ações.

## Sinais

1. **HOT ausente** — Track aparece em ≥N playlists vencedoras nos últimos 7 dias
   E não está em nenhuma managed playlist do gênero correspondente.
   → Ação: `add`
2. **COLD presente** — Track está em uma managed playlist E desaparece
   continuamente das vencedoras (queda em 14 dias).
   → Ação: `remove`
3. **TRENDING + winner** — Track sobe em `raw_chart_daily` E aparece em
   playlists vencedoras observadas.
   → Ação: `add` (prioridade alta)

## Estrutura

- Nova tabela `playlist_recommendations(track_id, managed_playlist_id, action, score, signals jsonb, created_at, resolved_at, resolved_by)`.
- Edge function `compute-cross-winners` rodando via cron diário 04:00 UTC.
- UI por playlist gerenciada listando recomendações; ação 1-clique enfileira
  no `bot-execution-queue` existente.

## Critérios de aceite
- Recomendação só sai com `score ≥ 0.6`.
- Cada recomendação carrega evidência (lista de playlists onde a track foi vista).
- Operador pode aceitar, rejeitar ou adiar; rejeição alimenta blocklist por 30d.
