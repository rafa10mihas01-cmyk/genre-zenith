# Phase 17-C — Observer VPS refactor

Este diretório contém **apenas artefatos a aplicar na VPS do Observer**
(repositório `spotify-pathfinder` / serviço Node + Playwright). Nada aqui
roda dentro do projeto Lovable.

## O que mudou

- `services/playlistScraper.js` reescrito do zero.
- DOM scraping (`document.querySelectorAll('[data-testid="tracklist-row"]')`) **eliminado**.
- Fonte única de dados: resposta da API interna
  `https://api-partner.spotify.com/pathfinder/v2/query`,
  campo `data.playlistV2.content.items[]`.

## Como aplicar

1. Na VPS, dentro do repositório do Observer, **substituir integralmente**
   `services/playlistScraper.js` pelo arquivo deste diretório.
2. Confirmar que o caller (provavelmente `server.js` no handler
   `GET /playlists/:id`) usa a assinatura:

   ```js
   const { scrapePlaylist } = require('./services/playlistScraper');
   const playlist = await scrapePlaylist(page, req.params.id);
   ```

3. `pm2 restart observer` (ou equivalente).
4. Validar:

   ```bash
   curl -s -H "x-observer-token: $TOKEN" \
     https://<observer-host>/playlists/37i9dQZF1DXcBWIGoYBM5M | jq '.tracks[0]'
   ```

   Deve retornar a estrutura completa (playcount, duration_ms, album.cover,
   artists[].uri, etc).

## Contrato de retorno

Ver JSDoc no topo de `services/playlistScraper.js`. Resumo por track:

```json
{
  "position": 1,
  "track_id": "…",
  "uri": "spotify:track:…",
  "name": "…",
  "playcount": 123456789,
  "duration_ms": 215000,
  "explicit": false,
  "album": { "name": "…", "uri": "spotify:album:…", "cover": "https://…" },
  "artists": [ { "name": "…", "uri": "spotify:artist:…" } ]
}
```

## Garantias

- **Não há fallback para DOM.** Se o Pathfinder não responder dentro de
  `timeoutMs` (default 25s), `scrapePlaylist` lança erro — caller decide
  retry / 502.
- Listener `page.on('response', …)` é registrado **antes** de `page.goto`
  para não perder a resposta inicial.
- `waitForResponse` resolve assim que aparecer uma resposta Pathfinder
  com `data.playlistV2` válido.
- Quando há múltiplas respostas Pathfinder (`fetchPlaylist`,
  `fetchPlaylistContents`, etc), escolhemos a que tem `playlistV2.uri`
  batendo com o `playlistId` pedido e maior número de items.
