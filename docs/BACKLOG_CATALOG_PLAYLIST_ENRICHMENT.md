# Backlog — Enriquecimento de playlists no modo catálogo

**Prioridade:** P2 (melhoria funcional, não bloqueia operação)
**Aberto em:** 16/06/2026
**Origem:** Investigação pós-incidente de coleta de catálogo (Menina Foguenta, job `626566b0`).

---

## Status atual

Fluxo de catálogo (`kind: catalog` no worker VPS) está **operacional** e produz snapshots válidos em `song_snapshots`.

### Campos coletados hoje
- `catalog_track_id`
- `total_plays_28d`
- `screenshot_url`
- `captured_at`
- `bot_metadata`

---

## Comportamento confirmado

Análise dos POSTs em `bot_ingest_raw` (snapshots de catálogo de 14/06 + atual):

| Snapshot                | Data         | Modo    | Payload  | `playlists[]` |
|-------------------------|--------------|---------|----------|---------------|
| `63c1326e` (referência) | 14/06 19:13  | catalog | 1.003 B  | **0**         |
| `5f3263b0` (referência) | 14/06 19:14  | catalog | 1.003 B  | **0**         |
| `1ba1daae` (atual)      | 16/06 19:03  | catalog | 1.097 B  | **0**         |
| `ffeef7f1` (deal)       | 16/06 15:42  | deal    | 18.900 B | 99            |
| `3c99512b` (deal)       | 14/06 21:23  | deal    | 26.316 B | 99            |

**Conclusão:** `playlists: []` em catálogo **não é regressão** — é o comportamento original do worker. Os snapshots de referência usados como prova de "fluxo correto" também chegaram sem playlists individuais.

---

## Diferença entre os dois modos do worker

| Etapa                              | `kind: deal` | `kind: catalog` |
|------------------------------------|:------------:|:---------------:|
| Lê `total_plays_28d` (header)      | ✅           | ✅              |
| Captura screenshot                 | ✅           | ✅              |
| Abre página Playlists              | ✅           | ❌              |
| Aplica filtro 7 dias               | ✅           | ❌              |
| Pagina resultados                  | ✅           | ❌              |
| Extrai `[data-testid="row"]`       | ✅           | ❌              |
| Monta `playlists[]` com `plays_7d` | ✅           | ❌              |
| POST `bot-ingest-song-snapshot`    | ✅           | ✅              |

---

## Impacto

**Nenhum impacto na coleta de evolução da faixa.** Catálogo continua produzindo snapshots válidos para:
- histórico de streams
- telemetria de crescimento
- comparação temporal
- monitoramento de catálogo

### Limitação atual
- `song_snapshot_playlists` permanece vazio para snapshots de catálogo
- Não há ranking de playlists por faixa de catálogo
- Não há análise de contribuição por playlist
- Não há paridade com o enriquecimento do fluxo de deal

---

## Melhoria proposta

Reaproveitar, no handler `spotify.catalog.collect` do worker, o mesmo extrator de tabela de playlists já usado em `spotify.deal.collect`.

### Fluxo desejado

```text
catalog.collect
   │
   ▼
lê total_plays_28d
   │
   ▼
abre página Playlists
   │
   ▼
aplica filtro 7 dias
   │
   ▼
extrai linhas da tabela ([data-testid="row"])
   │
   ▼
monta playlists[]  (spotify_playlist_id, name, owner, plays_7d)
   │
   ▼
upload screenshot
   │
   ▼
POST bot-ingest-song-snapshot  (catalog_track_id + total_plays_28d + playlists[])
```

### Resultado esperado
- Snapshots de catálogo enriquecidos com lista de playlists
- `song_snapshot_playlists` populado também no modo catálogo
- Atribuição por playlist disponível para faixas do catálogo
- Paridade funcional entre deal e catálogo

---

## Onde mexer

- **Worker VPS** (repositório externo, não vive neste projeto): handler `kind: catalog` precisa chamar o mesmo extrator de tabela usado em `kind: deal`.
- **Backend (este projeto):** **nenhuma mudança necessária.** `bot-ingest-song-snapshot` já aceita `playlists[]` no modo catálogo e já grava em `song_snapshot_playlists` via `snapshot_id`. A distribuição pra `campaign_playlist_collections` continua pulada em catálogo (correto — catálogo não tem deal/campanha).

---

## Critérios de aceite

1. Um job `kind: catalog` resulta em POST com `payload_size_bytes` > 5 KB e `jsonb_array_length(payload_json->'playlists') >= 1` (quando S4A retornar linhas).
2. `song_snapshot_playlists` recebe N linhas para o `snapshot_id` gerado.
3. Sem regressão no modo deal.

---

## Referências
- Incidente original: investigação 14–16/06/2026 (coleta de catálogo da Menina Foguenta).
- Snapshot atual de referência: `483aee65-2bb8-4e37-89c4-be3b6c69a415` (`catalog_track_id = 4a383b97-36c4-4873-9eab-8ffd1083f6b7`, `total_plays_28d = 545`).
- Contrato do worker: `docs/QUEUE_WORKER_CONTRACT.md` e `docs/BOT_VPS_CONTRACT.md`.
