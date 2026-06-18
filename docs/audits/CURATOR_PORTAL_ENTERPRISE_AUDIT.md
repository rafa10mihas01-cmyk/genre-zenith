# FASE 7.2 — Auditoria Enterprise do Portal do Curador

Modo: **READ ONLY**. Nada foi alterado.

Data: 2026-06-18

---

## 0. TL;DR (causa raiz primeiro)

| Sintoma | Causa raiz | Evidência |
|---|---|---|
| **"Link inválido ou expirado"** ao abrir o portal por curadores com e-mail cadastrado | Bug de integração frontend↔backend: o `CuratorAccessGate` autentica via OTP, recebe um JWT (24h), grava em `localStorage`, mas o `CuratorPage.load()` chama `supabase.functions.invoke("get-curator-deal-public", ...)` **sem repassar o JWT no header `x-portal-jwt`/`Authorization`**. O `gateCuratorAccess` em `_shared/portal-auth.ts` lê esses headers (linha 23), não acha JWT, e responde `401 otp_required`. O frontend trata isso como "link expirado". | `src/pages/CuratorPage.tsx:487-490` invoca sem header; `src/components/public/CuratorAccessGate.tsx:80` só grava no localStorage; `supabase/functions/_shared/portal-auth.ts:23,106` exige header. **6 deals** têm curador com e-mail cadastrado → todos afetados. |
| Cards "Sem dados" / "—" mesmo com coleta ativa | Dados ricos **existem** no banco (`delivery_proofs` 400 linhas, `curator_deal_snapshots` 1.371, `song_snapshot_playlists` 34k, `label_spreadsheet_rows`), mas não chegam ao payload do portal nem são renderizados por playlist. | ver Item 7. |
| Lista de playlists do curador sem ordenação por entrega | Ordenação atual é por `added_at ASC` (data de cadastro). | `get-curator-deal-public/index.ts:109` |
| Excel importado "some" | Os arquivos ficam em `label_spreadsheet_uploads` (17 uploads, com `file_path`, `content_hash`, `reference_date`, `is_baseline`, `superseded_by`) mas o portal **não expõe** essa lista ao curador nem permite re-download. | ver Item 5. |
| Prints não visíveis para o curador | Os prints estão em `curator_deal_snapshots.print_url` e `delivery_proofs.screenshot_url`, vinculados a `deal_id` + `playlist_id` + `captured_at`, mas o portal só usa o `print_url` como provador interno; não há galeria por playlist. | ver Item 4. |

---

## 1. Arquitetura reconstruída

```text
Browser  ─►  /c/:token  (CuratorPage.tsx)
              │
              ├─ check-curator-access  ──►  curators.email / curator_deal_access_emails
              │
              ├─ CuratorAccessGate  (se required)
              │     │
              │     ├─ request-curator-otp  ──►  curator_access_otps (TTL 10min, 3/h)
              │     │                          + enqueue_email (template OTP)
              │     │
              │     └─ verify-curator-otp   ──►  signCuratorAccessJwt (HS256, 24h)
              │                                  └─ localStorage  curator_access_jwt:<token>
              │
              └─ get-curator-deal-public  (slug | public_token)
                    │  ⚠ não envia x-portal-jwt
                    ├─ gateCuratorAccess  ─►  401 otp_required  ◄── BUG
                    │
                    ├─ v_curator_playlists_operational  (lista playlists)
                    ├─ curator_deal_songs                (músicas do deal)
                    ├─ rpc get_curator_deal_progress    (delivered, pct, eta)
                    ├─ rpc get_curator_deal_snapshot_history
                    └─ curator_deal_snapshots           (últimos prints/plays)
```

Tabelas/views chave já existentes:

- `curator_deals` (17) — slug, public_token, token_expires_at (180d), token_revoked_at
- `curator_deal_songs` (35 cols por música)
- `curator_deal_snapshots` (1.371 linhas) — `print_url`, `plays`, `plays_24h/7d/28d`, `playlist_id`, `song_id`, `captured_at`, `is_initial_capture`, `match_method`, `flagged`
- `delivery_proofs` (400 linhas, 2 deals) — `screenshot_url`, `position_in_playlist`, `plays_total/24h/7d`, `captured_at`, `bot_correlation_id`
- `curator_playlists` (30 cols) — `streams_7d/28d/total`, `last_paste_at`, `image_url`, `match_status`
- `label_spreadsheet_uploads` (17, 1 deal) — `file_path`, `file_name`, `content_hash`, `reference_date`, `rows_imported`, `is_baseline`, `superseded_by`, `window_kind`, `quarantine_signals`
- `label_spreadsheet_rows` — uma linha por (upload × playlist), com `streams`, `matched_playlist_id`, `matched_curator_id`
- `curator_access_otps` (10 linhas, 2 usadas) — OTP 10min, lockout em 5 falhas, rate 3/h por email
- `curator_access_logs` — auditoria de login

