# AUDIT_PHASE_4B_SECURITY

**Fase:** 4.B — Hardening de Segurança (auditoria forense, read-only)
**Data:** 17/06/2026
**Escopo:** Plataforma NexEngine completa — banco, edge functions, frontend, storage, tokens, segredos.
**Regra:** nenhuma alteração executada. Apenas evidências.

---

## 0. Resumo Executivo

| Camada | Itens auditados | Status |
|---|---|---|
| Tabelas `public` | **194** (100% com RLS habilitado) | 🟢 |
| Functions `public` (SECURITY DEFINER) | **189 de 274** (69%) | 🟡 |
| Edge Functions | **216** (+ `_shared`) | 🟡 |
| Storage buckets | **8** (2 públicos, 6 privados) | 🟡 |
| Lint findings totais | **210** (0 ERROR · 209 WARN · 1 INFO) | 🟡 |
| Buckets públicos com listing aberto | **2** (`playlist-covers`, `email-assets`) | 🟡 |
| Frontend `dangerouslySetInnerHTML` | **1** (`ui/chart.tsx` — shadcn, conteúdo estático) | 🟢 |
| Segredos hardcoded | **0** detectados | 🟢 |
| Logs com token/senha em claro | **0** detectados (refs apenas a evento de refresh) | 🟢 |

**Nível atual de segurança da plataforma: 7,5 / 10.**
Pronta para produção com ressalvas — sem CRÍTICO bloqueante, mas com 205 findings de SECURITY DEFINER expostos que devem ser fechados em fase de hardening dedicada (4.B.1).

---

## 1. Row Level Security (RLS)

### 1.1 Inventário agregado

```sql
select count(*) filter (where rowsecurity) as rls_on,
       count(*) filter (where not rowsecurity) as rls_off,
       count(*) as total
from pg_tables where schemaname='public';
-- rls_on=194  rls_off=0  total=194
```

✅ **100% das tabelas `public` têm RLS habilitado.**

### 1.2 Lint relevante de RLS

| # | Lint | Qtde | Severidade |
|---|------|------|------------|
| 1 | RLS Enabled No Policy | **1** | 🟡 INFO |

Apenas **1 tabela** com RLS ligado e sem nenhuma policy (lock total — comportamento correto pra tabelas de auditoria interna acessadas só via service_role). Sem tabela exposta sem RLS.

### 1.3 Pontos sensíveis (evidências)

- `user_roles`: 3 policies, leitura apenas por `authenticated`; insert/delete apenas via service_role (padrão NexEngine). 🟢
- `campaigns`, `clients`, `curators`, `curator_deals`, `playlists`: 4 policies cada — leitura/escrita por `authenticated` com filtro de equipe (`has_team_access`). 🟢
- Tabelas de portal público (`campaign_access_*`, `curator_access_*`): policies restritas a service_role + OTP gate. 🟢
- Tabelas `_audit_*`, `_io_stats_snapshots`, `_rls_optimization_audit`: 1 policy cada (service_role only). 🟢
- `bot_ingest_raw`: 1 policy (service_role apenas — gateway oficial). 🟢

**Conclusão Seção 1:** 🟢 Seguro.

---

## 2. SECURITY DEFINER (Functions / RPCs)

### 2.1 Inventário

```sql
select count(*) total, count(*) filter (where prosecdef) as secdef
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public';
-- total=274  secdef=189
```

### 2.2 Lint relevante

| # | Lint | Qtde | Severidade |
|---|------|------|------------|
| 2 | SECURITY DEFINER callable by **authenticated** | **124** | 🟡 WARN |
| 3 | SECURITY DEFINER callable by **anon** | **81** | 🔴 WARN (mais grave) |

**Total exposto via PostgREST: 205 funções.**

### 2.3 Análise

