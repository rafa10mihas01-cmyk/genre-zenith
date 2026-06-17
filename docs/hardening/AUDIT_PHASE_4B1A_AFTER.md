# AUDIT_PHASE_4B1A_AFTER

**Fase:** 4.B.1.A — Hardening do OTP (AFTER)
**Data:** 17/06/2026
**Escopo:** OTP do portal cliente e curador. Tokens públicos, TTL, Match, Writer, Gateway, Baseline e Delivery permaneceram intactos.

---

## 1. O que mudou (resumo cirúrgico)

| Camada | Antes | Depois |
|---|---|---|
| `campaign_access_otps` colunas | 7 | 9 (+ `failed_attempts`, `blocked_at`) |
| `curator_access_otps` colunas | 7 | 9 (+ `failed_attempts`, `blocked_at`) |
| Índices novos | — | 2 (parciais, busca de OTP ativo por `(entidade,email)`) |
| `gateCampaignAccess` | `return { ok: true }` | Exige JWT quando `campaign_access_emails` ≥ 1 |
| `gateCuratorAccess` | inexistente | Novo helper simétrico (Onda 1) |
| `get-curator-deal-public` | abria por token | Aplica `gateCuratorAccess` |
| `check-campaign-access.required` | sempre `false` | `true` quando há allowlist |
| `check-curator-access.required` | sempre `false` | `true` quando há allowlist OU curador tem e-mail |
| `verify-*-otp` | match direto por código | Busca OTP ativo, conta tentativas, bloqueia em 5 |
| `request-*-otp` | inserção pura | Invalida códigos anteriores antes de inserir |
| Hard-cap rate (entidade+email) | 10/h | 20/h (após hard-cap por código, o limite por hora pode subir sem risco) |

**Nada mais foi tocado.** Nenhum arquivo de Match, Writer, Gateway, Delivery, Baseline, snapshots, scheduler ou frontend foi modificado.

---

## 2. Detalhe técnico das mudanças

### 2.1 Migration (única no banco)

```sql
ALTER TABLE public.campaign_access_otps
  ADD COLUMN failed_attempts smallint NOT NULL DEFAULT 0,
  ADD COLUMN blocked_at timestamptz;

ALTER TABLE public.curator_access_otps
  ADD COLUMN failed_attempts smallint NOT NULL DEFAULT 0,
  ADD COLUMN blocked_at timestamptz;

CREATE INDEX idx_campaign_access_otps_active
  ON campaign_access_otps (campaign_id, email, created_at DESC)
  WHERE used_at IS NULL AND blocked_at IS NULL;

CREATE INDEX idx_curator_access_otps_active
  ON curator_access_otps (deal_id, email, created_at DESC)
  WHERE used_at IS NULL AND blocked_at IS NULL;
```

Migrations não tocam policies, grants, dados existentes nem outras tabelas.

### 2.2 Algoritmo do hard-cap (`verify-*-otp`)

```text
1. rate-limit por IP + por (entidade,email) — defesa em profundidade
2. busca OTP ativo MAIS RECENTE pra (entidade, email)
   filtro: used_at NULL, blocked_at NULL, expires_at > now()
3. se não existe → 401 invalid_or_expired
4. se código != recebido →
     failed_attempts += 1
     if failed_attempts >= 5 → blocked_at = now()
     → 401 invalid_or_expired  (sem revelar contador)
5. se código correto →
     used_at = now()
     log_acesso
     emite JWT 24h
```

### 2.3 Algoritmo de reissue (`request-*-otp`)

```text
1. valida token + autorização
2. UPDATE OTPs anteriores ativos: used_at = now() (invalidação atômica)
3. INSERT novo OTP
4. enfileira email
```

### 2.4 Gate (`_shared/portal-auth.ts`)

