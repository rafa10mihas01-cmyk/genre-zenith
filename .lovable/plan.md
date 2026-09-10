# Cadastrar várias músicas de uma vez (até 20)

## O que muda para você

Na tela "Adicionar música", o campo do link passa a aceitar **vários links colados de uma vez** (um por linha, ou separados por vírgula/espaço), até 20.

- Se você colar **1 link**, tudo continua exatamente como é hoje.
- Se colar **2 ou mais**, aparece a **tela de lote**:
  1. O sistema identifica as músicas uma a uma (nome, artista, capa) e mostra a lista.
  2. Cada linha vem com o **gênero sugerido** já preenchido — você pode trocar o gênero de qualquer linha, ou aplicar um gênero para todas.
  3. Linhas com problema (link inválido, música já cadastrada) ficam marcadas e podem ser removidas do lote.
  4. Você escolhe o destino do lote: **distribuir no gênero** (fluxo normal de hoje) ou **enviar só para playlists escolhidas** (a busca de playlists que já existe).
  5. Ao confirmar, começa a **fila devagar**: uma música por vez, com pausa entre cada uma, barra de progresso ("7 de 20"), status por linha (ok / erro) e botão **Parar**.
  6. No fim: resumo com quantas entraram, quais falharam e botão **Tentar de novo só as que falharam**.

Nada roda em paralelo — é sempre uma chamada por vez, para não sobrecarregar o Spotify nem gerar bloqueio.

## Detalhes técnicos

- Alteração **somente no frontend**, em `src/components/catalogo/AddCatalogTrackDialog.tsx`. Nenhuma mudança de banco, engine ou Edge Function.
- Reuso integral das funções já existentes: `resolve-catalog-track`, `preview-distribute-catalog-track`, `distribute-catalog-track` e `place-catalog-track-on-playlist`.
- Parser de entrada: quebra por linha/vírgula/espaço, remove duplicados, valida link/URI/ID de faixa ou álbum, corta em 20 itens.
- Fila sequencial com `for...of` + `await`, delay de ~1,2 s entre itens e flag de cancelamento; erro em um item não interrompe os demais (fica registrado como falha).
- Estado por item: `pending | resolving | ready | sending | done | error`, com mensagem de erro traduzida (reaproveitando o mapa de erros atual).
- O fluxo de 1 link continua no caminho de código atual, sem regressão.