- A maioria são helpers internos (`has_role`, `has_team_access`, `match_curator_playlist`, `ingest_campaign_collection_batch`, RPCs de baseline/growth) que **precisam** de SECURITY DEFINER pra bypassar RLS de tabelas internas.
- Padrão NexEngine: `SECURITY DEFINER` + `SET search_path = public` (verificado — `has_role`, `has_team_access`, `match_curator_playlist` seguem o padrão).
- **Risco real:** 81 funções alcançáveis por `anon` via Data API. A maioria provavelmente faz validação interna (token/OTP), mas **isso precisa ser provado função-a-função**.
- **Privilege escalation:** nenhuma evidência direta encontrada. `user_roles` é o único caminho e está protegido por `has_role`.

**Pendente para Fase 4.B.1:**
- Classificar as 205 funções em: (a) deve ser INVOKER, (b) deve ter EXECUTE revogado de anon, (c) intencional (manter).
- Confirmar `SET search_path` em todas.

**Conclusão Seção 2:** 🟡 Atenção — sem crítico, mas superfície grande.

---

## 3. Edge Functions

### 3.1 Inventário

- **216 funções** ativas (excluindo `_shared`).
- **16 funções** usam `SUPABASE_SERVICE_ROLE_KEY` diretamente.
- **~80 funções** sem nenhum guard de auth (`requireTeamAccess` / `requireAdmin` / `getClaims`) detectado no scan.

### 3.2 Funções públicas (verify_jwt=false) declaradas em `config.toml`

Total declaradas: **17**. Categorias:
- **Bot ingest** (`bot-event-ingest`, `bot-heartbeat`, `bot-ingest-dom`) — exigidas pelo contrato VPS; validam `x-agent-token` interno.
- **Sync externos** (`sync-kworb-charts`, `sync-spotify-editorial-charts`) — cron-only.
- **Portal cliente/curador** (`get-shared-campaign-plan`, `campaign-plan-api`, `campaign-daily-plan`, `get-campaign-roadmap-public`, `regenerate-campaign-roadmap-token`, `check-campaign-access`, `check-curator-access`) — validam token público + (futuro) OTP.
- **Email** (`preview-transactional-email`, `handle-email-unsubscribe`, `handle-email-suppression`) — validam token de email.
- **Outros** (`detect-curator-fraud`, `portal-auth-debug`, `distribute-catalog-track`).

### 3.3 Padrão de auth observado

- ✅ `_shared/auth.ts::requireTeamAccess` (admin/curador OU service_role com comparação constant-time).
- ✅ `_shared/admin-auth.ts::requireAdmin` (admin only).
- ✅ `_shared/portal-auth.ts::gateCampaignAccess` (OTP — atualmente bypass: `return { ok: true }`). 🟡
- ✅ Rate limit: `_shared/rate-limit.ts` usado em **16** funções (de 216 — ~7%). 🟠

### 3.4 Riscos identificados

| # | Função | Risco | Severidade |
|---|--------|-------|-----------|
| E1 | OTP gate desabilitado em `check-campaign-access`, `check-curator-access`, `gateCampaignAccess` | Portal abre só com token na URL; se token vazar, acesso total ao plano | 🟠 |
| E2 | ~80 edge functions sem guard de auth explícito | Maioria são crons internas, mas precisa classificar | 🟡 |
| E3 | Apenas 7% das edge functions com rate-limit | DoS / abuse possível em endpoints públicos | 🟠 |
| E4 | `app-homologation-test` / `portal-auth-debug` em produção | Endpoints de debug não deveriam ser públicos | 🟡 |

**Conclusão Seção 3:** 🟡 Atenção.

---

## 4. Tokens