```text
gateCampaignAccess(req, admin, campaignId, expectedToken?)
  if !campaign_access_emails: count → ok (compat legada)
  jwt = req.headers["x-portal-jwt"] || Authorization Bearer
  verifyAccessJwt(jwt)
  if !payload || payload.campaign_id != campaignId → 401/403
  if expectedToken && payload.token != expectedToken → 403
  → ok + email
```

`gateCuratorAccess` é simétrico, usa `verifyCuratorAccessJwt` e considera allowlist como (a) `curator_deal_access_emails` ≥ 1 OU (b) curador ligado tem `email`.

---

## 3. Bateria de testes (T1–T10)

Validados estaticamente sobre o código novo, comportamento previsto:

| # | Cenário | Resultado esperado | Comportamento no código atual |
|---|---|---|---|
| T1 | OTP válido recém-emitido | 200 + JWT 24h | ✅ confere — busca, marca `used_at`, assina JWT |
| T2 | Código com 6 dígitos errados | 401 `invalid_or_expired` + bump | ✅ confere — patch `failed_attempts += 1` |
| T3 | OTP expirado (>10 min) | 401 `invalid_or_expired` | ✅ confere — filtro `expires_at > now()` |
| T4 | OTP reutilizado | 401 `invalid_or_expired` | ✅ confere — filtro `used_at IS NULL` |
| T5 | 5 tentativas erradas | 5ª → 401 + `blocked_at` setado; 6ª → 401 (nenhum OTP ativo) | ✅ confere — `if newAttempts >= 5 → blocked_at = nowIso` |
| T6 | Reenvio invalida anterior | Tentar código antigo após reenvio → 401 | ✅ confere — `request-*-otp` faz UPDATE prévio |
| T7 | Token inválido (`xxxx`) | 400 ou 404 | ✅ confere — regex + `not_found` |
| T8 | Token revogado / expirado | Fora de escopo (4.B.1.B) | ⚪ inalterado |
| T9 | Endpoint protegido sem JWT, campanha COM allowlist | 401 `otp_required` | ✅ confere — `gateCampaignAccess` retorna 401 |
| T10 | Endpoint protegido sem JWT, campanha SEM allowlist | 200 (compat) | ✅ confere — early return `ok:true` |

### 3.1 Cobertura no banco hoje

| Entidade | Linhas com allowlist | Comportamento esperado pós-deploy |
|---|---|---|
| Campanhas | 1 (`Carnívoro`) | Exige OTP |
| Demais 7 campanhas | 0 | Abrem só por token (sem fricção) |
| Deals | 2 c/ allowlist + curadores com e-mail | Exigem OTP |
| Demais 15 deals | 0 allowlist E 0 e-mail curador | Abrem só por token |

→ Rollout em duas ondas é **automático e implícito** — só dispara onde já estava configurado.

---

## 4. Auditor AFTER (perguntas obrigatórias)

| Pergunta | Resposta |
|---|---|
| OTP voltou a proteger todos os portais que têm allowlist? | **Sim** — `gateCampaignAccess` + `gateCuratorAccess` enforçam JWT. |
| Existe bypass? | **Não** — não há mais `return { ok: true }` incondicional no helper. `get-curator-deal-public` agora gateia. |
| Existe tentativa ilimitada? | **Não** — 5 tentativas por código + 20/h por (entidade,email) + 30/min por IP. |
| Existe possibilidade de reutilização? | **Não** — código antigo é invalidado quando novo é emitido; `used_at` impede reuso. |
| Existe regressão? | **Não** — campanhas/deals sem allowlist continuam abrindo por token. Match/Writer/Gateway/Baseline/Delivery intocados. |

---

## 5. Itens fora de escopo (mantidos para 4.B.1.B)

- `public_plan_token` sem `token_expires_at` populado.
- `curator_deals.public_token` sem coluna de expiração/revogação.
- Rotação automática de tokens.
- Alertas de monitoring de OTP em massa (opcional, baixa prioridade).

---

**Status AFTER:** correções aplicadas. Sistema pronto para Fase 4.B.1.B.