---

## 2. Origem dos campos da tela

| Bloco no portal | Origem real | Quem grava | Quando atualiza | Porque pode aparecer vazio |
|---|---|---|---|---|
| Header (curador/música/cover) | `curator_deals` | criação do deal | manual | nunca vazio |
| Progresso (delivered, pct, ETA) | rpc `get_curator_deal_progress` (agrega `curator_deal_snapshots`) | bot/admin via S4A + import Excel | a cada snapshot/import | vazio se zero snapshots; **não desce por playlist** |
| Histórico semanal | rpc `get_curator_deal_snapshot_history` | mesmo acima | mesmo | idem |
| Playlists do curador | `v_curator_playlists_operational` (filtra `match_status=curator`) | cadastro do curador + enrich Spotify | on submit | **sem coluna de entrega/crescimento por playlist no payload**, mesmo com `streams_7d/28d/total` existindo em `curator_playlists` |
| Baseline (initial roster) | mesma view com `is_initial_roster=true` | observer/baseline pipeline | snapshot baseline | só nome+link no payload |
| Prints | `curator_deal_snapshots.print_url` (último) | analyze-deal-prints, bot, admin | a cada print | curador só vê o último; **histórico por playlist não exposto** |
| Excel | `label_spreadsheet_uploads` | import do Excel pelo curador | a cada upload | **nenhum bloco no portal renderiza** uploads passados |
| Posição na playlist | `delivery_proofs.position_in_playlist` (bot) e `curator_deal_snapshots.notes` | bot/AI | a cada print | **não exposto no payload do portal** |

---

## 3. Aba "Curador" — auditoria por item

| Pergunta | Resposta atual | Disponível no banco? |
|---|---|---|
| Como playlists são ordenadas? | `ORDER BY added_at ASC` (data de cadastro) | sim — `curator_playlists.streams_7d/28d/total` permite ordenar por entrega real |
| Delivery individual por playlist? | **não exposto** | sim — `curator_deal_snapshots.plays_24h/7d/28d` agrupado por `playlist_id` |
| Crescimento por playlist? | **não exposto** | sim — basta diferença entre snapshots consecutivos por `playlist_id` |
| Baseline da playlist? | só dentro do bloco "initial roster"; sem valor numérico | sim — `curator_deal_snapshots WHERE is_initial_capture=true` |
| Última coleta? | só agregado do deal; não por playlist | sim — `max(captured_at) GROUP BY playlist_id` |
| Posição? | **não exposto** | sim — `delivery_proofs.position_in_playlist` e `curator_playlists.position_in_paste` |
| Print? | só o último, sem filtro por playlist | sim — `delivery_proofs.screenshot_url` + `curator_deal_snapshots.print_url` por playlist |
| Excel? | **não exposto** | sim — `label_spreadsheet_uploads` + `_rows` |

---

## 4. Prints — vinculação

- **Storage**: URL pública em `curator_deal_snapshots.print_url` e `delivery_proofs.screenshot_url` (bucket storage; gerado por `analyze-deal-prints` e pelo bot/admin via S4A).
- **Vínculos existentes**:
  - `deal_id` ✅ (FK em ambas as tabelas)
  - `playlist_id` ✅ (FK; 400/400 em delivery_proofs)
  - `song_id` ✅ (em snapshots)
  - `captured_at` ✅ (timestamp dedicado)
  - `bot_correlation_id` / `batch_id` ✅ (rastreio do lote)
  - **`reference_date`** ⚠ existe apenas em `label_spreadsheet_uploads`. Prints não têm campo `reference_date`; só `captured_at`. Funcionalmente equivalente para timeline, mas não há link explícito print↔upload do mesmo dia.
- **Visibilidade pelo curador**: ❌. O portal devolve apenas o último `print_url` em `latestSnaps`. Não há endpoint que liste todos os prints por (deal, playlist).

