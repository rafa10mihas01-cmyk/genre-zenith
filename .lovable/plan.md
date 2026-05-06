## FASE 5B — Segurança, Governança e Ciclo de Vida

Objetivo: transformar os estados do deal (`awaiting_playlists`, `active`, `paused`, `closed`, `completed`) em comportamento operacional real, sem tocar em tracking/snapshots/whitelist/cálculo/RPC.

---

### 1. Migrations (estrutura)

**`curator_deals` — campos de governança de token**
- `token_expires_at timestamptz` (nullable)
- `token_revoked_at timestamptz` (nullable)
- Index em `public_token` (se não houver)

**Trigger de coerência de token** (`BEFORE UPDATE` em `curator_deals`):
- Ao mudar `state` para `closed`/`completed` → setar `token_revoked_at = now()` se nulo
- Ao reabrir (`active`) → limpar `token_revoked_at` e estender `token_expires_at` se vencido

**FKs com `ON DELETE CASCADE` nas satélites** (eliminar órfãos):
- `bot_print_batches.deal_id` → `curator_deals(id)`
- `bot_print_batches.song_id` → `curator_deal_songs(id)` (SET NULL — bot pode existir sem song)
- `bot_events.deal_id` → `curator_deals(id)` ON DELETE SET NULL
- `bot_events.song_id` → `curator_deal_songs(id)` ON DELETE SET NULL
- `curator_fraud_alerts.deal_id` → `curator_deals(id)` ON DELETE CASCADE
- `curator_fraud_alerts.playlist_id` → `curator_playlists(id)` ON DELETE CASCADE
- `curator_paste_imports.deal_id` → `curator_deals(id)` ON DELETE CASCADE
- `curator_paste_imports.song_id` → `curator_deal_songs(id)` ON DELETE SET NULL

Limpeza de órfãos existentes ANTES do `ALTER TABLE` para não falhar.

---

### 2. Helper compartilhado de validação

`supabase/functions/_shared/deal-access.ts` — função `assertDealOperable(deal)`:
- `state === 'closed' || state === 'completed'` → `403 deal_closed`
- `state === 'paused'` → `403 deal_paused`
- `token_revoked_at != null` → `403 token_revoked`
- `token_expires_at != null && token_expires_at < now()` → `403 token_expired`
- Caso contrário → ok

Slug continua sendo só URL amigável; o gate real é `public_token` + `state` + `revoked` + `expires`.

---

### 3. Edge Functions — aplicar gate

Aplicar `assertDealOperable` ANTES de qualquer mutação/ingestão em:
- `register-curator-playlist` (já tem lock; adicionar gate antes)
- `curator-paste-import` (se existir)
- `auto-collect-curator` / loop de coleta — antes de processar cada deal, filtrar por `state IN ('active','awaiting_playlists')` e token válido
- Qualquer função de upload de print/snapshot manual disparada pelo curador público

Leituras (relatório, histórico, view-only) continuam permitidas em `closed`/`completed` — apenas mutações são bloqueadas.

---

### 4. Queue / coleta automática respeitando estado

No worker que enfileira coleta (provavelmente `auto-collect-curator` cron):
- Query base: `WHERE state IN ('active') AND (token_expires_at IS NULL OR token_expires_at > now()) AND token_revoked_at IS NULL`
- `paused`/`closed`/`completed` ficam fora da fila
- Histórico permanece intacto (sem deletar nada)

---

### 5. Encerramento consistente

Ao mover para `closed`/`completed` (já existe `closed_at`):
- Trigger seta `token_revoked_at = now()`
- Edge functions de mutação retornam 403
- UI já mostra estado fechado (sem mudança)
- Snapshots/logs/playlists existentes ficam read-only por efeito do gate (não por RLS — RLS continua igual para o dono)

Reabrir um deal: setar `state='active'`, limpar `closed_at`, `token_revoked_at`, opcionalmente renovar `token_expires_at`.

---

### 6. UI — mínimo necessário

- `CuratorPage` (portal público): se backend retornar `403 deal_closed/paused/expired/revoked`, mostrar tela "Deal encerrado/pausado/link expirado" em vez de erro genérico
- Painel interno (`PlaylistDealsPage` ou `CuratorDealCard`): badge visual quando `token_revoked_at` ou `token_expires_at < now()`

Sem alterar lógica de cálculo, whitelist, snapshots ou tracking.

---

### Arquivos a editar/criar

**Migrations:**
- nova migration: colunas de token, trigger, FKs, índices, limpeza prévia de órfãos

**Edge functions:**
- `supabase/functions/_shared/deal-access.ts` (novo)
- `supabase/functions/register-curator-playlist/index.ts` (gate)
- `supabase/functions/auto-collect-curator/index.ts` (filtro de fila) — confirmar nome real
- demais funções de mutação curador → aplicar gate

**Frontend:**
- `src/pages/CuratorPage.tsx` (mensagens 403)
- `src/components/PlaylistDeals/CuratorDealCard.tsx` (badge expirado/revogado, se aplicável)

---

### Garantias finais

1. Token deixa de funcionar automaticamente ao fechar/completar deal
2. Slug não autentica nada por si só
3. `paused` realmente pausa coleta e ingestão
4. `closed`/`completed` são read-only operacional
5. Satélites não geram mais órfãos silenciosos
6. Core (tracking, snapshots, delta, whitelist, RPC) permanece intocado

Aguardando aprovação para executar.