# FASE 6.B.4 — Forense da Implementação do VPS Observer

**Modo:** read-only. Nenhuma alteração de código ou banco.
**Data:** 2026-06-18.

---

## RESUMO EXECUTIVO

| Item | Resposta |
|---|---|
| Funcionalidade planejada nunca finalizada? | **SIM** |
| Qual? | Cruzar tracklist 3rd-party (`observer_playlist_tracks`) com diagnose para detectar concorrentes/saturação reais. |
| Causa de hoje ter milhares de registros sem leitor? | **B) Implementação nunca foi concluída.** Apenas o **gatilho** (auto-enqueue de DIAGNOSE_ENGINE) foi ligado em 2026-06-15; o **consumidor** (diagnose lendo a tabela) nunca foi escrito. |

---

## ITEM 1 — Objetivo original (apenas evidências)

### 1.1 Documento de setup `docs/PLAYLIST_OBSERVER_VPS_SETUP.md` (linha 1-15)

> "Este bot roda **na sua VPS** […] como um processo PM2 isolado. Ele consome endpoints já criados no Lovable Cloud: `observer-pull-queue`, `observer-ingest-tracks`, `observer-upload-failure`."

Critério de aceite definido (linha 204-209):

> "Tabela `observer_playlist_tracks` deve ter linhas; quero ver **≥1 playlist com `track_count ≥ 20` e `album_cover_url` preenchido em ≥95% das linhas**."

→ Evidência: o critério de validação fala SÓ de ingestão (linhas presentes). **Não menciona consumidor.** A documentação de setup cobre apenas a parte produtora.

### 1.2 Matriz oficial `docs/audits/VPS_SOURCE_MATRIX.md` (linha 29, 48)

> "`observer-ingest-tracks` … `observed_playlists`, `observer_playlist_tracks`, `observer_runs` … **brain de observação**"
>
> "`observed_playlist_snapshots` / `observer_playlist_tracks` | observação de playlists não-gerenciadas | **brain de observação**"

→ Evidência: documentação declara como consumidor pretendido um **"brain de observação"** genérico, **sem referência a função, hook ou job concreto**.

### 1.3 Matriz `docs/audits/DATA_SOURCE_MATRIX.md` (linha 60-63, 135)

> "Playlist Position (posição da track dentro da playlist) — **Fonte: VPS Observer Bot** … `observer-ingest-tracks/index.ts` recebe … grava em `observer_playlist_tracks`. **Fallback**: `snapshot-playlist-tracks` via Spotify API."
>
> "Track position | VPS observer bot → `observer-ingest-tracks` | `observed_playlist_tracks` | Spotify API `snapshot-playlist-tracks` | **dual**"

→ Evidência: o objetivo era **substituir** `snapshot-playlist-tracks` (Spotify) como fonte canônica de **posição de track em playlists não-gerenciadas**, mantendo Spotify só como fallback.

### 1.4 Migration `20260615160740` (criação da tabela)

```sql
CREATE TABLE IF NOT EXISTS public.observer_playlist_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spotify_playlist_id text NOT NULL,
  spotify_track_id text NOT NULL,
  position int NOT NULL,
  name text, artist text, album_name text, album_cover_url text,
  duration_ms int,
  captured_at timestamptz NOT NULL DEFAULT now(),
  captured_date date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  correlation_id text, raw jsonb,
  CONSTRAINT observer_playlist_tracks_unique UNIQUE (spotify_playlist_id, spotify_track_id, captured_date)
);
```

→ Evidência: schema otimizado para **séries temporais** (`captured_date` no UNIQUE; histórico diário por playlist×track). Indica intenção de **comparação ao longo do tempo** (drift, churn, novidades, saturação), não apenas snapshot único.

---

## ITEM 2 — Componente que deveria consumir

Evidências cruzadas apontam para **`diagnose-managed-playlist`** como o consumidor pretendido:

### 2.1 Commit `fd02d284` / `a2eab5b0` (2026-06-15 22:05-22:06 UTC)

Título do commit: **"Conectou Observer ao diagnóstico"**.

Diff completo (única mudança):

