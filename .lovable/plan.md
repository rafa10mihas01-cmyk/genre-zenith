# Enviar música para uma playlist específica (inclusive duplicada)

## O que você quer
Na tela de adicionar música do Catálogo, quando a faixa já está cadastrada e o sistema diz "não falta nenhuma playlist", você quer uma busca para escolher **uma playlist específica** e mandar a música para ela — mesmo que ela já esteja lá (segunda cópia proposital).

## Como funciona hoje
- A tela só trabalha por **gênero**: ela pega todas as playlists do gênero e joga a música nas que ainda não têm.
- Existe uma trava no banco que impede a mesma música ter duas entradas vivas na mesma playlist. Foi ela que evitou muita sujeira no passado, então não vou removê-la — vou torná-la consciente de "cópia 1" e "cópia 2".

## O que vou construir

### 1. Busca de playlist na tela de adicionar música
Na etapa de revisão (a da imagem), abaixo dos cartões de números:
- Campo "Buscar playlist" com resultados ao digitar (nome da playlist, gênero, seguidores).
- A busca mostra todas as playlists operáveis, inclusive as que **já têm** a música — essas ganham uma marca "já contém".
- Ao escolher uma playlist, aparece um botão "Enviar só para esta playlist".
- Se a playlist escolhida já contém a música, aparece um aviso claro: "Esta playlist já tem a música. Confirmar vai criar uma segunda entrada." com confirmação explícita.
- O botão "Distribuir para N playlists" continua exatamente como está — nada do fluxo atual muda.

### 2. Envio direcionado no backend
- Nova função de banco que recebe a música + uma playlist específica + a marcação de "cópia extra permitida", e cria a entrada de distribuição só para aquela playlist.
- A trava de duplicidade passa a considerar o número da cópia: cópia 1 continua protegida contra duplicação acidental; uma cópia 2 só existe quando você pedir explicitamente pela nova busca.
- A execução (que efetivamente coloca a faixa na playlist no Spotify) reaproveita a fila já existente — nenhum executor novo.
- Registro no log de origem indicando que foi envio manual direcionado, para auditoria.

### 3. Proteções mantidas
- Playlists sem autorização válida ou marcadas para não operar continuam fora da busca.
- Máximo de 2 cópias da mesma música na mesma playlist.
- Campanhas e prioridade de posição seguem intocadas.

## Detalhes técnicos
- Frontend: `src/components/catalogo/AddCatalogTrackDialog.tsx` (etapa `preview`), busca via consulta a `managed_playlists` filtrando `execution_mode='API_READY'` e `operational_status <> 'do_not_operate'`, com marcação de presença via `catalog_placements` + `managed_playlist_tracks`.
- Banco: coluna `copy_index smallint NOT NULL DEFAULT 1` em `catalog_placements`; índices únicos parciais `idx_catalog_placements_unique_alive` e `ux_catalog_placements_active_track_playlist` recriados incluindo `copy_index`; nova RPC `engine_place_catalog_track_on_playlist(p_track_id uuid, p_playlist_id uuid, p_allow_duplicate boolean)`.
- Edge Function: novo endpoint fino `place-catalog-track-on-playlist` seguindo o padrão de `distribute-catalog-track` (mesmo guard de acesso da equipe), sem duplicar lógica de resolução de faixa.
- `engine_create_distribution_plan` permanece inalterada (continua criando sempre `copy_index = 1`).
