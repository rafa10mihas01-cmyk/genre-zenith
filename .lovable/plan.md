
# Nova regra de posicionamento de catálogo

## O que vai mudar (em linguagem de negócio)

1. **Playlists pequenas (≤ 5.000 seguidores)** — catálogo pode entrar em qualquer posição, inclusive na 1, desde que **nunca fique duas do catálogo em sequência** (sempre alterna com terceiros).
2. **Playlists grandes (> 5.000 seguidores)** — posições **1 a 5 ficam reservadas** para músicas de campanhas ativas / hot releases. Catálogo só pode entrar a partir da **posição 6**, mantendo a mesma alternância.
3. **Exceção da regra 2:** se a música do catálogo estiver amarrada a uma **campanha ativa**, ela pode ocupar 1-5 mesmo em playlist grande.
4. **Sempre** grava a posição no banco E manda para o Spotify — nunca mais "cai no fim da playlist" por default.

> Observação: o sistema hoje não tem métrica de "ouvintes mensais de playlist" (isso é métrica de artista). Vou usar **`followers` da playlist como proxy** — que é o número que já sustentamos em `managed_playlists.followers`. Se você quiser trocar depois pelo dado da VPS/observer, é só apontar a nova coluna.

---

## O que vou construir

### 1. Nova função SQL `fn_compute_catalog_target_position(playlist_id, spotify_track_id, is_campaign_active)`

Retorna a **primeira posição válida** para inserir a faixa, aplicando a regra acima. Passos:

1. Carrega a playlist inteira em ordem (`managed_playlist_tracks`).
2. Marca cada faixa como `catalog` (se aparece em `catalog_tracks`) ou `terceiro`.
3. Lê `followers` da playlist para escolher o piso: `1` (≤5k) ou `6` (>5k, exceto quando `is_campaign_active=true` → piso volta a `1`).
4. Percorre do piso até o fim procurando a primeira posição `p` onde: `faixa[p-1]` não é catálogo **e** `faixa[p]` (a que vai ser empurrada pra baixo) não é catálogo.
5. Se não achar nenhuma slot válido no meio, devolve `tracks_count` (append no fim) — cenário raro (playlist cheia de catálogo colado). Devolve também `reason` explicando a decisão.

### 2. Ajuste no worker `occupancy-executor`

- Antes do `addPlaylistTracks`, chama `fn_compute_catalog_target_position` passando um flag `is_campaign_active` (calculado com um `EXISTS` em campanhas ativas que referenciam a track).
- Passa `position` para o Spotify: `addPlaylistTracks(playlistId, [uri], token, { position })`.
- Grava `position` no `catalog_placements.position` no `markActive` (hoje está `NULL` pra tudo desde 26/jun).
- Passa `position` também para `mptInsertFromCatalog` para manter `managed_playlist_tracks.position` consistente localmente.

### 3. Log de auditoria da decisão

Estende `catalog_placement_execution_log` para gravar `position_reason` (ex.: `"pos=1 followers=3200 alt_ok"`, `"pos=6 hot_zone_skip"`, `"pos=42 fallback_append"`). Isso permite auditar depois se a regra está sendo respeitada em produção.

### 4. Correção do passivo (opcional, você aprova depois)

As ~583 placements de **Passa O Bigode 2** e **O Tbt que ele Quer** hoje estão empilhadas no FIM das playlists (posição relativa ~1.0). Depois da correção, posso rodar um "reposicionador" que remove essas faixas do fim e reinsere na posição correta — um lote controlado por playlist, respeitando rate limit do Spotify. **Isso não faz parte desta entrega inicial** — entrego a nova regra rodando pra frente e você decide se quer reprocessar o passivo.

---

## Ordem de execução

1. Migration: criar `fn_compute_catalog_target_position` + adicionar coluna `position_reason TEXT` em `catalog_placement_execution_log`.
2. Editar `supabase/functions/occupancy-executor/index.ts` para chamar a nova função, passar `position` pro Spotify e persistir.
3. Deploy da edge function.
4. Validação em produção: rodar 5-10 minutos, ler `catalog_placement_execution_log` e conferir que `position_reason` bate com a regra.

---

## Perguntas antes de eu apertar o botão

- **Confirma que `followers` é o número certo pra usar como corte de 5.000?** (é o que temos hoje). Se você tem outra fonte, me diga qual coluna/tabela.
- **"Hot release" (>5k, posições 1-5)** — considero como "hot" apenas músicas com **campanha ativa vinculada**? Ou você quer também uma flag manual tipo `catalog_tracks.is_hot_release`?
- **Reprocessar o passivo** de Passa O Bigode + O Tbt depois? (recomendo fortemente — hoje elas estão invisíveis no fim de ~583 playlists).
