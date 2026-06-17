# AUDIT — Phase 4.D (BEFORE)

Data: 2026-06-17 · Escopo: hardening de integrações externas.

## Inventário das integrações externas

| # | Integração | Vendor | Consumidores | Frequência | Timeout | Retry | Breaker | Rate-limit | Cache | Fallback |
|---|-----------|--------|--------------|-----------|---------|-------|---------|-----------|-------|----------|
| 1 | Spotify Web API | Spotify | `_shared/spotify-client.ts`, search-*, playlist-* | Alto | ✅ (oficial) | ✅ exp | ✅ oficial (`spotify_circuit_breaker`) | ✅ multi-app rotation | ✅ (3 caches) | Multi-app rotation; queue persistente |
| 2 | Spotify for Artists (scraping) | Spotify | bot worker (VPS) | Médio | ⚠️ ad-hoc | ⚠️ ad-hoc | ❌ | ⚠️ sequencial | Parcial | Fila local |
| 3 | Browserless / Playwright | Self-host | bot worker | Alto | ⚠️ ad-hoc | ⚠️ ad-hoc | ❌ | ⚠️ ad-hoc | n/a | manual-fallback.ts |
| 4 | OCR worker | Interno | bot worker | Alto | ⚠️ | ⚠️ | ❌ | Fila interna | ✅ `ai_print_cache` | Reenfileira |
| 5 | SMTP transacional | Provedor | send-email edges, ops-alerts | Médio | ⚠️ | ⚠️ | ❌ | ⚠️ | ✅ `email_send_state` | Slack/webhook |
| 6 | Supabase REST | Supabase | tudo | Crítico | Cliente SDK | SDK | ❌ | Plano | RQ frontend | Modo degradado |
| 7 | Supabase Storage | Supabase | uploads | Médio | ⚠️ | ⚠️ | ❌ | Plano | URL TTL 1h | Fila local |
| 8 | Supabase Auth | Supabase | login | Alto | SDK | SDK | ❌ | Plano | JWT cache | Portal público (OTP/token) |
| 9 | OpenAI / Lovable AI | Gateway | `ai_service.ts` | Médio | ⚠️ | ⚠️ | ❌ | `ai_quota_user` | ✅ `ai_print_cache` | Heurística rule-based |
| 10 | Kworb (scraping) | Kworb.net | cron diário | Baixo | ⚠️ | ⚠️ | ❌ | 1 req/3s | snapshot 24h | Skip ciclo |
| 11 | Webhooks (Slack/email) | Saída ops | deliver-system-alerts-cron | Médio | ✅ (4.C.2) | ✅ 5x | ❌ | Respeita 429 | n/a | DLQ + canal alternativo |

**Total auditado: 11 integrações.**

## Gaps identificados

- **Timeout:** 6 integrações com timeout ad-hoc (ou inexistente fora do SDK).
- **Retry padronizado:** 7 integrações sem política unificada de backoff+jitter.
- **Circuit breaker:** apenas Spotify possui breaker oficial; 10 integrações sem proteção.
- **Rate-limit:** apenas Spotify e webhooks tratam 429 explicitamente.
- **Health probe:** apenas Spotify+SMTP cobertos antes desta fase (Fase 4.C.3 adicionou SMTP).
- **Fallback documentado:** parcial; sem registro central.

## Decisão

Implementar camada única `_shared/external-call.ts` + registry `_shared/integration-registry.ts` + cron `external-health-probes-cron` cobrindo Spotify, Browserless, OCR, OpenAI, Kworb, Storage, Supabase REST.

**ADITIVO**: nenhuma alteração em Gateway, Match, Writer, Delivery, Baseline, CollectionRow, contratos do BOT. Clientes Spotify existentes mantêm breaker oficial — `external-call` é usado para NOVAS chamadas e wrappers leves.
