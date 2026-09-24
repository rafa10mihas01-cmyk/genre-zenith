# Separar playlists de Campanha e de Catálogo ao adicionar música

## Boa notícia
O sistema já tem essa separação guardada: hoje existem **198 playlists marcadas como Campanha** e **650 como Catálogo** (mais 50 arquivadas). Só que a tela de adicionar música ignora essa marca e manda para todas do gênero. Então não precisa criar nada novo: é só passar a usar a marca que já existe.

## O que muda para você

### 1. Marcar uma playlist como Campanha ou Catálogo
Na lista de Playlists, cada linha ganha um seletor simples **Campanha / Catálogo**. Você troca com um clique. Também dá para marcar várias de uma vez: seleciona e escolhe "Marcar como Campanha".

### 2. Escolher o tipo ao adicionar música
Logo antes de ver o resumo, aparece uma escolha: **Catálogo (normal)** ou **Campanha**.

- **Catálogo (normal)**: funciona como hoje, mas só com as playlists de Catálogo do gênero. As de Campanha ficam protegidas e não recebem música automaticamente. **Não tem cópia duplicada**: se a playlist já tem a música, ela fica de fora.
- **Campanha**: mostra só as playlists de Campanha do gênero. Você escolhe uma por uma quais vão receber a música, e não existe botão "mandar para todas". A cópia duplicada continua aqui, com o mesmo aviso de hoje ("essa playlist já tem a música, quer duplicar?").

O envio de várias músicas de uma vez (até 20) segue a mesma escolha.

### 3. O que continua igual
- Playlists sem autorização ou marcadas para não operar continuam fora.
- A música continua entrando no fim da playlist.
- A fila de inserção, as campanhas e as entregas não mudam.

## Ponto de atenção
As 198 marcadas hoje como Campanha vêm de uma classificação antiga. Assim que isso entrar no ar, elas deixam de receber música automática. Vale revisar a lista logo no primeiro dia.

## Detalhes técnicos
- Reusa a coluna `managed_playlists.playlist_type` (CAMPAIGN/CATALOG). Não cria tabela nova.
- `engine_create_distribution_plan`: só um filtro novo, `playlist_type = 'CATALOG'`. As contagens do preview usam o mesmo filtro.
- `engine_place_catalog_track_on_playlist`: `p_allow_duplicate` só é aceito quando a playlist é CAMPAIGN. No catálogo, se a música já estiver lá, a resposta é "já contém".
- `AddCatalogTrackDialog.tsx`: novo seletor de modo. No modo Campanha, a busca filtra `playlist_type='CAMPAIGN'` e o botão de distribuir para o gênero todo fica escondido. No modo Catálogo, a busca filtra CATALOG e a opção de duplicar sai.
- `PlaylistsTab`: seletor de tipo na linha e ação em massa. A atualização é feita direto na tabela, como os outros campos já editados ali.
