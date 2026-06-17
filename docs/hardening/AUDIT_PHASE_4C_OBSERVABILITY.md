# AUDIT PHASE 4.C — Hardening de Observabilidade

Data: 2026-06-17  
Tipo: **Auditoria forense — sem alterações.**  
Pergunta-norte: *"Se qualquer coisa quebrar agora, conseguimos descobrir em menos de 5 minutos?"*

> **Resposta resumida:** Para 70% dos incidentes, **SIM** (<5 min via `/sistema` + `bot_events`). Para 30% (gateway/parser/match silenciosos, OCR travado, cron parado sem heartbeat, frontend), **NÃO** — falta correlation_id ponta-a-ponta, falta dashboard de latência por estágio e faltam alertas push.

---

## 1. LOGS — Inventário

| Fonte | Tabela / canal | Rows hoje | Quem grava | Quem consulta | Padrão | Correlation | Classif. |
|---|---|---|---|---|---|---|---|
| Eventos BOT | `bot_events` (20 cols) | 25.423 (106/24h) | edge `bot-event-ingest`, workers | `/sistema` AoVivoFeed, AlertasHistorico | ✅ schema fixo (step/status/duration_ms/metadata) | ✅ coluna `correlation_id` | 🟢 |
| Heartbeat BOT | `bot_heartbeats` (26 cols) | 70.881 | edge `bot-heartbeat` | `BotSaudeCard`, `useLatestBotHeartbeat` | ✅ | ✅ `processing_correlation_ids[]` | 🟢 |
| Ingest bruto | `bot_ingest_raw` (20 cols) | 3.038 | `_shared/raw-ingest.ts` | debug / replay | ✅ | ✅ extraído via `pickField` | 🟢 |
| Coleta | `collection_logs` | 56.801 | `bot-collect-queue`, coletores | `ColetaPanel` | 🟡 sem correlation_id | ❌ | 🟠 |
| Deals | `curator_deal_logs` | 331 | engine de deals | `curator_deals/historico` | 🟡 | ❌ | 🟠 |
| Acesso portal | `campaign_access_logs`, `curator_access_logs` | 12 + n | gates OTP | painel admin | ✅ | ❌ | 🟡 |
| Email | `email_send_log` | 64 | `process-email-queue` | — (sem UI) | ✅ | ❌ | 🟠 |
| Cron | `cron_health` | 120.783 | `cron-health-monitor-10min` | `SaudeSistema` | ✅ | n/a | 🟢 |
| Spotify | `spotify_call_log` | 69.117 | `_shared/spotify-*` | `SpotifyAppsPanel`, `CircuitBreakerHistoryCard` | ✅ | ❌ | 🟢 |
| Playlist ops | `playlist_operation_log` | 3.109 | helpers de playlist | `ManualDistribuicoesPanel` | ✅ | ❌ | 🟡 |
| Token público | `public_token_audit` (novo 4.B.1.B) | 0 | RPCs `rotate/revoke_public_token` | painel admin (a criar) | ✅ | ✅ `correlation_id` | 🟢 |
| Edge logs nativos | Supabase analytics | — | runtime | `supabase--edge_function_logs` | ✅ (event_message) | parcial | 🟡 |
| Postgres logs | `postgres_logs` | — | runtime | analytics_query | ✅ | n/a | 🟢 |
| Browser logs | console | — | runtime | code--read_console_logs | ❌ não persiste | ❌ | 🔴 |
| VPS logs | journald nos workers | — | workers BOT | — (sem ingest reverso) | 🟡 | 🟡 (gera mas não consulta no painel) | 🟠 |
| OCR logs | embutidos em `bot_events` (`step='ocr'`) | — | workers | AoVivoFeed | 🟡 sem métrica dedicada de fila/duração | parcial | 🟠 |
| Upload prints | `bot_print_batches` (17 cols) | — | `bot-upload-print` | `BotSaudeCard` | ✅ | parcial | 🟡 |

**Resumo logs:** existe muito, mas o **correlation_id só é uniforme nas tabelas BOT** (bot_events/heartbeats/ingest_raw/print_batches). Não atravessa edge functions de Gateway/Match/Writer/Delivery.

