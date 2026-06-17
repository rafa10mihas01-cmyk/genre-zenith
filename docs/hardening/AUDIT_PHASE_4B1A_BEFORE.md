# AUDIT_PHASE_4B1A_BEFORE

**Fase:** 4.B.1.A — Hardening do OTP (BEFORE)
**Data:** 17/06/2026
**Regra:** documenta o estado atual antes da correção. Não toca em Token TTL, Match, Writer, Gateway, Baseline, Delivery.

---

## 1. Estado atual do OTP

### 1.1 Schemas

**`campaign_access_otps`** (7 colunas):
`id, campaign_id, email, code, created_at, expires_at, used_at`

**`curator_access_otps`** (7 colunas):
`id, deal_id, email, code, created_at, expires_at, used_at`

⚠️ **Nenhuma das duas tabelas tem coluna `failed_attempts` ou `blocked_at`.**

### 1.2 Edge Functions

| Função | LOC | Hard-cap por OTP | Invalida código anterior | Rate-limit IP | Rate-limit (entidade+email) |
|---|---|---|---|---|---|
| `request-campaign-otp` | 196 | n/a | ❌ não | 30/min | 10/h |
| `verify-campaign-otp` | 81 | ❌ **só rate-limit por IP/email** | n/a | 30/min | 10 tentativas/h |
| `request-curator-otp` | 181 | n/a | ❌ não | 30/min | 3/h |
| `verify-curator-otp` | 74 | ❌ **só rate-limit por IP/email** | n/a | 30/min | 10 tentativas/h |

### 1.3 Gate (`_shared/portal-auth.ts`)

```ts
export async function gateCampaignAccess(...) {
  // OTP gate temporariamente desabilitado — sempre libera.
  return { ok: true };
}
```

⚠️ **Bypass em produção.** Helper é chamado por 6 edge functions:
`client-approve-campaign`, `client-request-adjustment`, `get-campaign-roadmap-public`, `get-client-campaign-public`, `get-shared-campaign-plan`, `portal-auth-debug`.

❌ **Não existe `gateCuratorAccess`** — portal do curador (`get-curator-deal-public`) **não tem helper algum**, abre direto pelo token.

### 1.4 Check endpoints

| Endpoint | Comportamento atual |
|---|---|
| `check-campaign-access` | Sempre responde `{ ok:true, required:false }` |
| `check-curator-access` | Sempre responde `{ ok:true, required:false }` |

⚠️ Não consulta `campaign_access_emails` / `curator_deal_access_emails`.

---

## 2. Gaps confirmados (apenas escopo desta fase)

| # | Gap | Severidade | Onde |
|---|---|---|---|
| G1 | OTP sem hard-cap de tentativas por código (brute-force depende só do rate-limit por IP, atacante pode rotacionar IP) | 🔴 | `verify-*-otp` |
| G2 | Reissue de OTP não invalida códigos anteriores (códigos antigos continuam válidos até `expires_at`) | 🟠 | `request-*-otp` |
| G3 | `gateCampaignAccess` retorna `ok:true` sem checar nada | 🔴 | `_shared/portal-auth.ts` |
| G4 | Não existe `gateCuratorAccess` — curator portal sem gate sequer disponível | 🔴 | `_shared/portal-auth.ts` |
| G5 | `check-*-access` sempre reporta `required:false` mesmo com allowlist configurada | 🟠 | `check-*-access` |

---

## 3. Escopo congelado (não-mexer)

- ❌ Tokens públicos (`public_plan_token`, `curator_deals.public_token`) — Fase 4.B.1.B.
- ❌ TTL / `token_expires_at` — Fase 4.B.1.B.
- ❌ Gateway, Match, Writer, Delivery, Baseline.
- ❌ Schema de `campaigns`, `curator_deals`, `delivery_proofs`, `campaign_playlist_collections`.

---

## 4. Plano de execução (4.B.1.A)

1. **Migration** — adicionar `failed_attempts smallint DEFAULT 0` e `blocked_at timestamptz` em `campaign_access_otps` e `curator_access_otps`. Criar índice parcial pra busca rápida.
2. **`verify-*-otp`** — buscar OTP ativo mais recente; se código não bate → bumpa `failed_attempts`, marca `blocked_at` quando `>= 5`; retorna `invalid_or_expired` sem vazar contador.
3. **`request-*-otp`** — antes de inserir novo código, marca `used_at = now()` em todos os anteriores ainda ativos pra mesma (campanha/deal, email).
4. **`_shared/portal-auth.ts`** — `gateCampaignAccess` passa a exigir JWT válido quando `campaign_access_emails` tem ≥1 linha. Adiciona `gateCuratorAccess` simétrico.
5. **`get-curator-deal-public`** — aplica `gateCuratorAccess` (Onda 1).
6. **`check-*-access`** — passa a reportar `required: true` corretamente quando há allowlist.
7. **Testes** — bateria sintética em todos os fluxos.

---

## 5. Inventário de testes a executar no AFTER

| # | Cenário | Esperado |
|---|---|---|
| T1 | OTP válido | 200 + JWT |
| T2 | OTP inválido (dígitos errados) | 401 `invalid_or_expired` + bump |
| T3 | OTP expirado (>10 min) | 401 `invalid_or_expired` |
| T4 | OTP reutilizado (já `used_at`) | 401 `invalid_or_expired` |
| T5 | 5 tentativas erradas seguidas | 5ª retorna 401, e tentativa 6 fica bloqueada (`blocked` no banco) |
| T6 | Reenvio invalida código antigo | código antigo passa a falhar mesmo dentro do TTL |
| T7 | Token inválido | 404 `not_found` |
| T8 | Token revogado/expirado | (4.B.1.B — fora de escopo, só confirma comportamento atual) |
| T9 | Acesso a endpoint protegido sem JWT, campanha com allowlist | 401 |
| T10 | Acesso a endpoint protegido sem JWT, campanha SEM allowlist | 200 (compat legada preservada) |

---

## 6. Volume operacional (referência do BEFORE de 4.B.1)

- 12 acessos cliente em 90d (2 campanhas, 2 e-mails).
- 7 acessos curador em 90d (3 deals, 2 e-mails).
- 1 campanha com allowlist (`Carnívoro`, 30 acessos/90d).
- 2 deals com allowlist.
- 17 OTPs cliente (10 usados) · 8 OTPs curador (7 usados) historicamente.

→ Janela de baixíssimo risco de suporte. Aprovado para executar.

---

**Status BEFORE:** documentado. Próximo passo: aplicar migration + correções.
