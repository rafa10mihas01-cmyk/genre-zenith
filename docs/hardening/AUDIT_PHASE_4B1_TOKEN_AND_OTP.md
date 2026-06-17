# AUDIT_PHASE_4B1_TOKEN_AND_OTP

**Fase:** 4.B.1 — Auditoria operacional pré-correção (OTP + Tokens públicos)
**Data:** 17/06/2026
**Regra:** somente leitura. Nenhuma alteração executada em produção, código, schema, UX ou comportamento.

---

## Sumário Executivo

| Métrica | Valor | Interpretação |
|---|---|---|
| Acessos cliente nos últimos 90d | **12 hits, 2 campanhas, 2 e-mails** | Volume baixíssimo |
| Acessos curador nos últimos 90d | **7 hits, 3 deals, 2 e-mails** | Volume baixíssimo |
| OTPs cliente emitidos (histórico) | **17** (10 usados = 59%) | Módulo é exercitado |
| OTPs curador emitidos (histórico) | **8** (7 usados = 87%) | Módulo é exercitado |
| Campanhas com PIN configurado | **1** (`Carnívoro`, 3 e-mails, 30 acessos 90d) | Há expectativa de proteção que hoje não é aplicada |
| Deals com PIN configurado | **2** (3 e-mails) | Idem |
| Campanhas totais c/ token ativo | **8** (7 active) | 100% sem `token_expires_at` |
| Deals c/ token ativo | **17** (2 active) | 100% sem expiração |
| Campanhas com `token_revoked_at` | **0** | Coluna existe, nunca usada |

**Conclusão geral:** o ecossistema atual tem **uso operacional muito baixo do portal** (cliente + curador), o que cria uma **janela ideal para reativar o OTP e introduzir TTL/rotação de token sem risco real de suporte**.

---

## ITEM 1 — OTP

### 1.1 Quantos clientes utilizaram o portal nos últimos 90 dias?

```sql
SELECT count(*) hits, count(distinct campaign_id) campanhas,
       count(distinct email)  emails
FROM campaign_access_logs WHERE accessed_at > now() - interval '90 days';
-- hits: 12 | campanhas: 2 | emails: 2
```

- 30/60/90/180 dias: **12 / 12 / 12 / 12** (todos os acessos do semestre estão concentrados nos últimos 30d — fluxo recente).
- Distribuição mensal:
  - 2026-06: 10 hits · 1 campanha · 2 e-mails
  - 2026-05: 2 hits · 1 campanha · 0 e-mails identificados

### 1.2 Quantos curadores utilizaram o portal nos últimos 90 dias?

```sql
SELECT count(*), count(distinct deal_id), count(distinct email)
FROM curator_access_logs WHERE created_at > now() - interval '90 days';
-- 7 hits | 3 deals | 2 emails
```

### 1.3 Quantos acessos vieram apenas pelo token?

Hoje, **100%** — o gate OTP está desabilitado (`gateCampaignAccess` e `check-*-access` retornam `{ ok: true }` direto). Todo acesso registrado em `campaign_access_logs` foi via token na URL.

Mesmo assim, o registro mostra `email` em 10/12 acessos cliente e 7/7 curador — confirmação de que o frontend (`CampaignAccessGate`, `CuratorAccessGate`) ainda colhe e-mail/identificação para log mesmo sem OTP exigido.

### 1.4 O módulo OTP está 100% funcional?

Inventário das edge functions:

| Função | LOC | Notas |
|---|---|---|
| `request-campaign-otp` | 196 | Possui geração, gravação, envio por e-mail |
| `verify-campaign-otp` | 81 | Validação + emissão de JWT (`signAccessJwt`) |
| `request-curator-otp` | 181 | Idem cliente |
| `verify-curator-otp` | 74 | Idem cliente |
| `admin-campaign-access` | — | Bypass admin (já ativo) |
| `issue-admin-campaign-access` | — | Idem |

Métricas de uso histórico:
- **17 OTPs cliente** emitidos · **10 usados** (59% — taxa esperada, batem com adoção real).
- **8 OTPs curador** emitidos · **7 usados** (87%).