```diff
--- a/supabase/functions/observer-ingest-tracks/index.ts
+++ b/supabase/functions/observer-ingest-tracks/index.ts
@@ -64,7 +64,41 @@ Deno.serve(async (req) => {
+  // Auto-enfileira DIAGNOSE_ENGINE se a playlist é gerenciada [...]
+  if (managed && !managed.archived_at && !managed.diagnose_blocked) {
+    [...] enqueuePlaylistJob(supa, {
+      operation_type: "DIAGNOSE_ENGINE",
+      payload: { source: "observer", ... },
+    });
+  }
```

→ Evidência direta e explícita: a intenção declarada no commit message é "conectar Observer ao diagnóstico".

### 2.2 Mas o diff só implementou o GATILHO, não o CONSUMIDOR

`rg -ln observer_playlist_tracks supabase/functions/` → retorna **apenas o produtor**:
- `observer-pull-queue/index.ts` (controla a fila, não lê)
- `observer-ingest-tracks/index.ts` (grava)

→ `diagnose-managed-playlist/index.ts` **nunca leu** `observer_playlist_tracks`. Confirmado por `rg -n "observer_playlist_tracks|observed_playlist" supabase/functions/diagnose-managed-playlist/` retornar zero matches.

---

## ITEM 3 — Código desativado / TODO / branch incompleta

| Tipo | Localização | Evidência |
|---|---|---|
| **Branch incompleta** | commit `a2eab5b0` (15/06 22:05 UTC) + merge `fd02d284` (15/06 22:06 UTC) | Implementou apenas o lado-produtor (gatilho de re-diagnose). O lado-consumidor (diagnose lendo `observer_playlist_tracks`) nunca foi commitado. |
| **Doc órfão prometendo consumo** | `docs/audits/VPS_SOURCE_MATRIX.md:29,48` | "brain de observação" listado como consumidor, mas brain real não existe. |
| **Doc órfão prometendo dualidade** | `docs/audits/DATA_SOURCE_MATRIX.md:135` | Classifica `observer_playlist_tracks` como fonte "dual" com Spotify para posição — implica que algo deveria estar lendo. |
| **Schema com `correlation_id` + `raw jsonb`** | migration `20260615160740` linhas 14-15 | Campos só fazem sentido se algum job downstream rastrear e re-processar — não há job. |
| **TODO/FIXME explícito** | `rg -in "TODO\|FIXME\|HACK\|XXX" supabase/functions/observer-*/` | **zero matches** — não há comentário marcando como pendente. |
| **Feature flag** | `rg -in "OBSERVER_.*ENABLED\|observer_consume" supabase/ src/` | **zero matches** — não há flag de ligar/desligar consumo. |
| **`promote-search-to-observer/index.ts:1-10`** | edge function ativa | Promove playlists de `search_results` → `observed_playlists` (alimenta a fila do observer). Confirma que o pipeline produtor é ativamente mantido. |

---

## ITEM 4 — Fluxo pretendido vs armazenamento histórico

Evidências mostram **fluxo pretendido** (não armazenamento histórico):

| Evidência | Conclusão |
|---|---|
| Commit "Conectou Observer ao diagnóstico" (2.1) | Intenção explícita de pipeline ativo |
| `DATA_SOURCE_MATRIX.md:60-63` define como **fonte canônica** de posição (não cache) | Pipeline ativo |
| `VPS_SOURCE_MATRIX.md:29,48` lista "brain de observação" como consumidor | Pipeline ativo |
| `UNIQUE (spotify_playlist_id, spotify_track_id, captured_date)` permite re-ingestão diária | Série temporal viva, não dump único |
| `idx_opt_captured_at DESC` (migration linha 21) | Otimizado para "últimos N dias", típico de consumo recorrente |
| `promote-search-to-observer` continua promovendo playlists | Alimentação contínua presume consumo contínuo |

Fluxo originalmente pretendido (reconstruído a partir das evidências):

```text
Playlist 3rd-party
   ↓
playlist-observer (PM2 / VPS, DOM scrape)
   ↓
observer-ingest-tracks (POST)
   ↓
observer_playlist_tracks  ← série temporal
   ↓
diagnose-managed-playlist  ← CONSUMIDOR ESPERADO (nunca implementado)
   ↓
recomendações / saturação real / concorrentes vivos
```

A alternativa "armazenamento histórico" é **inconsistente** com o schema, com a doc e com o commit message.

---

## ITEM 5 — Por que existem milhares de registros sem consumidor

**Resposta: B) Implementação nunca foi concluída.**

Evidências:

