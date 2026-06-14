## Objetivo
Conectar o módulo Catálogo à telemetria que a VPS já produz, **sem criar coletor Spotify**, sem cron novo de scraping, sem tabela paralela. Reutilizar `song_snapshots` + `song_snapshot_playlists`.

## Ordem de execução (4 passos atômicos)

### Passo 1 — Ponte de identidade (DB)
Permitir que a VPS faça snapshot de uma música do catálogo igual já faz para deals.

- Adicionar coluna `catalog_track_id uuid NULL` em `song_snapshots` (FK → `catalog_tracks`).
- Tornar `song_id` nullable em `song_snapshots` (hoje é NOT NULL e força vínculo com `curator_deal_songs`).
- Constraint: `CHECK (song_id IS NOT NULL OR catalog_track_id IS NOT NULL)`.
- Índice `(catalog_track_id, captured_at DESC)`.
- Sem mexer em `song_snapshot_playlists` (já é genérico, ligado por `snapshot_id`).

### Passo 2 — Fila de enfileiramento do catálogo (DB)
Tabela mínima `catalog_snapshot_queue` para a VPS puxar alvos do catálogo (mesmo padrão da fila de deals):
- `catalog_track_id`, `spotify_track_id`, `priority`, `scheduled_for`, `status`, `locked_at/by`, `lease_expires_at`, `attempts`.
- Função `claim_next_catalog_snapshots(worker_id, limit)` (espelho do claim de placements).
- Trigger: ao inserir `catalog_tracks` (status='active') → enfileira snapshot inicial (baseline).
- Trigger: ao inserir `catalog_placements` com status='active' → enfileira snapshot D+1.

### Passo 3 — View de leitura para a UI (DB)
View `v_catalog_track_telemetry` agregando direto de `song_snapshots` + `song_snapshot_playlists`:
- `catalog_track_id`, `last_captured_at`, `last_plays_28d`, `baseline_plays_28d` (primeiro snapshot), `growth_abs`, `growth_pct`, `playlists_present_count`, `total_plays_7d_from_playlists`.

View `v_catalog_track_playlist_attribution`:
- por `catalog_track_id` × `spotify_playlist_id`: posição atual, plays_7d atual, primeiro_visto, último_visto, status (ativo/saiu).

Sem nenhuma escrita Spotify. Sem cron novo no Postgres.

### Passo 4 — Deprecar tabela morta
- `catalog_track_snapshots`: marcar como deprecada (comentário SQL + remover writes se houver). Não dropar ainda — só sinalizar. Drop fica para uma rodada futura após confirmar que nada lê.

## O que NÃO faz parte deste plano (explícito)
- ❌ Cron Spotify de snapshot.
- ❌ Edge function nova de coleta.
- ❌ Mudança no `process-catalog-placements` (já está fechado na Fase anterior).
- ❌ Mudança no worker da VPS (lado servidor da VPS é responsabilidade externa — este plano só prepara o **contrato DB** que ela já entende: ela vai consumir `claim_next_catalog_snapshots` e gravar em `song_snapshots` com `catalog_track_id` preenchido).
- ❌ UI nova — view fica pronta para alimentar dashboard depois.

## Diagrama do fluxo final

```text
Usuário cola URL
      │
      ▼
catalog_tracks (insert)
      │  trigger
      ▼
catalog_snapshot_queue (baseline)
      │  claim
      ▼
VPS worker  ──►  song_snapshots (catalog_track_id) + song_snapshot_playlists
      │
      ▼
distribute_catalog_track → catalog_placements
      │  trigger (placement active)
      ▼
catalog_snapshot_queue (recorrente)
      │
      ▼
v_catalog_track_telemetry  ◄── UI Catálogo lê daqui
v_catalog_track_playlist_attribution
```

## Detalhes técnicos
- Tudo via migration única por passo (4 migrations).
- Sem GRANT para `anon` em `catalog_snapshot_queue` (só `authenticated` + `service_role`); RLS bloqueia leitura para não-admin.
- `claim_next_catalog_snapshots` em `SECURITY DEFINER` com `SET search_path = public`.
- Após Passo 1 + 2, a VPS já pode começar a popular `song_snapshots` para a única `catalog_track` ativa (`7gUX0Of0lE9tWv167kzQdV`) assim que for chamada — sem nenhuma mudança no app.

## Entrega
Ao final dos 4 passos:
- `song_snapshots` aceita catálogo.
- Fila viva, fila enfileirada por trigger.
- Views prontas para qualquer UI consumir.
- `catalog_track_snapshots` marcada como deprecada.
- Zero dependência Spotify para telemetria de catálogo.

Confirma para eu rodar **Passo 1** (migration de ponte em `song_snapshots`)?