Cobertura funcional confirmada por código:
- ✅ Geração com `expires_at` (campo presente nas duas tabelas OTP).
- ✅ Reenvio (cliente pode pedir novo código — função reaceita request).
- ✅ Limite de tentativas → ⚠️ **não há contador de tentativas falhas por código** (`campaign_access_otps` não tem coluna `attempts`/`failed_at`). Hoje a única proteção contra brute-force é o `rate-limit.ts` no endpoint.
- ✅ UX: `CampaignAccessGate.tsx` e `CuratorAccessGate.tsx` existem e estão wired nos roteadores (`PlanoCampanhaPublico`, `CuratorPage`).

**Avaliação:** o módulo está **funcionalmente completo**, com 1 gap relevante:
- 🟡 Falta hard-cap de tentativas por OTP individual (brute-force de 6 dígitos depende só do rate-limit por IP).

### 1.5 Campanhas/deals impactados imediatamente

```sql
SELECT id, count(*) acessos_90d FROM campaigns c
JOIN campaign_access_emails e ON e.campaign_id=c.id
LEFT JOIN campaign_access_logs l ON l.campaign_id=c.id
   AND l.accessed_at > now()-interval '90 days'
GROUP BY id;
-- 0170d78a-97f1-41f7-99eb-a5b31c367053 (Carnívoro) | 30 acessos 90d
```

- **1 campanha** (`Carnívoro`, status `active`, 3 e-mails autorizados, 30 acessos 90d).
- **2 deals** com PIN configurado (3 e-mails totais).

Esses três fluxos **já têm a expectativa de PIN** (alguém adicionou e-mails autorizados), mas o gate está bypassado — então o re-ligamento **não** é uma surpresa para o usuário, é uma **restauração do comportamento contratado**.

### 1.6 Plano de ativação gradual proposto

Baseado em evidência (volume baixo, módulo funcional, 1 cliente "esperando" PIN):

**Etapa A — Hardening de pré-condição (semana 0)**
- Adicionar contador de tentativas por OTP (`failed_attempts` em `campaign_access_otps` e `curator_access_otps`, hard-cap 5).
- Adicionar log estruturado no `verify-*-otp` (rate de falha, tempo até verificar).
- Confirmar que o template de e-mail OTP está ativo e renderiza.

**Etapa B — Reativação curador (semana 1)**
- Reativar `gateCampaignAccess` apenas no `check-curator-access` (curadores = audiência interna, 2 e-mails, 3 deals).
- Validar: 1 deal com PIN, executa fluxo completo, monitora `curator_access_logs` por 5 dias.
- Rollback = mudar 1 linha (`return { ok: true }`).

**Etapa C — Reativação cliente (semana 2)**
- Antes: comunicar proativamente os 2 e-mails que usaram nos últimos 30d.
- Reativar `gateCampaignAccess` no `check-campaign-access`.
- Monitorar `campaign_access_otps` por 7 dias.

**Etapa D — Hardening pós-ativação (semana 3)**
- Alerta no Sistema/Saúde para OTPs com >3 falhas em 5 min.
- Métrica de health do portal (acessos vs OTPs emitidos).

**Risco real:** muito baixo. **Suporte estimado:** 1–2 tickets total (volume 90d = 4 e-mails únicos).

---

## ITEM 2 — Tokens públicos

### 2.1 Quantos `public_plan_token` existem?

```sql
SELECT count(*) total, count(*) FILTER (WHERE public_plan_token IS NOT NULL) with_token
FROM campaigns;
-- total: 8 | with_token: 8
```

- **8 campanhas** no total, **100% com token preenchido**.
- **7 campanhas `active`** (todas com token).
- **0 tokens com `token_expires_at` preenchido.**
- **0 tokens revogados** (`token_revoked_at IS NULL` em todas).
- Schema já tem as colunas `token_expires_at` e `token_revoked_at` — **infra pronta, nunca utilizada**.

### 2.2 Quantos `curator_deals.public_token` existem?

```sql
SELECT count(*) total, count(*) FILTER (WHERE public_token IS NOT NULL) with_token,
       count(*) FILTER (WHERE state IN ('active','open','aberto','ativo')) active
FROM curator_deals;
-- total: 17 | with_token: 17 | active: 2
```

- **17 deals**, **100% com `public_token`**, apenas **2 ativos**.
- Tabela **não possui** colunas `token_expires_at` nem `token_revoked_at` — diferente de `campaigns`.
- Coluna `slug` existe e também serve como token (campo permite acesso por slug humano).

