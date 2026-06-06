# AUDIT 11 — Editor manual: versionamento e rollback (Fase 5)

**Modo:** análise. Zero código.

---

## Pergunta direta: **rollback real existe hoje?**

**Não.**

O editor manual aplica mutações **destrutivas e imediatas** via `_shared/spotify-playlist.ts` (add/remove/reorder). Não há:
- Snapshot pré-mudança da ordem/tracklist.
- Tabela de versões com diffs por operação.
- Endpoint `revert(version_id)`.
- UI de "desfazer última operação".

O que existe é apenas **rastro parcial**:

| Tabela | O que registra | Suficiente para rollback? |
|---|---|---|
| `playlist_track_snapshots` | Snapshot periódico da tracklist (TTL 60d) | Parcial — granularidade de horas/dias, não por operação |
| `playlist_adjustment_impacts` | Impacto de ajustes recomendados pelo plano de IA | Não — registra "depois", não "antes" |
| `playlist_drift_snapshots` | Drift detectado vs snapshot anterior | Não — diagnóstico, não estado |
| `bot_events` | Eventos do bot (ingestão) | Não relacionado |
| `playlist_diagnoses.applied_changes` | Quais sugestões do plano foram aplicadas | Sim mas só para mudanças via "apply plan", não edit manual |

Conclusão operacional: **se um operador remover 10 faixas por engano às 14:00 e o último snapshot foi 12:00, ele recupera 10 faixas — mas perde toda edição feita entre 12:00 e 14:00.** E se a remoção foi numa playlist sem snapshot recente, a perda é total.

---

## Fluxo atual de uma mudança

```text
Editor UI (PlaylistEditorTab)
        │
        ▼
  spotify-playlist.ts:add/remove/reorder
        │  ┌─ chama Spotify API (mutação real)
        │  ├─ atualiza managed_playlist_tracks (espelho local)
        │  └─ NÃO escreve em nenhuma tabela de "version" antes/depois
        ▼
  playlist-brain-calc (recalcula capacity)
        │
        ▼
  (próximo cron) snapshot-playlist-tracks captura novo estado
```

**Gap fatal:** entre o passo 1 e o passo 4, qualquer erro humano é irreversível em granularidade fina.

---

## Impacto operacional

| Cenário | Hoje |
|---|---|
| Operador remove faixa errada | Precisa lembrar nome, buscar manualmente, re-adicionar (perde posição) |
| Operador reordena playlist inteira e quer voltar | Impossível sem snapshot. Mesmo com snapshot, ordem pode estar desatualizada |
| Bug em script aplica mudanças em massa | Sem rollback. Triage manual playlist por playlist |
| Cliente reclama de mudança feita há 2h | Sem audit log fino de "quem mudou o quê quando" |

Nenhum desses cenários é frequente, mas **todos são catastróficos quando acontecem** porque Spotify é fonte de verdade pública e clientes monitoram.

---

## Proposta de arquitetura segura (sem implementar)

### Tabela `playlist_edit_versions`

```sql
CREATE TABLE public.playlist_edit_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  managed_playlist_id uuid NOT NULL,
  version_number int NOT NULL,        -- sequencial por playlist
  operation text NOT NULL,            -- 'add' | 'remove' | 'reorder' | 'bulk'
  operation_payload jsonb NOT NULL,   -- inputs da operação
  tracks_before jsonb NOT NULL,       -- snapshot completo: [{track_id, position}]
  tracks_after jsonb NOT NULL,
  diff jsonb NOT NULL,                -- { added: [], removed: [], moved: [] }
  performed_by uuid REFERENCES auth.users(id),
  performed_at timestamptz DEFAULT now(),
  reverted_at timestamptz,
  reverted_by uuid,
  source text NOT NULL,               -- 'manual' | 'apply_plan' | 'bot'
  UNIQUE (managed_playlist_id, version_number)
);
```

### Fluxo proposto

```text
Editor UI
        │
        ▼
  intent → cria version_pending (tracks_before snapshot)
        │
        ▼
  spotify-playlist.ts aplica mudança
        │
        ├─ sucesso → completa version (tracks_after + diff)
        └─ falha   → marca version como rollback automático
        ▼
  UI mostra "Desfazer última operação" (até 24h)
        │
        ▼
  revert(version_id) → diff invertido → reaplica → grava nova version
```

### Retenção

- Últimas **50 versões** por playlist OU **30 dias** (o que vier primeiro).
- Cron `cleanup-edit-versions` mensal.

### UI mínima

1. Botão "Desfazer" na barra do editor (visível por 5min após mudança).
2. Aba "Histórico" no editor com lista paginada + diff visual + botão revert.
3. Indicação "v#" no header da playlist (debug, opcional).

### Custo

- Storage: ~5 KB por versão × 50 versões × 400 playlists = ~100 MB no pior caso. Aceitável.
- Latência: +1 INSERT por operação = ~10ms. Negligível.
- Complexidade: ~3-5 dias de implementação + testes de revert idempotente.

### Riscos

| Risco | Mitigação |
|---|---|
| Revert num estado já mudado por outra operação | Detectar via version number; abrir conflito; pedir confirmação |
| Revert de operação aplicada pelo bot | Permitir, com warning ("isso vai desfazer ação automatizada") |
| Storage explode | TTL agressivo + compressão JSONB |
| Spotify rate limit ao reverter bulk | Throttle + fila |

---

## Recomendação

🔴 **Crítico.** Editor sem rollback é dívida operacional alta. Recomendo:

1. **Curto prazo (1 sprint):** snapshot pré-mudança simples — antes de cada operação manual, escrever uma linha em `playlist_edit_versions` com `tracks_before` apenas. Sem UI de revert ainda, mas dá recurso forense.
2. **Médio prazo (próximo trimestre):** UI de "Desfazer última" + endpoint revert.
3. **Longo prazo:** histórico completo paginado + diff visual.

**Não bloqueia Fase 2/3/4.** Pode rodar em paralelo.