---

## 5. Excel — auditoria

| Pergunta | Resposta |
|---|---|
| Fica salvo? | ✅ `label_spreadsheet_uploads.file_path` (storage) + `content_hash` |
| Vinculado ao deal? | ✅ FK `deal_id` + `song_id` |
| Pode ser baixado de novo? | ❌ portal não expõe; admin sim |
| Histórico? | ✅ `created_at` + `reference_date` + `superseded_by/_at` + `is_baseline` |
| Versionamento? | ✅ `superseded_by` aponta para versão substituta; `window_kind/days` registra janela |
| Auditoria? | ✅ `uploaded_by`, `uploaded_via`, `quarantined_at`, `quarantine_reason`, `quarantine_signals` |

**Conclusão**: backend completo, **UI inexistente para o curador**. Falta apenas listar `label_spreadsheet_uploads WHERE deal_id=? ORDER BY reference_date DESC` no payload + botão download via signed URL.

---

## 6. Links públicos — causa raiz "Link expirado"

### Investigação por fluxo

| Mecanismo | Estado |
|---|---|
| TTL no token | ✅ `token_expires_at = now()+180d`. Hoje **nenhum** dos 17 deals está expirado (todos com TTL > 179 dias). |
| Revogação | ✅ `token_revoked_at`. **0 deals revogados** hoje. |
| Cache HTTP | ❌ Edge function não seta `Cache-Control`. Sem cache envolvido. |
| Assinatura | JWT HS256 com `SUPABASE_SERVICE_ROLE_KEY` como segredo (`curator-access-jwt.ts:3`). Funciona. |
| Renovação automática | ❌ não existe. Após 24h o curador precisa pedir novo OTP. |
| Mais de um fluxo gerando links? | Não — único fluxo: `slug | public_token` em `curator_deals`. Sem links concorrentes. |

### Causa raiz **real** do erro mostrado ao usuário

O texto "Link inválido ou expirado" no `CuratorPage.tsx:875` é exibido sempre que `error` é truthy. Há **três caminhos** que setam `error`:

1. **`get-curator-deal-public` devolve `ok:false`** → o motivo mais comum **não é** TTL expirado. É `otp_required` (HTTP 401), porque:
   - Há 6 deals onde `curators.email IS NOT NULL` → `dealHasAllowlist()` retorna `true`.
   - O frontend autentica o curador via OTP e guarda o JWT em `localStorage`.
   - **Bug**: `CuratorPage.load()` chama `supabase.functions.invoke("get-curator-deal-public", { body: { slug: publicToken } })` **sem opção `headers`**, então o JWT nunca viaja.
   - `gateCuratorAccess` recebe a request sem `x-portal-jwt` nem `Authorization` (além do anon padrão do supabase-js, que não é Bearer do JWT do portal), e responde `401 otp_required`.
   - O frontend mostra "Link inválido ou expirado".

2. **`token_revoked_at` setado** → `error: "token_revoked"`. Hoje 0 deals.

3. **`token_expires_at < now()`** → `error: "token_expired"`. Hoje 0 deals.

Os campos `token_expires_at`/`token_revoked_at` só são checados quando o endpoint é chamado por `public_token` cru, **não** por `slug`. Como o frontend manda `slug: publicToken`, essa checagem nem roda na maioria das chamadas (o token padrão de URL é o `slug`).

**Conclusão sobre o link expirado**: não é TTL, não é cache, não é revogação. É a falha do frontend em propagar o JWT do gate para a chamada de dados. Curadores **sem** e-mail cadastrado (10 deals) entram normalmente; curadores **com** e-mail (6 deals) sempre veem "expirado".

---

## 7. Dados ausentes (matriz "Sem dados" → realidade)

| Bloco que aparece vazio | Dado existe? | Onde |
|---|---|---|
| Delivery por playlist | ✅ existe | `curator_deal_snapshots.plays_24h/7d/28d` por `playlist_id` |
| Crescimento por playlist | ✅ existe | diferença entre 2 snapshots consecutivos por playlist |
| Posição por playlist | ✅ existe | `delivery_proofs.position_in_playlist` |
| Última coleta por playlist | ✅ existe | `max(captured_at)` por `playlist_id` |
| Streams 7d/28d por playlist | ✅ existe | `curator_playlists.streams_7d/28d/total` |
| Galeria de prints | ✅ existe | `curator_deal_snapshots.print_url` + `delivery_proofs.screenshot_url` |
| Histórico de Excel | ✅ existe | `label_spreadsheet_uploads` |
| Linhas do Excel por playlist | ✅ existe | `label_spreadsheet_rows` |
| Baseline numérica | ✅ existe | `curator_deal_snapshots WHERE is_initial_capture=true` |
| Followers por playlist | ✅ existe | `v_curator_playlists_operational.followers` (já vai no payload, mas raramente renderizado) |