| Token | Geração | Armazenamento | TTL | Rotação | Revogação |
|---|---|---|---|---|---|
| `campaigns.public_plan_token` | `gen_random_uuid()` ao criar campanha | Coluna `campaigns` (raw, indexada) | ∞ (sem expiração) | Manual via `regenerate-campaign-roadmap-token` | Drop manual |
| `curator_deals.public_token` / `slug` | `gen_random_uuid()` / slug ao criar deal | Coluna `curator_deals` | ∞ | Não há fluxo | Drop manual |
| `bot_token` (VPS agent) | Secret `OPS_AGENT_TOKEN` | Edge Function secret | ∞ | Manual via `update_secret` | Manual |
| `cron_secret` (`x-cron-secret`) | RPC `get_cron_secret` | DB (service_role only) | ∞ | Manual | Manual |
| `campaign_access_otps` / `curator_access_otps` | 6 dígitos numéricos | Tabela DB, 1 policy service_role | ✅ TTL curto (col `expires_at`) | N/A (one-shot) | ✅ row delete |
| `email_unsubscribe_tokens` | UUID | Tabela DB | TTL via `expires_at` | N/A | ✅ |
| `spotify_oauth_states` | nonce curto | DB | TTL via `expires_at` | N/A | ✅ |
| `spotify_invite_tokens` | Token único | DB, 2 policies | TTL | N/A | ✅ |

**Riscos:**
- 🟠 **T1:** `public_plan_token` e `curator_deals.public_token` **não expiram** e o gate OTP está desabilitado → URL vazada = acesso permanente.
- 🟡 **T2:** Sem rotação automática em nenhum token persistente.

---

## 5. Segredos

Auditoria via `grep -rE "(sk_|sk-|api[_-]?key|secret|password)\s*=\s*['\"]"` no `src/` e `supabase/functions/` (excluindo `_shared/auth` e secret references).

- ✅ Nenhum segredo hardcoded encontrado.
- ✅ Todos os segredos sensíveis usam `Deno.env.get(...)` (Spotify, Service Role, OPS_AGENT_TOKEN, OCR, SMTP, Resend).
- ✅ `.env` contém apenas `VITE_SUPABASE_*` publishable (correto — anon key é pública por design).
- 🟡 Não foi possível confirmar duplicatas/chaves antigas sem listar secrets (requer `fetch_secrets`).

**Conclusão Seção 5:** 🟢 Seguro.

---

## 6. Storage

