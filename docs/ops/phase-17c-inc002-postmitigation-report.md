# Fase 17-C — Relatório pós-mitigação INC-002

**Data:** 2026-06-20  
**Janela analisada:** 48h (24h antes da mitigação × 24h depois)  
**Fonte:** `spotify_call_log`, `playlist_execution_jobs`

---

## 1. Comparativo ANTES × DEPOIS

| Métrica | ANTES (72h–24h atrás) | DEPOIS (últimas 24h) | Δ |
|---|---|---|---|
| Chamadas a `/playlists/:id/items` (e `/tracks`) | 1.504 | 1.272 | **−15%** |
| HTTP 403 nesses endpoints | 1.300 | 1.264 | **−3%** |
| Chamadas do worker `bot-execution-queue` | 1.273 | 1.254 | **−1,5%** |
| Erros (status ≥ 400) do worker | 1.256 | 1.245 | **−1%** |
| Jobs presos em `claimed` > 1h | 5 (originais) | **0** ✅ | resolvido |
| Jobs cancelados pelo guard (24h) | — | 5 | guard ativo |

### Distribuição horária (chamadas do `bot-execution-queue` últimas 36h)
Volume **estável em ~40–55 chamadas/hora**, **≥98% retornando 403**.  
Não houve redução perceptível após a mitigação.

---

## 2. Interpretação

### ✅ O que a mitigação resolveu
- Os 5 jobs originais com `attempts` entre 241 e 745 foram cancelados e movidos para `manual_distribution_queue`.
- Nenhum job legado continua em loop infinito (>10 tentativas).
- O guard de `max_attempts` está operacional e cancelou os 5 jobs antigos.

### ⚠️ O que a mitigação NÃO resolveu
- **A taxa de 403 no endpoint `/v1/playlists/:id/items` permanece praticamente inalterada (~98%).**
- Novos jobs continuam entrando no worker, falhando com 403 e sendo cancelados — apenas em ciclos curtos (3–5 tentativas em vez de 240+).
- **5 novos jobs foram criados hoje (17:27) e já estavam com `attempts=5 > max_attempts=3` em `claimed`** no momento da auditoria. Serão cancelados na próxima passagem do guard, mas o padrão se repete.

### 🔎 Conclusão técnica
O guard impede o **loop infinito**, mas **não corrige o problema subjacente**: o endpoint `/v1/playlists/:id/items` está retornando 403 de forma sistemática para a grande maioria das playlists processadas pelo worker, independentemente do caminho de autenticação.

Isso **confirma o achado da Frente 1 do baseline** (Phase 17-C): `/playlists/:id/items` é o endpoint mais degradado do sistema e precisa de decisão arquitetural urgente.

---

## 3. Status do critério de encerramento INC-002

| Critério | Status |
|---|---|
| 5 jobs fora do loop | ✅ |
| Guard de `max_attempts` implantado e validado | ✅ |
| Volume de chamadas caiu para o esperado | ❌ (permanece ~50/h, ~98% erro) |

**Decisão:** INC-002 é considerado **parcialmente encerrado** — a parte operacional (loop infinito) está resolvida, mas a causa raiz (403 sistemático no endpoint `/items`) é **transferida formalmente para a Fase 17-C** como item bloqueante da matriz arquitetural. Não cabe mais tratá-la como incidente isolado.

---

## 4. Implicação para a Fase 17-C

A escolha do componente oficial para `/v1/playlists/:id/items` deixa de ser teórica:
- Gateway CC: **inviável** (98%+ de 403 em produção).
- OAuth: a validar no benchmark.
- VPS: a validar no benchmark.

**Próximo passo da fase:** Frente 3 — benchmark controlado da VPS, usando como amostra as 5 playlists novas presas hoje + as 5 playlists do INC-002 original (10 playlists com 403 confirmado em CC).

---

## 5. Ticket separado aberto

Atualização silenciosa de `status='manual'` na `playlist_execution_jobs` viola o `CHECK constraint`. Tratado em ticket próprio:
- `docs/ops/tickets/BUG-003-pej-status-manual-check-constraint.md` (a criar)
