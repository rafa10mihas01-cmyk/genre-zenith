# Plano final aprovado: Baseline S4A — identidade por Playlist ID

Princípios consolidados:

1. **`playlist_id`** = identidade canônica (URL é só input/exibição).
2. **Coleta unificada**: baseline é a primeira coleta marcada `is_baseline=true`.
3. **Banco guarda só fatos imutáveis**. Sem delta, sem atribuição armazenada.
4. **Nome histórico** por coleta (`playlist_name_at_capture`).
5. **`first_seen_at`** registrado na primeira aparição do ID na campanha.
6. **Atribuição (curador / ecossistema / orgânico)** é classificação de negócio → resolvida em runtime pela view.

---

## Fluxo

```
1. Aprova campanha → baseline_status = 'pending'
2. Bot abre S4A da música → 1ª coleta = baseline
3. Toda playlist_id da baseline trava cadastro
4. Curador cola URL → extraímos playlist_id → valida anti-baseline
5. Coletas de 2 em 2 dias → mesma tabela, is_baseline=false
6. View resolve atribuição em runtime cruzando ecossistema + cadastros de curadores
7. Crescimento = view: latest.plays_7d − baseline.plays_7d
```

Entre 1 e 2 → portal do curador em "aguardando baseline".

---

## Banco (Fase 1)

**`campaign_playlist_collections`** — fatos imutáveis do S4A
- `campaign_id`
- `playlist_id` (identidade canônica)
- `playlist_url` (denormalizado, exibição)
- `playlist_name_at_capture` (nome no momento exato da coleta)
- `plays_7d` (fato bruto)
- `captured_at`
- `is_baseline` (true só na primeira)
- `first_seen_at` (primeira aparição do ID na campanha)
- `source` (`s4a_dom`)
- `proof_screenshot_url`

Sem `attributed_to`. Sem `delta`.

Índices:
- `(campaign_id, playlist_id, captured_at)`
- Parcial UNIQUE: `(campaign_id, playlist_id) WHERE is_baseline = true`

Trigger BEFORE INSERT para `first_seen_at`:
- Se já existe linha anterior com o mesmo `(campaign_id, playlist_id)` → copia o `first_seen_at` mais antigo.
- Senão → `first_seen_at = NEW.captured_at`.

**`curator_campaign_playlists`** — cadastros do curador
- `campaign_id`, `curator_id`, `deal_id` (shadow)
- `playlist_id` (NOT NULL, extraído da URL no submit)
- `playlist_url` (input original)
- `registered_at`
- `status` (`pending_match` | `matched` | `not_found_yet`)

Trigger anti-duplicata: bloqueia INSERT se `playlist_id` já está em `campaign_playlist_collections` com `is_baseline=true` da mesma campanha.

**Campos novos em `campaigns`:**
- `baseline_status` (`pending` | `captured` | `failed`)
- `baseline_captured_at`

**View `vw_campaign_playlist_growth`** (atribuição + delta em runtime):

Resolve `attributed_to` por LEFT JOIN:
1. Se `playlist_id` ∈ `curator_campaign_playlists` da campanha → `curator:<id>`
2. Senão se `playlist_id` ∈ playlists do ecossistema (alocações da campanha) → `ecosystem`
3. Senão → `organic`

Retorna por playlist: nome atual, nome no dia zero, baseline_plays, current_plays, delta, attributed_to, first_seen_at, baseline_at, last_captured_at.

Telas leem da view. Mudou regra de atribuição? Altera só a view, zero migração.

## Bot / Edge Functions (Fase 2)

- **`approve-campaign-plan`** → marca `baseline_status='pending'`, enfileira job urgente.
- **`bot-collect-queue`** → reconhece `baseline_capture` prioritário.
- **`bot-ingest-snapshot`** → branch único:
  - Sempre insere em `campaign_playlist_collections` com `playlist_name_at_capture` do DOM.
  - Se `baseline_status='pending'`: marca linhas dessa coleta como `is_baseline=true` e vira `captured`.
  - Senão: `is_baseline=false`.
- Helper `_shared/spotify-playlist-id.ts`: `extractPlaylistId(url)` aceita `open.spotify.com/playlist/<id>`, `spotify:playlist:<id>`, com/sem query.
- Plays do DOM do S4A. Print é evidência, não fonte.

## Portal do curador (Fase 3)

- Form: URL obrigatória → extrai `playlist_id` no submit.
- Campanha `awaiting_baseline` → form desabilitado com aviso.
- `playlist_id` já na baseline → erro "essa playlist já estava na foto inicial".
- Lista mostra status por cadastro.

## Telas da campanha (Fase 4)

- **Aba Baseline**: `WHERE is_baseline=true` — foto travada com nome histórico do dia zero.
- **Aba Execução**: lê da view, agrupa por `attributed_to` → Ecossistema · Curadores (por curador) · Orgânico.
- **Aba Histórico**: timeline por `playlist_id`, mostra `first_seen_at` e mudanças de nome.

## O que NÃO muda

- 9 deals legados intactos.
- Linguagem operacional ("baseline chegou", "curador entregou X").
- Sidebar, design system, PageHeader.

## Ordem de entrega

1. **Fase 1 — Banco** (2 tabelas + view + triggers + campos em `campaigns`)
2. **Fase 2 — Bot/Ingest** (extrator de ID + branch baseline + captura de nome)
3. **Fase 3 — Portal curador** (URL → ID + validação anti-baseline)
4. **Fase 4 — Telas** (Baseline / Execução / Histórico lendo da view)

Cada fase entregável e testável sozinha.

---

Aprove para eu começar a Fase 1 (migration do banco).