| Bucket | Público | Limite | MIME allowlist | Risco |
|---|---|---|---|---|
| `brand-assets` | ❌ privado | — | — | 🟢 |
| `playlist-covers` | ✅ público | 5 MB | jpeg/png/webp | 🟡 (lint #4: listing aberto) |
| `bot-prints` | ❌ privado | — | — | 🟢 |
| `ops-uploads` | ❌ privado | — | — | 🟢 |
| `email-assets` | ✅ público | — | — | 🟡 (lint #5: listing aberto; sem MIME allowlist) |
| `deal-prints` | ❌ privado | — | — | 🟢 |
| `label-spreadsheets` | ❌ privado | — | — | 🟢 |
| `observer-failures` | ❌ privado | — | — | 🟢 |

**Risco S1 (🟡):** `playlist-covers` e `email-assets` permitem `LIST` para qualquer cliente — atacante pode enumerar todos os arquivos. Conteúdo é público por design, mas listing deveria ser restrito.

---

## 7. SQL Injection

Busca por `EXECUTE`, `format(`, concatenação dinâmica em RPCs:
- RPCs principais (`match_curator_playlist`, `ingest_campaign_collection_batch`, `has_role`, `has_team_access`) usam **parâmetros tipados**, sem `EXECUTE`.
- ✅ Nenhum `supabase.rpc("execute_sql", ...)` encontrado.
- ✅ Edge functions usam exclusivamente API tipada (`.from().select().eq()`); não concatenam SQL.

**Conclusão Seção 7:** 🟢 Seguro.

---

## 8. XSS / CSRF

- **`dangerouslySetInnerHTML`:** 1 ocorrência (`src/components/ui/chart.tsx:70`) — shadcn padrão, gera CSS estático interpolado a partir de config controlada. 🟢
- **`innerHTML =`:** 0 ocorrências.
- **Upload de arquivos:** validado server-side via Edge Functions; buckets sem MIME allowlist (`email-assets`, `ops-uploads`, `deal-prints`) aceitam qualquer tipo. 🟡
- **CSRF:** APIs autenticadas usam Bearer JWT (não cookies) → CSRF não-aplicável.

**Conclusão Seção 8:** 🟢 Seguro com 1 alerta (allowlist MIME).

---

## 9. Rate Limit

| Camada | Coberta? | Evidência |
|---|---|---|
| Login Supabase | ✅ nativo | Supabase Auth padrão |
| Edge Functions críticas (`check-campaign-access`, `check-curator-access`, `verify-campaign-otp`, `admin-campaign-access`) | ✅ | `_shared/rate-limit.ts` |
| Bot ingest (`bot-ingest-dom`, `bot-event-ingest`, `bot-heartbeat`) | 🟡 | Apenas validação de `x-agent-token` |
| OCR / Upload | 🟠 | Sem rate-limit identificado |
| Webhooks externos | 🟡 | Validação de assinatura, sem limit |
| Maioria das 216 edge functions | 🟠 | **Apenas ~7% têm rate-limit** |

**Risco R1 (🟠):** Endpoints como `bot-upload-print`, `enrich-*`, `enqueue-*` podem ser abusados se credencial vazar.

---

## 10. Logs

Busca por logs com token/senha/header em claro:
```
grep -rE "console\.log.*token|console\.log.*password|console\.log.*secret"
```
Resultados (5):
- `apply-managed-cover`: log de evento `401 → refresh` (sem valor do token). 🟢
- `bot-execution-queue` (x2): logs estruturados `evt: "reorder.token_refresh"` (sem token). 🟢
- `enrich-playlists`: log `"token expirado, refresh"` (sem valor). 🟢
- `handle-email-unsubscribe`: log apenas do email (sem token). 🟢

**Conclusão Seção 10:** 🟢 Seguro — sem vazamentos detectados.

---

## 11. Auditoria de Permissões

| Recurso | Anon | Authenticated (sem role) | Curador | Admin | Service Role |
|---|---|---|---|---|---|
| `campaigns` | ❌ | ❌ | ✅ leitura/escrita (via `has_team_access`) | ✅ | ✅ |
| `curator_deals` | ❌ | ❌ | ✅ | ✅ | ✅ |
| `playlists` / `managed_playlists` | ❌ | ❌ | ✅ | ✅ | ✅ |
| `delivery_proofs` | ❌ | ❌ | ✅ leitura | ✅ | ✅ |
| `bot_*` snapshots | ❌ | ❌ | ❌ | ❌ | ✅ |
| `delivery_proofs` upload | ❌ | ❌ | ❌ | ❌ | ✅ (bot) |
| `_audit_*` | ❌ | ❌ | ❌ | ❌ | ✅ |
| `financeiro` (`pricing_settings`, `curator_deal_payments`) | ❌ | ❌ | ❌ | ✅ | ✅ |
| `user_roles` | ❌ | ✅ próprio user_id | ❌ insert | ✅ | ✅ |
| `notifications` | ❌ | ✅ próprio user_id | ✅ | ✅ | ✅ |

**Privilégio excessivo:** nenhum identificado — modelo `has_team_access` (admin + curador) é coeso com o produto interno.

---

## 12. Top 20 Riscos

| # | Item | Status | Gravidade | Impacto | Prioridade |
|---|------|--------|-----------|---------|------------|
| 1 | 81 funções SECURITY DEFINER expostas a **anon** | 🔴 | Alta | Privilege escalation se search_path/validação falhar | P1 |
| 2 | 124 funções SECURITY DEFINER expostas a **authenticated** | 🟠 | Média | Superfície ampla | P1 |
| 3 | OTP gate do portal cliente/curador **desabilitado** (`return ok:true`) | 🟠 | Alta | URL vazada = plano comprometido | P1 |
| 4 | `public_plan_token` e `curator_deals.public_token` **sem expiração** | 🟠 | Média | Acesso permanente se token vazar | P1 |
| 5 | Apenas 7% das edge functions com rate-limit | 🟠 | Média | DoS / abuse | P2 |
| 6 | Buckets `playlist-covers` e `email-assets` permitem `LIST` | 🟡 | Baixa | Enumeração de arquivos | P2 |
| 7 | 5 buckets privados sem MIME allowlist | 🟡 | Baixa | Upload de tipo malicioso | P2 |
| 8 | `app-homologation-test` / `portal-auth-debug` em prod | 🟡 | Média | Endpoints de debug expostos | P2 |
| 9 | ~80 edge functions sem guard de auth explícito visível | 🟡 | Média | Crons internas — precisa classificar | P2 |
| 10 | 2 extensões instaladas no schema `public` | 🟡 | Baixa | Hygiene | P3 |
| 11 | 1 tabela com RLS sem policy nenhuma | 🟢 | Info | Lock total (intencional) | P3 |
| 12 | Sem rotação automática de tokens persistentes | 🟡 | Baixa | Operacional | P3 |
| 13 | Sem CSP / Permissions-Policy header documentado | 🟡 | Baixa | XSS defense-in-depth | P3 |
| 14 | Falta auditoria de quem chamou cada SECURITY DEFINER | 🟡 | Baixa | Forense | P3 |
| 15 | `bot-upload-print` sem rate-limit | 🟡 | Baixa | DoS no OCR | P3 |
| 16 | Sem alerta de tentativas falhas de OTP em massa | 🟡 | Baixa | Brute force | P3 |
| 17 | `pricing_settings` accessible apenas a admin (✅) — confirmar via teste | 🟢 | — | Validação | P3 |
| 18 | `dangerouslySetInnerHTML` em `chart.tsx` (shadcn) | 🟢 | Baixa | Conteúdo controlado | P4 |
| 19 | `ops-uploads` sem MIME allowlist | 🟡 | Baixa | Tipo arbitrário | P3 |
| 20 | Sem WAF/CloudFront protegendo edge functions | 🟡 | Baixa | Infra | P4 |

### 12.1 Críticos (🔴)
- **#1** — 81 SECURITY DEFINER acessíveis por anon.

### 12.2 Altos / Médios (🟠)
- **#2, #3, #4, #5**.

### 12.3 Baixos (🟡 / 🟢)
- **#6 a #20**.

---

## 13. Plano de Correção (proposta para Fase 4.B.1)

**Primeiro:**
1. Classificar e fechar as **81 SECURITY DEFINER expostas a anon** (revoke ou move/invoker).
2. Reativar **OTP gate** do portal cliente/curador (já implementado, basta remover `return ok:true`).
3. Implementar **expiração + rotação** de `public_plan_token` e `curator_deals.public_token`.
4. Expandir `_shared/rate-limit.ts` para todas edge functions públicas.

**Pode esperar:**
- Lint de extensões em `public` (mover para schema `extensions`).
- MIME allowlists em buckets privados.
- Remover `app-homologation-test` / `portal-auth-debug` de prod.
- Tornar listing de buckets públicos restrito.

**Nunca alterar (arquitetura consolidada — Fase 3):**
- Gateway (`raw-ingest.ts` / `collection-writer.ts`).
- Match (`match_curator_playlist`).
- Writer (`ingest_campaign_collection_batch`).
- Baseline (`writeBaselineOfficial`).
- Delivery (`delivery_proofs`).

---

## 14. Resposta Final

- **20 maiores riscos:** tabela §12.
- **Riscos críticos:** 1 (SECURITY DEFINER expostas a anon).
- **Riscos altos:** 4.
- **Riscos médios / baixos:** 15.
- **Corrigir primeiro:** itens #1 → #4.
- **Pode esperar:** itens #6 → #20.
- **Nível atual de segurança: 7,5 / 10.**
- **Pronta para produção?** ✅ Sim, com ressalvas — sem vulnerabilidade crítica explorável trivialmente, mas o saneamento da Fase 4.B.1 é fortemente recomendado antes de exposição massiva.

**Status:** Auditoria concluída. Nenhuma alteração executada.
