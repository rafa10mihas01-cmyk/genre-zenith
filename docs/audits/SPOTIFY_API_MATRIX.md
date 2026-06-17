# SPOTIFY API — MATRIZ DE FONTES

**Fase:** 6.A.1 · Read-only.

Para cada tipo de informação relevante, mostramos quem produz e qual deve ser a **fonte oficial**.

Legenda:
- ✅ = produz / persiste o dado
- 🟡 = produz mas como espelho/aproximação
- ❌ = não produz
- 🏆 = **fonte oficial recomendada**

| Informação | VPS Bot (bot-ingest-snapshot) | Spotify API | Banco (estado materializado) | Fonte oficial |
|---|---|---|---|---|
| **Streams diários (last_24h)** | ✅ via label spreadsheet (`plays_7d` = janela 24h) | ❌ (API não devolve plays) | `label_spreadsheet_rows`, `song_snapshots` | 🏆 **VPS** |
| **Streams totais campanha** | ✅ (agregado por `fn_campaign_delivery_accumulated`) | ❌ | `campaigns.delivery_total_*` | 🏆 **VPS → função SQL** |
| **Followers de playlist** | 🟡 (DOM, arredondado >1k) | ✅ (`/v1/playlists/{id}?fields=followers.total`) | `playlists.followers_count`, `playlist_followers_snapshots`, `followers_source` | 🏆 **Spotify API** (VPS = observacional) |
| **Followers de artista (cliente)** | ❌ | ✅ (`/v1/artists/{id}`) | `clients.followers_count`, `spotify_artist_cache` | 🏆 **Spotify API** |
| **Playlist Name** | 🟡 (texto cru da XLSX) | ✅ (`/v1/playlists/{id}?fields=name`) | `playlists.name`, `curator_playlists.name` | 🏆 **Spotify API** (XLSX só preenche se ID ausente) |
| **Playlist URL** | 🟡 (XLSX traz link) | ✅ (construível a partir do ID) | `playlists.url` | 🏆 **derivada do `spotify_playlist_id`** |
| **Playlist Position (ordem da track)** | 🟡 (screenshot mostra ordem visual) | ✅ (`/v1/playlists/{id}/items` retorna em ordem) | `managed_playlist_tracks.position`, `observer_playlist_tracks.position` | 🏆 **Spotify API** |
| **Playlist Image (capa)** | ❌ | ✅ (`fields=images`) | `playlists.image_url`, `curator_playlists.image_url` | 🏆 **Spotify API** |
| **Playlist Owner** | ❌ | ✅ (`fields=owner`) | `playlists.owner_*`, `managed_playlists.owner_id` | 🏆 **Spotify API** |
| **Track Metadata** (nome, duração, álbum) | 🟡 (parse de print) | ✅ (`/v1/tracks/{id}`) | `spotify_track_cache`, `catalog_tracks` | 🏆 **Spotify API → cache** |
| **Track URI / spotify_track_id** | ✅ (extraído do print/HAR) | ✅ | `catalog_tracks.spotify_track_id`, `curator_deal_songs.spotify_track_id` | 🏆 **VPS** (descobre); **Spotify API** valida |
| **Artist Metadata** (nome, imagem) | ❌ | ✅ (`/v1/artists/{id}`) | `spotify_artist_cache` | 🏆 **Spotify API → cache** |
| **Track presence em playlist (membership)** | ❌ | ✅ (`/v1/playlists/{id}/items`) | `managed_playlist_tracks`, `delivery_proofs` | 🏆 **Spotify API** |
| **Snapshot diário de tracks de playlist** | ❌ | ✅ (snapshot-playlist-tracks) | `playlist_track_snapshots` | 🏆 **Spotify API** |
| **Charts editoriais (paradas)** | ❌ | ✅ (`charts.spotify.com` scraping) | `raw_chart_daily`, `editorial_history` | 🏆 **Spotify Charts** |
| **OAuth tokens (user)** | ❌ | ✅ (`/api/token`) | `spotify_user_tokens` (refresh via watchdog) | 🏆 **Spotify OAuth** |
| **OAuth tokens (app — client credentials)** | ❌ | ✅ (`/api/token`) | em memória + cache `spotify_apps` | 🏆 **Spotify OAuth** |
| **Genre/Subgenre de track** | ❌ | 🟡 (via artistas) | `genres`, `track_playlist_fit`, `playlist_genres` | 🏆 **Banco** (derivado interno) |

---

## Regra geral

1. **Tudo que envolve QUANTIDADE de plays → VPS** (única fonte de plays na arquitetura).
2. **Tudo que envolve IDENTIDADE, METADATA ou MEMBERSHIP → Spotify API.**
3. **Mutações em playlists → Spotify API obrigatoriamente** (via helpers `_shared/spotify-playlist.ts`).
4. **Banco materializa**; pipelines de leitura **nunca** devem ir direto à Spotify sem passar pelos caches (`spotify_track_cache`, `spotify_artist_cache`, `spotify_playlist_cache`).
