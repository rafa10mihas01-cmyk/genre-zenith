## Onda 4 — Leitura via `v_curator_library` (sombra → produção)

**Objetivo:** parar de ler `curator_playlist_library` (tabela física, desatualizada e duplicada com ecossistema) e passar a ler da view `v_curator_library`, que agrega `curator_playlists` em tempo real e já marca `is_ecosystem`. Notes/status continuam vivendo na tabela legada — só a fonte de verdade da listagem muda.

### Por que

- Hoje `useCuratorLibrary` lê de `curator_playlist_library` (449 linhas, fonte editorial paralela) e cruza com `v_curator_library` só pra setar `is_ecosystem`. Resultado: 2 queries, dados podem divergir, playlist que foi declarada em deal real mas nunca passou pela "library" não aparece.
- A view `v_curator_library` agrega `curator_playlists` direto (4648 linhas) → reflete o que de fato foi declarado nas campanhas. Já marca `is_ecosystem`, `times_used`, `streams_7d_total`, `streams_lifetime_total`, `spotify_dead`.

### Mudanças

**1. `src/hooks/useCuratorLibrary.ts` — load()**
- Trocar leitura principal: `from("curator_playlist_library")` → `from("v_curator_library")`. Remove o `ecoRes` separado (já vem na view).
- A view não tem `id`, `status`, `notes`, `created_at`, `updated_at`. Faz LEFT JOIN client-side com `curator_playlist_library` (mesmo curator, mesmo `spotify_playlist_id`) só pra hidratar `id`/`status`/`notes`. Default: `status='active'`, `notes=null`, `id` = composto `${curator_id}:${spotify_playlist_id}`.
- Mantém `statsRes` e `perfRes` (views legadas continuam funcionando enquanto existirem).
- Mantém o bloco de `genresByLibrary` intacto.

**2. Mutations (`addManual`, `updateStatus`, `remove`)**
- `addManual`: mantém INSERT em `curator_playlist_library` (registra intenção editorial). A view só vai mostrar quando a playlist for de fato declarada em deal.
- `updateStatus` / `remove`: continuam operando em `curator_playlist_library` por `id` legado. Quando o item vier só da view (sem registro na library), o botão de status/remove fica desabilitado na UI (próxima onda) — nesta onda, se `id` for sintético, `updateStatus`/`remove` viram no-op com toast informativo.

**3. `supabase/functions/get-client-campaign-public/index.ts` (linha 453)**
- Enriquecimento de nome/cover continua usando `curator_playlist_library` (é só fallback de metadata, não fonte primária). **Sem mudança nesta onda.**

**4. Interface `CuratorLibraryPlaylist`**
- Tornar opcionais os campos que a view não fornece: `user_id`, `first_seen_at`, `created_at`, `updated_at`. `status` ganha default `'active'`. `notes` default `null`.

### O que NÃO muda

- Zero migration. View já existe (criada na Onda 2).
- `curator_playlist_library` continua existindo, escrita e RLS intactas.
- `fn_deal_delivery_accumulated` intocada.
- Nenhuma tela visual muda além de aparecerem agora playlists declaradas em deals que não estavam na library legada.

### Risco

Médio. Mitigação: a view foi validada na Onda 2 (já era lida pra `is_ecosystem`). Smoke test pós-deploy: abrir biblioteca de 2 curadores e conferir se a lista cresceu (esperado) e se `is_ecosystem` continua certo.

### Arquivos tocados

- `src/hooks/useCuratorLibrary.ts` (única edição relevante)

Confirma que sigo com essa Onda 4?