# Contrato Bot VPS — Janelas de Tempo (24h / 7d / 28d)

> **Objetivo:** o número exibido no app precisa **bater 1:1 com o que o curador
> vê no Spotify for Artists**. Hoje o bot lê só uma janela (a default que aparece
> na tela). Vamos passar a coletar **três janelas** por playlist em cada visita.
>
> Decisão de produto: **24h** é a janela oficial usada para contar plays
> entregues no deal. 7d e 28d são guardadas para auditoria/visualização.

## 1. O que o bot precisa fazer no Spotify for Artists

Em cada visita à página de uma playlist, abrir o seletor de período e ler **as
três janelas** disponíveis:

| Filtro no Spotify          | Campo no payload |
|----------------------------|------------------|
| "Últimas 24 horas"         | `plays_24h`      |
| "Últimos 7 dias"           | `plays_7d`       |
| "Últimos 28 dias"          | `plays_28d`      |

Pular **"12 meses"** por enquanto (raramente útil, dobra o tempo de scrape).

Dica de implementação: alternar o filtro via clique no seletor, esperar o
número estabilizar (re-render do componente termina), ler o número, repetir.
Ordem sugerida: 24h → 7d → 28d (do mais recente pro mais antigo).

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
      "plays_24h": 412,
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

O endpoint **continua aceitando** o formato antigo:

```jsonc
{ "snapshots": [{ "plays": 2890, ... }] }
```

Quando só `plays` vier, o backend assume que é a janela **7d** (que era o
default histórico). Mas isso é fallback — o bot novo **deve sempre** mandar as
3 janelas.

### Regras

- Cada janela é **opcional** individualmente. Se uma não foi capturada (ex.: a
  playlist não tem dados de 24h ainda), envie `null` ou omita o campo. Não
  invente zero.
- Os 3 números são **valores absolutos da janela** lidos diretamente da tela —
  **não** é delta, **não** é acumulado.
- O backend grava em `curator_deal_snapshots.plays_24h / plays_7d / plays_28d`.
  O campo legado `plays` é preenchido automaticamente com a primeira janela
  disponível na ordem 24h → 7d → 28d.

## 3. Por que a janela oficial é 24h

- É o número que muda mais rápido — permite ver o efeito real de uma adição
  recente sem ruído de plays antigos da janela.
- Para pagar o curador (mexer com o dinheiro de cliente), a auditoria precisa
  ser do dia. Se ele coloca a música hoje, amanhã eu sei exatamente quanto
  rodou nas primeiras 24h.
- 7d e 28d ficam visíveis no app pra contexto/curva, mas não somam meta.

Se essa decisão mudar no futuro, é só trocar `curator_deals.payout_window`
para `7d` ou `28d` — o backend já suporta.

## 4. Frequência de coleta

Não muda. O bot continua respeitando `curator_deal_songs.auto_collect_interval_minutes`
e o sinal de `next_auto_collect_at`. A única mudança é **ler 3 números em vez de 1**
em cada visita.