---

## 2. CORRELATION ID — auditoria da cadeia

| Estágio | Gera? | Propaga? | Persiste? |
|---|---|---|---|
| BOT (worker) | ✅ origem | ✅ via header/body | ✅ |
| Gateway (`bot-ingest*`) | recebe | ✅ → `bot_events`, `bot_ingest_raw` | ✅ |
| Parser (`_shared/raw-ingest`, `ingest-dom`) | propaga | ✅ | ✅ |
| Match Engine | recebe via `bot_ingest_raw.correlation_id` | ❌ **não passa adiante** | ❌ |
| Writer (snapshots/delivery_proofs) | ❌ | ❌ | ❌ |
| Delivery (`curator_deal_delivery_status`) | ❌ | ❌ | ❌ |
| Frontend | ❌ não recebe header de resposta | ❌ | ❌ |

**Veredicto:** `🔴 Quebra em Match → Writer → Delivery → Frontend.` Dá pra rastrear `bot → ingest`, mas não dá pra responder *"que correlation_id originou esta entrega?"* a partir de `delivery_proofs` ou `curator_deal_snapshots`.

---

## 3. BOT — reconstrução de job

| Sinal | Cobertura |
|---|---|
| Heartbeat (worker_id, hostname, process_id, memory) | ✅ `bot_heartbeats` |
| Eventos por step | ✅ `bot_events.step/status/duration_ms` |
| Crash detection | 🟡 inferido por ausência de heartbeat (≥10 min) — sem evento `crash` dedicado |
| Retry | 🟡 implícito em `bot_events` mas sem `attempt` numérico padronizado |
| Fila | ✅ `bot-execution-queue` + `reset-stuck-bot-songs` |
| OCR | 🟠 sem métrica de fila pendente ou tempo médio |
| Upload | ✅ `bot_print_batches` (status, retry_count) |

**Resposta:** consigo reconstruir 80% da vida de um job. Faltam: contador de retry padronizado, evento de crash explícito, métrica de fila OCR.

---

## 4. EDGE FUNCTIONS — rastreabilidade

- **217 funções deployadas.**
- Cada execução **tem log nativo Supabase** (event_message + execution_time_ms + status_code).
- Erros 500 ficam em `function_edge_logs`, mas **só 60 dias** de retenção.
- **Nenhuma função tem `correlation_id` injetado no log nativo** — só dá pra cruzar com `bot_events` quando a função é da família `bot-*`.
- Timeout: detectável só via `status_code=546` no edge log; sem alerta automático.

Classificação: 🟡 logs existem, **alertas não**.

---

## 5. BANCO — auditoria

- **RPCs:** algumas escrevem em `sync_log` / `playlist_operation_log`. A maioria das `SECURITY DEFINER` (81 funções listadas em 4.B) **não loga erro** — só lança exception que vai pro `postgres_logs`.
- **Triggers:** sem tabela de auditoria genérica; alguns triggers populam `*_history` (curator_brain_history, playlist_brain_history, genre_brain_history, etc.). 🟢
- **Cron:** ✅ `cron.job_run_details` + `cron_health` + `cron-health-monitor-10min` + `monitor-critical-crons` horário. Histórico mantido (purge diário).
- **Erros estruturados:** ❌ não há `db_error_log` central — depende do `postgres_logs` (90 dias).

Classificação: 🟡.

---

## 6. ALERTAS — cobertura

| Falha | Detecção | Tempo | Quem percebe |
|---|---|---|---|
| BOT parado | ✅ heartbeat ausente >10min via `BotSaudeCard` | ≤10 min | operador olhando `/sistema` |
| OCR parado | 🟠 só inferido por queda em `bot_events step=ocr` | indefinido | ninguém automaticamente |
| Gateway parado | 🟠 só via queda em `bot_ingest_raw` | indefinido | — |
| Match falhando | 🔴 sem detector | indefinido | — |
| Writer falhando | 🔴 sem detector | indefinido | — |
| Delivery travado | 🟡 `revalidate-deliveries-hourly` + `cron-deal-delivery-check-daily` | ≤1h / ≤24h | cron |
| Cron parado | ✅ `monitor-critical-crons` (hora) + `cron-health-monitor-10min` | ≤10min | painel |
| Upload preso | ✅ `recover-print-batches-5min` + `reset-stuck-bot-songs` | ≤15min | cron auto-recovery |

