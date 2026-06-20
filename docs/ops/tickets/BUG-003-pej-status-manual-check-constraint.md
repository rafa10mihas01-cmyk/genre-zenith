# BUG-003 — `playlist_execution_jobs.status='manual'` viola CHECK constraint

**Tipo:** Bug estrutural (não-arquitetural)  
**Origem:** Investigação do INC-002  
**Severidade:** Média (contribuiu para loop infinito)  
**Status:** Aberto

## Descrição
O worker `bot-execution-queue` (e possivelmente outros pontos) tenta atualizar `playlist_execution_jobs.status = 'manual'` quando decide encaminhar um job para `manual_distribution_queue`. A constraint atual só aceita:

```
status IN ('pending', 'claimed', 'done', 'failed', 'cancelled')
```

A atualização falha silenciosamente (o erro é engolido pelo Supabase client em alguns paths), e o job permanece em `claimed`, alimentando o recovery sweep.

## Locais afetados
- `supabase/functions/bot-execution-queue/index.ts` — buscar `status: "manual"` e revisar tratamento.
- Outros workers que escrevem em `playlist_execution_jobs` (auditar).

## Opções de correção
1. **Adicionar `'manual'` ao CHECK constraint** (migration) — mantém semântica.
2. **Trocar `'manual'` por `'cancelled'`** no código (já é o padrão da mitigação INC-002) — mais simples, sem migração.

**Recomendação:** opção 2. `cancelled` + insert em `manual_distribution_queue` é suficiente para encerrar o ciclo de vida do job no worker automático, e o estado canônico passa a viver na fila manual.

## Critério de fechamento
- Nenhuma tentativa de update para `status='manual'` no codebase.
- Teste unitário ou integração que cubra o fluxo de roteamento para manual.

## Relação com Fase 17-C
**Independente.** Este bug é tratado fora da revisão arquitetural Spotify.
