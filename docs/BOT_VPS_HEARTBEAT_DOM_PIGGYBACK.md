# Piggyback DOM no `bot-heartbeat`

> **Atalho operacional:** o bot pode enviar `dom_snapshots[]` junto com o
> heartbeat. O endpoint processa cada item com a mesma lógica de
> `/bot-ingest-dom`. Use isso quando não quiser/poder fazer outra request
> separada.

## Payload

```jsonc
POST /bot-heartbeat
Headers:
  x-bot-key: <BOT_API_KEY>
  Content-Type: application/json
Body:
{
  "spotify_session_valid": true,
  "processing_correlation_ids": ["..."],

  // NOVO — opcional
  "dom_snapshots": [
    {
      "deal_id": "uuid",
      "song_id": "uuid",
      "correlation_id": "uuid",          // do item recebido em bot-collect-queue
      "playlists": [
        {
          "playlist_name": "Funk 2025",
          "spotify_url": "https://open.spotify.com/playlist/...",
          "plays_24h": 412,
          "plays_7d":  2890,
          "plays_28d": 11320,
          "followers": 18234,
          "source": "spotify_for_artists"
        }
      ],
      "note": "coleta diária"            // opcional
    }
  ]
}
```

## Resposta

```jsonc
{
  "ok": true,
  "dom_results": [
    { "song_id": "...", "ok": true, "inserted": 12, "skipped": 0 }
  ]
}
```

## Regras

- `dom_snapshots` é **opcional**. Heartbeats sem ele continuam funcionando como hoje.
- Cada item é processado individualmente — falha de um não derruba os outros.
- Dedupe de 90s (mesmo do `/bot-ingest-dom`) continua valendo, então enviar
  duas vezes em janela curta é seguro.
- Após sucesso: `auto_collect_status` volta para `idle`, `queued_at` é limpo,
  `next_auto_collect_at` é re-agendado para `now + auto_collect_interval_minutes`.
- `/bot-ingest-dom` continua existindo e funcionando — ambos caminhos coexistem.

## Quando preferir cada caminho

| Caminho | Quando usar |
|---|---|
| `POST /bot-ingest-dom`         | Bot já tem chamada explícita ao endpoint funcionando. |
| `POST /bot-heartbeat` (piggyback) | Não dá pra atualizar o dist do bot rapidamente; o heartbeat já roda. |
