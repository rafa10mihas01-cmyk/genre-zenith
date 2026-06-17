# AUDIT PHASE 4.C.2 — BEFORE

Data: 2026-06-17  
Pré-requisito: Fase 4.C.1 concluída (correlation_id, system_alerts, health_probes, crash event).

## Estado inicial

| Recurso | Existe? | Onde |
|---|---|---|
| Dashboard único de observabilidade | ❌ | dados dispersos em SaúdeSistema/AlertasHistorico/AoVivoFeed |
| Busca por correlation_id ponta-a-ponta | ❌ | precisa consulta SQL manual em 9 tabelas |
| Worker de entrega de alertas externos | ❌ | `system_alerts.delivered_at` sempre nulo |
| Suporte a canal email/webhook/slack | parcial | apenas estrutura (colunas) |
| Painel de performance (p50/p95/p99) | ❌ | `bot_events.duration_ms` sem visualização |
| Painel de segurança | ❌ | dados em `*_otps`, `public_token_audit` sem painel |
| RUM frontend | ❌ | erros do navegador desaparecem ao recarregar |
| Busca global | ❌ | sem entrada única por correlation/uuid/worker |
| Ack/resolução manual de alertas | ❌ | colunas existem mas sem UI |

## Métricas baseline

| Métrica | Valor |
|---|---|
| Tempo para localizar incidente | 5–15 min (analista cruza 4+ telas) |
| Tempo para identificar causa | 10–30 min (sem busca por correlation_id na UI) |
| Tempo para abrir chamado | 10 min (operador copia logs manualmente) |
| Tempo para recuperação total (MTTR) | 30–60 min |
| Cobertura alertas externos | 0% (só in-app sino) |
| Erros frontend registrados | 0% |
| Subsystems com painel dedicado | 5/12 |
| Visibilidade real-time | parcial (heartbeat + AoVivoFeed) |

## Pontos cegos confirmados
1. Sem dashboard de observabilidade unificado.
2. Sem worker de entrega de alertas externos.
3. Sem painel de performance (p50/p95/p99).
4. Sem painel de segurança.
5. Sem RUM frontend.
6. Sem busca global (correlation_id / worker / token / playlist).
