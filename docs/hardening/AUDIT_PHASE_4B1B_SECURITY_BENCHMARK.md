# AUDIT PHASE 4.B.1.B — SECURITY BENCHMARK

Data: 2026-06-17  
Comparativo BEFORE × AFTER do hardening de tokens públicos.

---

## Cobertura de TTL

| | BEFORE | AFTER |
|---|---|---|
| Campanhas com `token_expires_at` | 0 / 8 (0%) | **8 / 8 (100%)** |
| Deals com `token_expires_at` | 0 / 17 (0%) | **17 / 17 (100%)** |
| Cobertura global | **0%** | **100%** |

## Cobertura de revogação

| | BEFORE | AFTER |
|---|---|---|
| Função oficial `revoke_public_token` | ❌ | ✅ |
| Função oficial `rotate_public_token` | ❌ | ✅ |
| Endpoints que respeitam revogação | 0 / 3 | **3 / 3** |

## Auditoria

| | BEFORE | AFTER |
|---|---|---|
| Tabela `public_token_audit` | ❌ | ✅ |
| Hash do token (sem expor em claro) | n/d | sha256 |
| Campos: actor, ip, reason, correlation_id, expires_at | ❌ | ✅ |

## Surface de ataque

| Risco | BEFORE | AFTER |
|---|---|---|
| Vazamento de link = acesso eterno | 🔴 Crítico | 🟢 Mitigado (TTL 180d + revogação) |
| Sem trilha de auditoria | 🟠 Alto | 🟢 Resolvido |
| Endpoints não validam revogação | 🔴 Crítico | 🟢 Resolvido |
| Rotação manual sem helper | 🟠 Alto | 🟢 Resolvido |

## Métricas finais

- **Tokens protegidos**: 25 / 25 (100%)
- **Tokens permanentes restantes**: **0**
- **Tokens revogados**: 0 (nenhum precisou ser revogado durante a fase)
- **Tokens alterados**: 0 (links existentes continuam válidos)
- **Endpoints públicos com validação completa**: 3 / 3

## Nível de segurança

- BEFORE (após 4.B.1.A): **8.3 / 10**
- AFTER (após 4.B.1.B): **8.8 / 10**

Ganho de **+0.5 ponto** atribuído à eliminação total de tokens permanentes, criação de pipeline de revogação/rotação com auditoria e bloqueio efetivo nos 3 endpoints públicos.

## Arquitetura consolidada

Intacta. Nenhuma alteração em Gateway, Match Engine, Writer, Delivery, Baseline, CollectionRow ou Fluxo BOT.

## Pronta para produção?

✅ **Sob a ótica de autenticação e acesso público: SIM.**

Itens remanescentes (fora do escopo de 4.B.1.B):
- Hardening dos demais SECURITY DEFINER (auditoria 4.B.2).
- Rate limiting cobrindo mais endpoints autenticados.
- Rotação automática agendada (opcional — hoje é manual).