Não foi encontrado nenhum bloco do portal cujo dado **realmente não exista** no banco.

---

## 8. Matriz final

| Funcionalidade | Dados existem | Backend pronto | UI pronta | Falta integração | Está quebrado |
|---|:-:|:-:|:-:|:-:|:-:|
| Login via OTP | ✅ | ✅ | ✅ | — | — |
| Renovação automática de JWT | ✅ | ❌ | ❌ | — | — |
| Sessão JWT → API protegida | ✅ | ✅ | ❌ | **sim** | **sim — "link expirado"** |
| Lista de playlists | ✅ | ✅ | ✅ | — | ordenação por entrega |
| Delivery por playlist | ✅ | parcial | ❌ | sim | — |
| Crescimento por playlist | ✅ | ❌ (sem RPC dedicada) | ❌ | sim | — |
| Posição na playlist | ✅ | ✅ (delivery_proofs) | ❌ | sim | — |
| Última coleta por playlist | ✅ | ❌ (sem agregação no payload) | ❌ | sim | — |
| Galeria de prints | ✅ | ❌ (sem endpoint listar) | ❌ | sim | — |
| Histórico de Excel | ✅ | ❌ (não no payload) | ❌ | sim | — |
| Download do Excel | ✅ | ❌ (sem signed URL) | ❌ | sim | — |
| Baseline numérica | ✅ | parcial | parcial | sim | — |
| TTL do token | ✅ | ✅ | ✅ | — | — |
| Revogação manual | ✅ | ✅ | ❌ admin não tem botão | — | — |

---

## Conclusão

1. **O Portal do Curador já tem dados suficientes para ser Enterprise.** ~90% do que falta para parecer "rico" já está coletado e armazenado.
2. **Informações que existem e não aparecem**: delivery/crescimento/posição/última coleta **por playlist**, galeria de prints, histórico e download de Excel, baseline numérica por playlist. Todos disponíveis em `curator_deal_snapshots`, `delivery_proofs`, `curator_playlists`, `label_spreadsheet_uploads/_rows`.
3. **Causa raiz dos "links expirados"**: bug de propagação de JWT — o `CuratorAccessGate` autentica e guarda o JWT no `localStorage`, mas `CuratorPage.load()` não envia esse JWT no header `x-portal-jwt`/`Authorization` ao chamar `get-curator-deal-public`. O backend responde `otp_required (401)` e o frontend exibe "Link inválido ou expirado". Afeta exclusivamente os 6 deals com `curators.email` preenchido. **Não é** TTL, cache, revogação ou múltiplos fluxos.
4. **Causa raiz dos blocos vazios**: o endpoint `get-curator-deal-public` retorna a lista de playlists sem juntar as métricas por playlist; o frontend, por sua vez, não tem componentes para exibi-las. Não é falta de coleta.
5. **Melhorias que dependem apenas de integração** (sem novo bot/tabela/coleta):
   - Adicionar `headers: { "x-portal-jwt": jwt }` em `supabase.functions.invoke("get-curator-deal-public", ...)` (e demais chamadas do portal).
   - Mudar `ORDER BY added_at` para `ORDER BY streams_7d DESC NULLS LAST` em `v_curator_playlists_operational`.
   - Incluir no payload: `delivery_per_playlist` (agregação de `curator_deal_snapshots` por `playlist_id`), `prints` (lista `delivery_proofs` + `curator_deal_snapshots.print_url`), `uploads` (lista `label_spreadsheet_uploads` com signed URLs).
   - Endpoint dedicado de signed URL para `file_path` do Excel.
   - Job de "refresh JWT" antes do `exp` (opcional; mitiga o passo 1 caso a sessão dure mais de 24h).

Nada disso exige novas tabelas, novos bots ou novas coletas. É exclusivamente trabalho de **payload + componente**.
