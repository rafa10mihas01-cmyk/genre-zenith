# AUDIT — Phase 4.C.3 (BEFORE)

Data: 2026-06-17 · Escopo: refinamento final da observabilidade.

## Estado pré-implementação

| Eixo | Cobertura | Gap residual |
|------|-----------|--------------|
| RUM básico | `client_error_log` captura `message/stack/url/release/correlation_id` | Falta breadcrumbs, rota anterior/atual, ação do usuário, componente React, viewport, sessão, commit |
| Source maps | Não publicados | Stacks minificados ilegíveis em produção |
| Auditoria de mutações | Apenas tabelas pontuais (`spotify_oauth_audit`, `public_token_audit`, `oauth-audit`) | Sem `audit_log` genérico em tabelas críticas (curator_deals, campaigns, clients, curators, curator_deal_songs, system_alerts, system_flags) |
| SMTP health | Sem probe periódico | Falhas só percebidas após reclamação |
| Dashboard histórico | Apenas snapshot 6h em memória | Sem séries 24h/7d/30d persistidas |
| Crons | `cron_health` registra última execução, mas sem duração/erro/retries padronizados | Painel de crons inexistente |
| Runbooks | Ausentes | Operador depende de tribal knowledge |

## Pontos cegos identificados (7)

1. Erros JS chegam sem contexto de navegação → triagem demora.
2. Stack trace ofuscado → impossível mapear para arquivo-fonte.
3. Mutação manual em `curator_deals` não deixa rastro de "quem/quando/o que mudou".
4. SMTP pode estar fora do ar por horas até alguém testar envio.
5. Dashboard de Performance só mostra "agora" — sem comparativo histórico.
6. Crons que falham silenciosamente não geram alerta automático.
7. Alertas críticos chegam sem procedimento padronizado de resposta.

## Decisão

Implementar 7 itens com abordagem ADITIVA (sem alterar Gateway/Match/Writer/Delivery/Baseline/CollectionRow/Fluxo BOT/contratos públicos).
