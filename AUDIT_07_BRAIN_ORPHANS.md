# AUDIT 07 — `playlist_brain` / `playlist_brain_history` (Fase 1.1)

**Modo:** read-only. Nenhuma linha alterada. Nenhuma FK criada.

---

## Achado-chave

O nome "órfão" estava enganoso. **100% das linhas de `playlist_brain` apontam para um `playlists.id` válido** (canônico). O problema é outro: muitas dessas playlists canônicas **não têm `managed_playlist` ativa correspondente**, então o cérebro está "vivo" para algo que não é mais gerido.

`playlist_brain.playlist_id` referencia `public.playlists.id` (tabela canônica), **não** `managed_playlists.id`. A confusão anterior veio do AUDIT_02 que comparou 858 brain × 373 managed sem entender o relacionamento real.

---

## Números reais

| Métrica | Valor |
|---|---|
| `playlist_brain` total | **858** |
| `playlist_brain_history` total | **10.078** |
| `managed_playlists` total | 898 (373 ativas, 525 arquivadas) |
| Brain rows com `playlists.id` válido | 858 (100%) |
| Brain rows com `playlists.id` inválido | 0 |
| Brain rows com managed **ativa** | **322** ✅ legítimas |
| Brain rows com managed **só arquivada** | **426** 🟠 órfãs de arquivamento |
| Brain rows **sem managed alguma** | **110** 🔴 órfãs puras |

Resultado: das 858 linhas, **536 (62%) estão obsoletas** porque a playlist correspondente foi arquivada ou nunca virou managed.

Detalhe importante: das 373 managed ativas, apenas **322 têm brain** — 51 ainda não rodaram cálculo. Isso é gap de cobertura, não dívida.

## Origem das linhas órfãs

| Mês | Linhas brain criadas | Órfãs do mês |
|---|---|---|
| 2026-05 | 274 | 274 (100%) |
| 2026-06 | 584 | 262 (45%) |

**Diagnóstico de origem:** `playlist_brain` foi populada em backfill amplo (maio inteiro: 274 linhas, todas órfãs hoje) e o cron contínuo de junho mantém ~45% de órfãos novos. Isso aponta para um único vetor:

> **`playlist-brain-calc` é chamado para playlists que depois são arquivadas, e não há `ON DELETE` ou rotina que limpe o brain quando o managed é arquivado.**

Não encontramos código que escreva em `playlist_brain` para playlists que nunca foram managed — todas as 110 órfãs puras provavelmente vêm de managed *deletadas* (não arquivadas), o que é raro mas possível.

## History (`playlist_brain_history`)

| Métrica | Valor |
|---|---|
| Total | 10.078 |
| Playlists distintas | 858 (= 1:1 com brain) |
| Sem managed ativa | **5.636 (56%)** |
| Média linhas/playlist | ~11,7 |

Sem política de retenção: cresce linear com cada recálculo (cron diário + manual).

---

## Impacto operacional

### Performance
- Hook `usePlaylistBrain` filtra por `playlist_id` específico → órfãos não atrapalham SELECT individual.
- `usePlaylistBrainHistory` idem.
- **Único custo real hoje:** SELECT * em queries administrativas (`v_brain_health`, auditorias) carrega 62% de lixo.

### Storage
- `playlist_brain` ~1 MB, `playlist_brain_history` ~12 MB. Não é problema agora, mas cresce 2x por trimestre no ritmo atual.

### Consistência
- Dashboards que contam "playlists com cérebro" vão dar números errados (foi exatamente o que aconteceu no AUDIT_02 inicial).
- Recálculos podem rodar em playlists arquivadas se algum cron não filtrar `archived_at`.

---

## Fluxos legítimos que tocam essas tabelas (mapeamento)

Buscas no código (`rg "playlist_brain"`):

| Origem | Tabela | Operação | Filtra archived? |
|---|---|---|---|
| `playlist-brain-calc` (edge) | brain + history | upsert + insert | precisa verificar |
| `usePlaylistBrain` (front) | brain | select por id | N/A |
| `usePlaylistBrainHistory` (front) | history | select por id | N/A |
| `v_brain_health` (view) | brain | select agregado | precisa verificar |

**Não foi encontrado nenhum fluxo que use brain de playlist arquivada intencionalmente.** Histórico de cérebro de playlist arquivada é dado morto.

---

## Recomendação (sem executar nesta fase)

### Quando aprovado executar, nesta ordem:

1. **Snapshot read-only** das 536 linhas órfãs em CSV (`/mnt/documents/playlist_brain_orphans_pre_cleanup.csv`) para evidência reversível.
2. **DELETE** das 536 linhas brain + 5.636 history correspondentes (transação única).
3. **Migration FK:**
   ```sql
   ALTER TABLE public.playlist_brain
     ADD CONSTRAINT playlist_brain_playlist_id_fkey
     FOREIGN KEY (playlist_id) REFERENCES public.playlists(id) ON DELETE CASCADE;
   ALTER TABLE public.playlist_brain_history
     ADD CONSTRAINT playlist_brain_history_playlist_id_fkey
     FOREIGN KEY (playlist_id) REFERENCES public.playlists(id) ON DELETE CASCADE;
   ```
   Atenção: isso só protege contra *playlist canônica deletada* — **não** protege contra *managed arquivada* (managed e playlist canônica são tabelas distintas).
4. **Trigger** em `managed_playlists` quando `archived_at` vira não-null:
   ```sql
   -- ao arquivar uma managed, marcar brain como stale (ou deletar conforme política)
   ```
   Decidir: deletar brain? marcar `archived_at`? Adicionar coluna `archived_at` em `playlist_brain`?
5. **Edge function `cleanup-playlist-brain`** (admin-only, dry-run default) — deleta brain/history cuja playlist canônica não tem managed ativa há > 90 dias.
6. **Cron diário** chamando função em modo real.

### Risco de cada passo
| Passo | Risco | Reversível? |
|---|---|---|
| 1. CSV snapshot | 🟢 zero | sim |
| 2. DELETE 536+5636 | 🟢 baixo (sem código depende) | via CSV |
| 3. FK | 🟡 médio (precisa garantir 0 órfãos antes) | sim (DROP) |
| 4. Trigger arquivamento | 🟠 alto (muda comportamento de fluxo) | sim |
| 5. Edge function | 🟢 baixo | N/A |
| 6. Cron | 🟢 baixo | sim |

---

## Decisão pendente do usuário

Antes de qualquer DELETE/FK/trigger, validar:

1. ✅ Confirmar que **dados de cérebro de playlist arquivada são descartáveis** (não usados em relatórios históricos, valuation, etc).
2. ✅ Confirmar política: **deletar** ou **marcar `archived_at` no brain** (preserva histórico, custa storage)?
3. ✅ Confirmar que ninguém precisa "reativar" uma playlist arquivada e recuperar o cérebro antigo.

Sem essas 3 respostas, a Fase 1.1 fica em "auditoria entregue, aguardando go".
