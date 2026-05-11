# Fase 1 — Canonical Playlist Layer

Objetivo: criar uma camada central de identidade de playlists (`public.playlists`) e linkar — sem quebrar nada — as 3 tabelas existentes (`managed_playlists`, `curator_playlist_library`, `curator_playlists`) via uma nova coluna `canonical_playlist_id`.

Princípios:
- Nada existente é alterado, renomeado ou removido.
- Novas colunas são **nullable** e sem default destrutivo.
- Sem foreign keys "duras" para evitar quebra de inserts vindos do bot/edge functions (usaremos FK com `ON DELETE SET NULL`).
- Backfill é idempotente: se rodar 2x, não duplica nada (`ON CONFLICT (spotify_playlist_id) DO UPDATE`).
- RLS segue padrão do projeto: `has_team_access()` para SELECT/INSERT/UPDATE/DELETE.

---

## 1. Nova tabela `public.playlists`

```text
playlists
├── id                    uuid PK              default gen_random_uuid()
├── spotify_playlist_id   text UNIQUE NOT NULL
├── name                  text
├── ownership             text NOT NULL        check in ('own','curator','external')  default 'external'
├── account_id            uuid NULL            (sem FK dura; lógica aplicacional)
├── source                text NOT NULL        check in ('managed','library','deal','bot','apify')  default 'external'
├── followers             bigint
├── cover_url             text
├── first_seen_at         timestamptz NOT NULL default now()
├── last_seen_at          timestamptz NOT NULL default now()
└── created_at            timestamptz NOT NULL default now()
```

Observação: `source` no enunciado tem valor `'external'` implícito (usado em `ownership`). Vou aceitar os 5 valores listados (`managed | library | deal | bot | apify`) e usar `'managed'` como default seguro no backfill conforme origem da linha. Confirma se prefere outro default.

Índices:
- `UNIQUE (spotify_playlist_id)` (já vem do constraint)
- `INDEX (ownership)`, `INDEX (account_id)`, `INDEX (source)`

RLS: `ENABLE`, com 4 policies `has_team_access()` (padrão do projeto).

Trigger: `update_updated_at` não se aplica (não existe coluna `updated_at`); mas adiciono trigger leve para manter `last_seen_at = now()` em UPDATE.

---

## 2. Coluna `canonical_playlist_id` nas 3 tabelas

Adicionada como **nullable**, sem default, com FK `ON DELETE SET NULL`:

```sql
ALTER TABLE managed_playlists         ADD COLUMN canonical_playlist_id uuid NULL REFERENCES playlists(id) ON DELETE SET NULL;
ALTER TABLE curator_playlist_library  ADD COLUMN canonical_playlist_id uuid NULL REFERENCES playlists(id) ON DELETE SET NULL;
ALTER TABLE curator_playlists         ADD COLUMN canonical_playlist_id uuid NULL REFERENCES playlists(id) ON DELETE SET NULL;
```

Índices em cada tabela: `CREATE INDEX ... ON <tabela>(canonical_playlist_id);`

Nenhuma coluna existente é alterada. Bot e edge functions continuam inserindo exatamente como antes — a coluna nova fica `NULL` em inserts legados e é preenchida pelo backfill / por triggers futuras (Fase 2).

---

## 3. Backfill idempotente (dentro da mesma migration)

Lógica (em SQL, executada na ordem abaixo):

**Passo A — managed_playlists → playlists (ownership='own', source='managed'):**
```sql
INSERT INTO playlists (spotify_playlist_id, name, ownership, account_id, source, followers, cover_url, first_seen_at, last_seen_at)
SELECT mp.spotify_playlist_id, mp.name, 'own', mp.account_id, 'managed',
       mp.followers, mp.cover_url, COALESCE(mp.created_at, now()), now()
FROM managed_playlists mp
WHERE mp.spotify_playlist_id IS NOT NULL
ON CONFLICT (spotify_playlist_id) DO UPDATE
  SET name       = COALESCE(playlists.name, EXCLUDED.name),
      followers  = COALESCE(EXCLUDED.followers, playlists.followers),
      cover_url  = COALESCE(EXCLUDED.cover_url, playlists.cover_url),
      last_seen_at = now();

UPDATE managed_playlists mp
SET canonical_playlist_id = p.id
FROM playlists p
WHERE p.spotify_playlist_id = mp.spotify_playlist_id
  AND mp.canonical_playlist_id IS NULL;
```

**Passo B — curator_playlist_library → playlists (ownership='curator', source='library'):**
Mesma estrutura. Para linhas que já existem na tabela `playlists` (vindas do passo A com `ownership='own'`), o `ON CONFLICT` **não rebaixa** o ownership — mantemos o ownership existente (uso `playlists.ownership` no SET, não EXCLUDED).

**Passo C — curator_playlists → playlists (ownership='curator', source='deal'):**
Idem. Nunca sobrescreve `ownership='own'` ou `'curator'` já gravado.

Regra anti-rebaixamento (aplicada nos 3 ON CONFLICT):
```sql
ownership = CASE
  WHEN playlists.ownership = 'own'     THEN 'own'
  WHEN playlists.ownership = 'curator' THEN 'curator'
  ELSE EXCLUDED.ownership
END
```

Resultado: cada `spotify_playlist_id` distinto vira **1** linha em `playlists`; as 3 tabelas ficam todas com `canonical_playlist_id` preenchido para qualquer linha que tinha `spotify_playlist_id` válido.

---

## 4. O que **NÃO** será feito nesta fase

- Sem alterar/remover colunas existentes.
- Sem mudar contratos do bot, edge functions, RPCs, triggers existentes.
- Sem tornar `canonical_playlist_id` `NOT NULL`.
- Sem deduplicar linhas das tabelas originais.
- Sem unificar `curator_playlists` (snapshot por deal) com `curator_playlist_library` — continuam coexistindo.
- Sem expor a tabela no frontend (Fase 2).

---

## 5. Entregáveis desta fase

1 migration SQL única contendo:
- `CREATE TABLE playlists` + índices + RLS + policies + trigger `last_seen_at`.
- 3 × `ALTER TABLE ADD COLUMN canonical_playlist_id` + índices.
- Backfill idempotente (passos A, B, C).

Após aprovação da migration, **nenhuma alteração de código TS é necessária** nesta fase — types.ts será regenerado automaticamente e tudo segue funcionando.

---

## 6. Verificação pós-migration

Vou rodar como SELECTs de sanidade:
- `SELECT count(*) FROM playlists;`
- `SELECT count(*) FROM managed_playlists WHERE canonical_playlist_id IS NULL AND spotify_playlist_id IS NOT NULL;` → esperado **0**
- Idem para `curator_playlist_library` e `curator_playlists`.
- `SELECT ownership, count(*) FROM playlists GROUP BY 1;`

Se tudo zerar/bater, Fase 1 está concluída e segura para Fase 2 (triggers de sincronização + uso no frontend).

Posso prosseguir e gerar a migration?