**Push real (email/Slack/SMS): ❌ inexistente.** Toda detecção depende de alguém abrir `/sistema`. Crons recuperam silenciosamente. Classificação: 🔴.

---

## 7. DASHBOARDS OPERACIONAIS

Página `/sistema` cobre:

- ✅ BOT (BotSaudeCard, AoVivoFeed, AoVivoPainel, RoboAoVivo)
- ✅ Coleta (ColetaPanel)
- ✅ Execução (ExecucaoPanel)
- ✅ Capacidade (CapacidadePanel)
- ✅ Impacto (ImpactoPanel)
- ✅ Spotify (SpotifyAppsPanel, CircuitBreakerHistoryCard, SpotifyPilotPanel)
- ✅ Genre/Playlist brain
- ✅ Saúde sistêmica (SaudeSistema, SystemKpis)
- ✅ Alertas (AlertasHistorico, AttentionInbox)
- ✅ Manual de distribuições

**Faltam:**

- 🔴 Dashboard de **Gateway** (latência por estágio bot→ingest→parse→match)
- 🔴 Dashboard de **OCR** (fila, tempo médio, taxa de erro)
- 🔴 Dashboard de **Delivery end-to-end** (proof → reconcile → snapshot)
- 🟠 Dashboard de **Performance** (p50/p95 de edge functions)
- 🟠 Dashboard de **Segurança** (tentativas OTP, tokens revogados/expirados, 403s)
- 🟠 Heatmap de erros por edge function

Classificação: 🟡 (cobre operação, falha em performance/segurança).

---

## 8. HEALTH CHECKS

| Subsistema | Probe | Status |
|---|---|---|
| Banco | `cron-health` + `db_health` tool | ✅ |
| Supabase backend | `supabase--cloud_status` | ✅ |
| Spotify | `spotify_circuit_breaker` + `spotify-token-watchdog-10min` | ✅ |
| VPS / workers | heartbeat | ✅ |
| OCR | ❌ sem probe dedicado | 🔴 |
| Browser (puppeteer) | ❌ sem probe | 🔴 |
| SMTP | ❌ sem probe ativo (apenas erros em `email_send_log`) | 🟠 |
| APIs externas (Kworb etc) | `sync-kworb-charts-daily` falha silenciosa | 🟠 |
| Engine self-check | ✅ `engine-health` | 🟢 |

Classificação: 🟡.

---

## 9. MÉTRICAS — latência por estágio

| Estágio | Tem `duration_ms`? | Histórico? | Gráfico? |
|---|---|---|---|
| Gateway | parcial (bot_events) | ✅ | ❌ |
| Parser | ❌ | ❌ | ❌ |
| Match | ❌ | ❌ | ❌ |
| Writer | ❌ | ❌ | ❌ |
| Delivery | parcial (curator_deal_delivery_status) | ✅ | parcial |
| OCR | 🟡 só em `bot_events.duration_ms` quando step='ocr' | ✅ | ❌ |
| Upload | ✅ `bot_print_batches` | ✅ | parcial |
| Edge fns | ✅ analytics (60d) | parcial | ❌ |

Classificação: 🟠. **Não há painel único com p50/p95/p99 por estágio.**

---

## 10. INCIDENTES — "minha campanha parou"

| Pergunta | Hoje consegue? |
|---|---|
| Onde parou? | 🟡 cruzar `curator_deal_logs` + `bot_events` por `deal_id` |
| Quando parou? | ✅ |
| Por que parou? | 🟡 só se houver `bot_events.status='error'` ou `spotify_call_log` 4xx/5xx |
| Quem executou? | ✅ `worker_id/hostname` em heartbeat |
| Qual worker? | ✅ |
| Qual VPS? | ✅ `vps_nodes` |
| Qual edge function? | 🟠 só por timestamp, sem chave |
| Qual correlation_id? | 🔴 **se o problema for pós-Match, perdido** |

