## O que eu já tinha mexido no bot (e está pela metade)

Em sessões anteriores eu deixei a **infra de coleta unificada** no bot da VPS apontando pra catálogo:
- `bot-collect-queue` já tenta puxar itens de catálogo via RPC `claim_next_catalog_snapshots` e montar a URL `artists.spotify.com/.../song/.../stats` pro bot scrapear (mesma tela usada pra Ai Ai Que Legal).
- `bot-ingest-song-snapshot` já aceita `catalog_track_id` (modo catálogo) e fecha o item da fila depois que o bot devolve o print + lista de playlists.

**Por isso a queue criou um item e travou: a função existe na borda, mas faltam as peças no banco e o bot foi tentando, falhando e somando attempts.**

## O que falta (na ordem dos 5 passos, sem quebrar o que tá rodando hoje)

### Passo 1 — Banco (migração)
- Adicionar em `catalog_tracks`:
  - `spotify_artist_id text` — sem ele o bot não monta a URL.
  - `auto_collect_interval_minutes int default 2880` (2 dias, igual deal_song).
  - `last_auto_collect_at timestamptz`, `next_auto_collect_at timestamptz`.
- Criar RPC `claim_next_catalog_snapshots(worker, limit, lease)` — claim atômico (FOR UPDATE SKIP LOCKED, marca `processing`, `locked_by`, lease).
- Criar RPC `enqueue_catalog_snapshots_due()` — varre `catalog_tracks` ativas com `next_auto_collect_at <= now()` (ou null) e enfileira `reason='periodic' priority=2`. Bump de `next_auto_collect_at = now() + interval`.
- Trigger `AFTER INSERT ON catalog_tracks` — enfileira automaticamente `reason='baseline' priority=1` (é o que produz a primeira leitura de uma música nova, em vez de chamar Spotify API).

### Passo 2 — Tirar a API da baseline
- No `distribute-catalog-track` (edge): remover toda a chamada a `/v1/tracks` e `/v1/artists` que tentava preencher `popularity`/`monthly_listeners`. Continua só resolvendo metadados básicos (nome/artista/ISRC/capa) já que precisa pra criar a linha. **Nenhuma popularity entra no banco via API.**
- Baseline T0 fica vazia até o bot voltar o primeiro snapshot — exatamente o mesmo padrão de uma música nova de deal.

### Passo 3 — Cron
- 1 cron a cada hora: `enqueue_catalog_snapshots_due` + reciclagem de zumbi (lease expirado → volta a `pending` se attempts < max).
- Frequência da coleta em si continua 2 em 2 dias (governada por `auto_collect_interval_minutes`), o cron só verifica quem está pronto.

### Passo 4 — Limpar o lixo que ficou
- Destravar o item da "Bct de Ouro" que está `processing` com attempts=6 → reset pra `pending` com attempts=0.
- Preencher `spotify_artist_id` da "Bct de Ouro" (uma única chamada manual à API só pra resolver — depois disso, zero API).
- Setar `auto_collect_interval_minutes=2880` e `next_auto_collect_at=now()` pra essa música.

### Passo 5 — Bug do release no `bot-collect-queue`
- O fallback usa `worker_id` mas a coluna é `locked_by`. Corrigir o UPDATE pra não estourar quando solta um item inválido.

## O que continua igual (não quebra nada)
- `distribute-catalog-track`/`resolve-catalog-track`: mesmo contrato pra UI.
- `process-catalog-placements`/`reap-catalog-placements`: intocados — quem adiciona/remove em playlist segue igual.
- Bot da Ai Ai Que Legal: nenhum byte muda (deal_song mode é o caminho default).
- Tabela `song_snapshots` já aceita `catalog_track_id` nullable → o snapshot do bot cai no mesmo storage.

## Resultado final
- Coloca link → cria track → enfileira baseline → bot coleta na próxima rodada → grava snapshot real.
- Daí em diante, a cada 48h o cron enfileira coleta nova, bot tira print, grava em `song_snapshots`.
- Zero chamada de Spotify API pra `popularity`/`monthly_listeners`.

Posso executar?
