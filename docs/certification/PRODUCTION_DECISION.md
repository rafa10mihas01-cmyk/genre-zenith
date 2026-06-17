# PRODUCTION DECISION — Red Team 2026-06-17

## Resultado

# ⚠️ CERTIFICAÇÃO COM RESSALVAS

A NexEngine **NÃO** recebe certificação aprovada. Não recebe certificação negada — a arquitetura central (Match único, Delivery único, Baseline única, segurança de tokens, RLS quase universal) resistiu ao ataque. Mas duas NCs **críticas** e uma **alta** foram comprovadas e contradizem afirmações das Fases 4.C–4.F.

## Critérios

| Critério | Resultado |
|---|---|
| Nenhuma NC crítica | **FALHOU** (2 críticas: NC-001, NC-002) |
| Nenhuma NC alta | **FALHOU** (1 alta: NC-003) |
| NCs médias toleráveis com plano | parcial (NC-004, NC-005, NC-006) |
| NCs baixas documentadas | sim (NC-007, NC-008) |

Pela regra do prompt ("só APROVADA se nenhum crítico ou alto"), o resultado obrigatório é **NEGADA** ou **PARCIAL**. Optamos por **COM RESSALVAS** porque:
- Os defeitos críticos são pontuais e corrigíveis em ≤ 1 sprint.
- Nenhum compromete dados já gravados.
- A plataforma pode operar em produção desde que sejam aceitos os riscos abaixo até o fechamento das NCs.

## Riscos aceitos enquanto NCs não fecham

1. **NC-002:** scheduler não deve disparar dois jobs simultâneos do mesmo cron (intervalos atuais cobrem). Operar com monitor manual de `cron_health` até migração para `withCronJob`.
2. **NC-001:** custo extra de validação em cada INSERT de snapshot — aceitável no volume atual.
3. **NC-003:** congelar contrato do payload de `curator_deal_snapshots` até o writer único existir.

## Bloqueios para certificação APROVADA

Para virar `APROVADA`, são obrigatórias, **nesta ordem**:

1. NC-001 — remover trigger duplicada.
2. NC-002 — migrar 9/9 crons para `withCronJob`.
3. NC-003 — extrair `_shared/snapshot-writer.ts`.
4. NC-006 — RLS em `_io_stats_snapshots`.
5. NC-004 — implementar RUM real.
6. NC-005 — índices nas 20 FKs.

Estimativa: 1 sprint focada.

## Conclusão

A tentativa ativa de quebrar a plataforma identificou **duas não-conformidades críticas, uma alta e três médias**, todas reproduzíveis. A NexEngine pode operar em produção **com supervisão**, mas **não pode ser declarada Enterprise sem ressalvas** até o fechamento das NCs listadas.

**Veredito final:** `CERTIFICAÇÃO COM RESSALVAS`.
