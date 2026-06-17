# AUDIT PHASE 4.B.1.B — AFTER (Hardening dos Tokens Públicos)

Data: 2026-06-17

---

## ITEM 1 — Inventário pós-backfill

| Métrica | campaigns | curator_deals |
|---|---|---|
| Total com token | 8 | 17 |
| Com `token_expires_at` | **8 (100%)** | **17 (100%)** |
| Revogados | 0 | 0 |
| Expiração padrão aplicada | NOW + 180d | NOW + 180d |
| Tokens alterados | **0** (valor preservado) | **0** (valor preservado) |

---

## ITEM 2 — Schema

✅ `campaigns.token_expires_at` (preexistente, agora populado)  
✅ `campaigns.token_revoked_at`  
✅ `curator_deals.token_expires_at` (preexistente, agora populado)  
✅ `curator_deals.token_revoked_at`  
✅ Nova tabela `public.public_token_audit` (RLS ativo; SELECT admin, ALL service_role)

---

## ITEM 3 — Funções oficiais

| Função | SECURITY | Grants |
|---|---|---|
| `revoke_public_token(kind, id, actor, ip, reason, correlation_id)` | DEFINER + `search_path=public` | `EXECUTE` apenas service_role |
| `rotate_public_token(kind, id, actor, ip, ttl_days, correlation_id)` | DEFINER + `search_path=public` | `EXECUTE` apenas service_role |
| `validate_public_token_state(revoked_at, expires_at)` | IMMUTABLE | authenticated + service_role |

Auditoria gravada em `public_token_audit` (kind, entity_id, action, actor, ip, reason, hash do token, expires_at, created_at). Nunca grava o token em claro — só `sha256`.

---

## ITEM 4 — Validação em endpoints públicos

| Endpoint | Existe | Revogado | Expirado | Registro correto |
|---|---|---|---|---|
| `get-shared-campaign-plan` | ✅ | ✅ (410) | ✅ (410) | ✅ |
| `get-client-campaign-public` | ✅ | ✅ (410) | ✅ (410) | ✅ |
| `get-curator-deal-public` | ✅ | ✅ (410) | ✅ (410) | ✅ |

Padrão: quando token revogado/expirado → HTTP **410 Gone** com `error: token_revoked` ou `token_expired`. Comportamento legado preservado para slug amigável (sem token, sem TTL).

---

## ITEM 5 — Testes lógicos

| Cenário | Resultado esperado | Status |
|---|---|---|
| Token válido (dentro de 180d, não revogado) | 200 OK | ✅ |
| Token expirado | 410 `token_expired` | ✅ |
| Token revogado | 410 `token_revoked` | ✅ |
| Token inexistente | 404 `not_found` | ✅ |
| Token rotacionado (link novo) | 200 OK; link antigo → 410 `token_revoked`/sem match | ✅ |
| Link antigo após rotação | 410 (revoked) ou 404 (not_found) | ✅ |
| Portal cliente sem alteração de UX | UX inalterada | ✅ |
| Portal curador sem alteração de UX | UX inalterada | ✅ |

---

## ITEM 6 — Auditor AFTER

| Pergunta | Resposta |
|---|---|
| Existe token sem expiração? | **NÃO** |
| Existe token sem capacidade de revogação? | **NÃO** |
| Existe token permanente? | **NÃO** |
| Existe bypass? | **NÃO** |
| Existe regressão funcional? | **NÃO** |
| Mudou regra de negócio? | **NÃO** |
| Mudou arquitetura? | **NÃO** |

---

## ITEM 7 — Componentes intactos

- Gateway ✅ não alterado
- Match Engine ✅ não alterado
- Writer ✅ não alterado
- Delivery ✅ não alterado
- Baseline ✅ não alterado
- CollectionRow ✅ não alterado
- Fluxo BOT ✅ não alterado
- Arquitetura consolidada ✅ intacta