Tempo estimado p/ root cause hoje: **15–45 min** (analista experiente, com acesso a SQL + painel).

---

## TOP 20 PONTOS CEGOS

1. 🔴 Correlation_id não atravessa Match→Writer→Delivery→Frontend.
2. 🔴 Sem alerta push (email/Slack) para falhas críticas.
3. 🔴 Sem dashboard de Gateway end-to-end (latência por estágio).
4. 🔴 Sem dashboard de OCR (fila, throughput, erro).
5. 🔴 Sem health-check de OCR e browser headless.
6. 🔴 Erros de edge function não geram evento estruturado (só log nativo, 60d).
7. 🔴 Console do navegador não persiste — erro frontend desaparece ao recarregar.
8. 🟠 Tentativa de retry não tem contador padronizado nos workers.
9. 🟠 Crash de worker é inferido (timeout) — sem evento `crash` dedicado.
10. 🟠 SMTP sem probe ativo; falha silenciosa até cliente reclamar.
11. 🟠 `collection_logs`, `curator_deal_logs`, `playlist_operation_log` sem correlation_id.
12. 🟠 Sem painel de p50/p95 por edge function.
13. 🟠 Sem painel de segurança (OTP failed, tokens revogados, 403s).
14. 🟠 `email_send_log` sem visualização no admin.
15. 🟠 Cron `sync-kworb-charts-daily` falha silenciosa (sem alerta).
16. 🟠 Sem RUM (Real User Monitoring) no frontend.
17. 🟡 `cron_health` cresce sem TTL agressivo (120k rows; purge diário ajuda).
18. 🟡 Falta correlation_id em logs de `_shared/spotify-*`.
19. 🟡 `bot_print_batches` não expõe métrica de tempo OCR p95.
20. 🟡 Sem trilha de auditoria genérica (quem alterou cada registro sensível).

---

## TEMPO PARA DETECTAR FALHA CRÍTICA

| Cenário | Hoje | Após hardening 4.C |
|---|---|---|
| BOT parou | 5–10 min (heartbeat) | ≤1 min (alerta push) |
| Gateway silencioso | 30–60 min | ≤2 min |
| OCR travado | desconhecido (horas) | ≤5 min |
| Match falhando | ≥1 hora | ≤5 min |
| Delivery travado | ≤1h (cron) | ≤5 min |
| Cron parado | ≤10 min | ≤2 min |
| Cliente reclama | só quando ele abre ticket | preventivo |

---

## NÍVEL DE OBSERVABILIDADE

**Atual: 6.5 / 10**

- Logs: 8/10
- Correlation: 4/10
- Alertas: 3/10
- Dashboards: 7/10
- Health-checks: 6/10
- Métricas/latência: 5/10
- Auditoria DB: 6/10
- Frontend: 3/10

**Pronto para operação contínua 24x7? ❌ Não.**  
Operação atende durante o expediente (alguém olha `/sistema`). Para 24x7 precisa de **alertas push + correlation_id ponta-a-ponta + health-check OCR/browser**.

---

## PLANO PRIORIZADO (4.C.1 / 4.C.2 / 4.C.3)

| Onda | Itens | Esforço | Impacto |
|---|---|---|---|
| **4.C.1 — Crítico** | Correlation_id ponta-a-ponta (`_shared/with-correlation.ts` + propagação em Match/Writer/Delivery) · alertas push (email para `ops-alerts-cron-every-5min`) · health-check OCR · evento `crash` explícito | 2–3 dias | 🔴 reduz MTTR de 30→5 min |
| **4.C.2 — Alto** | Dashboard Gateway/OCR/Delivery com latência p50/p95 · painel de segurança (OTP/tokens/403) · persistência de erros frontend | 2 dias | 🟠 |
| **4.C.3 — Médio** | RUM frontend · contador de retry padronizado · auditoria genérica de mutações sensíveis · probe SMTP | 1–2 dias | 🟡 |

**Pós 4.C.3 esperado: 9.0 / 10 — apto para 24x7.**

---

## REGRA INVIOLÁVEL

Nesta fase **nada foi alterado**. Próximo passo aguarda decisão entre 4.C.1 / 4.C.2 / 4.C.3.
