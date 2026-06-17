# AUDIT PHASE 4.B.1.B — BEFORE (Hardening dos Tokens Públicos)

Data: 2026-06-17  
Escopo: `campaigns.public_plan_token`, `curator_deals.public_token`  
Metodologia: Auditor BEFORE → Migração → Backfill → Testes → Auditor AFTER

---

## ITEM 1 — Inventário de tokens

| Métrica | campaigns | curator_deals |
|---|---|---|
| Total de registros | 8 | 17 |
| Com token público | 8 (100%) | 17 (100%) |
| Com `token_expires_at` | **0** | **0** |
| Com `token_revoked_at` | **0** | **0** (coluna não existia na auditoria 4.B.1.A — já adicionada em migração subsequente) |
| Token mais antigo | 2026-05-23 | 2026-05-07 |
| Token mais recente | 2026-06-10 | 2026-06-15 |
| Tokens revogados | 0 | 0 |
| Tokens expirados | 0 | 0 |

> **Idade média**: ~20 dias (campaigns), ~25 dias (deals).  
> **100% dos tokens são permanentes** — sem TTL, sem revogação registrada.

---

## ITEM 2 — Schema atual

Colunas já existentes em ambas as tabelas (após 4.B.1.A):

- `public.campaigns.token_expires_at timestamptz`
- `public.campaigns.token_revoked_at timestamptz`
- `public.curator_deals.token_expires_at timestamptz`
- `public.curator_deals.token_revoked_at timestamptz`

Faltam:

- Tabela de auditoria `public.public_token_audit` (criada, rotacionada, revogada — com IP, actor, correlation_id).
- Funções oficiais `revoke_public_token` e `rotate_public_token`.
- Validação centralizada de TTL/revogação nas leituras públicas.

---

## ITEM 3 — Endpoints públicos auditados

| Endpoint | Leitura por token | Valida expiração? | Valida revogação? |
|---|---|---|---|
| `get-shared-campaign-plan` | `campaigns.public_plan_token` | ❌ | ❌ |
| `get-client-campaign-public` | `campaigns.public_plan_token` | ❌ | ❌ |
| `get-curator-deal-public` | `curator_deals.public_token` | ❌ (campos selecionados, nunca conferidos) | ❌ |

---

## ITEM 4 — Riscos identificados

| Risco | Severidade |
|---|---|
| Token permanente em 100% dos registros | 🔴 Crítico |
| Sem revogação possível (vazamento de link = acesso eterno) | 🔴 Crítico |
| Sem auditoria de criação/rotação/revogação | 🟠 Alto |
| Sem helper SQL oficial para revogar/rotacionar | 🟠 Alto |
| Endpoints não verificam expiração mesmo quando coluna existe | 🟠 Alto |

---

## ITEM 5 — Plano de correção (próximas etapas desta fase)

1. Backfill `token_expires_at = NOW() + 180d` em todos os registros com token (sem alterar o valor do token).
2. Criar tabela `public_token_audit`.
3. Criar funções `revoke_public_token(kind, id, actor, ip, reason)` e `rotate_public_token(kind, id, actor, ip)`.
4. Adicionar validação obrigatória nos 3 endpoints públicos: existe → não revogado → não expirado → registro correto.
5. Re-auditar (AFTER).