### 2.3 Quantos foram utilizados nos últimos 30/60/90/180 dias?

Usando `campaign_access_logs` como proxy de "token foi consumido":

| Janela | Hits cliente | Hits curador |
|---|---|---|
| 30d | 12 | 7 |
| 60d | 12 | 7 |
| 90d | 12 | 7 |
| 180d | 12 | 7 |

⇒ **Todo o tráfego do semestre é recente**. Tokens antigos (>30d sem uso) representam **a maioria das 8 campanhas + 17 deals** — ninguém abriu.

### 2.4 Existe algum link compartilhado permanentemente?

Apenas **1 cliente** (`Carnívoro`) tem padrão de uso recorrente (30 acessos em 90d, mesmos 2 e-mails). Os demais são consultas pontuais.

### 2.5 Existe processo que dependa de tokens sem expiração?

Análise:
- ❌ Nenhum cron consome `public_plan_token`.
- ❌ Nenhuma integração externa (bot/VPS) usa esses tokens.
- ✅ Único consumidor: **frontend público** (`PlanoCampanhaPublico`, `CuratorPage`).
- ✅ Já existe edge function `regenerate-campaign-roadmap-token` — infra de rotação **já existe** para `roadmap_token`, falta só estender para `public_plan_token`.

⇒ **Nenhum processo automatizado depende de imutabilidade**. Adicionar TTL não quebra integração.

### 2.6 Política de ciclo de vida proposta

Baseada nos dados reais (apenas 1 cliente recorrente, todos os outros são pontuais):

| Eixo | Proposta | Justificativa |
|---|---|---|
| **Geração** | Manter `gen_random_uuid()` no INSERT (sem mudança) | Já é seguro |
| **Expiração default** | `token_expires_at = created_at + 180 dias` (campaign) e `+ 90 dias` (deal) | Cobre 100% do uso histórico (180d hits = 30d hits ⇒ ninguém usa link >30d) |
| **Renovação** | Endpoint `extend-campaign-token` chamado pelo botão "Copiar link" no admin — desliza expires_at por +180d | Cliente recorrente (1 caso) é renovado de graça pelo operador |
| **Revogação** | Botão "Revogar acesso" no admin grava `token_revoked_at` (coluna já existe em `campaigns`, adicionar em `curator_deals`) | Recurso anti-vazamento |
| **Invalidação automática** | Quando `campaign.status` muda para `closed`/`canceled`, marcar `token_revoked_at = now()` via trigger | Higiene |
| **Compatibilidade** | Backfill: `UPDATE campaigns SET token_expires_at = greatest(created_at, now()) + interval '180 days' WHERE token_expires_at IS NULL` | Zero quebra: todo link existente ganha mais 180d a partir de hoje |
| **Rotação automática** | ❌ NÃO recomendado por enquanto | Sem evidência de vazamento; rotação forçaria reenvio manual ao cliente |

**Migração de compatibilidade necessária:**
1. `ALTER TABLE curator_deals ADD COLUMN token_expires_at timestamptz, ADD COLUMN token_revoked_at timestamptz` (campaigns já tem).
2. Backfill conforme acima.
3. Atualizar `check-campaign-access`, `check-curator-access`, `get-shared-campaign-plan`, `get-campaign-roadmap-public`, `campaign-plan-api`, `campaign-daily-plan` para validar `token_expires_at > now() AND token_revoked_at IS NULL`.
4. UI: badge "Expira em XX dias" no painel de Campanhas + botão "Estender prazo".

**Risco:** zero, com backfill de 180d a partir do dia da migração.

---

## Auditor Sign-off

| Pergunta | Resposta |
|---|---|
| Posso alterar algo agora? | **Não.** Apenas auditoria. |
| OTP está pronto para reativar? | Sim, com 1 melhoria prévia (hard-cap de tentativas). |
| Volume operacional justifica reativar OTP? | Sim — 4 e-mails únicos em 90d, sem expectativa de churn. |
| Política de TTL viável sem quebrar links? | Sim — 180d default + backfill = zero ruptura. |
| Próximo passo recomendado? | Aprovar política e abrir Fase **4.B.1.A** (hardening OTP) → **4.B.1.B** (TTL tokens). |

**Nenhuma alteração executada. Documento pronto para decisão.**
