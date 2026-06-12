# Plano — Ownership de Playlists por Campanha (3 ondas)

## Objetivo
Eliminar o conceito de "biblioteca permanente do curador". Playlist passa a ter ownership **por campanha**. Ecossistema (`managed_playlists`) continua sendo o único ownership permanente. Resolve multi-dono (Êxtase/Trovão), simplifica match, mantém auditoria limpa.

## Modelo alvo

```text
managed_playlists          → ownership permanente (ecossistema)
curator_playlists          → ownership por campanha (UNIQUE campaign_id + spotify_playlist_id)
v_curator_library          → VIEW agregando curator_playlists (substitui tabela física)
curator_playlist_library   → mantida apenas como _notes editorial (sem curator_id único)
```

Regras:
1. Playlist no ecossistema **não pode** virar `curator_playlist` (trigger bloqueia).
2. Mesma playlist em 2 campanhas ativas de curadores diferentes = permitido (cada campanha tem seu próprio ownership).
3. Mesma playlist + mesma campanha = `UNIQUE` (uma campanha não pode declarar a mesma playlist 2x).
4. Promoção pra ecossistema marca `promoted_to_ecosystem_at` e bloqueia futuras declarações como `curator_playlist`.

## Onda 1 — Fundação transacional (sem quebrar nada)

**Migration:**
- `ALTER TABLE curator_playlists ADD COLUMN promoted_to_ecosystem_at timestamptz`.
- `CREATE UNIQUE INDEX curator_playlists_campaign_spid_uq ON curator_playlists(campaign_id, spotify_playlist_id) WHERE campaign_id IS NOT NULL AND spotify_playlist_id IS NOT NULL`.
- `CREATE FUNCTION claim_playlist_for_campaign(_campaign_id, _curator_id, _spotify_playlist_id, _name, _followers)` — SECURITY DEFINER, transacional:
  1. Se existir em `managed_playlists` ativa → retorna `{status: 'ecosystem', managed_playlist_id}`.
  2. Tenta INSERT em `curator_playlists`. Se conflito do unique → retorna `{status: 'conflict', existing_curator_id, campaign_id}`.
  3. Sucesso → retorna `{status: 'claimed', curator_playlist_id}`.
- `CREATE TRIGGER trg_block_curator_playlist_if_eco BEFORE INSERT ON curator_playlists` — bloqueia se `spotify_playlist_id` existe em `managed_playlists` ativa.
- `CREATE TRIGGER trg_promote_to_ecosystem AFTER INSERT ON managed_playlists` — marca `promoted_to_ecosystem_at = now()` em todos `curator_playlists` com mesmo `spotify_playlist_id`.

**Código:**
- `PasteUrlsDialog.tsx`, `PastePlaylistsDialog.tsx`, importadores de paste/XLSX → trocar INSERT direto por RPC `claim_playlist_for_campaign`. UI mostra conflito ("playlist já está em campanha X do curador Y").
- `extract-snapshot-from-print/index.ts` → confirmar ordem de match: 1) `managed_playlists` → `campaign_eco_snapshots`; 2) `curator_playlists` por `(campaign_id, spotify_playlist_id)`; 3) fallback editorial/organic. Remover desempate por nome.

**Risco:** baixo (tudo aditivo, nada quebrado). Validar com 1 paste real antes de seguir.

## Onda 2 — View substitui tabela (sombra)

**Migration:**
- `CREATE VIEW v_curator_library` agregando de `curator_playlists`:
  ```sql
  SELECT
    cp.curator_id,
    cp.spotify_playlist_id,
    MAX(cp.playlist_name) as playlist_name,
    MAX(cp.followers) as followers,
    COUNT(DISTINCT cp.deal_id) as times_used,
    MAX(cp.created_at) as last_used_at,
    BOOL_OR(cp.promoted_to_ecosystem_at IS NOT NULL) as is_ecosystem
  FROM curator_playlists cp
  WHERE cp.curator_id IS NOT NULL
  GROUP BY cp.curator_id, cp.spotify_playlist_id;
  ```
- `CREATE VIEW v_curator_library_stats` e `v_curator_library_performance` reaproveitando lógica das views atuais, apontando pra `v_curator_library`.

**Código:**
- `src/hooks/useCuratorLibrary.ts` → trocar `from("curator_playlist_library")` por `from("v_curator_library")`. Manter shape do retorno.
- Telas: `CuratorLibraryPanel`, `CuratorLibrarySheet`, `ImportFromLibraryDialog` — funcionam sem mudança (mesmo shape).
- Mutations `addManual`, `updateStatus`, `remove` → temporariamente desabilitadas ou redirecionadas pra `curator_playlist_library_notes` (notes/status apenas).

**Risco:** médio. Rodar em paralelo: view + tabela coexistem 1 semana. Smoke test: comparar contagens.

## Onda 3 — Limpeza (drop legado)

**Pré-condição:** Onda 2 estável por 7 dias, zero erros de leitura.

**Migration:**
- `DROP VIEW curator_playlist_library_stats, curator_playlist_performance` (versões antigas).
- `ALTER TABLE curator_playlist_library RENAME TO curator_playlist_notes`.
- `ALTER TABLE curator_playlist_notes DROP COLUMN times_used, last_used_at, followers, image_url` (campos derivados agora vêm da view).
- Manter apenas: `curator_id`, `spotify_playlist_id`, `notes`, `status`, `created_at`.

**Código:**
- Limpar referências a colunas removidas.
- Atualizar `AUDIT_06_PLAN.md` marcando dívida resolvida.

**Risco:** alto se houver leitura escondida. Mitigação: `grep -r "curator_playlist_library"` antes do drop.

## Detalhes técnicos

**Tabelas afetadas:**
- `curator_playlists` (4648 linhas) — ganha unique + coluna `promoted_to_ecosystem_at`.
- `curator_playlist_library` (449 linhas) — vira view, depois `_notes`.
- `managed_playlists` (898 linhas) — ganha trigger de promoção.
- `curator_deal_baseline_playlists` — sem mudança.

**Edge functions tocadas:**
- `extract-snapshot-from-print` — confirmar ordem de match já corrigida na sessão anterior, remover fallback por nome quando id existir.
- `bot-ingest-snapshot`, `analyze-deal-prints` — auditar uso de `curator_playlist_library`.

**Arquivos frontend:**
- `src/hooks/useCuratorLibrary.ts`
- `src/components/curators/PasteUrlsDialog.tsx`
- `src/components/playlist-deals/PastePlaylistsDialog.tsx`
- `src/components/playlist-deals/ImportFromLibraryDialog.tsx`
- `src/components/curators/CuratorLibraryPanel.tsx`

**Conflitos atuais a resolver antes da Onda 1:**
- 5 playlists em 3 curadores no `library` — não bloqueia (vira histórico).
- 15+ playlists do ecossistema duplicadas no `library` — trigger da Onda 1 impede novas duplicatas; legado fica até Onda 3.

## Decisão pendente

Confirmo: começo pela Onda 1 (migration + RPC + triggers) sem tocar em UI ainda?
