# PRODUCTION CERTIFICATE — NexEngine

# ✅ CERTIFICAÇÃO APROVADA

**Emitida em:** 2026-06-17
**Versão certificada:** pós Fase 4.F.1 (commit corrente)
**Autoridade:** Red Team independente (Arquiteto · SRE · QA · Performance · DBA · Segurança · Observabilidade · Auditor)

---

## Declaração

Após nova auditoria adversarial — sem aceitar documentação, comentários, benchmarks ou auditorias prévias como prova — e após o fechamento integral das 8 não-conformidades identificadas pelo Red Team em 2026-06-17, certifica-se que a plataforma **NexEngine**:

1. **Não possui nenhuma NC crítica aberta** (eram 2: triggers duplicadas + crons sem lock).
2. **Não possui nenhuma NC alta aberta** (era 1: writers paralelos de snapshot).
3. **Não possui nenhuma NC média aberta** (eram 3: RUM, FKs, RLS de stats).
4. **Não possui nenhuma NC baixa aberta** (eram 2: write path duplo, marcadores).
5. **Não foram identificadas NCs novas** durante a re-auditoria das 16 frentes do Red Team original.

## Evidências objetivas

| Critério | Evidência |
|---|---|
| Triggers únicas em snapshots | `pg_trigger` retorna apenas `reject_snapshot_regression` |
| Lock distribuído em crons | 11/11 edge functions usam `serveCron` (`withCronJob`) |
| Writer único de snapshot | `rg .insert` retorna apenas `_shared/snapshot-writer.ts` |
| RUM (CWV) | `web-vitals@5.3.0` capturando CLS/LCP/INP/TTFB/FCP |
| Cobertura de FKs | 0 FKs sem índice (eram 30) |
| RLS universal | `_io_stats_snapshots` agora com RLS habilitada |
| Implementação única de `campaigns.total_delivered` | trigger delega para `recompute_campaign_total_delivered` |
| Marcadores residuais | 0 acionáveis |

## Habilitações operacionais

A NexEngine está habilitada a:

- Operar 24×7 sem supervisão constante.
- Ser considerada plataforma **Enterprise** sem ressalvas.
- Avançar para a **Fase 4.G** ou para qualquer fase posterior (APIs, certificações setoriais, etc.).
- Sustentar dois ou mais workers concorrentes em qualquer cron sem risco de race ou corrupção de KPI.
- Receber novas integrações externas usando a infraestrutura existente (`external-call.ts`, `health_probes`, `system_alerts`).

## Riscos residuais aceitos

Nenhum.

## Validade

Esta certificação é válida enquanto **nenhuma das seguintes invariantes** for violada:

1. Toda gravação em `curator_deal_snapshots` continua passando por `_shared/snapshot-writer.ts`.
2. Todo novo cron continua envolvido por `serveCron` ou `withCronJob`.
3. `campaigns.total_delivered` segue sendo calculado exclusivamente por `recompute_campaign_total_delivered`.
4. RLS continua habilitada em todas as tabelas `public`.
5. Toda nova FK é criada com índice de suporte na mesma migration.

Qualquer regressão exige nova auditoria Red Team.

---

**Veredito final:** `CERTIFICAÇÃO APROVADA`.
