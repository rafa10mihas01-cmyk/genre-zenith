# Contrato Bot VPS — Janelas de Tempo (7d / 28d)

> **Objetivo:** o número exibido no app precisa **bater 1:1 com o que o curador
> vê no Spotify for Artists**. O bot coleta **duas janelas** por playlist em
> cada visita.
>
> Decisão de produto (atualizada): a janela oficial usada para contar plays
> entregues no deal é **7 dias**. 28d é guardada para auditoria/visualização.
> A janela **24h foi descontinuada** — não precisa mais ser coletada nem
> exibida. O backend continua aceitando `plays_24h` em payloads antigos por
> compatibilidade, mas o bot novo **não deve mais abrir o seletor de 24h**.

## 1. O que o bot precisa fazer no Spotify for Artists

Em cada visita à página de uma playlist, abrir o seletor de período e ler
**as duas janelas** abaixo:

| Filtro no Spotify          | Campo no payload |
|----------------------------|------------------|
| "Últimos 7 dias"           | `plays_7d`       |
| "Últimos 28 dias"          | `plays_28d`      |

Pular **"Últimas 24 horas"** e **"12 meses"**. Isso economiza ~33% do tempo
de scrape por playlist.

Dica de implementação: alternar o filtro via clique no seletor, esperar o
número estabilizar (re-render do componente termina), ler o número, repetir.
Ordem sugerida: 7d → 28d.

## 2. Novo formato do payload — `POST /bot-ingest-snapshot`

```jsonc
{
  "deal_id": "...",
  "song_id": "...",
  "correlation_id": "<uuid>",
  "snapshots": [
    {
      "playlist_name": "Funk 2025",
      "spotify_url": "https://open.spotify.com/playlist/...",
      "plays_7d":  2890,
      "plays_28d": 11320,
      "followers": 18234,
      "source": "spotify_for_artists"
    }
  ],
  "print_urls": ["..."],
  "note": "..."
}
```

### Compatibilidade retroativa

O endpoint **continua aceitando**:

- `plays_24h` (descontinuado, ignorado para cálculo de entrega mas gravado se vier).
- O formato legado `{ "plays": N }` — quando só `plays` vier, o backend assume
  que é a janela **7d**.

### Regras

- Cada janela é **opcional** individualmente. Se uma não foi capturada, envie
  `null` ou omita o campo. Não invente zero.
- Os números são **valores absolutos da janela** lidos diretamente da tela —
  **não** é delta, **não** é acumulado.
- O backend grava em `curator_deal_snapshots.plays_7d / plays_28d` (a coluna
  `plays_24h` continua no schema só pra histórico). O campo legado `plays` é
  preenchido automaticamente com a primeira janela disponível na ordem
  **7d → 28d → 24h (compat) → 0**.

## 3. Por que a janela oficial é 7d

- É a janela default que o curador vê quando abre o Spotify for Artists.
- É estável o suficiente pra suavizar ruído diário (picos, falhas de coleta).
- Não exige abrir o seletor — o bot pode capturar direto e gastar menos tempo.
- 28d continua visível no app pra contexto/curva, mas não soma meta.

Se essa decisão mudar no futuro, é só trocar `curator_deals.payout_window`
para `28d` — o backend já suporta.

## 4. Frequência de coleta

O bot continua respeitando `curator_deal_songs.auto_collect_interval_minutes`
e o sinal de `next_auto_collect_at`. Recomendação operacional: rodar a cada
48h (≈ 2880 minutos) é suficiente, já que a janela de 7d é móvel e absorve
variações diárias.
