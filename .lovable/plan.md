## Objetivo
Limpar as 136 playlists de teste vinculadas ao curador **Manolo** (`d1f15533-5a67-44e8-97ee-8cea04802df4`), mantendo intactos:
- O cadastro do curador
- O deal/campanha de teste
- A música do deal
- A compra registrada

## O que será apagado
- **136 linhas** em `curator_playlist_library` onde `curator_id = 'd1f15533-...'`

## O que NÃO será tocado
- `curators` (Manolo continua lá)
- `curator_deals` (1 deal preservado)
- `curator_deal_songs` (1 música preservada)
- `curator_purchases` (1 compra preservada)
- Qualquer dado de outros curadores

## Execução
1 comando de `DELETE` filtrado pelo `curator_id` do Manolo. Quando ele começar a cadastrar as novas playlists pelo portal, a biblioteca dele vai estar zerada.