1. **Commit message declara intenção** (`fd02d284` "Conectou Observer ao diagnóstico", 2026-06-15 22:06 UTC) → confirma que a conexão estava no escopo.
2. **Diff do commit só toca o lado produtor** (auto-enqueue de DIAGNOSE_ENGINE em `observer-ingest-tracks`). O diff **não toca `diagnose-managed-playlist`**, que é onde a leitura deveria ocorrer.
3. **`git log -- supabase/functions/diagnose-managed-playlist/` entre 13/06 e 18/06** mostra commits posteriores (`2f7fa660`, `deed88c4`, `364629d1`), nenhum citando observer.
4. **Zero consumidores em código** (`rg -ln observer_playlist_tracks supabase/functions/` = só os 2 produtores).
5. **Zero TODO/FIXME marcando a pendência** → a parada não foi explicitamente registrada como dívida técnica.
6. **Hipótese A (intencional)** é descartada pelo commit message e pelo schema temporal.
7. **Hipótese C (consumidor removido)** é descartada por `git log --all --oneline -- supabase/functions/diagnose-managed-playlist/index.ts` não mostrar commit que tenha removido leitura de `observer_playlist_tracks` (a string nunca apareceu no arquivo).

---

## ITEM 6 — Funcionalidade planejada não finalizada

**SIM.**

| Campo | Evidência |
|---|---|
| **Qual** | Pipeline "Observer → Diagnose" para usar tracklists 3rd-party reais como insumo do diagnóstico de playlists gerenciadas (concorrentes vivos, saturação de track no nicho, descoberta de candidatas). |
| **Quando começou** | 2026-06-13 14:38 UTC — migration `20260613143823` cria `observed_playlists` + `observed_playlist_snapshots` + blocklist. |
| **Marcos seguintes** | 2026-06-15 11:13 UTC — RLS hardening (`20260615111307`). 2026-06-15 16:07 UTC — migration `20260615160740` cria `observer_playlist_tracks`. 2026-06-15 22:05 UTC — commit `a2eab5b0`/`fd02d284` "Conectou Observer ao diagnóstico" (só gatilho). |
| **Por que ficou incompleta** | Após o commit do gatilho (15/06 22:06 UTC), **nenhum commit posterior** toca a leitura. A sessão de desenvolvimento aparentemente encerrou no produtor sem retomar o consumidor. Não há TODO/feature flag/branch documentando a pausa. |
| **Qual componente deveria consumir** | `supabase/functions/diagnose-managed-playlist/index.ts` (declarado no commit message "Conectou Observer ao diagnóstico"). Secundariamente, `evaluate-plan-snapshots` (cron 03:00 UTC que invoca diagnose) seria o orquestrador que se beneficiaria. |

---

## CONCLUSÃO (evidências, sem opinião)

1. **Commit `fd02d284` / `a2eab5b0` (2026-06-15 22:06 UTC, mensagem "Conectou Observer ao diagnóstico")** prova que a intenção declarada era **acoplar Observer ao diagnose**, não armazenar histórico.
2. **Diff do mesmo commit** prova que **apenas o gatilho** (auto-enqueue de DIAGNOSE_ENGINE em `observer-ingest-tracks/index.ts:67-99`) foi implementado.
3. **`rg -ln observer_playlist_tracks supabase/functions/` retorna 2 arquivos**, ambos produtores. `diagnose-managed-playlist` nunca leu a tabela.
4. **Schema (`UNIQUE` com `captured_date`, índice `captured_at DESC`, `correlation_id`, `raw jsonb`)** prova que a tabela foi projetada como série temporal consumível, não como dump.
5. **Documentação oficial (`VPS_SOURCE_MATRIX.md:29,48`, `DATA_SOURCE_MATRIX.md:60-63,135`)** documenta um consumidor pretendido ("brain de observação", "dual com Spotify") que nunca foi implementado.
6. **Nenhum TODO/FIXME/feature flag** no código observer marca a pendência → a parada não foi formalizada.
7. **`promote-search-to-observer`** continua alimentando a fila ativamente → o produtor é mantido vivo presumindo consumo futuro.

**Classificação:** **B — Implementação nunca foi concluída.**
Trabalho restante identificado (não executado nesta fase): alterar `diagnose-managed-playlist` para ler `observer_playlist_tracks` ao montar a janela de concorrentes do nicho, substituindo (ou complementando) os benchmarks curados em `genre_benchmarks`.
